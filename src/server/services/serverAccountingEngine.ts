/**
 * محرك المحاسبة ودفتر الأستاذ والقيود المزدوجة المعتمد على الخادم
 * Server-Authoritative Financial Ledger & Double-Entry Accounting Engine
 * معالجة نتائج التدقيق: C3 (توحيد القيد والصندوق على الخادم) و H1 (إلغاء تحكم العميل في السيولة)
 */

import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { safeAtomicWriteJson, safeReadJson, getYemenDateTimeString } from '../utils/atomicFileStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Tests may provide an isolated temporary directory; production always uses the app data directory.
const DATA_DIR = process.env.NODE_ENV === 'test' && process.env.ALNAMARI_TEST_DATA_DIR
  ? path.resolve(process.env.ALNAMARI_TEST_DATA_DIR)
  : path.resolve(__dirname, '../../../data');
const ACCOUNTS_FILE = path.resolve(DATA_DIR, 'accounts_ledger.json');
const JOURNAL_FILE = path.resolve(DATA_DIR, 'journal_entries.json');
const BASELINE_FILE = path.resolve(DATA_DIR, 'financial_baseline_approved.local.json');
const PENDING_FINANCIAL_TRANSACTION_FILE = path.resolve(DATA_DIR, 'financial_transaction_pending.json');

interface ApprovedFinancialBaseline {
  schemaVersion: 1;
  approvedAt: string;
  approvedBy: string;
  approvedByUserId: string;
  openingBalances: Record<string, {
    type: ServerAccount['type'];
    balances: Record<CurrencyCode, number>;
  }>;
}

export type CurrencyCode = 'YER_OLD' | 'YER_NEW' | 'SAR' | 'USD';

export interface ServerAccount {
  id: string;
  code: string;
  nameAr: string;
  name?: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  category: 'cash_box' | 'bank' | 'network' | 'customer' | 'capital' | 'exchange_profit' | 'commission' | 'operating_expense' | 'remittance' | 'operational';
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
  referenceType: 'transfer_payout' | 'transfer_send' | 'internal_transfer' | 'expense' | 'manual_adjustment';
  referenceId: string;
  branchId: string;
  createdBy: string;
  isBalanced: boolean;
  idempotencyKey?: string;
  voucherNumber?: string;
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
    const rawLoadedAccounts = safeReadJson<unknown[]>(ACCOUNTS_FILE, [], {
      failOnCorruption: true,
      failOnMissing: true,
    });

    if (!Array.isArray(rawLoadedAccounts) || rawLoadedAccounts.length === 0) {
      throw new Error('توقف آمن: دفتر الحسابات فارغ أو لا يحتوي حسابات. لا يمكن تشغيل العمليات المالية قبل استعادة الدفتر الصحيح.');
    }

    // The checked-in ledger uses legacy "name"; the application chart uses "nameAr".
    // Normalize the read model without modifying the source file on startup.
    const loadedAccounts: ServerAccount[] = rawLoadedAccounts.map((rawAccount) => {
      if (!rawAccount || typeof rawAccount !== 'object' || Array.isArray(rawAccount)) {
        return rawAccount as ServerAccount;
      }
      const record = rawAccount as Record<string, unknown>;
      const nameAr = typeof record.nameAr === 'string' && record.nameAr.trim()
        ? record.nameAr
        : typeof record.name === 'string'
          ? record.name
          : '';
      return { ...record, nameAr } as unknown as ServerAccount;
    });

    const currencies: CurrencyCode[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];
    const accountTypes: ServerAccount['type'][] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
    const accountIds = new Set<string>();

