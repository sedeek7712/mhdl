/**
 * سجل الإرسال المركزي المستقل - نظام عمرو النماري للصرافة
 * Independent Production-Grade WhatsApp Dispatch Registry with Disk Persistence & Idempotency
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WhatsAppDispatchRecord, WhatsAppLifecycleStatus, WhatsAppVoucherSnapshot } from '../types/whatsapp.js';
import { safeAtomicWriteJson } from '../utils/atomicFileStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data files paths
const DATA_DIR = process.env.NODE_ENV === 'test' && process.env.ALNAMARI_TEST_DATA_DIR
  ? path.resolve(process.env.ALNAMARI_TEST_DATA_DIR)
  : path.resolve(__dirname, '../../../data');
const REGISTRY_FILE = path.resolve(DATA_DIR, 'whatsapp_dispatch_registry.json');
const ARCHIVE_DIR = path.resolve(DATA_DIR, 'archived_vouchers');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(ARCHIVE_DIR)) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

class DispatchRegistry {
  private records: Map<string, WhatsAppDispatchRecord> = new Map();
  private voucherToRecordId: Map<string, string> = new Map();
  private messageIdToRecordId: Map<string, string> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  private buildIndexes(list: WhatsAppDispatchRecord[]) {
    if (!Array.isArray(list)) throw new Error('توقف آمن: سجل WhatsApp يجب أن يكون مصفوفة سجلات.');
    const records = new Map<string, WhatsAppDispatchRecord>();
    const voucherToRecordId = new Map<string, string>();
    const messageIdToRecordId = new Map<string, string>();
    const idempotencyKeys = new Set<string>();
    const statuses: WhatsAppLifecycleStatus[] = [
      'PENDING', 'GENERATING', 'GENERATED', 'UPLOADING', 'UPLOADED',
      'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RETRY_PENDING',
    ];

    for (const item of list) {
      if (!item || typeof item !== 'object' ||
          typeof item.id !== 'string' || !item.id.trim() ||
          typeof item.voucherNumber !== 'string' || !item.voucherNumber.trim() ||
          typeof item.transactionId !== 'string' || !item.transactionId.trim() ||
          typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt)) ||
          typeof item.idempotencyKey !== 'string' || !item.idempotencyKey.trim() ||
          typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256) ||
          !Number.isSafeInteger(item.fileSizeBytes) || item.fileSizeBytes <= 0 ||
          !statuses.includes(item.status) ||
          !item.snapshot || typeof item.snapshot !== 'object' || Array.isArray(item.snapshot) ||
          (item.rawWebhookEvents !== undefined && !Array.isArray(item.rawWebhookEvents))) {
        throw new Error('توقف آمن: سجل WhatsApp يحتوي على سجل ناقص أو غير صالح؛ لم يتم تحميل سجل فارغ.');
      }
      if (records.has(item.id) || voucherToRecordId.has(item.voucherNumber) ||
          idempotencyKeys.has(item.idempotencyKey) ||
          (item.whatsappMessageId && messageIdToRecordId.has(item.whatsappMessageId))) {
        throw new Error('توقف آمن: سجل WhatsApp يحتوي على معرف أو رقم سند أو مفتاح تكرار أو رسالة مكررة.');
      }
      records.set(item.id, item);
      voucherToRecordId.set(item.voucherNumber, item.id);
      idempotencyKeys.add(item.idempotencyKey);
      if (item.whatsappMessageId) messageIdToRecordId.set(item.whatsappMessageId, item.id);
    }
    return { records, voucherToRecordId, messageIdToRecordId };
  }

  private applyIndexes(indexes: ReturnType<DispatchRegistry['buildIndexes']>): void {
    this.records = indexes.records;
    this.voucherToRecordId = indexes.voucherToRecordId;
    this.messageIdToRecordId = indexes.messageIdToRecordId;
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(REGISTRY_FILE)) return;
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8');
    if (!raw.trim()) throw new Error('توقف آمن: سجل WhatsApp فارغ أو مقطوع.');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('توقف آمن: بنية سجل WhatsApp غير صالحة.');
    const indexes = this.buildIndexes(parsed as WhatsAppDispatchRecord[]);
    this.applyIndexes(indexes);
    console.log(`[WhatsApp Registry] Loaded ${this.records.size} validated dispatch records from disk.`);
  }

  private persistRecords(nextRecords: WhatsAppDispatchRecord[]): void {
    const indexes = this.buildIndexes(nextRecords);
    // Persist first. In-memory indexes are replaced only after the atomic disk write succeeds.
    safeAtomicWriteJson(REGISTRY_FILE, nextRecords);
    this.applyIndexes(indexes);
  }

  private persistRecord(nextRecord: WhatsAppDispatchRecord): void {
    const nextRecords = Array.from(this.records.values()).filter((item) => item.id !== nextRecord.id);
    nextRecords.push(nextRecord);
    this.persistRecords(nextRecords);
  }

  /**
   * حساب بصمة SHA-256 للملف للتأكد من سلامته وربطه بالسجل المالي
   */
  public calculateSha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * حفظ نسخة أرشيفية دائمة لصورة السند على القرص مرتبطة بالبصمة
   */
  public archiveVoucherImage(buffer: Buffer, voucherNumber: string, sha256: string): string {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > 2.5 * 1024 * 1024) {
      throw new Error('حجم صورة السند غير صالح للأرشفة.');
    }
    if (typeof voucherNumber !== 'string' || !voucherNumber.trim() ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256) ||
        this.calculateSha256(buffer) !== sha256.toLowerCase()) {
      throw new Error('بصمة صورة السند أو رقم السند غير صالح.');
    }

    const isPng = buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (!isPng && !isJpeg) throw new Error('لا يمكن أرشفة ملف ليس PNG أو JPEG.');
    const cleanNum = voucherNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
    const extension = isPng ? 'png' : 'jpg';
    const filename = `${cleanNum}_${sha256.substring(0, 12)}.${extension}`;
    const filepath = path.resolve(ARCHIVE_DIR, filename);

    if (fs.existsSync(filepath)) {
      const existing = fs.readFileSync(filepath);
      if (this.calculateSha256(existing) !== sha256.toLowerCase()) {
        throw new Error('تعارض في ملف أرشيف السند الموجود مسبقاً.');
      }
      return filename;
    }

    const tempPath = `${filepath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
    let fd: number | undefined;
    try {
      fd = fs.openSync(tempPath, 'wx', 0o600);
      fs.writeFileSync(fd, buffer);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tempPath, filepath);
      return filename;
    } catch (error) {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { /* best-effort descriptor cleanup */ }
      }
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* best-effort temp cleanup */ }
      throw new Error(`تعذر حفظ أرشيف صورة السند ذرياً: ${error instanceof Error ? error.message : 'خطأ تخزين غير معروف'}`);
    }
  }

  /**
   * التحقق من منع تكرار الإرسال (Idempotency Check)
   */
  public checkIdempotency(voucherNumber: string, forceRetry = false): {
    canSend: boolean;
    existingRecord?: WhatsAppDispatchRecord;
    reason?: string;
  } {
    const recordId = this.voucherToRecordId.get(voucherNumber);
    if (!recordId) {
      return { canSend: true };
    }

    const record = this.records.get(recordId);
    if (!record) {
      return { canSend: true };
    }

    // إذا طلب المستخدم إعادة الإرسال الصريحة (Explicit Retry)
    if (forceRetry) {
      return { canSend: true, existingRecord: record };
    }

    // إذا كان السند قيد الإرسال أو تم إرساله بنجاح
    if (['SENDING', 'UPLOADING'].includes(record.status)) {
      const elapsed = Date.now() - new Date(record.createdAt).getTime();
      if (elapsed < 30000) { // أقل من 30 ثانية
        return {
          canSend: false,
          existingRecord: record,
          reason: 'السند قيد الإرسال حالياً لمزود WhatsApp، يرجى الانتظار لتفادي التكرار.',
        };
      }
    }

    if (['SENT', 'DELIVERED', 'READ'].includes(record.status)) {
      return {
        canSend: false,
        existingRecord: record,
        reason: `تم إرسال هذا السند مسبقاً للعميل (الحالة: ${record.status} بمعرف: ${record.whatsappMessageId}). اضغط على إعادة الإرسال الصريحة إذا كنت ترغب بإرسال نسخة جديدة.`,
      };
    }

    return { canSend: true, existingRecord: record };
  }

  /**
   * إنشاء سجل إرسال جديد أو تهيئة محاولة جديدة
   */
  public createOrUpdateAttempt(params: {
    voucherNumber: string;
    transactionId: string;
    voucherType: string;
    recipientPhone: string;
    caption: string;
    sha256: string;
    fileSizeBytes: number;
    storageKey: string;
    employeeId?: string;
    employeeName?: string;
    snapshot: WhatsAppVoucherSnapshot;
    idempotencyKey?: string;
  }): WhatsAppDispatchRecord {
    const existingId = this.voucherToRecordId.get(params.voucherNumber);
    const existing = existingId ? this.records.get(existingId) : null;

    const recordId = existing ? existing.id : `disp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    const record: WhatsAppDispatchRecord = {
      id: recordId,
      transactionId: params.transactionId,
      voucherNumber: params.voucherNumber,
      voucherType: params.voucherType,
      recipientPhone: params.recipientPhone,
      sha256: params.sha256,
      fileSizeBytes: params.fileSizeBytes,
      metaMediaId: null,
      whatsappMessageId: null,
      status: 'UPLOADING',
      caption: params.caption,
      createdAt: existing ? existing.createdAt : now,
      attemptsCount: existing ? existing.attemptsCount + 1 : 1,
      lastError: null,
      employeeId: params.employeeId || 'CASHIER-1',
      employeeName: params.employeeName || 'عمرو النماري',
      idempotencyKey: params.idempotencyKey || `${params.voucherNumber}_${params.sha256.substring(0, 8)}`,
      storageKey: params.storageKey,
      snapshot: params.snapshot,
      rawWebhookEvents: existing?.rawWebhookEvents || [],
    };

    this.persistRecord(record);
    return { ...record, rawWebhookEvents: [...(record.rawWebhookEvents || [])] };
  }

  /**
   * تسجيل نجاح رفع الوسائط إلى Meta
   */
  public recordMediaUploaded(recordId: string, metaMediaId: string) {
    const record = this.records.get(recordId);
    if (!record) return;

    this.persistRecord({
      ...record,
      metaMediaId,
      uploadedAt: new Date().toISOString(),
      status: 'SENDING',
    });
  }

  /**
   * تسجيل قبول Meta لطلب الإرسال (حالة SENT الرسمية)
   */
  public recordSent(recordId: string, whatsappMessageId: string) {
    const record = this.records.get(recordId);
    if (!record) return;

    this.persistRecord({
      ...record,
      whatsappMessageId,
      sentAt: new Date().toISOString(),
      status: 'SENT', // Meta acceptance only; delivery is confirmed by webhook.
    });
    console.log(`[WhatsApp Registry] Voucher ${record.voucherNumber} marked as SENT. Message ID: ${whatsappMessageId}`);
  }

  /**
   * تحديث الحالة عند وصول إشعار تسليم حقيقي من Webhook
   */
  public recordWebhookEvent(messageId: string, status: 'sent' | 'delivered' | 'read' | 'failed', rawEvent: any): boolean {
    const recordId = this.messageIdToRecordId.get(messageId);
    if (!recordId) {
      console.warn(`[WhatsApp Registry] Webhook event received for unknown messageId: ${messageId}`);
      return false;
    }

    const record = this.records.get(recordId);
    if (!record) return false;

    // Deduplication: منع معالجة نفس الحدث مرتين
    const isDuplicate = record.rawWebhookEvents?.some(
      (e) => e.id === rawEvent.id && e.status === status && e.timestamp === rawEvent.timestamp
    );
    if (isDuplicate) {
      console.log(`[WhatsApp Registry] Duplicate webhook event ignored for ${messageId}`);
      return true;
    }

    const now = new Date().toISOString();
    const updated: WhatsAppDispatchRecord = {
      ...record,
      rawWebhookEvents: [...(record.rawWebhookEvents || []), rawEvent],
    };
    if (status === 'delivered') {
      updated.status = 'DELIVERED';
      updated.deliveredAt = now;
    } else if (status === 'read') {
      updated.status = 'READ';
      updated.readAt = now;
    } else if (status === 'failed') {
      updated.status = 'FAILED';
      updated.failedAt = now;
      updated.lastError = JSON.stringify(rawEvent.errors || 'Webhook delivery failed');
    }

    this.persistRecord(updated);
    return true;
  }

  /**
   * تسجيل الفشل
   */
  public recordFailure(recordId: string, error: string) {
    const record = this.records.get(recordId);
    if (!record) return;

    this.persistRecord({
      ...record,
      status: 'FAILED',
      lastError: error,
      failedAt: new Date().toISOString(),
    });
    console.warn(`[WhatsApp Registry] Voucher ${record.voucherNumber} marked as FAILED.`);
  }

  /**
   * استرجاع السجل برقم السند
   */
  public getByVoucherNumber(voucherNumber: string): WhatsAppDispatchRecord | null {
    const id = this.voucherToRecordId.get(voucherNumber);
    return id ? this.records.get(id) || null : null;
  }

  /**
   * استرجاع جميع السجلات
   */
  public getAllRecords(): WhatsAppDispatchRecord[] {
    return Array.from(this.records.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
}

export const dispatchRegistry = new DispatchRegistry();
