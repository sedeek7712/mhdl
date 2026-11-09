/**
 * محرك المحاسبة ودفتر الأستاذ والقيود المزدوجة المعتمد على الخادم
 * Server-Authoritative Financial Ledger & Double-Entry Accounting Engine
 * معالجة نتائج التدقيق: C3 (توحيد القيد والصندوق على الخادم) و H1 (إلغاء تحكم العميل في السيولة)
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { safeAtomicWriteJson, safeReadJson, getYemenDateTimeString } from '../utils/atomicFileStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../data');
const ACCOUNTS_FILE = path.resolve(DATA_DIR, 'accounts_ledger.json');
const JOURNAL_FILE = path.resolve(DATA_DIR, 'journal_entries.json');
const PENDING_FINANCIAL_TRANSACTION_FILE = path.resolve(DATA_DIR, 'financial_transaction_pending.json');

export type CurrencyCode = 'YER_OLD' | 'YER_NEW' | 'SAR' | 'USD';

export interface ServerAccount {
  id: string;
  code: string;
  nameAr: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  category: 'cash_box' | 'bank' | 'network' | 'customer' | 'remittance' | 'operational';
  balances: Record<CurrencyCode, number>;
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

class ServerAccountingEngine {
  private storageWriteBlocked = false;
  private activeTransactionId: string | null = null;
  private accounts: Map<string, ServerAccount> = new Map();
  private journalEntries: ServerJournalEntry[] = [];

  constructor() {
    this.loadState();
  }

  private loadState(): void {
    // A surviving marker means the previous process stopped during a multi-file financial commit.
    // Never clear it automatically: require manual ledger reconciliation first.
    if (fs.existsSync(PENDING_FINANCIAL_TRANSACTION_FILE)) {
      let transactionDetails = 'تفاصيل المعاملة غير متاحة';
      try {
        transactionDetails = fs.readFileSync(PENDING_FINANCIAL_TRANSACTION_FILE, 'utf8').slice(0, 1000);
      } catch {
        // The presence of the marker is enough to stop startup.
      }
      throw new Error(`توقف آمن: توجد معاملة مالية غير مكتملة. لا تحذف علامة الاسترداد ولا تعاود الصرف قبل مطابقة الملفات يدوياً. التفاصيل: ${transactionDetails}`);
    }

    // الدفاتر المالية ملفات إلزامية: لا ننشئ أرصدة افتراضية عند فقدانها أو تلفها.
    const loadedAccounts = safeReadJson<ServerAccount[]>(ACCOUNTS_FILE, [], {
      failOnCorruption: true,
      failOnMissing: true,
    });

    if (!Array.isArray(loadedAccounts) || loadedAccounts.length === 0) {
      throw new Error('توقف آمن: دفتر الحسابات فارغ أو لا يحتوي حسابات. لا يمكن تشغيل العمليات المالية قبل استعادة الدفتر الصحيح.');
    }

    const currencies: CurrencyCode[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];
    const accountIds = new Set<string>();

    for (const account of loadedAccounts) {
      if (!account || typeof account.id !== 'string' || !account.id.trim() ||
          !account.balances || typeof account.balances !== 'object') {
        throw new Error('توقف آمن: سجل حساب غير صالح في دفتر الأستاذ. لم يتم تحميل أي أرصدة مالية.');
      }
      if (accountIds.has(account.id)) {
        throw new Error(`توقف آمن: معرف الحساب مكرر في دفتر الأستاذ (${account.id}).`);
      }
      accountIds.add(account.id);

      for (const currency of currencies) {
        const balance = account.balances[currency];
        if (typeof balance !== 'number' || !Number.isFinite(balance)) {
          throw new Error(`توقف آمن: رصيد غير صالح للحساب (${account.id}) بالعملة (${currency}).`);
        }
      }
    }

    // لا يسمح النظام بالعمل دون حساب الصندوق الرئيسي وصندوق الكاشير المعتمد.
    if (!accountIds.has('acc-1101') || !accountIds.has('acc-1102')) {
      throw new Error('توقف آمن: حساب الخزينة الرئيسية أو صندوق الكاشير غير موجود في دفتر الأستاذ.');
    }

    const loadedJournalEntries = safeReadJson<ServerJournalEntry[]>(JOURNAL_FILE, [], {
      failOnCorruption: true,
      failOnMissing: true,
    });
    if (!Array.isArray(loadedJournalEntries) ||
        loadedJournalEntries.some((entry) => {
          if (!entry || typeof entry.id !== 'string' || !entry.id.trim() ||
              typeof entry.entryNumber !== 'string' || !entry.entryNumber.trim() ||
              typeof entry.referenceId !== 'string' || !entry.referenceId.trim() ||
              !Array.isArray(entry.lines) || entry.lines.length < 2) {
            return true;
          }

          const totals = new Map<CurrencyCode, { debit: number; credit: number }>();
          for (const line of entry.lines) {
            if (!line || typeof line.accountId !== 'string' ||
                !currencies.includes(line.currency) ||
                typeof line.debit !== 'number' || !Number.isFinite(line.debit) || line.debit < 0 ||
                typeof line.credit !== 'number' || !Number.isFinite(line.credit) || line.credit < 0 ||
                (line.debit > 0 && line.credit > 0)) {
              return true;
            }

            const total = totals.get(line.currency) || { debit: 0, credit: 0 };
            total.debit += line.debit;
            total.credit += line.credit;
            totals.set(line.currency, total);
          }

          return Array.from(totals.values()).some(
            (total) => Math.abs(total.debit - total.credit) > 0.001
          );
        })) {
      throw new Error('توقف آمن: ملف قيود اليومية يحتوي سجلات غير مكتملة أو قيوداً غير متوازنة حسب العملة.');
    }

    this.accounts.clear();
    for (const account of loadedAccounts) {
      this.accounts.set(account.id, account);
    }
    this.journalEntries = loadedJournalEntries;
  }

  public beginFinancialTransaction(metadata: {
    operation: string;
    referenceId: string;
    amount?: number;
    currency?: string;
    actorId?: string;
  }): { success: boolean; transactionId?: string; error?: string } {
    if (this.storageWriteBlocked) {
      return { success: false, error: 'الكتابة المالية متوقفة بسبب حالة حفظ غير محسومة. أوقف النظام واطلب مطابقة الدفاتر قبل المتابعة.' };
    }
    if (this.activeTransactionId || fs.existsSync(PENDING_FINANCIAL_TRANSACTION_FILE)) {
      this.storageWriteBlocked = true;
      return { success: false, error: 'توجد معاملة مالية أخرى غير مكتملة؛ تم إيقاف العمليات المالية.' };
    }

    const transactionId = crypto.randomUUID();
    try {
      safeAtomicWriteJson(PENDING_FINANCIAL_TRANSACTION_FILE, {
        transactionId,
        ...metadata,
        startedAt: getYemenDateTimeString(),
        status: 'PENDING',
      });
      this.activeTransactionId = transactionId;
      return { success: true, transactionId };
    } catch (error: any) {
      this.storageWriteBlocked = true;
      return { success: false, error: `تعذر إنشاء علامة حماية المعاملة؛ تم تعطيل الكتابة المالية: ${error.message}` };
    }
  }

  public completeFinancialTransaction(transactionId: string): { success: boolean; error?: string } {
    if (!this.activeTransactionId || this.activeTransactionId !== transactionId) {
      this.storageWriteBlocked = true;
      return { success: false, error: 'تعذر مطابقة معرّف المعاملة المالية النشطة؛ تم إيقاف الكتابة.' };
    }

    try {
      fs.unlinkSync(PENDING_FINANCIAL_TRANSACTION_FILE);
      this.activeTransactionId = null;
      return { success: true };
    } catch (error: any) {
      this.storageWriteBlocked = true;
      return { success: false, error: `تعذر إزالة علامة المعاملة بعد الحفظ؛ يلزم فحص يدوي: ${error.message}` };
    }
  }

  public cancelFinancialTransaction(transactionId: string): { success: boolean; error?: string } {
    // Safe only before any financial file has been changed.
    return this.completeFinancialTransaction(transactionId);
  }

  public markFinancialRecoveryRequired(): void {
    this.storageWriteBlocked = true;
  }

  public isFinancialWriteBlocked(): boolean {
    // A marker or active transaction blocks every API write, including other registry mutations.
    return this.storageWriteBlocked ||
      this.activeTransactionId !== null ||
      fs.existsSync(PENDING_FINANCIAL_TRANSACTION_FILE);
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
  }): { success: boolean; journalEntry?: ServerJournalEntry; cashierBalanceAfter?: number; error?: string; errorCode?: 'COMMIT_PENDING_RECOVERY' } {
    if (this.storageWriteBlocked) {
      return { success: false, errorCode: 'COMMIT_PENDING_RECOVERY', error: 'الكتابة المالية متوقفة بسبب معاملة سابقة غير محسومة. لا تعاود العملية؛ يلزم إيقاف النظام ومطابقة الدفاتر.' };
    }

    const cashier = this.accounts.get('acc-1102');
    if (!cashier) {
      return { success: false, error: 'حساب صندوق الكاشير (acc-1102) غير مهيأ في الخادم.' };
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

    let ownTransactionId: string | null = null;
    if (!this.activeTransactionId) {
      const started = this.beginFinancialTransaction({
        operation: 'remittance_payout',
        referenceId: params.transferNumber,
        amount: params.amount,
        currency: params.currency,
        actorId: params.tellerId,
      });
      if (!started.success || !started.transactionId) {
        return { success: false, errorCode: 'COMMIT_PENDING_RECOVERY', error: started.error || 'تعذر بدء المعاملة المالية.' };
      }
      ownTransactionId = started.transactionId;
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

    // الحفظ الذري على القرص للدفاتر المحاسبية
    try {
      safeAtomicWriteJson(ACCOUNTS_FILE, Array.from(this.accounts.values()));
      safeAtomicWriteJson(JOURNAL_FILE, this.journalEntries);
    } catch (err: any) {
      // التراجع في الذاكرة إن فشل الحفظ
      cashier.balances[params.currency] += params.amount;
      networkAccount.balances[params.currency] -= params.amount;
      this.journalEntries.shift();
      this.storageWriteBlocked = true;
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: `فشل حفظ ملفات الدفتر ضمن معاملة مالية معلّمة. لا تعاود الصرف؛ يلزم إيقاف النظام ومطابقة الحسابات والقيود. ${err.message}`,
      };
    }

    if (ownTransactionId) {
      const completed = this.completeFinancialTransaction(ownTransactionId);
      if (!completed.success) {
        return {
          success: false,
          errorCode: 'COMMIT_PENDING_RECOVERY',
          error: completed.error || 'تعذر اعتماد اكتمال حفظ المعاملة المالية.',
        };
      }
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
  }): { success: boolean; journalEntry?: ServerJournalEntry; error?: string; errorCode?: 'COMMIT_PENDING_RECOVERY' } {
    if (this.storageWriteBlocked) {
      return { success: false, errorCode: 'COMMIT_PENDING_RECOVERY', error: 'الكتابة المالية متوقفة بسبب معاملة سابقة غير محسومة. لا تعاود العملية؛ يلزم إيقاف النظام ومطابقة الدفاتر.' };
    }

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

    const started = this.beginFinancialTransaction({
      operation: 'cashier_drawer_funding',
      referenceId: `${params.fromAccountId}->${params.toAccountId}`,
      amount: params.amount,
      currency: params.currency,
    });
    if (!started.success || !started.transactionId) {
      return { success: false, errorCode: 'COMMIT_PENDING_RECOVERY', error: started.error || 'تعذر بدء المعاملة المالية.' };
    }

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
      safeAtomicWriteJson(ACCOUNTS_FILE, Array.from(this.accounts.values()));
      safeAtomicWriteJson(JOURNAL_FILE, this.journalEntries);
    } catch (err: any) {
      fromAcc.balances[params.currency] += params.amount;
      toAcc.balances[params.currency] -= params.amount;
      this.journalEntries.shift();
      this.storageWriteBlocked = true;
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: `فشل حفظ معاملة تغذية الصندوق؛ لا تعاود التغذية قبل مطابقة الدفاتر. ${err.message}`,
      };
    }

    const completed = this.completeFinancialTransaction(started.transactionId);
    if (!completed.success) {
      return { success: false, errorCode: 'COMMIT_PENDING_RECOVERY', error: completed.error, journalEntry: newJournalEntry };
    }

    return { success: true, journalEntry: newJournalEntry };
  }
}

export const serverAccountingEngine = new ServerAccountingEngine();
