/**
 * نظام التخزين الذري المقاوم لانهيار النظام وتلف البيانات
 * Atomic File Storage & Safe JSON Persistence
 * معالجة نتائج التدقيق: H4 (الكتابة الذرية وسلامة البيانات) و L1 (توقيت اليمن UTC+3)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * الحصول على الوقت الحالي بتوقيت اليمن الرسمي (Asia/Aden - UTC+3)
 */
export function getYemenDateTimeString(date = new Date()): string {
  // Format: YYYY-MM-DD HH:mm
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Aden',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';
  
  const y = getPart('year');
  const m = getPart('month');
  const d = getPart('day');
  const hour = getPart('hour');
  const min = getPart('minute');

  return `${y}-${m}-${d} ${hour}:${min}`;
}

/**
 * الحصول على الطابع الزمني بتوقيت اليمن مع الثواني
 */
export function getYemenFullTimestamp(date = new Date()): string {
  return `${getYemenDateTimeString(date)}:${String(date.getSeconds()).padStart(2, '0')} (UTC+3)`;
}

/**
 * كتابة ذرية آمنة للملفات (Atomic Write via .tmp + rename)
 * يمنع تلف ملفات JSON عند انقطاع التيار الكهربائي أو إيقاف السيرفر المفاجئ
 */
export function safeAtomicWriteJson(filePath: string, data: any): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const serialized = JSON.stringify(data, null, 2);
  const randomSuffix = crypto.randomBytes(6).toString('hex');
  const tmpPath = `${filePath}.tmp.${Date.now()}.${randomSuffix}`;

  try {
    // 1. كتابة الملف المؤقت
    const fd = fs.openSync(tmpPath, 'w');
    fs.writeSync(fd, serialized, 0, 'utf-8');
    // 2. إجبار نظام الملفات على الكتابة للقرص الفعلي (Flush to Disk)
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    // 4. في safeAtomicWriteJson احتفظ بنسخة .bak من الملف السابق قبل الاستبدال (N2)
    if (fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, `${filePath}.bak`);
      } catch (bakErr) {
        console.warn(`[AtomicStorage BACKUP] Failed to create .bak for ${filePath}:`, bakErr);
      }
    }

    // 3. إعادة التسمية الذرية (Atomic Rename)
    fs.renameSync(tmpPath, filePath);
  } catch (err: any) {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup error
      }
    }
    console.error(`[AtomicStorage ERROR] Failed to write atomically to ${filePath}:`, err);
    throw new Error(`فشل الحفظ الآمن للملف (${path.basename(filePath)}): ${err.message}`);
  }
}

/**
 * قراءة آمنة لملف JSON مع حماية ضد بلع الأخطاء وتدمير البيانات السابقة (N2)
 */
export function safeReadJson<T>(
  filePath: string,
  defaultData: T,
  options: { failOnCorruption?: boolean } = { failOnCorruption: true }
): T {
  const failOnCorruption = options.failOnCorruption !== false;

  if (!fs.existsSync(filePath)) {
    // الإنشاء بالافتراضيات فقط إذا كان الملف غير موجود
    safeAtomicWriteJson(filePath, defaultData);
    return defaultData;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    // N2: الملف الفارغ أو المقطوع يُعامل كتالف (الإنشاء بالافتراضيات فقط إذا كان الملف غير موجود)
    if (!raw.trim()) {
      throw new Error('الملف فارغ أو مقطوع (0 بايت أو مسافات فقط)');
    }
    return JSON.parse(raw) as T;
  } catch (err: any) {
    console.error(`[AtomicStorage FATAL] Corrupted JSON detected in ${filePath}:`, err.message);

    // 3. عند التلف: احفظ نسخة .corrupt.<وقت> وأوقف التشغيل برسالة عربية واضحة تذكر الملف وتشير إلى .bak
    const corruptBackup = `${filePath}.corrupt.${Date.now()}`;
    try {
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, corruptBackup);
        console.warn(`[AtomicStorage BACKUP] Corrupted file preserved at: ${corruptBackup}`);
      }
    } catch {
      // Ignore
    }

    if (failOnCorruption) {
      throw new Error(
        `خطأ حرج في سلامة البيانات (N2): الملف (${path.basename(filePath)}) تالف أو مقطوع أو غير صالح كـ JSON (${err.message}). تم إيقاف النظام لمنع تصفير البيانات أو استبدال الأرصدة. تم حفظ نسخة تالفة في (${path.basename(corruptBackup)}). يمكنك فحص النسخة الاحتياطية (${path.basename(filePath)}.bak) يدوياً.`
      );
    }

    return defaultData;
  }
}