    for (const account of loadedAccounts) {
      if (!account || typeof account.id !== 'string' || !account.id.trim() ||
          typeof account.nameAr !== 'string' || !account.nameAr.trim() ||
          !accountTypes.includes(account.type) ||
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

    // Opening balances must be explicitly approved by the owner after physical cash/network reconciliation.
    const baseline = safeReadJson<ApprovedFinancialBaseline>(BASELINE_FILE, null as any, {
      failOnCorruption: true,
      failOnMissing: true,
    });
    if (!baseline || baseline.schemaVersion !== 1 ||
        typeof baseline.approvedAt !== 'string' || !baseline.approvedAt.trim() ||
        typeof baseline.approvedBy !== 'string' || !baseline.approvedBy.trim() ||
        typeof baseline.approvedByUserId !== 'string' || !baseline.approvedByUserId.trim() ||
        !baseline.openingBalances || typeof baseline.openingBalances !== 'object') {
      throw new Error('توقف آمن: لم يتم اعتماد الأرصدة الافتتاحية. بعد مطابقة النقد الفعلي وكشوف الشبكات شغّل npm run setup:financial-baseline.');
    }

    const localUsers = safeReadJson<Array<{ id: string; name: string; role: string; isActive: boolean }>>(
      path.resolve(DATA_DIR, 'system_users.local.json'),
      [],
      { failOnCorruption: true, failOnMissing: true }
    );
    if (localUsers.length !== 1 || localUsers[0].role !== 'owner' ||
        localUsers[0].isActive !== true ||
        baseline.approvedByUserId !== localUsers[0].id ||
        baseline.approvedBy !== localUsers[0].name) {
      throw new Error('توقف آمن: اعتماد الأرصدة لا يطابق حساب المالك المحلي النشط. أعد اعتماد خط الأساس بواسطة المالك الحالي.');
    }

    const baselineIds = Object.keys(baseline.openingBalances);
    if (baselineIds.length !== loadedAccounts.length ||
        loadedAccounts.some((account) => !baseline.openingBalances[account.id] ||
          baseline.openingBalances[account.id].type !== account.type)) {
      throw new Error('توقف آمن: حسابات الدفتر لا تطابق حسابات خط الأساس المعتمد. يلزم إعادة مطابقة واعتماد الأرصدة.');
    }

    const accountMap = new Map<string, ServerAccount>();
    for (const account of loadedAccounts) accountMap.set(account.id, account);
    const movements = new Map<string, Record<CurrencyCode, number>>();
    for (const account of loadedAccounts) {
      movements.set(account.id, { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 });
      const approved = baseline.openingBalances[account.id];
      for (const currency of currencies) {
        if (typeof approved.balances?.[currency] !== 'number' ||
            !Number.isFinite(approved.balances[currency])) {
          throw new Error(`توقف آمن: رصيد افتتاحي غير صالح في الاعتماد للحساب (${account.id}) والعملة (${currency}).`);
        }
      }
    }

    for (const entry of loadedJournalEntries) {
      for (const line of entry.lines) {
        const account = accountMap.get(line.accountId);
        if (!account) {
          throw new Error(`توقف آمن: القيد (${entry.entryNumber}) يشير إلى حساب غير موجود (${line.accountId}).`);
        }
        const normalSign = account.type === 'asset' || account.type === 'expense' ? 1 : -1;
        const accountMovements = movements.get(account.id)!;
        accountMovements[line.currency] += normalSign * (line.debit - line.credit);
      }
    }

    for (const account of loadedAccounts) {
      const approved = baseline.openingBalances[account.id];
      const accountMovements = movements.get(account.id)!;
      for (const currency of currencies) {
        const expected = approved.balances[currency] + accountMovements[currency];
        if (Math.abs(expected - account.balances[currency]) > 0.001) {
          throw new Error(`توقف آمن: رصيد الحساب (${account.id}) بالعملة (${currency}) لا يطابق خط الأساس الافتتاحي مضافاً إليه القيود. المتوقع (${expected}) والمحفوظ (${account.balances[currency]}). يلزم فحص الدفتر قبل التشغيل.`);
        }
      }
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
  public executeOutgoingRemittance(params: {
    transferNumber: string;
    amount: number;
    feeAmount: number;
    currency: CurrencyCode;
    senderName: string;
    recipientName: string;
    networkName: string;
    notes?: string;
    tellerId: string;
    tellerName: string;
    branchId?: string;
    idempotencyKey: string;
  }): {
    success: boolean;
    journalEntry?: ServerJournalEntry;
    accounts?: ServerAccount[];
    totalPaid?: number;
    error?: string;
    errorCode?: 'COMMIT_PENDING_RECOVERY';
  } {
    const currencies: CurrencyCode[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];
    if (typeof params.idempotencyKey !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.idempotencyKey)) {
      return { success: false, error: 'معرف عملية الحوالة الصادرة غير صالح.' };
    }
    if (typeof params.transferNumber !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/.test(params.transferNumber)) {
      return { success: false, error: 'رقم الحوالة الصادرة غير صالح.' };
    }
    if (!currencies.includes(params.currency)) {
      return { success: false, error: 'عملة الحوالة الصادرة غير مدعومة.' };
    }
    const isValidAmount = (value: number) =>
      typeof value === 'number' && Number.isFinite(value) &&
      value >= 0 && Math.abs(value * 1000 - Math.round(value * 1000)) <= 1e-8;
    if (!isValidAmount(params.amount) || params.amount <= 0 ||
        !isValidAmount(params.feeAmount)) {
      return { success: false, error: 'مبلغ الحوالة والعمولة يجب أن يكونا صالحين حتى ثلاث منازل عشرية، مع مبلغ حوالة موجب.' };
    }
    if (typeof params.senderName !== 'string' || !params.senderName.trim() || params.senderName.trim().length > 160 ||
        typeof params.recipientName !== 'string' || !params.recipientName.trim() || params.recipientName.trim().length > 160 ||
        typeof params.networkName !== 'string' || !params.networkName.trim() || params.networkName.trim().length > 100 ||
        typeof params.tellerId !== 'string' || !params.tellerId.trim() ||
        typeof params.tellerName !== 'string' || !params.tellerName.trim()) {
      return { success: false, error: 'اسم المرسل والمستفيد والشبكة وبيانات المنفذ حقول إلزامية.' };
    }
    const notes = typeof params.notes === 'string' ? params.notes.trim() : '';
    if (notes.length > 500) {
      return { success: false, error: 'ملاحظات الحوالة تتجاوز الحد المسموح.' };
    }

    const totalPaid = params.amount + params.feeAmount;
    if (!Number.isFinite(totalPaid) || totalPaid <= 0) {
      return { success: false, error: 'إجمالي المبلغ المدفوع غير صالح.' };
    }

    const priorEntry = this.journalEntries.find((entry) =>
      entry.idempotencyKey === params.idempotencyKey &&
      entry.referenceType === 'transfer_send'
    );
    if (priorEntry) {
      const sameTransfer = priorEntry.referenceId === params.transferNumber.trim().toUpperCase() &&
        priorEntry.createdBy === params.tellerName &&
        priorEntry.branchId === (params.branchId || 'br-main') &&
        priorEntry.descriptionAr === `إرسال حوالة صادرة ${params.transferNumber.trim().toUpperCase()} للمستلم ${params.recipientName.trim()} عبر ${params.networkName.trim()}`;
      const cashLine = priorEntry.lines.find((line) =>
        line.accountId === 'acc-1102' && line.currency === params.currency &&
        Math.abs(line.debit - totalPaid) <= 0.0000001 && line.credit === 0
      );
      const payableLine = priorEntry.lines.find((line) =>
        line.accountId === 'acc-2201' && line.currency === params.currency &&
        Math.abs(line.credit - params.amount) <= 0.0000001 && line.debit === 0
      );
      const commissionLine = params.feeAmount > 0
        ? priorEntry.lines.find((line) =>
            line.accountId === 'acc-4101' && line.currency === params.currency &&
            Math.abs(line.credit - params.feeAmount) <= 0.0000001 && line.debit === 0
          )
        : undefined;
      if (!sameTransfer || !cashLine || !payableLine || (params.feeAmount > 0 && !commissionLine)) {
        return { success: false, error: 'معرف الحوالة مستخدم سابقاً مع بيانات مختلفة. لم تُنفذ حركة مالية جديدة.' };
      }
      return {
        success: true,
        journalEntry: priorEntry,
        accounts: this.getAccounts(),
        totalPaid,
      };
    }

    if (this.storageWriteBlocked ||
        (!this.activeTransactionId && fs.existsSync(PENDING_FINANCIAL_TRANSACTION_FILE))) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: 'توجد معاملة مالية غير محسومة. أوقف النظام ولا تسجل حوالة صادرة جديدة حتى مطابقة الدفاتر.',
      };
    }

    const cashier = this.accounts.get('acc-1102');
    const pendingRemittance = this.accounts.get('acc-2201');
    const commissionAccount = this.accounts.get('acc-4101');
    if (!cashier || cashier.type !== 'asset') {
      return { success: false, error: 'صندوق الكاشير (acc-1102) غير موجود أو نوعه المحاسبي غير صحيح.' };
    }
    if (!pendingRemittance || pendingRemittance.type !== 'liability') {
      return {
        success: false,
        error: 'حساب الحوالات المعلقة/مستحقات الشبكة (acc-2201) غير موجود أو ليس حساب التزامات. رحّل دليل الحسابات واعتمد خط الأساس أولاً.',
      };
    }
    if (params.feeAmount > 0 && (!commissionAccount || commissionAccount.type !== 'revenue')) {
      return {
        success: false,
        error: 'حساب إيرادات العمولات (acc-4101) غير موجود أو نوعه المحاسبي غير صحيح.',
      };
    }

    let ownTransactionId: string | null = null;
    if (!this.activeTransactionId) {
      const started = this.beginFinancialTransaction({
        operation: 'outgoing_remittance',
        referenceId: params.transferNumber.trim().toUpperCase(),
        amount: totalPaid,
        currency: params.currency,
        actorId: params.tellerId,
      });
      if (!started.success || !started.transactionId) {
        return {
          success: false,
          errorCode: 'COMMIT_PENDING_RECOVERY',
          error: started.error || 'تعذر بدء معاملة الحوالة الصادرة الآمنة.',
        };
      }
      ownTransactionId = started.transactionId;
    }

    const previousCashier = cashier.balances[params.currency] || 0;
    const previousPending = pendingRemittance.balances[params.currency] || 0;
    const previousCommission = commissionAccount?.balances[params.currency] || 0;
    cashier.balances[params.currency] = previousCashier + totalPaid;
    pendingRemittance.balances[params.currency] = previousPending + params.amount;
    if (params.feeAmount > 0 && commissionAccount) {
      commissionAccount.balances[params.currency] = previousCommission + params.feeAmount;
    }

    const [date, time] = getYemenDateTimeString().split(' ');
    const normalizedNumber = params.transferNumber.trim().toUpperCase();
    const voucherNumber = `V-OUT-${crypto.randomUUID().toUpperCase()}`;
    const entryNumber = `JV-OUT-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const lines: ServerJournalLine[] = [
      {
        accountId: cashier.id,
        accountNameAr: cashier.nameAr,
        currency: params.currency,
        debit: totalPaid,
        credit: 0,
        note: `مبلغ مستلم من المرسل ${params.senderName.trim()} شاملاً العمولة`,
      },
      {
        accountId: pendingRemittance.id,
        accountNameAr: pendingRemittance.nameAr,
        currency: params.currency,
        debit: 0,
        credit: params.amount,
        note: `مستحق للشبكة ${params.networkName.trim()} عن الحوالة ${normalizedNumber}`,
      },
    ];
    if (params.feeAmount > 0 && commissionAccount) {
      lines.push({
        accountId: commissionAccount.id,
        accountNameAr: commissionAccount.nameAr,
        currency: params.currency,
        debit: 0,
        credit: params.feeAmount,
        note: `عمولة حوالة صادرة ${normalizedNumber}`,
      });
    }

    const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      cashier.balances[params.currency] = previousCashier;
      pendingRemittance.balances[params.currency] = previousPending;
      if (commissionAccount) commissionAccount.balances[params.currency] = previousCommission;
      if (ownTransactionId) this.cancelFinancialTransaction(ownTransactionId);
      return { success: false, error: 'القيد المحاسبي للحوالة الصادرة غير متوازن؛ لم تُحفظ العملية.' };
    }

    const journalEntry: ServerJournalEntry = {
      id: `jv-out-${crypto.randomUUID()}`,
      entryNumber,
      date,
      time,
      descriptionAr: `إرسال حوالة صادرة ${normalizedNumber} للمستلم ${params.recipientName.trim()} عبر ${params.networkName.trim()}`,
      lines,
      referenceType: 'transfer_send',
      referenceId: normalizedNumber,
      branchId: params.branchId || 'br-main',
      createdBy: params.tellerName,
      isBalanced: true,
      idempotencyKey: params.idempotencyKey,
      voucherNumber,
    };

    this.journalEntries.unshift(journalEntry);
    try {
      safeAtomicWriteJson(ACCOUNTS_FILE, Array.from(this.accounts.values()));
      safeAtomicWriteJson(JOURNAL_FILE, this.journalEntries);
    } catch (error: any) {
      cashier.balances[params.currency] = previousCashier;
      pendingRemittance.balances[params.currency] = previousPending;
      if (commissionAccount) commissionAccount.balances[params.currency] = previousCommission;
      this.journalEntries.shift();
      this.storageWriteBlocked = true;
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: `فشل حفظ دفتر الحوالة الصادرة. لا تعاود العملية؛ أوقف النظام وطابق الأرصدة والقيود. ${error.message}`,
      };
    }

    if (ownTransactionId) {
      const completed = this.completeFinancialTransaction(ownTransactionId);
      if (!completed.success) {
        return {
          success: false,
          errorCode: 'COMMIT_PENDING_RECOVERY',
          journalEntry,
          error: completed.error || 'تعذر إغلاق علامة معاملة الحوالة الصادرة.',
        };
      }
    }

    return {
      success: true,
      journalEntry,
      accounts: this.getAccounts(),
      totalPaid,
    };
  }

  public executeInternalTransfer(params: {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    currency: CurrencyCode;
    description: string;
    operatorId: string;
    operatorName: string;
    branchId?: string;
    idempotencyKey: string;
  }): {
    success: boolean;
    journalEntry?: ServerJournalEntry;
    accounts?: ServerAccount[];
    error?: string;
    errorCode?: 'COMMIT_PENDING_RECOVERY';
  } {
    const currencies: CurrencyCode[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];
    if (typeof params.idempotencyKey !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.idempotencyKey)) {
      return { success: false, error: 'معرف المناقلة غير صالح. أعد فتح الطلب من الواجهة.' };
    }

    if (typeof params.fromAccountId !== 'string' || !params.fromAccountId.trim() ||
        typeof params.toAccountId !== 'string' || !params.toAccountId.trim()) {
      return { success: false, error: 'يجب تحديد حساب التحويل والحساب المستلم.' };
    }
    if (params.fromAccountId === params.toAccountId) {
      return { success: false, error: 'لا يمكن إجراء مناقلة إلى الحساب نفسه.' };
    }
    if (!currencies.includes(params.currency)) {
      return { success: false, error: 'العملة المحددة غير مدعومة.' };
    }
    if (typeof params.amount !== 'number' || !Number.isFinite(params.amount) ||
        params.amount <= 0 || Math.abs(params.amount * 1000 - Math.round(params.amount * 1000)) > 1e-8) {
      return { success: false, error: 'المبلغ يجب أن يكون موجباً وصالحاً حتى ثلاث منازل عشرية.' };
    }
    if (typeof params.description !== 'string' || !params.description.trim() ||
        params.description.trim().length > 240) {
      return { success: false, error: 'وصف المناقلة إلزامي ولا يتجاوز 240 حرفاً.' };
    }
    if (typeof params.operatorId !== 'string' || !params.operatorId.trim() ||
        typeof params.operatorName !== 'string' || !params.operatorName.trim()) {
      return { success: false, error: 'بيانات منفذ المناقلة غير صالحة.' };
    }

    if (this.storageWriteBlocked || this.activeTransactionId ||
        fs.existsSync(PENDING_FINANCIAL_TRANSACTION_FILE)) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: 'توجد معاملة مالية غير محسومة أو قيد المعالجة. أوقف النظام ولا تنفذ مناقلة جديدة حتى مطابقة الدفاتر.',
      };
    }

    const priorEntry = this.journalEntries.find((entry) =>
      entry.idempotencyKey === params.idempotencyKey &&
      entry.referenceType === 'internal_transfer' &&
      entry.descriptionAr.startsWith('مناقلة داخلية:')
    );
    if (priorEntry) {
      const debitLine = priorEntry.lines.find((line) =>
        line.accountId === params.toAccountId &&
        line.currency === params.currency &&
        Math.abs(line.debit - params.amount) <= 0.001 &&
        line.credit === 0
      );
      const creditLine = priorEntry.lines.find((line) =>
        line.accountId === params.fromAccountId &&
        line.currency === params.currency &&
        Math.abs(line.credit - params.amount) <= 0.001 &&
        line.debit === 0
      );
      const sameDescription = priorEntry.descriptionAr === `مناقلة داخلية: ${params.description.trim()}` &&
        priorEntry.createdBy === params.operatorName &&
        priorEntry.branchId === (params.branchId || 'br-main');

      if (!debitLine || !creditLine || !sameDescription) {
        return {
          success: false,
          error: 'معرف المناقلة مستخدم سابقاً ببيانات مختلفة. رُفض الطلب ولم تُنفذ حركة جديدة.',
        };
      }
      return {
        success: true,
        journalEntry: priorEntry,
        accounts: this.getAccounts(),
      };
    }

    const fromAccount = this.accounts.get(params.fromAccountId);
    const toAccount = this.accounts.get(params.toAccountId);
    if (!fromAccount || !toAccount) {
      return { success: false, error: 'أحد الحسابين المحددين غير موجود في دليل الحسابات المعتمد.' };
    }
    if (fromAccount.type !== 'asset' || toAccount.type !== 'asset') {
      return { success: false, error: 'المناقلة الداخلية مسموحة بين حسابات الأصول فقط في هذا المسار.' };
    }
    const sourceBalance = fromAccount.balances[params.currency];
    if (typeof sourceBalance !== 'number' || !Number.isFinite(sourceBalance) ||
        sourceBalance < params.amount) {
      return {
        success: false,
        error: `رصيد الحساب ${fromAccount.nameAr} غير كافٍ لتنفيذ المناقلة.`,
      };
    }

    const started = this.beginFinancialTransaction({
      operation: 'internal_transfer',
      referenceId: `${params.fromAccountId}->${params.toAccountId}`,
      amount: params.amount,
      currency: params.currency,
      actorId: params.operatorId,
    });
    if (!started.success || !started.transactionId) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: started.error || 'تعذر بدء المعاملة المالية الآمنة.',
      };
    }

    const previousSourceBalance = fromAccount.balances[params.currency];
    const previousTargetBalance = toAccount.balances[params.currency] || 0;
    fromAccount.balances[params.currency] = previousSourceBalance - params.amount;
    toAccount.balances[params.currency] = previousTargetBalance + params.amount;

    const yemenTime = getYemenDateTimeString();
    const [date, time] = yemenTime.split(' ');
    const voucherNumber = `V-TRF-${crypto.randomUUID().toUpperCase()}`;
    const entryNumber = `JV-TRF-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const journalEntry: ServerJournalEntry = {
      id: `jv-trf-${crypto.randomUUID()}`,
      entryNumber,
      date,
      time,
      descriptionAr: `مناقلة داخلية: ${params.description.trim()}`,
      lines: [
        {
          accountId: toAccount.id,
          accountNameAr: toAccount.nameAr,
          currency: params.currency,
          debit: params.amount,
          credit: 0,
          note: 'استلام مناقلة داخلية',
        },
        {
          accountId: fromAccount.id,
          accountNameAr: fromAccount.nameAr,
          currency: params.currency,
          debit: 0,
          credit: params.amount,
          note: 'إرسال مناقلة داخلية',
        },
      ],
      referenceType: 'internal_transfer',
      referenceId: voucherNumber,
      branchId: params.branchId || 'br-main',
      createdBy: params.operatorName,
      isBalanced: true,
      idempotencyKey: params.idempotencyKey,
      voucherNumber,
    };

    this.journalEntries.unshift(journalEntry);
    try {
      safeAtomicWriteJson(ACCOUNTS_FILE, Array.from(this.accounts.values()));
      safeAtomicWriteJson(JOURNAL_FILE, this.journalEntries);
    } catch (error: any) {
      fromAccount.balances[params.currency] = previousSourceBalance;
      toAccount.balances[params.currency] = previousTargetBalance;
      this.journalEntries.shift();
      this.storageWriteBlocked = true;
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: `فشل حفظ المناقلة في الدفاتر. لا تعاود الطلب؛ أوقف النظام وطابق الحسابات والقيود. ${error.message}`,
      };
    }

