import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { safeAtomicWriteJson, safeReadJson, getYemenDateTimeString } from '../src/server/utils/atomicFileStorage.js';

type CurrencyCode = 'YER_OLD' | 'YER_NEW' | 'SAR' | 'USD';
type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

interface AccountRecord {
  id: string;
  nameAr: string;
  type: AccountType;
  balances: Record<CurrencyCode, number>;
}

interface JournalLine {
  accountId: string;
  currency: CurrencyCode;
  debit: number;
  credit: number;
}

interface JournalEntry {
  id: string;
  entryNumber: string;
  lines: JournalLine[];
}

interface OwnerRecord {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

const CURRENCIES: CurrencyCode[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];
const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];

interface ApprovedFinancialBaseline {
  schemaVersion: 1;
  approvedAt: string;
  approvedBy: string;
  approvedByUserId: string;
  openingBalances: Record<string, {
    type: AccountType;
    balances: Record<CurrencyCode, number>;
  }>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts_ledger.json');
const JOURNAL_FILE = path.join(DATA_DIR, 'journal_entries.json');
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

function normalBalanceSign(type: AccountType): number {
  return type === 'asset' || type === 'expense' ? 1 : -1;
}

async function main(): Promise<void> {
  if (fs.existsSync(BASELINE_FILE)) {
    throw new Error('يوجد اعتماد أرصدة افتتاحية بالفعل. لن يتم استبداله تلقائياً؛ يلزم إجراء إعادة اعتماد منفصل وموثق.');
  }

  if (!fs.existsSync(USERS_FILE)) {
    throw new Error('لم يتم إعداد حساب المالك. شغّل npm run setup:owner أولاً.');
  }

  const users = safeReadJson<OwnerRecord[]>(USERS_FILE, [], {
    failOnCorruption: true,
    failOnMissing: true,
  });
  if (!Array.isArray(users) || users.length !== 1 ||
      users[0].role !== 'owner' || users[0].isActive !== true) {
    throw new Error('ملف المستخدمين لا يحتوي حساب مالك واحداً نشطاً؛ تم إيقاف اعتماد الأرصدة.');
  }

  const accounts = safeReadJson<AccountRecord[]>(ACCOUNTS_FILE, [], {
    failOnCorruption: true,
    failOnMissing: true,
  });
  const journalEntries = safeReadJson<JournalEntry[]>(JOURNAL_FILE, [], {
    failOnCorruption: true,
    failOnMissing: true,
  });

  if (!Array.isArray(accounts) || accounts.length === 0 || !Array.isArray(journalEntries)) {
    throw new Error('دفتر الحسابات أو قيود اليومية غير صالحة. لم يتم إنشاء اعتماد.');
  }

  const accountMap = new Map<string, AccountRecord>();
  for (const account of accounts) {
    if (!account || typeof account.id !== 'string' || !account.id.trim() ||
        typeof account.nameAr !== 'string' || !account.nameAr.trim() ||
        !ACCOUNT_TYPES.includes(account.type) || !account.balances) {
      throw new Error('يوجد حساب غير صالح في دفتر الأستاذ. لم يتم إنشاء اعتماد.');
    }
    if (accountMap.has(account.id)) {
      throw new Error(`معرف حساب مكرر: ${account.id}`);
    }
    for (const currency of CURRENCIES) {
      if (typeof account.balances[currency] !== 'number' || !Number.isFinite(account.balances[currency])) {
        throw new Error(`رصيد غير صالح للحساب ${account.id} والعملة ${currency}.`);
      }
    }
    accountMap.set(account.id, account);
  }

  const movements = new Map<string, Record<CurrencyCode, number>>();
  for (const account of accounts) {
    movements.set(account.id, { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 });
  }

  const journalTotals = new Map<CurrencyCode, { debit: number; credit: number }>();
  for (const entry of journalEntries) {
    if (!entry || typeof entry.id !== 'string' ||
        typeof entry.entryNumber !== 'string' || !Array.isArray(entry.lines) || entry.lines.length < 2) {
      throw new Error('يوجد قيد يومية غير صالح. لم يتم إنشاء اعتماد.');
    }

    for (const line of entry.lines) {
      const account = accountMap.get(line.accountId);
      if (!account || !CURRENCIES.includes(line.currency) ||
          typeof line.debit !== 'number' || !Number.isFinite(line.debit) || line.debit < 0 ||
          typeof line.credit !== 'number' || !Number.isFinite(line.credit) || line.credit < 0 ||
          (line.debit > 0 && line.credit > 0)) {
        throw new Error(`سطر قيد غير صالح في ${entry.entryNumber}.`);
      }

      const total = journalTotals.get(line.currency) || { debit: 0, credit: 0 };
      total.debit += line.debit;
      total.credit += line.credit;
      journalTotals.set(line.currency, total);

      const accountMovement = movements.get(line.accountId)!;
      accountMovement[line.currency] += normalBalanceSign(account.type) * (line.debit - line.credit);
    }
  }

  for (const [currency, total] of journalTotals) {
    if (Math.abs(total.debit - total.credit) > 0.001) {
      throw new Error(`قيود اليومية غير متوازنة بعملة ${currency}. لم يتم إنشاء اعتماد.`);
    }
  }

  const openingBalances: ApprovedFinancialBaseline['openingBalances'] = {};
  const displayRows: Array<{ account: string; currency: string; opening: number; current: number }> = [];

  for (const account of accounts) {
    const balances = {} as Record<CurrencyCode, number>;
    for (const currency of CURRENCIES) {
      const opening = account.balances[currency] - movements.get(account.id)![currency];
      if (!Number.isFinite(opening)) {
        throw new Error(`تعذر استنتاج الرصيد الافتتاحي للحساب ${account.id}.`);
      }
      balances[currency] = opening;
      displayRows.push({
        account: account.nameAr,
        currency,
        opening,
        current: account.balances[currency],
      });
    }
    openingBalances[account.id] = { type: account.type, balances };
  }

  console.log('\nالأرصدة الافتتاحية المستنتجة من الأرصدة الحالية وقيود اليومية:');
  console.table(displayRows);
  console.log('هذه الأرصدة ليست معتمدة لمجرد ظهورها هنا. طابق النقد الفعلي وكشوف الشبكات لكل حساب وعملة قبل الإقرار.');

  const confirmation = await ask(
    '\nبعد المطابقة الفعلية فقط، اكتب "اعتمد" لتثبيت هذه الأرصدة كخط أساس محلي: '
  );
  if (confirmation !== 'اعتمد') {
    throw new Error('لم يتم اعتماد الأرصدة. لم يتم إنشاء ملف خط الأساس.');
  }

  const baseline: ApprovedFinancialBaseline = {
    schemaVersion: 1,
    approvedAt: getYemenDateTimeString(),
    approvedBy: users[0].name,
    approvedByUserId: users[0].id,
    openingBalances,
  };

  safeAtomicWriteJson(BASELINE_FILE, baseline);
  console.log('تم اعتماد خط الأساس محلياً بنجاح. الملف مستثنى من Git.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'حدث خطأ غير معروف.';
  console.error(`فشل اعتماد الأرصدة: ${message}`);
  process.exitCode = 1;
});
