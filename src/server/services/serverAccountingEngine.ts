/**
 * محرك المحاسبة ودفتر الأستاذ والقيود المزدوجة المعتمد على الخادم
 * Server-Authoritative Financial Ledger & Double-Entry Accounting Engine
 * معالجة نتائج التدقيق: C3 (توحيد القيد والصندوق على الخادم) و H1 (إلغاء تحكم العميل في السيولة)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { safeAtomicWriteJson, safeReadJson, getYemenDateTimeString } from '../utils/atomicFileStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../data');
const LEDGER_FILE = path.resolve(DATA_DIR, 'ledger.json');
const ACCOUNTS_FILE = path.resolve(DATA_DIR, 'accounts_ledger.json');
const JOURNAL_FILE = path.resolve(DATA_DIR, 'journal_entries.json');

export type CurrencyCode = 'YER_OLD' | 'YER_NEW' | 'SAR' | 'USD';

export interface ServerAccount {
  id: string;
  code: string;
  nameAr: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  category: 'cash_box' | 'bank' | 'network' | 'customer' | 'remittance' | 'operational';
  balances: Record<CurrencyCode, number>;
  initialBalances?: Record<CurrencyCode, number>;
}

export interface ServerJournalLine {
  accountId: string;
  accountNameAr: string;
  currency: CurrencyCode;
  debit: number;
  credit: number;
  note?: string;
}

export interface ServerJournalEntry {
  id: string;
  entryNumber: string;
  date: string;
  time: string;
  descriptionAr: string;
  lines: ServerJournalLine[];
  referenceType: 'transfer_payout' | 'transfer_send' | 'internal_transfer' | 'manual_adjustment';
  referenceId: string;
  branchId: string;
  createdBy: string;
  isBalanced: boolean;
}

export interface ServerLedgerState {
  version: number;
  lastUpdated: string;
  accounts: ServerAccount[];
  journalEntries: ServerJournalEntry[];
}

export const DEFAULT_INITIAL_BALANCES: Record<string, Record<CurrencyCode, number>> = {
  'acc-1101': {
    YER_OLD: 25000000,
    YER_NEW: 50000000,
    SAR: 150000,
    USD: 40000,
  },
  'acc-1102': {
    YER_OLD: 5000000,
    YER_NEW: 10000000,
    SAR: 50000,
    USD: 10000,
  },
  'acc-1201': {
    YER_OLD: 0,
    YER_NEW: 0,
    SAR: 0,
    USD: 0,
  },
  'acc-1301': {
    YER_OLD: 0,
    YER_NEW: 0,
    SAR: 0,
    USD: 0,
  },
  'acc-1302': {
    YER_OLD: 0,
    YER_NEW: 0,
    SAR: 0,
    USD: 0,
  },
};

const DEFAULT_ACCOUNTS: ServerAccount[] = [
  {
    id: 'acc-1101',
    code: '1101',
    nameAr: 'الخزينة المركزية (الصندوق الرئيسي)',
    type: 'asset',
    category: 'cash_box',
    balances: {
      YER_OLD: 25000000,
      YER_NEW: 50000000,
      SAR: 150000,
      USD: 40000,
    },
    initialBalances: { ...DEFAULT_INITIAL_BALANCES['acc-1101'] },
  },
  {
    id: 'acc-1102',
    code: '1102',
    nameAr: 'صندوق كاشير الصراف 1 (عمرو النماري)',
    type: 'asset',
    category: 'cash_box',
    balances: {
      YER_OLD: 5000000,
      YER_NEW: 10000000,
      SAR: 50000,
      USD: 10000,
    },
    initialBalances: { ...DEFAULT_INITIAL_BALANCES['acc-1102'] },
  },
  {
    id: 'acc-1201',
    code: '1201',
    nameAr: 'حساب بنك الكريمي الإسلامي',
    type: 'asset',
    category: 'bank',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
    initialBalances: { ...DEFAULT_INITIAL_BALANCES['acc-1201'] },
  },
  {
    id: 'acc-1301',
    code: '1301',
    nameAr: 'حساب شبكة النجم للحوالات',
    type: 'asset',
    category: 'network',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
    initialBalances: { ...DEFAULT_INITIAL_BALANCES['acc-1301'] },
  },
  {
    id: 'acc-1302',
    code: '1302',
    nameAr: 'حساب شبكة الامتياز للحوالات',
    type: 'asset',
    category: 'network',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
    initialBalances: { ...DEFAULT_INITIAL_BALANCES['acc-1302'] },
  },
];

class ServerAccountingEngine {
  private accounts: Map<string, ServerAccount> = new Map();
  private journalEntries: ServerJournalEntry[] = [];

  constructor() {
    this.loadState();
  }

  /**
   * N5: فحص تطابق مجموع القيود لكل حساب وعملة مع الرصيد
   */
  public verifyLedgerIntegrity(
    accountsToCheck?: ServerAccount[],
    entriesToCheck?: ServerJournalEntry[]
  ): { isValid: boolean; error?: string; discrepancies?: string[] } {
    const accounts = accountsToCheck || Array.from(this.accounts.values());
    const entries = entriesToCheck || this.journalEntries;
    const discrepancies: string[] = [];

    const currencies: CurrencyCode[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];

    for (const acc of accounts) {
      for (const cur of currencies) {
        const initial = acc.initialBalances?.[cur] ?? DEFAULT_INITIAL_BALANCES[acc.id]?.[cur] ?? 0;
        let totalDebit = 0;
        let totalCredit = 0;

        for (const entry of entries) {
          for (const line of entry.lines) {
            if (line.accountId === acc.id && line.currency === cur) {
              totalDebit += line.debit || 0;
              totalCredit += line.credit || 0;
            }
          }
        }

        // للأصول (Assets): الرصيد المتوقع = الرصيد الافتتاحي + مجموع المدين - مجموع الدائن
        const netChange = totalDebit - totalCredit;
        const expectedBalance = initial + netChange;
        const actualBalance = acc.balances[cur] ?? 0;

        if (Math.abs(expectedBalance - actualBalance) > 0.001) {
          discrepancies.push(
            `الحساب [${acc.nameAr} (${acc.code}) - ${cur}]: الرصيد الفعلي (${actualBalance}) لا يطابق مجموع القيود (${expectedBalance})، الفارق: ${actualBalance - expectedBalance}`
          );
        }
      }
    }

    if (discrepancies.length > 0) {
      return {
        isValid: false,
        error: `خطأ حرج في تطابق دفتر الأستاذ (N5): تم اكتشاف ${discrepancies.length} عدم تطابق بين أرصدة الحسابات والقيود المحاسبية. ${discrepancies.join(' | ')}`,
        discrepancies,
      };
    }

    return { isValid: true };
  }

  /**
   * N5: ترحيل غير مدمّر وقراءة دفتر الأستاذ الذري الموحد من ledger.json
   */
  private loadState(): void {
    // ترحيل أوتوماتيكي غير مدمّر من الملفين القديمين إذا لم يكن ledger.json موجوداً بعد
    if (!fs.existsSync(LEDGER_FILE)) {
      let migratedAccounts: ServerAccount[] = DEFAULT_ACCOUNTS;
      let migratedEntries: ServerJournalEntry[] = [];

      if (fs.existsSync(ACCOUNTS_FILE)) {
        migratedAccounts = safeReadJson<ServerAccount[]>(ACCOUNTS_FILE, DEFAULT_ACCOUNTS, { failOnCorruption: true });
      }
      if (fs.existsSync(JOURNAL_FILE)) {
        migratedEntries = safeReadJson<ServerJournalEntry[]>(JOURNAL_FILE, [], { failOnCorruption: true });
      }

      for (const acc of migratedAccounts) {
        if (!acc.initialBalances) {
          acc.initialBalances = { ...(DEFAULT_INITIAL_BALANCES[acc.id] || acc.balances) };
        }
      }

      const initialLedgerState: ServerLedgerState = {
        version: 1,
        lastUpdated: getYemenDateTimeString(),
        accounts: migratedAccounts,
        journalEntries: migratedEntries,
      };

      // حفظ أولي ذري في ledger.json مع إبقاء الملفين القديمين دون حذف
      safeAtomicWriteJson(LEDGER_FILE, initialLedgerState);
    }

    const ledgerState = safeReadJson<ServerLedgerState>(
      LEDGER_FILE,
      {
        version: 1,
        lastUpdated: getYemenDateTimeString(),
        accounts: DEFAULT_ACCOUNTS,
        journalEntries: [],
      },
      { failOnCorruption: true }
    );

    this.accounts.clear();
    for (const acc of ledgerState.accounts) {
      if (!acc.initialBalances) {
        acc.initialBalances = { ...(DEFAULT_INITIAL_BALANCES[acc.id] || acc.balances) };
      }
      this.accounts.set(acc.id, acc);
    }
    this.journalEntries = ledgerState.journalEntries;

    // فحص التطابق عند التحميل: مجموع القيود لكل حساب وعملة = الرصيد
    const integrity = this.verifyLedgerIntegrity();
    if (!integrity.isValid) {
      console.error('[AccountingEngine FATAL] Ledger integrity check failed:', integrity.error);
      throw new Error(integrity.error);
    }
  }

  private saveLedgerStateToDisk(): void {
    const state: ServerLedgerState = {
      version: 1,
      lastUpdated: getYemenDateTimeString(),
      accounts: Array.from(this.accounts.values()),
      journalEntries: this.journalEntries,
    };

    // كتابة ذرية في ملف واحد ledger.json يضم الحسابات والقيود معاً
    safeAtomicWriteJson(LEDGER_FILE, state);

    // مرآة توافقية للملفات القديمة
    try {
      safeAtomicWriteJson(ACCOUNTS_FILE, state.accounts);
      safeAtomicWriteJson(JOURNAL_FILE, state.journalEntries);
    } catch {
      // Ignore legacy mirroring errors
    }
  }

  public getAccounts(): ServerAccount[] {
    return Array.from(this.accounts.values()).map((a) => ({
      ...a,
      balances: { ...a.balances },
    }));
  }

  public getAccount(id: string): ServerAccount | undefined {
    return this.accounts.get(id);
  }

  public getJournalEntries(): ServerJournalEntry[] {
    return [...this.journalEntries];
  }

  public getCashierBalance(currency: CurrencyCode): number {
    const cashier = this.accounts.get('acc-1102');
    return cashier?.balances[currency] || 0;
  }

  /**
   * C3 & H1: تنفيذ قيد صرف الحوالة الذري على الخادم مع خصم صندوق الكاشير
   */
  public executeRemittancePayout(params: {
    transferNumber: string;
    amount: number;
    currency: CurrencyCode;
    recipientName: string;
    recipientIdNumber: string;
    networkName?: string;
    tellerId: string;
    tellerName: string;
    tellerRole: string;
    branchId?: string;
    managerOverrideApproved?: boolean;
    managerOverrideBy?: string;
  }): { success: boolean; journalEntry?: ServerJournalEntry; cashierBalanceAfter?: number; error?: string } {
    const cashier = this.accounts.get('acc-1102');
    if (!cashier) {
      return { success: false, error: 'حساب صندوق الكاشير (acc-1102) غير مهيأ في الخادم.' };
    }

    // N1 (حارس ثانٍ على مستوى الدفتر): رفض صريح لأي قيد ثانٍ من نوع transfer_payout لنفس referenceId
    const existingPayoutEntry = this.journalEntries.find(
      (e) => e.referenceType === 'transfer_payout' && e.referenceId === params.transferNumber
    );
    if (existingPayoutEntry) {
      return {
        success: false,
        error: `رفض محاسبي قاطع: يوجد قيد صرف مسبق برقم (${existingPayoutEntry.entryNumber}) لنفس رقم الحوالة (${params.transferNumber}). يمنع تسجيل قيد ثانٍ منعاً باتاً.`,
      };
    }

    const currentBalance = cashier.balances[params.currency] || 0;

    // H1: التحقق من السيولة على الخادم - لا نثق بمدخلات المتصفح
    if (currentBalance < params.amount) {
      if (!params.managerOverrideApproved) {
        return {
          success: false,
          error: `رفض النظام: رصيد صندوق الكاشير الفعلي في الخادم (${currentBalance} ${params.currency}) غير كافٍ لصرف مبلغ الحوالة (${params.amount} ${params.currency}). يتطلب العملية تغذية الصندوق أو اعتماد المدير العام.`,
        };
      }
    }

    const networkAccount = this.accounts.get('acc-1301') || this.accounts.get('acc-1101')!;
    const yemenTime = getYemenDateTimeString();
    const [dateStr, timeStr] = yemenTime.split(' ');

    const nextSeq = this.journalEntries.length + 1;
    const entryNumber = `JV-${new Date().getFullYear()}-${String(nextSeq).padStart(4, '0')}`;

    // القيد المحاسبي المزدوج المتوازن:
    // مدين: حساب الشبكة (مطالبة الشبكة بقيمة الحوالة)
    // دائن: صندوق الكاشير (تسليم النقدية للمستفيد)
    const lines: ServerJournalLine[] = [
      {
        accountId: networkAccount.id,
        accountNameAr: networkAccount.nameAr,
        currency: params.currency,
        debit: params.amount,
        credit: 0,
        note: `مطالبة ${params.networkName || 'الشبكة'} بقيمة الحوالة ${params.transferNumber}`,
      },
      {
        accountId: cashier.id,
        accountNameAr: cashier.nameAr,
        currency: params.currency,
        debit: 0,
        credit: params.amount,
        note: `تسليم نقدي للحوالة ${params.transferNumber} للمستفيد ${params.recipientName} (هوية: ${params.recipientIdNumber})`,
      },
    ];

    // التحقق من توازن القيد
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      return { success: false, error: 'خطأ محاسبي حرج: القيد غير متوازن.' };
    }

    // تحديث الأرصدة
    cashier.balances[params.currency] = (cashier.balances[params.currency] || 0) - params.amount;
    networkAccount.balances[params.currency] = (networkAccount.balances[params.currency] || 0) + params.amount;

    const newJournalEntry: ServerJournalEntry = {
      id: `jv-pay-${Date.now()}-${nextSeq}`,
      entryNumber,
      date: dateStr,
      time: timeStr,
      descriptionAr: `صرف حوالة واردة ${params.transferNumber} للمستفيد ${params.recipientName} (هوية: ${params.recipientIdNumber})`,
      lines,
      referenceType: 'transfer_payout',
      referenceId: params.transferNumber,
      branchId: params.branchId || 'br-khadeer',
      createdBy: params.tellerName,
      isBalanced: true,
    };

    this.journalEntries.unshift(newJournalEntry);

    // N5: الحفظ الذري الموحد لدفتر الأستاذ في ملف واحد (ledger.json)
    try {
      this.saveLedgerStateToDisk();
    } catch (err: any) {
      // التراجع في الذاكرة إن فشل الحفظ
      cashier.balances[params.currency] += params.amount;
      networkAccount.balances[params.currency] -= params.amount;
      this.journalEntries.shift();
      return { success: false, error: `فشل الحفظ الذري لدفتر الأستاذ: ${err.message}` };
    }

    return {
      success: true,
      journalEntry: newJournalEntry,
      cashierBalanceAfter: cashier.balances[params.currency],
    };
  }

  /**
   * تغذية صندوق الكاشير من الخزينة المركزية بقيد مزدوج موثق
   */
  public fundCashierDrawer(params: {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    currency: CurrencyCode;
    operatorName: string;
    branchId?: string;
  }): { success: boolean; journalEntry?: ServerJournalEntry; error?: string } {
    const fromAcc = this.accounts.get(params.fromAccountId);
    const toAcc = this.accounts.get(params.toAccountId);

    if (!fromAcc || !toAcc) {
      return { success: false, error: 'أحد الحسابات المحددة غير موجود.' };
    }

    if (params.amount <= 0 || !Number.isFinite(params.amount)) {
      return { success: false, error: 'مبلغ التغذية يجب أن يكون رقماً موجباً أكبر من الصفر.' };
    }

    const currentSourceBalance = fromAcc.balances[params.currency] || 0;
    if (currentSourceBalance < params.amount) {
      return {
        success: false,
        error: `رصيد ${fromAcc.nameAr} (${currentSourceBalance} ${params.currency}) غير كافٍ لتغذية المبلغ المطلوب (${params.amount}).`,
      };
    }

    const yemenTime = getYemenDateTimeString();
    const [dateStr, timeStr] = yemenTime.split(' ');
    const nextSeq = this.journalEntries.length + 1;
    const entryNumber = `JV-FUND-${new Date().getFullYear()}-${String(nextSeq).padStart(4, '0')}`;

    fromAcc.balances[params.currency] -= params.amount;
    toAcc.balances[params.currency] = (toAcc.balances[params.currency] || 0) + params.amount;

    const lines: ServerJournalLine[] = [
      {
        accountId: toAcc.id,
        accountNameAr: toAcc.nameAr,
        currency: params.currency,
        debit: params.amount,
        credit: 0,
        note: `إيداع وتغذية الصندوق من ${fromAcc.nameAr}`,
      },
      {
        accountId: fromAcc.id,
        accountNameAr: fromAcc.nameAr,
        currency: params.currency,
        debit: 0,
        credit: params.amount,
        note: `صرف تغذية نقدية إلى ${toAcc.nameAr}`,
      },
    ];

    const newJournalEntry: ServerJournalEntry = {
      id: `jv-fund-${Date.now()}-${nextSeq}`,
      entryNumber,
      date: dateStr,
      time: timeStr,
      descriptionAr: `تغذية صندوق من ${fromAcc.nameAr} إلى ${toAcc.nameAr}`,
      lines,
      referenceType: 'internal_transfer',
      referenceId: entryNumber,
      branchId: params.branchId || 'br-main',
      createdBy: params.operatorName,
      isBalanced: true,
    };

    this.journalEntries.unshift(newJournalEntry);

    try {
      this.saveLedgerStateToDisk();
    } catch (err: any) {
      fromAcc.balances[params.currency] += params.amount;
      toAcc.balances[params.currency] -= params.amount;
      this.journalEntries.shift();
      return { success: false, error: err.message };
    }

    return { success: true, journalEntry: newJournalEntry };
  }
}

export const serverAccountingEngine = new ServerAccountingEngine();