    const completed = this.completeFinancialTransaction(started.transactionId);
    if (!completed.success) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        journalEntry,
        error: completed.error || 'تعذر إغلاق علامة المعاملة المالية؛ يلزم فحص الدفاتر.',
      };
    }

    return {
      success: true,
      journalEntry,
      accounts: this.getAccounts(),
    };
  }

  public executeOperatingExpense(params: {
    expenseType: string;
    amount: number;
    currency: CurrencyCode;
    notes: string;
    operatorId: string;
    operatorName: string;
    branchId?: string;
    idempotencyKey: string;
  }): {
    success: boolean;
    journalEntry?: ServerJournalEntry;
    accounts?: ServerAccount[];
    error?: string;
    errorCode?: 'COMMIT_PENDING_RECOVERY';
  } {
    const currencies: CurrencyCode[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];
    if (typeof params.idempotencyKey !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.idempotencyKey)) {
      return { success: false, error: 'معرف سند المصروف غير صالح.' };
    }
    if (!currencies.includes(params.currency)) {
      return { success: false, error: 'عملة المصروف غير مدعومة.' };
    }
    if (typeof params.amount !== 'number' || !Number.isFinite(params.amount) ||
        params.amount <= 0 || Math.abs(params.amount * 1000 - Math.round(params.amount * 1000)) > 1e-8) {
      return { success: false, error: 'مبلغ المصروف يجب أن يكون موجباً وصالحاً حتى ثلاث منازل عشرية.' };
    }
    if (typeof params.expenseType !== 'string' || !params.expenseType.trim() ||
        params.expenseType.trim().length > 120 ||
        typeof params.notes !== 'string' || !params.notes.trim() || params.notes.trim().length > 240) {
      return { success: false, error: 'نوع المصروف والبيان إلزاميان، ويجب ألا يتجاوز كل منهما الحد المسموح.' };
    }
    if (typeof params.operatorId !== 'string' || !params.operatorId.trim() ||
        typeof params.operatorName !== 'string' || !params.operatorName.trim()) {
      return { success: false, error: 'بيانات منفذ سند المصروف غير صالحة.' };
    }

    if (this.storageWriteBlocked || this.activeTransactionId ||
        fs.existsSync(PENDING_FINANCIAL_TRANSACTION_FILE)) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: 'توجد معاملة مالية غير محسومة. أوقف النظام ولا تنفذ مصروفاً جديداً حتى مطابقة الدفاتر.',
      };
    }

    const expectedDescription = `مصروف تشغيلي: ${params.expenseType.trim()} - ${params.notes.trim()}`;
    const priorEntry = this.journalEntries.find((entry) =>
      entry.idempotencyKey === params.idempotencyKey &&
      entry.referenceType === 'expense'
    );
    if (priorEntry) {
      const debitLine = priorEntry.lines.find((line) =>
        line.accountId === 'acc-5101' &&
        line.currency === params.currency &&
        Math.abs(line.debit - params.amount) <= 0.0000001 &&
        line.credit === 0
      );
      const creditLine = priorEntry.lines.find((line) =>
        line.accountId === 'acc-1102' &&
        line.currency === params.currency &&
        Math.abs(line.credit - params.amount) <= 0.0000001 &&
        line.debit === 0
      );
      const sameRequest = priorEntry.descriptionAr === expectedDescription &&
        priorEntry.createdBy === params.operatorName &&
        priorEntry.branchId === (params.branchId || 'br-main');

      if (!debitLine || !creditLine || !sameRequest) {
        return {
          success: false,
          error: 'معرف المصروف مستخدم سابقاً مع بيانات مختلفة أو منفذ/فرع مختلف. رُفض الطلب دون تنفيذ حركة جديدة.',
        };
      }
      return {
        success: true,
        journalEntry: priorEntry,
        accounts: this.getAccounts(),
      };
    }

    const expenseAccount = this.accounts.get('acc-5101');
    const cashierAccount = this.accounts.get('acc-1102');
    if (!expenseAccount || expenseAccount.type !== 'expense') {
      return {
        success: false,
        error: 'حساب المصروفات (acc-5101) غير موجود أو نوعه غير صحيح. رحّل دليل الحسابات واعتمد خط الأساس قبل تسجيل المصروفات.',
      };
    }
    if (!cashierAccount || cashierAccount.type !== 'asset') {
      return { success: false, error: 'صندوق الكاشير (acc-1102) غير موجود أو نوعه غير صحيح.' };
    }

    const cashierBalance = cashierAccount.balances[params.currency];
    if (typeof cashierBalance !== 'number' || !Number.isFinite(cashierBalance) ||
        cashierBalance < params.amount) {
      return {
        success: false,
        error: `رصيد صندوق الكاشير غير كافٍ لتغطية المصروف بعملة ${params.currency}.`,
      };
    }

    const started = this.beginFinancialTransaction({
      operation: 'operating_expense',
      referenceId: 'acc-5101->acc-1102',
      amount: params.amount,
      currency: params.currency,
      actorId: params.operatorId,
    });
    if (!started.success || !started.transactionId) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: started.error || 'تعذر بدء معاملة المصروف الآمنة.',
      };
    }

    const previousCashierBalance = cashierAccount.balances[params.currency];
    const previousExpenseBalance = expenseAccount.balances[params.currency] || 0;
    cashierAccount.balances[params.currency] = previousCashierBalance - params.amount;
    expenseAccount.balances[params.currency] = previousExpenseBalance + params.amount;

    const [date, time] = getYemenDateTimeString().split(' ');
    const voucherNumber = `V-EXP-${crypto.randomUUID().toUpperCase()}`;
    const entryNumber = `JV-EXP-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const journalEntry: ServerJournalEntry = {
      id: `jv-exp-${crypto.randomUUID()}`,
      entryNumber,
      date,
      time,
      descriptionAr: expectedDescription,
      lines: [
        {
          accountId: expenseAccount.id,
          accountNameAr: expenseAccount.nameAr,
          currency: params.currency,
          debit: params.amount,
          credit: 0,
          note: params.notes.trim(),
        },
        {
          accountId: cashierAccount.id,
          accountNameAr: cashierAccount.nameAr,
          currency: params.currency,
          debit: 0,
          credit: params.amount,
          note: 'صرف نقدي من صندوق الكاشير',
        },
      ],
      referenceType: 'expense',
      referenceId: voucherNumber,
      branchId: params.branchId || 'br-main',
      createdBy: params.operatorName,
      isBalanced: true,
      idempotencyKey: params.idempotencyKey,
      voucherNumber,
    };

    this.journalEntries.unshift(journalEntry);
    try {
      safeAtomicWriteJson(ACCOUNTS_FILE, Array.from(this.accounts.values()));
      safeAtomicWriteJson(JOURNAL_FILE, this.journalEntries);
    } catch (error: any) {
      cashierAccount.balances[params.currency] = previousCashierBalance;
      expenseAccount.balances[params.currency] = previousExpenseBalance;
      this.journalEntries.shift();
      this.storageWriteBlocked = true;
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: `فشل حفظ سند المصروف في الدفاتر. لا تعاود العملية؛ أوقف النظام وطابق الحسابات والقيود. ${error.message}`,
      };
    }

    const completed = this.completeFinancialTransaction(started.transactionId);
    if (!completed.success) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        journalEntry,
        error: completed.error || 'تعذر إغلاق علامة معاملة المصروف؛ يلزم فحص الدفاتر.',
      };
    }

    return {
      success: true,
      journalEntry,
      accounts: this.getAccounts(),
    };
  }

  public fundCashierDrawer(params: {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    currency: CurrencyCode;
    operatorName: string;
    branchId?: string;
    idempotencyKey: string;
  }): { success: boolean; journalEntry?: ServerJournalEntry; error?: string; errorCode?: 'COMMIT_PENDING_RECOVERY' } {
    if (typeof params.idempotencyKey !== 'string' || !/^[a-f0-9-]{36}$/i.test(params.idempotencyKey)) {
      return { success: false, error: 'مفتاح العملية غير صالح. أعد فتح الطلب من الواجهة.' };
    }

    if (this.storageWriteBlocked || this.activeTransactionId ||
        fs.existsSync(PENDING_FINANCIAL_TRANSACTION_FILE)) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: 'توجد معاملة مالية غير محسومة أو قيد المعالجة. أوقف النظام ولا تعاود التغذية حتى مطابقة الدفاتر.',
      };
    }

    // Safe retry: if the original request committed but its HTTP response was lost,
    // return the original journal entry without applying the balances a second time.
    const priorEntry = this.journalEntries.find((entry) =>
      entry.idempotencyKey === params.idempotencyKey &&
      entry.referenceType === 'internal_transfer' &&
      entry.descriptionAr.startsWith('تغذية صندوق ')
    );
    if (priorEntry) {
      const debitLine = priorEntry.lines.find((line) =>
        line.accountId === params.toAccountId &&
        line.currency === params.currency &&
        Math.abs(line.debit - params.amount) <= 0.001 &&
        line.credit === 0
      );
      const creditLine = priorEntry.lines.find((line) =>
        line.accountId === params.fromAccountId &&
        line.currency === params.currency &&
        Math.abs(line.credit - params.amount) <= 0.001 &&
        line.debit === 0
      );

      const sameOperator = priorEntry.createdBy === params.operatorName &&
        priorEntry.branchId === (params.branchId || 'br-main');
      if (!debitLine || !creditLine || !sameOperator) {
        return {
          success: false,
          error: 'مفتاح العملية مستخدم سابقاً مع مبلغ أو عملة أو حسابات أو منفذ مختلف. رُفض الطلب ولم تُنفذ حركة مالية جديدة.',
        };
      }

      return { success: true, journalEntry: priorEntry };
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

    const voucherNumber = `V-FUND-${crypto.randomUUID().toUpperCase()}`;
    const newJournalEntry: ServerJournalEntry = {
      id: `jv-fund-${Date.now()}-${nextSeq}`,
      entryNumber,
      date: dateStr,
      time: timeStr,
      descriptionAr: `تغذية صندوق من ${fromAcc.nameAr} إلى ${toAcc.nameAr}`,
      lines,
      referenceType: 'internal_transfer',
      referenceId: voucherNumber,
      branchId: params.branchId || 'br-main',
      createdBy: params.operatorName,
      isBalanced: true,
      idempotencyKey: params.idempotencyKey,
      voucherNumber,
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
