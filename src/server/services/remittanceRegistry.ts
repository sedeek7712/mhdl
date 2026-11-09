/**
 * سجل إدارة وترقيم وصرف الحوالات المالية المركزي - نظام عمرو النماري للصرافة
 * Central Enterprise Remittance Master Registry & Financial Integrity Engine
 * معالجة نتائج التدقيق: C2, C3, H1, H2, H4, M1, M2, M7, L1
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { safeAtomicWriteJson, safeReadJson, getYemenDateTimeString } from '../utils/atomicFileStorage.js';
import { serverAccountingEngine, ServerJournalEntry, CurrencyCode } from './serverAccountingEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../../data');
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

class RemittanceRegistry {
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
  public registerMasterRemittance(rem: RemittanceMasterRecord): { success: boolean; error?: string; record?: RemittanceMasterRecord } {
    if (!rem.transferNumber || typeof rem.transferNumber !== 'string' || !rem.transferNumber.trim()) {
      return { success: false, error: 'رقم الحوالة إلزامي لتسجيل الحوالة في النظام المركزي.' };
    }

    const cleanNum = rem.transferNumber.trim().toUpperCase();
    if (this.masterRemittances.has(cleanNum)) {
      return {
        success: false,
        error: `رفض النظام: الحوالة رقم ${cleanNum} مسجلة مسبقاً في السجل المركزي (Unique Constraint).`,
      };
    }

    // M1: التحقق من إيجابية المبلغ وعدم تمرير مبالغ سالبة أو صفرية
    if (typeof rem.amount !== 'number' || rem.amount <= 0 || !Number.isFinite(rem.amount)) {
      return { success: false, error: 'مبلغ الحوالة يجب أن يكون رقماً موجباً أكبر من الصفر.' };
    }

    // M1: التحقق من صحة العملة
    if (!SUPPORTED_CURRENCIES.includes(rem.currency as CurrencyCode)) {
      return { success: false, error: `العملة (${rem.currency}) غير مدعومة في نظام الصرافة.` };
    }

    // M2: التحقق من اسم المستفيد
    if (!rem.recipientName || typeof rem.recipientName !== 'string' || !rem.recipientName.trim()) {
      return { success: false, error: 'اسم المستفيد إلزامي لتسجيل الحوالة.' };
    }

    const sanitizedRem: RemittanceMasterRecord = {
      ...rem,
      transferNumber: cleanNum,
      amount: rem.amount,
      currency: rem.currency,
      status: 'available', // C2: إجبار الحالة على available من الخادم ومنع التلاعب
      direction: rem.direction === 'outgoing' ? 'outgoing' : 'incoming',
      createdAt: rem.createdAt || getYemenDateTimeString(),
    };

    this.masterRemittances.set(cleanNum, sanitizedRem);
    this.saveMasterRemittancesToDisk();

    if (!this.registeredNumbers.has(cleanNum)) {
      this.registeredNumbers.set(cleanNum, {
        number: cleanNum,
        registeredAt: sanitizedRem.createdAt,
        registeredBy: sanitizedRem.tellerName || 'النظام',
        mode: sanitizedRem.numberingMode || 'automatic',
      });
      this.saveNumbersToDisk();
    }

    return { success: true, record: sanitizedRem };
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
    voucherNumber?: string;
    journalEntryReference?: string;
    managerOverride?: boolean;
    managerOverrideReason?: string;
  }): {
    success: boolean;
    record?: RemittancePayoutRecord;
    masterRemittance?: RemittanceMasterRecord;
    journalEntry?: ServerJournalEntry;
    error?: string;
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
        return {
          success: true,
          record: existing,
          masterRemittance: this.masterRemittances.get(cleanNum),
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
        return {
          success: false,
          error: accountingRes.error || 'فشلت معالجة القيد المحاسبي وصندوق الكاشير على الخادم.',
        };
      }

      const yemenPaidAt = getYemenDateTimeString();
      const voucherNum = params.voucherNumber || `V-PAY-${Date.now().toString().slice(-4)}`;
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
        id: `audit-pay-${Date.now()}`,
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

      // حفظ التغييرات ذرياً
      this.savePayoutsToDisk();
      this.saveMasterRemittancesToDisk();
      this.saveAuditLogsToDisk();

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
