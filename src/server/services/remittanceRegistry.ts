/**
 * سجل إدارة وترقيم وصرف الحوالات المالية المركزي - نظام عمرو النماري للصرافة
 * Central Enterprise Remittance Master Registry & Financial Integrity Engine
 * معالجة نتائج التدقيق: C2, C3, H1, H2, H4, M1, M2, M7, L1
 */

import fs from 'fs';
import crypto from 'node:crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { safeAtomicWriteJson, safeReadJson, getYemenDateTimeString } from '../utils/atomicFileStorage.js';
import { serverAccountingEngine, ServerJournalEntry, CurrencyCode } from './serverAccountingEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.NODE_ENV === 'test' && process.env.ALNAMARI_TEST_DATA_DIR
  ? path.resolve(process.env.ALNAMARI_TEST_DATA_DIR)
  : path.resolve(__dirname, '../../../data');
const SETTINGS_FILE = path.resolve(DATA_DIR, 'remittance_settings.json');
const NUMBERS_REGISTRY_FILE = path.resolve(DATA_DIR, 'remittance_numbers_registry.json');
const AUDIT_LOGS_FILE = path.resolve(DATA_DIR, 'remittance_audit_logs.json');
const PAYOUTS_REGISTRY_FILE = path.resolve(DATA_DIR, 'remittance_payouts_registry.json');
const MASTER_REMITTANCES_FILE = path.resolve(DATA_DIR, 'remittances_master.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export type RemittanceNumberingMode = 'automatic' | 'manual';
export type TransferStatus = 'draft' | 'approved' | 'available' | 'paid' | 'cancelled' | 'refunded' | 'pending';

export interface RemittanceSettingsRecord {
  numberingMode: RemittanceNumberingMode;
  prefix: string;
  nextSequence: number;
  updatedAt: string;
  updatedBy: string;
  updatedByRole: string;
  notes?: string;
}

export interface RemittanceAuditRecord {
  id: string;
  category: 'remittance_numbering' | 'security' | 'financial' | 'reconciliation';
  action: string;
  details: string;
  performedBy: string;
  userRole: string;
  timestamp: string;
  oldValue?: string;
  newValue?: string;
}

export interface RemittancePayoutRecord {
  idempotencyKey?: string;
  transferId: string;
  transferNumber: string;
  recipientIdType: string;
  recipientIdNumber: string;
  tellerId: string;
  tellerName: string;
  tellerRole: string;
  amount: number;
  currency: string;
  paidAt: string;
  voucherNumber: string;
  journalEntryReference: string;
  cashMovementReference?: string;
  managerOverride?: boolean;
  managerOverrideBy?: string;
  managerOverrideReason?: string;
}

export interface RemittanceMasterRecord {
  id: string;
  tellerRole?: string;
  transferNumber: string;
  direction: 'outgoing' | 'incoming';
  status: TransferStatus;
  senderName: string;
  senderPhone: string;
  recipientName: string;
  recipientPhone: string;
  networkName: string;
  amount: number;
  currency: string;
  feeAmount: number;
  totalPaid: number;
  branchName: string;
  tellerName: string;
  createdAt: string;
  paidAt?: string;
  recipientIdType?: string;
  recipientIdNumber?: string;
  voucherNumber?: string;
  journalEntryReference?: string;
  cashMovementReference?: string;
  payoutRecordId?: string;
  numberingMode?: RemittanceNumberingMode;
  idempotencyKey?: string;
  notes?: string;
}

export interface ReconciliationResult {
  timestamp: string;
  totalMasterRemittances: number;
  totalPaidRemittances: number;
  totalPayoutRecords: number;
  matchedCount: number;
  discrepanciesCount: number;
  status: 'BALANCED' | 'DISCREPANCIES_FOUND';
  discrepancies: Array<{
    transferNumber: string;
    issue: string;
    details: string;
  }>;
}

const SUPPORTED_CURRENCIES: CurrencyCode[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];

export class RemittanceRegistry {
  private settings: RemittanceSettingsRecord;
  private registeredNumbers: Map<string, { number: string; registeredAt: string; registeredBy: string; mode: string }> = new Map();
  private auditLogs: RemittanceAuditRecord[] = [];
  private payouts: Map<string, RemittancePayoutRecord> = new Map();
  private idempotencyStore: Map<string, RemittancePayoutRecord> = new Map();
  private idempotencyToTransferMap: Map<string, string> = new Map();
  private masterRemittances: Map<string, RemittanceMasterRecord> = new Map();
  private inFlightPayouts: Set<string> = new Set();

  constructor() {
    this.settings = {
      numberingMode: 'automatic',
      prefix: 'TR-',
      nextSequence: 931107,
      updatedAt: '2026-11-06 09:00',
      updatedBy: 'عمرو النماري',
      updatedByRole: 'owner',
      notes: 'الترقيم التلقائي المركزي المتسلسل لمنع التكرار وضمان سلامة الدورة المستندية.',
    };

    this.loadFromDisk();
  }

  /**
   * H4: قراءة آمنة تمنع بلع الأخطاء وتدمير البيانات عند وجود تلف
   */
  private loadFromDisk() {
    // جميع هذه الملفات تحمل حالة مالية أو مرجعية تؤثر في منع التكرار؛ لا يجوز استبدالها بقيم فارغة عند الفقد أو التلف.
    const loadedSettings = safeReadJson<RemittanceSettingsRecord>(SETTINGS_FILE, this.settings, {
      failOnCorruption: true,
      failOnMissing: true,
    });
    if (!loadedSettings || typeof loadedSettings !== 'object' ||
        !['automatic', 'manual'].includes(loadedSettings.numberingMode) ||
        typeof loadedSettings.prefix !== 'string' || !loadedSettings.prefix.trim() ||
        !Number.isSafeInteger(loadedSettings.nextSequence) || loadedSettings.nextSequence < 1) {
      throw new Error('توقف آمن: إعدادات ترقيم الحوالات غير صالحة؛ لن يتم تشغيل التسجيل أو الترقيم حتى استعادة الإعدادات الصحيحة.');
    }

    const numbersList = safeReadJson<{ number: string; registeredAt: string; registeredBy: string; mode: string }[]>(
      NUMBERS_REGISTRY_FILE,
      [],
      { failOnCorruption: true, failOnMissing: true }
    );
    if (!Array.isArray(numbersList) ||
        numbersList.some((item) => !item || typeof item.number !== 'string' || !item.number.trim())) {
      throw new Error('توقف آمن: سجل أرقام الحوالات غير صالح؛ منعاً لإعادة استخدام رقم سبق حجزه.');
    }

    const payoutsList = safeReadJson<RemittancePayoutRecord[]>(PAYOUTS_REGISTRY_FILE, [], {
      failOnCorruption: true,
      failOnMissing: true,
    });
    if (!Array.isArray(payoutsList) ||
        payoutsList.some((item) => !item || typeof item.transferNumber !== 'string' ||
          !item.transferNumber.trim() || typeof item.tellerId !== 'string' ||
          !Number.isFinite(item.amount) || item.amount <= 0 ||
          typeof item.currency !== 'string' || typeof item.voucherNumber !== 'string' ||
          typeof item.journalEntryReference !== 'string')) {
      throw new Error('توقف آمن: سجل صرف الحوالات يحتوي سجلات غير صالحة؛ لن يتم تحميل حالة صرف غير موثوقة.');
    }

    const auditLogs = safeReadJson<RemittanceAuditRecord[]>(AUDIT_LOGS_FILE, [], {
      failOnCorruption: true,
      failOnMissing: true,
    });
    if (!Array.isArray(auditLogs) ||
        auditLogs.some((item) => !item || typeof item.id !== 'string' ||
          typeof item.action !== 'string' || typeof item.timestamp !== 'string')) {
      throw new Error('توقف آمن: سجل تدقيق الحوالات غير صالح؛ لا يمكن ضمان سلامة سجل العمليات.');
    }

    const masterList = safeReadJson<RemittanceMasterRecord[]>(MASTER_REMITTANCES_FILE, [], {
      failOnCorruption: true,
      failOnMissing: true,
    });
    if (!Array.isArray(masterList) ||
        masterList.some((item) => !item || typeof item.id !== 'string' ||
          typeof item.transferNumber !== 'string' || !item.transferNumber.trim() ||
          !Number.isFinite(item.amount) || item.amount <= 0)) {
      throw new Error('توقف آمن: سجل الحوالات الرئيسي يحتوي بيانات غير صالحة؛ تم منع تشغيل الصرف على سجل ناقص.');
    }

    this.settings = loadedSettings;
    this.registeredNumbers.clear();
    for (const item of numbersList) {
      const normalizedNumber = item.number.trim().toUpperCase();
      if (this.registeredNumbers.has(normalizedNumber)) {
        throw new Error(`توقف آمن: رقم حوالة مكرر في سجل الأرقام (${normalizedNumber}).`);
      }
      this.registeredNumbers.set(normalizedNumber, item);
    }

    this.payouts.clear();
    this.idempotencyStore.clear();
    this.idempotencyToTransferMap.clear();
    for (const item of payoutsList) {
      const cleanNum = item.transferNumber.trim().toUpperCase();
      if (this.payouts.has(cleanNum)) {
        throw new Error(`توقف آمن: توجد أكثر من عملية صرف مسجلة للحوالة (${cleanNum}).`);
      }
      this.payouts.set(cleanNum, item);
      if (item.idempotencyKey) {
        const boundTransfer = this.idempotencyToTransferMap.get(item.idempotencyKey);
        if (boundTransfer && boundTransfer !== cleanNum) {
          throw new Error(`توقف آمن: مفتاح عدم التكرار مرتبط بأكثر من حوالة (${item.idempotencyKey}).`);
        }
        const compositeKey = `${cleanNum}:${item.tellerId}:${item.idempotencyKey}`;
        this.idempotencyStore.set(compositeKey, item);
        this.idempotencyToTransferMap.set(item.idempotencyKey, cleanNum);
      }
    }

    this.auditLogs = auditLogs;
    this.masterRemittances.clear();
    for (const item of masterList) {
      const normalizedNumber = item.transferNumber.trim().toUpperCase();
      if (this.masterRemittances.has(normalizedNumber)) {
        throw new Error(`توقف آمن: رقم حوالة مكرر في السجل الرئيسي (${normalizedNumber}).`);
      }
      this.masterRemittances.set(normalizedNumber, item);
    }

    // Reconcile all paid records against both the payout registry and the actual journal.
    // If any side of a previous multi-file commit is missing or inconsistent, do not start the service.
    const journalEntries = serverAccountingEngine.getJournalEntries();
    for (const [cleanNum, payout] of this.payouts) {
      const master = this.masterRemittances.get(cleanNum);
      const journal = journalEntries.find((entry) => entry.entryNumber === payout.journalEntryReference);
      if (!master || master.status !== 'paid' ||
          master.amount !== payout.amount || master.currency !== payout.currency ||
          master.journalEntryReference !== payout.journalEntryReference ||
          !journal || journal.referenceType !== 'transfer_payout' ||
          journal.referenceId.trim().toUpperCase() !== cleanNum) {
        throw new Error(`توقف آمن: عدم تطابق سجل صرف الحوالة (${cleanNum}) بين الحوالة الرئيسية وسجل الصرف ودفتر اليومية. يلزم فحص محاسبي قبل التشغيل.`);
      }

      const debit = journal.lines
        .filter((line) => line.currency === payout.currency)
        .reduce((sum, line) => sum + line.debit, 0);
      const credit = journal.lines
        .filter((line) => line.currency === payout.currency)
        .reduce((sum, line) => sum + line.credit, 0);
      if (Math.abs(debit - payout.amount) > 0.001 || Math.abs(credit - payout.amount) > 0.001) {
        throw new Error(`توقف آمن: مبالغ قيد اليومية لا تطابق عملية صرف الحوالة (${cleanNum}). يلزم فحص محاسبي قبل التشغيل.`);
      }
    }

    for (const [cleanNum, master] of this.masterRemittances) {
      if (master.status === 'paid' && !this.payouts.has(cleanNum)) {
        throw new Error(`توقف آمن: الحوالة (${cleanNum}) مدفوعة في السجل الرئيسي دون سجل صرف مطابق.`);
      }
    }

    for (const journal of journalEntries) {
      if (journal.referenceType === 'transfer_payout') {
        const cleanNum = journal.referenceId.trim().toUpperCase();
        const payout = this.payouts.get(cleanNum);
        if (!payout || payout.journalEntryReference !== journal.entryNumber) {
          throw new Error(`توقف آمن: قيد صرف (${journal.entryNumber}) لا يملك سجل صرف وحوالة رئيسية مطابقين.`);
        }
      }
    }
  }
  private saveSettingsToDisk() {
    safeAtomicWriteJson(SETTINGS_FILE, this.settings);
  }

  private saveNumbersToDisk() {
    safeAtomicWriteJson(NUMBERS_REGISTRY_FILE, Array.from(this.registeredNumbers.values()));
  }

  private saveAuditLogsToDisk() {
    safeAtomicWriteJson(AUDIT_LOGS_FILE, this.auditLogs);
  }

  private savePayoutsToDisk() {
    safeAtomicWriteJson(PAYOUTS_REGISTRY_FILE, Array.from(this.payouts.values()));
  }

  private saveMasterRemittancesToDisk() {
    safeAtomicWriteJson(MASTER_REMITTANCES_FILE, Array.from(this.masterRemittances.values()));
  }

  // =========================================================================
  // Master Remittance Authority (قواعد المصدر المعتمد على الخادم)
  // =========================================================================

  /**
   * C2 & M1: تسجيل حوالة في السجل المركزي المعتمد مع تدقيق صارم للمبالغ والعملة
   */
  public registerMasterRemittance(rem: RemittanceMasterRecord): {
    success: boolean;
    error?: string;
    errorCode?: 'COMMIT_PENDING_RECOVERY';
    record?: RemittanceMasterRecord;
    replayed?: boolean;
  } {
    if (!rem || typeof rem !== 'object') {
      return { success: false, error: 'بيانات الحوالة غير صالحة.' };
    }
    if (typeof rem.transferNumber !== 'string' || !rem.transferNumber.trim() ||
        rem.transferNumber.trim().length > 64 ||
        !/^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/.test(rem.transferNumber.trim())) {
      return { success: false, error: 'رقم الحوالة إلزامي ويجب أن يكون من 3 إلى 64 حرفاً/رقماً أو شرطة.' };
    }

    const cleanNum = rem.transferNumber.trim().toUpperCase();
    if (rem.direction !== 'incoming') {
      return {
        success: false,
        error: 'لا يمكن تسجيل حوالة صادرة دون القيد المحاسبي المتكامل. استخدم مسار تسجيل الحوالة الصادرة المعتمد.',
      };
    }
    if (typeof rem.amount !== 'number' || !Number.isFinite(rem.amount) ||
        rem.amount <= 0 || Math.abs(rem.amount * 1000 - Math.round(rem.amount * 1000)) > 1e-8) {
      return { success: false, error: 'مبلغ الحوالة يجب أن يكون موجباً وصالحاً حتى ثلاث منازل عشرية.' };
    }
    if (typeof rem.currency !== 'string' || !SUPPORTED_CURRENCIES.includes(rem.currency as CurrencyCode)) {
      return { success: false, error: `العملة (${String(rem.currency)}) غير مدعومة.` };
    }
    if (typeof rem.senderName !== 'string' || !rem.senderName.trim() || rem.senderName.trim().length > 160 ||
        typeof rem.recipientName !== 'string' || !rem.recipientName.trim() || rem.recipientName.trim().length > 160 ||
        typeof rem.networkName !== 'string' || !rem.networkName.trim() || rem.networkName.trim().length > 100) {
      return { success: false, error: 'اسم المرسل والمستفيد والشبكة حقول إلزامية وبأطوال صالحة.' };
    }
    const senderPhone = typeof rem.senderPhone === 'string' ? rem.senderPhone.trim() : '';
    const recipientPhone = typeof rem.recipientPhone === 'string' ? rem.recipientPhone.trim() : '';
    if (senderPhone.length > 32 || recipientPhone.length > 32) {
      return { success: false, error: 'رقم هاتف المرسل أو المستفيد أطول من الحد المسموح.' };
    }

    const feeAmount = rem.feeAmount;
    if (typeof feeAmount !== 'number' || !Number.isFinite(feeAmount) || feeAmount < 0 ||
        Math.abs(feeAmount * 1000 - Math.round(feeAmount * 1000)) > 1e-8) {
      return { success: false, error: 'العمولة يجب أن تكون صفراً أو مبلغاً موجباً حتى ثلاث منازل عشرية.' };
    }
    const expectedTotal = rem.amount + feeAmount;
    if (typeof rem.totalPaid !== 'number' || !Number.isFinite(rem.totalPaid) ||
        Math.abs(rem.totalPaid - expectedTotal) > 0.001) {
      return { success: false, error: 'إجمالي المبلغ لا يساوي أصل الحوالة مضافاً إليه العمولة.' };
    }
    if (typeof rem.branchName !== 'string' || !rem.branchName.trim() ||
        typeof rem.tellerName !== 'string' || !rem.tellerName.trim()) {
      return { success: false, error: 'بيانات الفرع ومنفذ التسجيل مطلوبة.' };
    }
    const notes = typeof rem.notes === 'string' ? rem.notes.trim() : '';
    if (notes.length > 500) {
      return { success: false, error: 'ملاحظات الحوالة تتجاوز الحد المسموح.' };
    }

    const existing = this.masterRemittances.get(cleanNum);
    if (existing) {
      const sameRequest =
        existing.direction === rem.direction &&
        existing.senderName === rem.senderName.trim() &&
        existing.senderPhone === senderPhone &&
        existing.recipientName === rem.recipientName.trim() &&
        existing.recipientPhone === recipientPhone &&
        existing.networkName === rem.networkName.trim() &&
        existing.amount === rem.amount &&
        existing.currency === rem.currency &&
        existing.feeAmount === feeAmount &&
        existing.totalPaid === expectedTotal &&
        existing.branchName === rem.branchName.trim() &&
        existing.tellerName === rem.tellerName.trim() &&
        (existing.tellerRole || '') === (rem.tellerRole || '') &&
        (existing.notes || '') === notes;
      if (!sameRequest) {
        return {
          success: false,
          error: `رقم الحوالة (${cleanNum}) مسجل مسبقاً ببيانات مختلفة. لم يتم إنشاء سجل جديد.`,
        };
      }
      return { success: true, record: existing, replayed: true };
    }

    if (this.registeredNumbers.has(cleanNum)) {
      return {
        success: false,
        error: `رقم الحوالة (${cleanNum}) محجوز مسبقاً دون سجل حوالة مطابق. يلزم فحص الحجز السابق قبل التسجيل.`,
      };
    }

    if (serverAccountingEngine.isFinancialWriteBlocked()) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: 'توجد معاملة مالية غير محسومة. أوقف النظام ولا تسجل حوالة جديدة حتى مطابقة الدفاتر.',
      };
    }

    const createdAt = getYemenDateTimeString();
    const sanitizedRem: RemittanceMasterRecord = {
      id: `rem-master-${crypto.randomUUID()}`,
      transferNumber: cleanNum,
      direction: rem.direction,
      status: 'available',
      senderName: rem.senderName.trim(),
      senderPhone,
      recipientName: rem.recipientName.trim(),
      recipientPhone,
      networkName: rem.networkName.trim(),
      amount: rem.amount,
      currency: rem.currency,
      feeAmount,
      totalPaid: expectedTotal,
      branchName: rem.branchName.trim(),
      tellerName: rem.tellerName.trim(),
      tellerRole: rem.tellerRole,
      createdAt,
      notes,
      voucherNumber: `V-INC-${crypto.randomUUID().toUpperCase()}`,
    };

    const transaction = serverAccountingEngine.beginFinancialTransaction({
      operation: 'remittance_master_registration',
      referenceId: cleanNum,
      amount: sanitizedRem.amount,
      currency: sanitizedRem.currency as CurrencyCode,
    });
    if (!transaction.success || !transaction.transactionId) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: transaction.error || 'تعذر بدء معاملة تسجيل الحوالة الآمنة.',
      };
    }

    const reservation = {
      number: cleanNum,
      registeredAt: createdAt,
      registeredBy: sanitizedRem.tellerName,
      mode: rem.numberingMode || 'manual',
    };
    const auditRecord: RemittanceAuditRecord = {
      id: `audit-register-${crypto.randomUUID()}`,
      category: 'financial',
      action: sanitizedRem.direction === 'incoming' ? 'تسجيل حوالة واردة في السجل المركزي' : 'تسجيل حوالة صادرة في السجل المركزي',
      details: `تم تسجيل الحوالة ${cleanNum} بمبلغ ${sanitizedRem.amount} ${sanitizedRem.currency} للمستفيد ${sanitizedRem.recipientName}`,
      performedBy: sanitizedRem.tellerName,
      userRole: sanitizedRem.tellerRole || 'owner',
      timestamp: createdAt,
      newValue: JSON.stringify({
        transferNumber: cleanNum,
        direction: sanitizedRem.direction,
        amount: sanitizedRem.amount,
        currency: sanitizedRem.currency,
        status: 'available',
      }),
    };

    this.masterRemittances.set(cleanNum, sanitizedRem);
    this.registeredNumbers.set(cleanNum, reservation);
    this.auditLogs.unshift(auditRecord);

    try {
      this.saveMasterRemittancesToDisk();
      this.saveNumbersToDisk();
      this.saveAuditLogsToDisk();
    } catch (error: any) {
      this.masterRemittances.delete(cleanNum);
      this.registeredNumbers.delete(cleanNum);
      this.auditLogs.shift();
      serverAccountingEngine.markFinancialRecoveryRequired();
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: `فشل حفظ أحد سجلات تسجيل الحوالة. لا تعاود التسجيل؛ أوقف النظام وطابق سجل الحوالات والأرقام والتدقيق. ${error.message}`,
      };
    }

    const completed = serverAccountingEngine.completeFinancialTransaction(transaction.transactionId);
    if (!completed.success) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        record: sanitizedRem,
        error: completed.error || 'تعذر إغلاق علامة تسجيل الحوالة؛ يلزم فحص الدفاتر.',
      };
    }

    return { success: true, record: sanitizedRem, replayed: false };
  }

  public registerOutgoingRemittance(params: {
    idempotencyKey: string;
    manualTransferNumber?: string;
    senderName: string;
    senderPhone?: string;
    recipientName: string;
    recipientPhone?: string;
    networkName: string;
    amount: number;
    currency: CurrencyCode;
    feeAmount: number;
    notes?: string;
    branchName: string;
    tellerName: string;
    tellerRole: string;
  }): {
    success: boolean;
    record?: RemittanceMasterRecord;
    journalEntry?: ServerJournalEntry;
    accounts?: ServerAccount[];
    replayed?: boolean;
    error?: string;
    errorCode?: 'COMMIT_PENDING_RECOVERY';
  } {
    const currencies: CurrencyCode[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];
    if (typeof params.idempotencyKey !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.idempotencyKey)) {
      return { success: false, error: 'معرف عملية الحوالة الصادرة غير صالح.' };
    }
    if (typeof params.senderName !== 'string' || !params.senderName.trim() || params.senderName.trim().length > 160 ||
        typeof params.recipientName !== 'string' || !params.recipientName.trim() || params.recipientName.trim().length > 160 ||
        typeof params.networkName !== 'string' || !params.networkName.trim() || params.networkName.trim().length > 100 ||
        typeof params.branchName !== 'string' || !params.branchName.trim() ||
        typeof params.tellerName !== 'string' || !params.tellerName.trim() ||
        typeof params.tellerRole !== 'string' || !params.tellerRole.trim()) {
      return { success: false, error: 'بيانات المرسل والمستفيد والشبكة والفرع والمنفذ مطلوبة.' };
    }
    if (!currencies.includes(params.currency)) {
      return { success: false, error: 'عملة الحوالة الصادرة غير مدعومة.' };
    }
    const validAmount = (value: number) => typeof value === 'number' &&
      Number.isFinite(value) && value >= 0 &&
      Math.abs(value * 1000 - Math.round(value * 1000)) <= 1e-8;
    if (!validAmount(params.amount) || params.amount <= 0 || !validAmount(params.feeAmount)) {
      return { success: false, error: 'مبلغ الحوالة والعمولة يجب أن يكونا صالحين حتى ثلاث منازل عشرية، مع مبلغ حوالة موجب.' };
    }
    const totalPaid = params.amount + params.feeAmount;
    if (!Number.isFinite(totalPaid) || totalPaid <= 0) {
      return { success: false, error: 'إجمالي المبلغ المدفوع غير صالح.' };
    }
    const senderPhone = typeof params.senderPhone === 'string' ? params.senderPhone.trim() : '';
    const recipientPhone = typeof params.recipientPhone === 'string' ? params.recipientPhone.trim() : '';
    const notes = typeof params.notes === 'string' ? params.notes.trim() : '';
    if (senderPhone.length > 32 || recipientPhone.length > 32 || notes.length > 500) {
      return { success: false, error: 'أحد حقول الهاتف أو الملاحظات أطول من الحد المسموح.' };
    }

    if (serverAccountingEngine.isFinancialWriteBlocked()) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: 'توجد معاملة مالية غير محسومة. أوقف النظام ولا تسجل حوالة صادرة جديدة حتى مطابقة الدفاتر.',
      };
    }

    const expectedDescription = (transferNumber: string) =>
      `إرسال حوالة صادرة ${transferNumber} للمستلم ${params.recipientName.trim()} عبر ${params.networkName.trim()}`;

    const existingByKey = Array.from(this.masterRemittances.values()).find(
      (record) => record.idempotencyKey === params.idempotencyKey
    );
    if (existingByKey) {
      const existingJournal = serverAccountingEngine.getJournalEntries().find(
        (entry) => entry.idempotencyKey === params.idempotencyKey &&
          entry.referenceType === 'transfer_send' &&
          entry.referenceId === existingByKey.transferNumber
      );
      const sameRequest =
        existingByKey.direction === 'outgoing' &&
        existingByKey.senderName === params.senderName.trim() &&
        existingByKey.senderPhone === senderPhone &&
        existingByKey.recipientName === params.recipientName.trim() &&
        existingByKey.recipientPhone === recipientPhone &&
        existingByKey.networkName === params.networkName.trim() &&
        existingByKey.amount === params.amount &&
        existingByKey.currency === params.currency &&
        existingByKey.feeAmount === params.feeAmount &&
        existingByKey.totalPaid === totalPaid &&
        existingByKey.branchName === params.branchName.trim() &&
        existingByKey.tellerName === params.tellerName.trim() &&
        (existingByKey.tellerRole || '') === params.tellerRole &&
        (existingByKey.notes || '') === notes &&
        existingByKey.numberingMode === this.settings.numberingMode;
      const requestedManual = typeof params.manualTransferNumber === 'string'
        ? params.manualTransferNumber.trim().toUpperCase()
        : '';
      const sameManualNumber = existingByKey.numberingMode !== 'manual' ||
        requestedManual === existingByKey.transferNumber;
      const cashLine = existingJournal?.lines.find((line) =>
        line.accountId === 'acc-1102' && line.currency === params.currency &&
        Math.abs(line.debit - totalPaid) <= 0.0000001 && line.credit === 0
      );
      const payableLine = existingJournal?.lines.find((line) =>
        line.accountId === 'acc-2201' && line.currency === params.currency &&
        Math.abs(line.credit - params.amount) <= 0.0000001 && line.debit === 0
      );
      const commissionLine = params.feeAmount > 0
        ? existingJournal?.lines.find((line) =>
            line.accountId === 'acc-4101' && line.currency === params.currency &&
            Math.abs(line.credit - params.feeAmount) <= 0.0000001 && line.debit === 0
          )
        : undefined;
      if (!sameRequest || !sameManualNumber || !existingJournal || !cashLine ||
          !payableLine || (params.feeAmount > 0 && !commissionLine) ||
          existingJournal.descriptionAr !== expectedDescription(existingByKey.transferNumber)) {
        return {
          success: false,
          error: 'معرف الحوالة الصادرة مستخدم سابقاً مع بيانات مختلفة أو قيد محاسبي غير مطابق. لم تُنفذ حركة جديدة.',
        };
      }
      return {
        success: true,
        record: existingByKey,
        journalEntry: existingJournal,
        accounts: serverAccountingEngine.getAccounts(),
        replayed: true,
      };
    }

    const orphanJournal = serverAccountingEngine.getJournalEntries().find(
      (entry) => entry.idempotencyKey === params.idempotencyKey
    );
    if (orphanJournal) {
      const recovery = serverAccountingEngine.beginFinancialTransaction({
        operation: 'outgoing_remittance_orphan_recovery',
        referenceId: orphanJournal.referenceId,
        amount: totalPaid,
        currency: params.currency,
      });
      if (recovery.success) serverAccountingEngine.markFinancialRecoveryRequired();
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: 'وجد النظام قيد حوالة صادرة بنفس معرف العملية دون سجل حوالة رئيسي مطابق. تم إيقاف التسجيل ويلزم فحص الدفاتر.',
      };
    }

    const numberingMode = this.settings.numberingMode;
    let transferNumber = '';
    let nextSettings = { ...this.settings };
    let sequence: number | undefined;

    if (numberingMode === 'manual') {
      if (typeof params.manualTransferNumber !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/.test(params.manualTransferNumber.trim())) {
        return { success: false, error: 'رقم الحوالة إلزامي وصالح في وضع الترقيم اليدوي.' };
      }
      transferNumber = params.manualTransferNumber.trim().toUpperCase();
    } else {
      sequence = this.settings.nextSequence;
      if (!Number.isSafeInteger(sequence) || sequence < 1 ||
          typeof this.settings.prefix !== 'string' || !this.settings.prefix.trim()) {
        return { success: false, error: 'إعداد الترقيم التلقائي غير صالح؛ راجع إعدادات ترقيم الحوالات.' };
      }
      while (true) {
        transferNumber = `${this.settings.prefix}${String(sequence).padStart(6, '0')}`;
        const normalized = transferNumber.trim().toUpperCase();
        if (!this.registeredNumbers.has(normalized) && !this.masterRemittances.has(normalized)) break;
        sequence += 1;
        if (!Number.isSafeInteger(sequence)) {
          return { success: false, error: 'نفد نطاق الترقيم التلقائي. راجع إعدادات الترقيم.' };
        }
      }
      nextSettings = {
        ...this.settings,
        nextSequence: sequence + 1,
        updatedAt: getYemenDateTimeString(),
        updatedBy: params.tellerName.trim(),
        updatedByRole: params.tellerRole,
      };
    }

    const cleanNumber = transferNumber.trim().toUpperCase();
    if (this.registeredNumbers.has(cleanNumber) || this.masterRemittances.has(cleanNumber)) {
      return {
        success: false,
        error: `رقم الحوالة (${cleanNumber}) مسجل أو محجوز مسبقاً. لم تُنفذ أي حركة مالية.`,
      };
    }

    const started = serverAccountingEngine.beginFinancialTransaction({
      operation: 'outgoing_remittance',
      referenceId: cleanNumber,
      amount: totalPaid,
      currency: params.currency,
      actorId: params.tellerName.trim(),
    });
    if (!started.success || !started.transactionId) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: started.error || 'تعذر بدء معاملة الحوالة الصادرة الآمنة.',
      };
    }

    const accountingResult = serverAccountingEngine.executeOutgoingRemittance({
      transferNumber: cleanNumber,
      amount: params.amount,
      feeAmount: params.feeAmount,
      currency: params.currency,
      senderName: params.senderName.trim(),
      recipientName: params.recipientName.trim(),
      networkName: params.networkName.trim(),
      notes,
      tellerId: params.tellerName.trim(),
      tellerName: params.tellerName.trim(),
      branchId: params.branchName.trim(),
      idempotencyKey: params.idempotencyKey,
    });

    if (!accountingResult.success) {
      if (accountingResult.errorCode === 'COMMIT_PENDING_RECOVERY') {
        return {
          success: false,
          errorCode: 'COMMIT_PENDING_RECOVERY',
          error: accountingResult.error || 'فشل حفظ دفتر الحوالة الصادرة؛ لا تعاود الطلب.',
        };
      }
      const cancelled = serverAccountingEngine.cancelFinancialTransaction(started.transactionId);
      if (!cancelled.success) {
        serverAccountingEngine.markFinancialRecoveryRequired();
        return {
          success: false,
          errorCode: 'COMMIT_PENDING_RECOVERY',
          error: cancelled.error || 'تعذر إلغاء علامة معاملة الحوالة الصادرة.',
        };
      }
      return {
        success: false,
        error: accountingResult.error || 'رفض محرك الحسابات الحوالة الصادرة.',
      };
    }

    const createdAt = getYemenDateTimeString();
    const record: RemittanceMasterRecord = {
      id: `rem-out-${crypto.randomUUID()}`,
      idempotencyKey: params.idempotencyKey,
      transferNumber: cleanNumber,
      direction: 'outgoing',
      status: 'approved',
      senderName: params.senderName.trim(),
      senderPhone,
      recipientName: params.recipientName.trim(),
      recipientPhone,
      networkName: params.networkName.trim(),
      amount: params.amount,
      currency: params.currency,
      feeAmount: params.feeAmount,
      totalPaid,
      branchName: params.branchName.trim(),
      tellerName: params.tellerName.trim(),
      tellerRole: params.tellerRole,
      createdAt,
      notes,
      voucherNumber: accountingResult.journalEntry!.voucherNumber,
      journalEntryReference: accountingResult.journalEntry!.entryNumber,
      cashMovementReference: accountingResult.journalEntry!.voucherNumber,
      numberingMode,
    };

    const reservation = {
      number: cleanNumber,
      registeredAt: createdAt,
      registeredBy: params.tellerName.trim(),
      mode: numberingMode,
    };
    const auditEntry: RemittanceAuditRecord = {
      id: `audit-outgoing-${crypto.randomUUID()}`,
      category: 'financial',
      action: 'تسجيل حوالة صادرة وقيد التزام الشبكة والعمولة',
      details: `تم تسجيل الحوالة الصادرة ${cleanNumber} بمبلغ ${params.amount} ${params.currency} وعمولة ${params.feeAmount}، إجمالي مستلم ${totalPaid}، عبر ${params.networkName.trim()}`,
      performedBy: params.tellerName.trim(),
      userRole: params.tellerRole,
      timestamp: createdAt,
      newValue: JSON.stringify({
        transferNumber: cleanNumber,
        amount: params.amount,
        feeAmount: params.feeAmount,
        currency: params.currency,
        totalPaid,
        journalEntryReference: record.journalEntryReference,
      }),
    };

    this.masterRemittances.set(cleanNumber, record);
    this.registeredNumbers.set(cleanNumber, reservation);
    this.auditLogs.unshift(auditEntry);
    const previousSettings = this.settings;
    this.settings = nextSettings;

    try {
      this.saveMasterRemittancesToDisk();
      this.saveNumbersToDisk();
      this.saveAuditLogsToDisk();
      if (numberingMode === 'automatic') this.saveSettingsToDisk();
    } catch (error: any) {
      this.masterRemittances.delete(cleanNumber);
      this.registeredNumbers.delete(cleanNumber);
      this.auditLogs.shift();
      this.settings = previousSettings;
      serverAccountingEngine.markFinancialRecoveryRequired();
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        error: `فشل حفظ سجل الحوالة الصادرة أو حجز رقمها أو التدقيق. لا تعاود العملية؛ أوقف النظام وطابق دفتر الأستاذ وسجل الحوالات. ${error.message}`,
      };
    }

    const completed = serverAccountingEngine.completeFinancialTransaction(started.transactionId);
    if (!completed.success) {
      return {
        success: false,
        errorCode: 'COMMIT_PENDING_RECOVERY',
        record,
        journalEntry: accountingResult.journalEntry,
        error: completed.error || 'تعذر إغلاق علامة معاملة الحوالة الصادرة.',
      };
    }

    return {
      success: true,
      record,
      journalEntry: accountingResult.journalEntry,
      accounts: accountingResult.accounts,
      replayed: false,
    };
  }

  public getMasterRemittance(transferNumber: string): RemittanceMasterRecord | undefined {
    if (!transferNumber) return undefined;
    return this.masterRemittances.get(transferNumber.trim().toUpperCase());
  }

  public getAllMasterRemittances(): RemittanceMasterRecord[] {
    return Array.from(this.masterRemittances.values());
  }

  // =========================================================================
  // Settings & Numbering Policy
  // =========================================================================

  public getSettings(): RemittanceSettingsRecord {
    return { ...this.settings };
  }

  public updateSettings(
    newSettings: Partial<RemittanceSettingsRecord>,
    userRole: string,
    userName: string
  ): { success: boolean; settings?: RemittanceSettingsRecord; error?: string } {
    if (userRole !== 'owner' && userRole !== 'general_manager') {
      return {
        success: false,
        error: 'صلاحية غير كافية: تعديل إعدادات وسياسة ترقيم الحوالات مقتصر حصرياً على المالك والمدير العام.',
      };
    }

    const previousValue = `mode: ${this.settings.numberingMode}, prefix: ${this.settings.prefix}, next: ${this.settings.nextSequence}`;

    if (newSettings.numberingMode) this.settings.numberingMode = newSettings.numberingMode;
    if (newSettings.prefix) this.settings.prefix = newSettings.prefix.trim().toUpperCase();
    if (typeof newSettings.nextSequence === 'number' && newSettings.nextSequence > 0) {
      this.settings.nextSequence = Math.floor(newSettings.nextSequence);
    }

    this.settings.updatedAt = getYemenDateTimeString();
    this.settings.updatedBy = userName;
    this.settings.updatedByRole = userRole;

    this.saveSettingsToDisk();

    const auditEntry: RemittanceAuditRecord = {
      id: `audit-${Date.now()}`,
      category: 'remittance_numbering',
      action: 'تحديث سياسة ترقيم الحوالات',
      details: `تم تعديل سياسة ترقيم الحوالات بواسطة [${userRole}] ${userName}`,
      performedBy: userName,
      userRole,
      timestamp: this.settings.updatedAt,
      oldValue: previousValue,
      newValue: `mode: ${this.settings.numberingMode}, prefix: ${this.settings.prefix}, next: ${this.settings.nextSequence}`,
    };

    this.auditLogs.unshift(auditEntry);
    this.saveAuditLogsToDisk();

    return { success: true, settings: { ...this.settings } };
  }

  public validateTransferNumber(transferNumber: string): { isUnique: boolean; message: string } {
    if (!transferNumber || typeof transferNumber !== 'string') {
      return { isUnique: false, message: 'رقم الحوالة غير محدد' };
    }

    const clean = transferNumber.trim().toUpperCase();
    if (this.registeredNumbers.has(clean) || this.masterRemittances.has(clean)) {
      return {
        isUnique: false,
        message: `رقم الحوالة [${clean}] مسجل مسبقاً في النظام المركزي وغير متاح للاستخدام.`,
      };
    }

    return {
      isUnique: true,
      message: `رقم الحوالة [${clean}] فريد ومتاح للاستخدام والتسجيل.`,
    };
  }

  /**
   * M7: حجز رقم حوالة مع التحقق الصارم من عدم غياب الرقم
   */
  public registerTransferNumber(
    transferNumber: string,
    operatorName = 'النظام',
    mode = 'manual'
  ): { success: boolean; error?: string } {
    if (!transferNumber || typeof transferNumber !== 'string' || !transferNumber.trim()) {
      return { success: false, error: 'رقم الحوالة مطلوب وغير صالح للحجز.' };
    }

    const cleanNum = transferNumber.trim().toUpperCase();
    if (this.registeredNumbers.has(cleanNum) || this.masterRemittances.has(cleanNum)) {
      return {
        success: false,
        error: `الرقم ${cleanNum} مسجل مسبقاً في السجل المركزي ولا يمكن حجزه مرة أخرى.`,
      };
    }

    this.registeredNumbers.set(cleanNum, {
      number: cleanNum,
      registeredAt: getYemenDateTimeString(),
      registeredBy: operatorName,
      mode,
    });

    this.saveNumbersToDisk();
    return { success: true };
  }

  public getNextAtomicSequence(operatorName: string): { transferNumber: string; sequence: number } {
    let candidate = '';
    let seq = this.settings.nextSequence;

    while (true) {
      candidate = `${this.settings.prefix}${String(seq).padStart(6, '0')}`;
      if (!this.registeredNumbers.has(candidate.toUpperCase()) && !this.masterRemittances.has(candidate.toUpperCase())) {
        break;
      }
      seq += 1;
    }

    this.registeredNumbers.set(candidate.toUpperCase(), {
      number: candidate,
      registeredAt: getYemenDateTimeString(),
      registeredBy: operatorName,
      mode: 'automatic',
    });

    this.settings.nextSequence = seq + 1;
    this.saveSettingsToDisk();
    this.saveNumbersToDisk();

    return { transferNumber: candidate, sequence: seq };
  }

  public isRemittancePaid(transferNumber: string): boolean {
    if (!transferNumber) return false;
    const cleanNum = transferNumber.trim().toUpperCase();
    const payoutRecord = this.payouts.get(cleanNum);
    const masterRecord = this.masterRemittances.get(cleanNum);
    return Boolean(payoutRecord || masterRecord?.status === 'paid');
  }

  public getPayoutRecord(transferNumber: string): RemittancePayoutRecord | undefined {
    if (!transferNumber) return undefined;
    return this.payouts.get(transferNumber.trim().toUpperCase());
  }

  // =========================================================================
  // رابعاً: صرف الحوالات مع القيد الخادمي الذري والمطابقة المزدوجة
  // =========================================================================

  /**
   * C3, H1, H2: تنفيذ عملية الصرف الموحدة المعتمدة على الخادم
   */
  public payoutRemittance(params: {
    idempotencyKey?: string;
    transferId: string;
    transferNumber: string;
    recipientIdType: string;
    recipientIdNumber: string;
    tellerId: string;
    tellerName: string;
    tellerRole: string;
    tellerBranch?: string;
    amount?: number;
    currency?: string;
    clientAmount?: number;
    clientCurrency?: string;
    cashierDrawerBalance?: number;
    journalEntryReference?: string;
    managerOverride?: boolean;
    managerOverrideReason?: string;
  }): {
    success: boolean;
    record?: RemittancePayoutRecord;
    masterRemittance?: RemittanceMasterRecord;
    journalEntry?: ServerJournalEntry;
    error?: string;
    errorCode?: 'COMMIT_PENDING_RECOVERY';
    isDuplicate?: boolean;
  } {
    if (!params.transferNumber || typeof params.transferNumber !== 'string') {
      return { success: false, error: 'رقم الحوالة غير محدد.' };
    }

    const cleanNum = params.transferNumber.trim().toUpperCase();

    // H2: فحص مفتاح عدم التكرار والتحقق من عدم استخدامه لحوالة أخرى
    if (params.idempotencyKey) {
      const boundTransfer = this.idempotencyToTransferMap.get(params.idempotencyKey);
      if (boundTransfer && boundTransfer !== cleanNum) {
        return {
          success: false,
          error: `رفض النظام: مفتاح عدم التكرار (Idempotency Key) مستخدم مسبقاً لحوالة أخرى (${boundTransfer}). يمنع إعادة استخدام نفس المفتاح لحوالات مختلفة.`,
        };
      }

      const compositeKey = `${cleanNum}:${params.tellerId}:${params.idempotencyKey}`;
      if (this.idempotencyStore.has(compositeKey)) {
        const existing = this.idempotencyStore.get(compositeKey)!;
        const existingMaster = this.masterRemittances.get(cleanNum);
        const existingJournal = serverAccountingEngine.getJournalEntries().find(
          (entry) => entry.entryNumber === existing.journalEntryReference
        );

        // Do not report a replay as successful when its master record or accounting evidence is missing.
        if (!existingMaster || !existingJournal) {
          return {
            success: false,
            isDuplicate: true,
            record: existing,
            error: 'توقف آمن: سجل الصرف السابق موجود لكن مستند الحوالة أو قيد اليومية المرتبط به غير موجود. لا تعاود الصرف؛ يلزم إجراء مطابقة محاسبية.',
          };
        }

        return {
          success: true,
          record: existing,
          masterRemittance: existingMaster,
          journalEntry: existingJournal,
        };
      }
    }

    // قفل التزامن لمنع الصرف المتزامن
    if (this.inFlightPayouts.has(cleanNum)) {
      return {
        success: false,
        error: `رفض النظام: عملية صرف الحوالة (${cleanNum}) قيد المعالجة حالياً في طلب متزامن آخر. يمنع التكرار.`,
      };
    }

    // التحقق من الصرف المسبق
    if (this.payouts.has(cleanNum)) {
      const existing = this.payouts.get(cleanNum)!;
      return {
        success: false,
        isDuplicate: true,
        record: existing,
        error: `رفض النظام: الحوالة رقم ${cleanNum} تم صرفها مسبقاً بتاريخ ${existing.paidAt} بواسطة ${existing.tellerName}. يمنع صرف الحوالة مرتين منعاً باتاً.`,
      };
    }

    // التحقق من الصلاحيات
    const allowedRoles = ['teller', 'branch_manager', 'general_manager', 'owner'];
    if (!allowedRoles.includes(params.tellerRole)) {
      return {
        success: false,
        error: `صلاحية غير كافية: دور [${params.tellerRole}] غير مخول بتنفيذ عمليات صرف الحوالات وتسليم النقدية.`,
      };
    }

    // AML / KYC
    if (!params.recipientIdNumber || !params.recipientIdNumber.trim()) {
      return {
        success: false,
        error: 'رقم إثبات هوية المستفيد حقل إلزامي لصرف الحوالة وفقاً لمعايير الامتثال ومكافحة غسل الأموال (AML/KYC).',
      };
    }

    this.inFlightPayouts.add(cleanNum);

    try {
      let masterRem = this.masterRemittances.get(cleanNum);
      if (!masterRem) {
        return {
          success: false,
          error: `رفض النظام: الحوالة رقم ${cleanNum} غير مسجلة في السجل المالي المركزي المعتمد للمؤسسة.`,
        };
      }

      if (masterRem.direction !== 'incoming') {
        return {
          success: false,
          error: `رفض النظام: الحوالة رقم ${cleanNum} صادرة وليست واردة، ولا يمكن صرفها من مكتب تسليم الحوالات الواردة.`,
        };
      }

      if (masterRem.status === 'paid') {
        return {
          success: false,
          isDuplicate: true,
          error: `رفض النظام: الحوالة رقم ${cleanNum} حالتها في السجل المعتمد [مصروفة مسبقاً].`,
        };
      }

      if (masterRem.status !== 'available' && masterRem.status !== 'approved') {
        return {
          success: false,
          error: `رفض النظام: الحوالة بحالة [${masterRem.status}] وليست متاحة للصرف والتسليم.`,
        };
      }

      // مطابقة المبالغ والعملات لمنع تلاعب العميل
      if (typeof params.clientAmount === 'number' && params.clientAmount > 0) {
        if (Math.abs(params.clientAmount - masterRem.amount) > 0.001) {
          return {
            success: false,
            error: `رفض النظام: عدم تطابق مبلغ الحوالة! مبلغ الصرف المرسل (${params.clientAmount}) لا يطابق أصل الحوالة المسجل في النظام (${masterRem.amount} ${masterRem.currency}).`,
          };
        }
      }

      if (params.clientCurrency && params.clientCurrency !== masterRem.currency) {
        return {
          success: false,
          error: `رفض النظام: عملة الصرف المرسلة (${params.clientCurrency}) لا تطابق عملة الحوالة المسجلة (${masterRem.currency}).`,
        };
      }

      // H1: التحقق من اعتماد المدير لتجاوز السيولة (فقط المالك والمدير العام يمكنهم اعتماد التجاوز)
      const isManagerOverrideAllowed = Boolean(
        params.managerOverride && (params.tellerRole === 'owner' || params.tellerRole === 'general_manager')
      );

      // Mark the entire multi-file payout transaction before touching the ledger.
      const transaction = serverAccountingEngine.beginFinancialTransaction({
        operation: 'remittance_payout',
        referenceId: cleanNum,
        amount: masterRem.amount,
        currency: masterRem.currency,
        actorId: params.tellerId,
      });
      if (!transaction.success || !transaction.transactionId) {
        return {
          success: false,
          errorCode: 'COMMIT_PENDING_RECOVERY',
          error: transaction.error || 'تعذر بدء معاملة الصرف الآمنة.',
        };
      }

      // C3: تنفيذ القيد المحاسبي المزدوج وخصم الصندوق الفعلي على الخادم
      const accountingRes = serverAccountingEngine.executeRemittancePayout({
        transferNumber: cleanNum,
        amount: masterRem.amount,
        currency: masterRem.currency as CurrencyCode,
        recipientName: masterRem.recipientName,
        recipientIdNumber: params.recipientIdNumber.trim(),
        networkName: masterRem.networkName,
        tellerId: params.tellerId,
        tellerName: params.tellerName,
        tellerRole: params.tellerRole,
        branchId: params.tellerBranch,
        managerOverrideApproved: isManagerOverrideAllowed,
        managerOverrideBy: isManagerOverrideAllowed ? params.tellerName : undefined,
      });

      if (!accountingRes.success) {
        if (accountingRes.errorCode === 'COMMIT_PENDING_RECOVERY') {
          return {
            success: false,
            errorCode: 'COMMIT_PENDING_RECOVERY',
            error: accountingRes.error || 'فشل حفظ الدفتر المالي؛ لا تعاود الصرف.',
          };
        }

        const cancelled = serverAccountingEngine.cancelFinancialTransaction(transaction.transactionId);
        if (!cancelled.success) {
          serverAccountingEngine.markFinancialRecoveryRequired();
          return {
            success: false,
            errorCode: 'COMMIT_PENDING_RECOVERY',
            error: cancelled.error || 'تعذر إلغاء علامة المعاملة بعد رفض العملية؛ يلزم فحص يدوي.',
          };
        }

        return {
          success: false,
          error: accountingRes.error || 'فشلت معالجة القيد المحاسبي وصندوق الكاشير على الخادم.',
        };
      }

      const yemenPaidAt = getYemenDateTimeString();
      // إصدار رقم سند صرف من الخادم فقط؛ UUID يمنع تصادم الأرقام عند العمليات المتزامنة أو السريعة.
      const voucherNum = `V-PAY-${new Date().getFullYear()}-${crypto.randomUUID().toUpperCase()}`;
      const entryNum = accountingRes.journalEntry!.entryNumber;

      const payoutRecord: RemittancePayoutRecord = {
        idempotencyKey: params.idempotencyKey,
        transferId: masterRem.id,
        transferNumber: cleanNum,
        recipientIdType: params.recipientIdType,
        recipientIdNumber: params.recipientIdNumber.trim(),
        tellerId: params.tellerId,
        tellerName: params.tellerName,
        tellerRole: params.tellerRole,
        amount: masterRem.amount,
        currency: masterRem.currency,
        paidAt: yemenPaidAt,
        voucherNumber: voucherNum,
        journalEntryReference: entryNum,
        cashMovementReference: voucherNum,
        managerOverride: isManagerOverrideAllowed,
        managerOverrideBy: isManagerOverrideAllowed ? params.tellerName : undefined,
        managerOverrideReason: params.managerOverrideReason,
      };

      this.payouts.set(cleanNum, payoutRecord);
      if (params.idempotencyKey) {
        const compositeKey = `${cleanNum}:${params.tellerId}:${params.idempotencyKey}`;
        this.idempotencyStore.set(compositeKey, payoutRecord);
        this.idempotencyToTransferMap.set(params.idempotencyKey, cleanNum);
      }

      // تحديث حالة الحوالة في السجل الرئيسي
      masterRem.status = 'paid';
      masterRem.paidAt = yemenPaidAt;
      masterRem.recipientIdType = params.recipientIdType;
      masterRem.recipientIdNumber = params.recipientIdNumber.trim();
      masterRem.voucherNumber = voucherNum;
      masterRem.journalEntryReference = entryNum;
      masterRem.cashMovementReference = voucherNum;
      masterRem.payoutRecordId = voucherNum;
      this.masterRemittances.set(cleanNum, masterRem);

      const auditEntry: RemittanceAuditRecord = {
        id: `audit-pay-${crypto.randomUUID()}`,
        category: 'financial',
        action: 'صرف حوالة وتسليم نقدية للمستفيد (معتمد ذرياً بقيد خادمي)',
        details: `تم صرف الحوالة ${cleanNum} بمبلغ ${masterRem.amount} ${masterRem.currency} للمستفيد (${masterRem.recipientName} - إثبات هوية: ${params.recipientIdType} ${params.recipientIdNumber}) بواسطة ${params.tellerName}. سند: ${voucherNum}، قيد: ${entryNum}`,
        performedBy: params.tellerName,
        userRole: params.tellerRole,
        timestamp: yemenPaidAt,
        oldValue: 'status: available',
        newValue: `status: paid (Voucher: ${voucherNum}, JV: ${entryNum})`,
      };

      this.auditLogs.unshift(auditEntry);

      // Persist all payout-side records while the pending transaction marker remains on disk.
      try {
        this.savePayoutsToDisk();
        this.saveMasterRemittancesToDisk();
        this.saveAuditLogsToDisk();
      } catch (saveError: any) {
        serverAccountingEngine.markFinancialRecoveryRequired();
        return {
          success: false,
          errorCode: 'COMMIT_PENDING_RECOVERY',
          error: `فشل حفظ أحد سجلات الصرف بعد تحديث دفتر الأستاذ. لا تعاود الصرف؛ أوقف النظام وطابق الحسابات والقيود والحوالة وسجل الصرف. ${saveError.message}`,
          record: payoutRecord,
          masterRemittance: masterRem,
          journalEntry: accountingRes.journalEntry,
        };
      }

      const committed = serverAccountingEngine.completeFinancialTransaction(transaction.transactionId);
      if (!committed.success) {
        return {
          success: false,
          errorCode: 'COMMIT_PENDING_RECOVERY',
          error: committed.error || 'تعذر اعتماد اكتمال المعاملة المالية؛ لا تعاود الصرف.',
          record: payoutRecord,
          masterRemittance: masterRem,
          journalEntry: accountingRes.journalEntry,
        };
      }

      return {
        success: true,
        record: payoutRecord,
        masterRemittance: masterRem,
        journalEntry: accountingRes.journalEntry,
      };
    } finally {
      this.inFlightPayouts.delete(cleanNum);
    }
  }

  // =========================================================================
  // سادساً: آلية المطابقة المحاسبية الحقيقية (Reconciliation Engine)
  // =========================================================================

  /**
   * C2 & C3: مطابقة شاملة تفحص كل حوالة مصروفة مقابل القيد الحقيقي في journal_entries.json
   */
  public reconcilePayouts(): ReconciliationResult {
    const paidRemittances = Array.from(this.masterRemittances.values()).filter((r) => r.status === 'paid');
    const discrepancies: ReconciliationResult['discrepancies'] = [];
    const serverJournalEntries = serverAccountingEngine.getJournalEntries();
    let matchedCount = 0;

    for (const rem of paidRemittances) {
      const cleanNum = rem.transferNumber.trim().toUpperCase();
      const payoutRecord = this.payouts.get(cleanNum);

      if (!payoutRecord) {
        discrepancies.push({
          transferNumber: cleanNum,
          issue: 'MISSING_PAYOUT_RECORD',
          details: `الحوالة ${cleanNum} حالتها مدفوعة ولكن سجل الصرف غير موجود في payouts registry.`,
        });
        continue;
      }

      // فحص وجود القيد المحاسبي الفعلي في دفتر اليومية الخادمي
      const matchingJv = serverJournalEntries.find(
        (jv) => jv.referenceId === cleanNum || jv.entryNumber === payoutRecord.journalEntryReference
      );

      if (!matchingJv) {
        discrepancies.push({
          transferNumber: cleanNum,
          issue: 'MISSING_SERVER_JOURNAL_ENTRY',
          details: `الحوالة ${cleanNum} مصروفة ولكن قيدها المحاسبي (${payoutRecord.journalEntryReference}) غير موجود في دفتر القيود الخادمي journal_entries.json.`,
        });
        continue;
      }

      if (payoutRecord.amount !== rem.amount || payoutRecord.currency !== rem.currency) {
        discrepancies.push({
          transferNumber: cleanNum,
          issue: 'AMOUNT_MISMATCH',
          details: `اختلاف بين مبلغ سجل الصرف (${payoutRecord.amount} ${payoutRecord.currency}) ومبلغ الحوالة الأصلي (${rem.amount} ${rem.currency}).`,
        });
        continue;
      }

      matchedCount += 1;
    }

    const result: ReconciliationResult = {
      timestamp: getYemenDateTimeString(),
      totalMasterRemittances: this.masterRemittances.size,
      totalPaidRemittances: paidRemittances.length,
      totalPayoutRecords: this.payouts.size,
      matchedCount,
      discrepanciesCount: discrepancies.length,
      status: discrepancies.length === 0 ? 'BALANCED' : 'DISCREPANCIES_FOUND',
      discrepancies,
    };

    return result;
  }

  public getAuditLogs(): RemittanceAuditRecord[] {
    return [...this.auditLogs];
  }
}

export const remittanceRegistry = new RemittanceRegistry();
