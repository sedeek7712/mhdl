import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { getYemenDateTimeString, safeAtomicWriteJson } from '../src/server/utils/atomicFileStorage.js';

interface ExistingOwner {
  id: string;
  name: string;
  username: string;
  role: 'owner';
  branchId: string;
  branchName: string;
  pinSalt?: string;
  pinHash?: string;
  isActive?: boolean;
  mustChangePin?: boolean;
  createdAt?: string;
  [key: string]: unknown;
}

interface OwnerRecord extends ExistingOwner {
  pinSalt: string;
  pinHash: string;
  isActive: true;
  mustChangePin: false;
  createdAt: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'system_users.local.json');
const LEGACY_USERS_FILE = path.join(DATA_DIR, 'system_users.json');

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
    return Promise.reject(new Error('يجب تشغيل الإعداد من نافذة طرفية تفاعلية حتى لا يظهر PIN أثناء كتابته.'));
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
          reject(new Error('تم إلغاء إعداد المالك.'));
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

function createPinHash(pin: string, salt: string): string {
  return crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex');
}

function validatePin(pin: string): void {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error('يجب أن يتكون PIN من 6 أرقام بالضبط.');
  }
  if (/^(\d)\1+$/.test(pin) || ['123456', '654321', '000000', '111111', '222222', '123321'].includes(pin)) {
    throw new Error('هذا PIN ضعيف وشائع؛ اختر أرقاماً غير متسلسلة وغير مكررة.');
  }
}

async function main(): Promise<void> {
  let owner: ExistingOwner;

  const sourceUsersFile = fs.existsSync(USERS_FILE) ? USERS_FILE : LEGACY_USERS_FILE;
  if (fs.existsSync(sourceUsersFile)) {
    const raw = fs.readFileSync(sourceUsersFile, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('ملف المستخدمين ليس قائمة JSON صحيحة. لم يتم تعديل أي ملف.');
    }

    const owners = parsed.filter((user): user is ExistingOwner =>
      Boolean(user && typeof user === 'object' && (user as ExistingOwner).role === 'owner')
    );
    if (owners.length !== 1) {
      throw new Error('لم يتم العثور على حساب مالك واحد بالضبط. أوقف الإعداد لحماية الحسابات؛ يلزم فحص يدوي قبل المتابعة.');
    }

    owner = owners[0];
    if (!owner.id || !owner.name || !owner.username || !owner.branchId || !owner.branchName) {
      throw new Error('بيانات حساب المالك غير مكتملة. لم يتم تعديل أي ملف.');
    }

    const confirm = await ask(
      'سيتم الاحتفاظ بحساب المالك وحده، وأرشفة ملف المستخدمين الحالي محلياً، وتعطيل الحسابات الأخرى في النسخة النشطة. اكتب نعم للمتابعة: '
    );
    if (confirm !== 'نعم') {
      throw new Error('لم يتم إجراء أي تغيير.');
    }
  } else {
    const name = await ask('اسم مالك النظام: ');
    const username = await ask('اسم الدخول (أحرف إنجليزية/أرقام، 3-32): ');
    const branchName = await ask('اسم الفرع الرئيسي: ');
    if (!name || !/^[a-zA-Z0-9._-]{3,32}$/.test(username) || !branchName) {
      throw new Error('الاسم أو اسم الدخول أو اسم الفرع غير صالح. لم يتم إنشاء الحساب.');
    }

    owner = {
      id: `usr-${crypto.randomBytes(8).toString('hex')}`,
      name,
      username: username.toLowerCase(),
      role: 'owner',
      branchId: 'br-main',
      branchName,
      createdAt: getYemenDateTimeString(),
    };
  }

  const pin = await readHidden('أدخل PIN جديد للمالك (لن يظهر أثناء الكتابة): ');
  validatePin(pin);
  const confirmation = await readHidden('أعد إدخال PIN للتأكيد: ');
  if (pin !== confirmation) {
    throw new Error('الرمزان غير متطابقين. لم يتم حفظ أي تغيير.');
  }

  const pinSalt = crypto.randomBytes(16).toString('hex');
  const ownerRecord: OwnerRecord = {
    ...owner,
    role: 'owner',
    pinSalt,
    pinHash: createPinHash(pin, pinSalt),
    isActive: true,
    mustChangePin: false,
    createdAt: owner.createdAt || getYemenDateTimeString(),
  };

  let backupPath: string | undefined;
  if (fs.existsSync(sourceUsersFile)) {
    backupPath = `${USERS_FILE}.pre-single-user.${Date.now()}.bak`;
    fs.copyFileSync(sourceUsersFile, backupPath);
  }

  safeAtomicWriteJson(USERS_FILE, [ownerRecord]);
  console.log('تم إعداد حساب المالك الوحيد بنجاح. لم يتم حفظ PIN كنص صريح.');
  if (backupPath) {
    console.log(`تم حفظ نسخة احتياطية للحسابات السابقة محلياً: ${path.basename(backupPath)}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'حدث خطأ غير معروف أثناء تهيئة المالك.';
  console.error(`فشل إعداد المالك: ${message}`);
  process.exitCode = 1;
});
