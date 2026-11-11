import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { INITIAL_ACCOUNTS } from '../src/data/initialData.js';
import { buildChartReconciliationPlan, type ChartAccountDefinition } from '../src/server/services/chartOfAccountsMigration.js';
import { safeAtomicWriteJson, safeReadJson } from '../src/server/utils/atomicFileStorage.js';
import { resolveDataDirectory } from '../src/server/utils/dataDirectory.js';

interface OwnerRecord {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  pinSalt: string;
  pinHash: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolveDataDirectory(path.resolve(__dirname, '../data'));
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts_ledger.json');
const USERS_FILE = path.join(DATA_DIR, 'system_users.local.json');
const BASELINE_FILE = path.join(DATA_DIR, 'financial_baseline_approved.local.json');

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function readHidden(question: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('يجب تشغيل ترحيل دليل الحسابات من نافذة طرفية تفاعلية لإدخال PIN بشكل مخفي.'));
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          reject(new Error('تم إلغاء ترحيل دليل الحسابات.'));
          return;
        }
        if (byte === 13 || byte === 10) {
          cleanup();
          resolve(value);
          return;
        }
        if (byte === 8 || byte === 127) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (byte >= 48 && byte <= 57 && value.length < 6) {
          value += String.fromCharCode(byte);
          process.stdout.write('*');
        }
      }
    };

    process.stdout.write(question);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

function verifyOwnerPin(owner: OwnerRecord, pin: string): boolean {
  if (!/^\d{6}$/.test(pin) ||
      !/^[a-f0-9]{32}$/i.test(owner.pinSalt) ||
      !/^[a-f0-9]{64}$/i.test(owner.pinHash)) {
    return false;
  }
  const actual = crypto.pbkdf2Sync(pin, owner.pinSalt, 100000, 32, 'sha256');
  const expected = Buffer.from(owner.pinHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function main(): Promise<void> {
  if (fs.existsSync(BASELINE_FILE)) {
    throw new Error('يوجد خط أساس مالي معتمد بالفعل. لن نضيف حسابات بعد الاعتماد؛ يلزم إجراء إعادة ترحيل واعتماد مستقل وموثق.');
  }
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    throw new Error('ملف دفتر الحسابات غير موجود. لا يمكن إنشاء دفتر جديد من بيانات افتراضية.');
  }

  const owners = safeReadJson<OwnerRecord[]>(USERS_FILE, [], {
    failOnCorruption: true,
    failOnMissing: true,
  });
  if (!Array.isArray(owners) || owners.length !== 1 ||
      owners[0].role !== 'owner' || owners[0].isActive !== true) {
    throw new Error('يجب إعداد حساب مالك واحد نشط أولاً عبر npm run setup:owner.');
  }

  const pin = await readHidden('أدخل PIN المالك لتأكيد ترحيل دليل الحسابات: ');
  if (!verifyOwnerPin(owners[0], pin)) {
    throw new Error('PIN المالك غير صحيح. لم يتم تعديل دليل الحسابات.');
  }

  const existingAccounts = safeReadJson<unknown[]>(ACCOUNTS_FILE, [], {
    failOnCorruption: true,
    failOnMissing: true,
  });
  const chartAccounts: ChartAccountDefinition[] = INITIAL_ACCOUNTS.map((account) => ({
    id: account.id,
    code: account.code,
    nameAr: account.nameAr,
    type: account.type,
    category: account.category,
  }));

  const plan = buildChartReconciliationPlan(existingAccounts, chartAccounts);
  if (plan.added.length === 0) {
    console.log('دليل الحسابات متطابق بالفعل. لم يتم تعديل أي ملف.');
    return;
  }

  console.log('\nالحسابات الموجودة ستبقى بأسمائها وأرصدتها الحالية دون تغيير.');
  console.log('الحسابات التالية فقط ستضاف بأرصدة افتتاحية صفرية في العملات الأربع:');
  console.table(plan.added.map((account) => ({
    code: account.code,
    id: account.id,
    name: account.name,
    type: account.type,
    category: account.category,
  })));

  console.log('هذا الإجراء لا يثبت أن هذه الحسابات ليس لها أرصدة خارج النظام. يجب على المالك التأكد من أنها حسابات جديدة أو أن أرصدتها الافتتاحية الفعلية صفر.');
  const confirmation = await ask('\nإذا طابقت الحسابات ووافقت أن تُضاف بأرصدة صفرية، اكتب "أضف الحسابات الناقصة بصفر": ');
  if (confirmation !== 'أضف الحسابات الناقصة بصفر') {
    throw new Error('لم تتم الموافقة. لم يتم تعديل دفتر الحسابات.');
  }

  const backupPath = `${ACCOUNTS_FILE}.before-chart-reconcile.${crypto.randomUUID()}.bak`;
  fs.copyFileSync(ACCOUNTS_FILE, backupPath);

  safeAtomicWriteJson(ACCOUNTS_FILE, plan.accounts);

  console.log(`تمت إضافة ${plan.added.length} حسابات جديدة بأرصدة صفرية، وحفظ نسخة احتياطية: ${path.basename(backupPath)}`);
  console.log('الخطوة التالية: شغّل npm run setup:financial-baseline، وراجع كل حساب وعملة، ولا تعتمد الأرصدة قبل المطابقة الفعلية.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'حدث خطأ غير معروف.';
  console.error(`فشل ترحيل دليل الحسابات: ${message}`);
  process.exitCode = 1;
});
