/**
 * سجل إدارة وترقيم وصرف الحوالات المالية المركزي - نظام عمرو النماري للصرافة
 * Central Enterprise Remittance Master Registry & Financial Integrity Engine
 * معالجة وتطبيق ضوابط البنود: 4 (إصلاح صرف الحوالات) و5 (توحيد الصرف) و6 (المحاسبة والأرصدة)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
  journalEntryReference?: string;
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

class RemittanceRegistry {
  private settings: RemittanceSettingsRecord;
  private registeredNumbers: Map<string, { number: string; registeredAt: string; registeredBy: string; mode: string }> = new Map();
  private auditLogs: RemittanceAuditRecord[] = [];
  private payouts: Map<string, RemittancePayoutRecord> = new Map();
  private idempotencyStore: Map<string, RemittancePayoutRecord> = new Map();
  private masterRemittances: Map<string, RemittanceMasterRecord> = new Map();
  private inFlightPayouts: Set<string> = new Set(); // Mutex / Lock for concurrent requests

  constructor() {
    this.settings = {
      numberingMode: 'automatic',
      prefix: 'TR-',
      nextSequence: 931107,
      updatedAt: '2026-11-06 09:00',
      updatedBy: 'عمرو النماري',
      updatedByRole: 'owner',
      notes: 'التهيئة الافتراضية: الترقيم التلقائي المركزي المتسلسل لمنع التكرار وضمان سلامة الدورة المستندية.',
    };

    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        this.settings = JSON.parse(raw);
      } else {
        this.saveSettingsToDisk();
      }

      if (fs.existsSync(NUMBERS_REGISTRY_FILE)) {
        const raw = fs.readFileSync(NUMBERS_REGISTRY_FILE, 'utf-8');
        const list: { number: string; registeredAt: string; registeredBy: string; mode: string }[] = JSON.parse(raw);
        for (const item of list) {
          this.registeredNumbers.set(item.number.trim().toUpperCase(), item);
        }
      }

      if (fs.existsSync(PAYOUTS_REGISTRY_FILE)) {
        const raw = fs.readFileSync(PAYOUTS_REGISTRY_FILE, 'utf-8');
        const list: RemittancePayoutRecord[] = JSON.parse(raw);
        for (const item of list) {
          const cleanNum = item.transferNumber.trim().toUpperCase();
          this.payouts.set(cleanNum, item);
          if (item.idempotencyKey) {
            this.idempotencyStore.set(item.idempotencyKey, item);
          }
        }
      }

      if (fs.existsSync(AUDIT_LOGS_FILE)) {
        const raw = fs.readFileSync(AUDIT_LOGS_FILE, 'utf-8');
        this.auditLogs = JSON.parse(raw);
      } else {
        this.auditLogs = [
          {
            id: 'audit-init-01',
            category: 'remittance_numbering',
            action: 'تهيئة سياسة ترقيم الحوالات',
            details: 'اعتماد سياسة الترقيم التلقائي المركزي (TR-) كسياسة رسمية معتمدة لمنع تكرار الأرقام بين الفروع',
            performedBy: 'عمرو النماري',
            userRole: 'owner',
            timestamp: '2026-11-06 09:00',
            oldValue: 'غير محدد',
            newValue: 'automatic (TR-)',
          },
        ];
        this.saveAuditLogsToDisk();
      }

      // Load master remittances
      if (fs.existsSync(MASTER_REMITTANCES_FILE)) {
        const raw = fs.readFileSync(MASTER_REMITTANCES_FILE, 'utf-8');
        const list: RemittanceMasterRecord[] = JSON.parse(raw);
        for (const item of list) {
          this.masterRemittances.set(item.transferNumber.trim().toUpperCase(), item);
        }
      } else {
        // Initial authoritative sample incoming remittance for production payout desk
        const initialIncoming: RemittanceMasterRecord = {
          id: 'rem-incoming-931106',
          transferNumber: 'TR-931106',
          direction: 'incoming',
          status: 'available',
          senderName: 'ياسين عبد الرقيب الشميري',
          senderPhone: '771280940',
          recipientName: 'صديق علي الفتاحي',
          recipientPhone: '779077071',
          networkName: 'شبكة النجم للحوالات',
          amount: 5000,
          currency: 'SAR',
          feeAmount: 0,
          totalPaid: 5000,
          branchName: 'المركز الرئيسي - تعز',
          tellerName: 'النظام المركزي',
          createdAt: '2026-11-06 10:00',
          numberingMode: 'automatic',
          notes: 'حوالة واردة معتمدة وجاهزة للصرف من شبكة النجم',
        };
        this.masterRemittances.set(initialIncoming.transferNumber.toUpperCase(), initialIncoming);
        this.saveMasterRemittancesToDisk();
      }
    } catch (err) {
      console.warn('[RemittanceRegistry] Error loading state from disk, using fallback defaults:', err);
    }
  }

  private saveSettingsToDisk() {
    try {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[RemittanceRegistry] Failed to save settings to disk:', err);
    }
  }

  private saveNumbersToDisk() {
    try {
      const list = Array.from(this.registeredNumbers.values());
      fs.writeFileSync(NUMBERS_REGISTRY_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('[RemittanceRegistry] Failed to save numbers to disk:', err);
    }
  }

  private saveAuditLogsToDisk() {
    try {
      fs.writeFileSync(AUDIT_LOGS_FILE, JSON.stringify(this.auditLogs, null, 2), 'utf-8');
    } catch (err) {
      console.error('[RemittanceRegistry] Failed to save audit logs to disk:', err);
    }
  }

  private savePayoutsToDisk() {
    try {
      const list = Array.from(this.payouts.values());
      fs.writeFileSync(PAYOUTS_REGISTRY_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('[RemittanceRegistry] Failed to save payouts to disk:', err);
    }
  }

  private saveMasterRemittancesToDisk() {
    try {
      const list = Array.from(this.masterRemittances.values());
      fs.writeFileSync(MASTER_REMITTANCES_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('[RemittanceRegistry] Failed to save master remittances to disk:', err);
    }
  }

  // =========================================================================
  // Master Remittance Authority (قواعد المصدر المعتمد على الخادم)
  // =========================================================================

  /**
   * تسجيل حوالة في السجل المركزي المعتمد على الخادم
   */
  public registerMasterRemittance(rem: RemittanceMasterRecord): { success: boolean; error?: string } {
    const cleanNum = rem.transferNumber.trim().toUpperCase();
    if (this.masterRemittances.has(cleanNum)) {
      return {
        success: false,
        error: `رفض النظام: الحوالة رقم ${cleanNum} مسجلة مسبقاً في السجل المركزي (Unique Constraint).`,
      };
    }

    this.masterRemittances.set(cleanNum, rem);
    this.saveMasterRemittancesToDisk();

    // Register number in unique numbers registry
    if (!this.registeredNumbers.has(cleanNum)) {
      this.registeredNumbers.set(cleanNum, {
        number: cleanNum,
        registeredAt: rem.createdAt || new Date().toISOString(),
        registeredBy: rem.tellerName || 'النظام',
        mode: rem.numberingMode || 'automatic',
      });
      this.saveNumbersToDisk();
    }

    return { success: true };
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
        error: `صلاحية مرفوضة: تعديل سياسة ترقيم الحوالات مقتصر على المالك والمدير العام فقط. دورك الحالي: [${userRole}]`,
      };
    }

    const oldMode = this.settings.numberingMode;
    const oldPrefix = this.settings.prefix;
    const oldSeq = this.settings.nextSequence;

    if (newSettings.numberingMode) this.settings.numberingMode = newSettings.numberingMode;
    if (newSettings.prefix) this.settings.prefix = newSettings.prefix.trim().toUpperCase();
    if (typeof newSettings.nextSequence === 'number' && newSettings.nextSequence > 0) {
      this.settings.nextSequence = Math.floor(newSettings.nextSequence);
    }

    this.settings.updatedAt = new Date().toISOString().replace('T', ' ').substring(0, 16);
    this.settings.updatedBy = userName;
    this.settings.updatedByRole = userRole;

    this.saveSettingsToDisk();

    // Log to audit trail
    const auditEntry: RemittanceAuditRecord = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      category: 'remittance_numbering',
      action: 'تعديل سياسة ترقيم الحوالات وإجراءات الأمان',
      details: `تم تحديث سياسة الترقيم بواسطة [${userName}] (${userRole}). النمط: ${this.settings.numberingMode}، البادئة: ${this.settings.prefix}، التسلسل التالي: ${this.settings.nextSequence}`,
      performedBy: userName,
      userRole,
      timestamp: this.settings.updatedAt,
      oldValue: `${oldMode} (Prefix: ${oldPrefix}, Seq: ${oldSeq})`,
      newValue: `${this.settings.numberingMode} (Prefix: ${this.settings.prefix}, Seq: ${this.settings.nextSequence})`,
    };

    this.auditLogs.unshift(auditEntry);
    this.saveAuditLogsToDisk();

    return {
      success: true,
      settings: { ...this.settings },
    };
  }

  public validateTransferNumber(transferNumber: string): { isUnique: boolean; message: string } {
    if (!transferNumber || !transferNumber.trim()) {
      return { isUnique: false, message: 'رقم الحوالة لا يمكن أن يكون فارغاً' };
    }

    const cleanNum = transferNumber.trim().toUpperCase();
    const isTaken = this.registeredNumbers.has(cleanNum) || this.masterRemittances.has(cleanNum);

    if (isTaken) {
      return {
        isUnique: false,
        message: `رقم الحوالة (${cleanNum}) محجوز ومسجل مسبقاً في النظام. يمنع تكرار الأرقام قطيعاً.`,
      };
    }

    return {
      isUnique: true,
      message: `رقم الحوالة (${cleanNum}) متاح وفريد ومطابق لسياسة الأمان.`,
    };
  }

  public registerTransferNumber(
    transferNumber: string,
    operatorName: string,
    mode: RemittanceNumberingMode
  ): { success: boolean; error?: string } {
    const cleanNum = transferNumber.trim().toUpperCase();

    if (this.registeredNumbers.has(cleanNum)) {
      return {
        success: false,
        error: `رفض النظام: رقم الحوالة ${transferNumber} مستخدم مسبقاً (Unique Constraint Violation).`,
      };
    }

    this.registeredNumbers.set(cleanNum, {
      number: cleanNum,
      registeredAt: new Date().toISOString(),
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
      registeredAt: new Date().toISOString(),
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
  // رابعاً: إصلاح وضمان صحة صرف الحوالات (Fortified Remittance Payout Engine)
  // =========================================================================

  /**
   * تنفيذ عملية الصرف المركزية الموحدة مع الحماية الشاملة
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
  }): { success: boolean; record?: RemittancePayoutRecord; masterRemittance?: RemittanceMasterRecord; error?: string; isDuplicate?: boolean } {
    const cleanNum = params.transferNumber.trim().toUpperCase();

    // 11. Idempotency Key check: منع تكرار العملية عند إعادة إرسال الطلب
    if (params.idempotencyKey && this.idempotencyStore.has(params.idempotencyKey)) {
      const existing = this.idempotencyStore.get(params.idempotencyKey)!;
      return {
        success: true,
        record: existing,
        masterRemittance: this.masterRemittances.get(cleanNum),
      };
    }

    // 9. منع الصرف المتزامن (Concurrency Mutex Lock on Transfer Number)
    if (this.inFlightPayouts.has(cleanNum)) {
      return {
        success: false,
        error: `رفض النظام: عملية صرف الحوالة (${cleanNum}) قيد المعالجة حالياً في طلب متزامن آخر. يمنع التكرار.`,
      };
    }

    // 5. التحقق من أن الحوالة لم تُصرف سابقاً
    if (this.payouts.has(cleanNum)) {
      const existing = this.payouts.get(cleanNum)!;
      return {
        success: false,
        isDuplicate: true,
        record: existing,
        error: `رفض النظام: الحوالة رقم ${cleanNum} تم صرفها مسبقاً بتاريخ ${existing.paidAt} بواسطة ${existing.tellerName}. يمنع صرف الحوالة مرتين منعاً باتاً.`,
      };
    }

    // 13. استخراج هوية الموظف وصلاحياته من الجلسة الموثقة وعدم الوثوق بمدخلات العميل
    const allowedRoles = ['teller', 'branch_manager', 'general_manager', 'owner'];
    if (!allowedRoles.includes(params.tellerRole)) {
      return {
        success: false,
        error: `صلاحية غير كافية: دور [${params.tellerRole}] غير مخول بتنفيذ عمليات صرف الحوالات وتسليم النقدية.`,
      };
    }

    // 6. التحقق من الهوية حسب نوع المستند ورقم الهوية
    if (!params.recipientIdNumber || !params.recipientIdNumber.trim()) {
      return {
        success: false,
        error: 'رقم إثبات هوية المستفيد حقل إلزامي لصرف الحوالة وفقاً لمعايير الامتثال ومكافحة غسل الأموال (AML/KYC).',
      };
    }

    // ضع القفل الذري للطلب الحالي لمنع تداخل العمليات المتزامنة
    this.inFlightPayouts.add(cleanNum);

    try {
      // 1. لا تقبل صرف حوالة غير موجودة في سجل الحوالات الأصلي
      // 3. اجلب بيانات الحوالة الأصلية من مصدرها المعتمد على الخادم
      let masterRem = this.masterRemittances.get(cleanNum);

      if (!masterRem) {
        // إذا لم تكن موجودة في السجل الرئيسي، نرفض الصرف منعاً لصرف حوالات وهمية (FIND-004/005)
        return {
          success: false,
          error: `رفض النظام: الحوالة رقم ${cleanNum} غير مسجلة في السجل المالي المركزي المعتمد للمؤسسة.`,
        };
      }

      // 4. تحقق من رقم الحوالة وحالتها والمبلغ والعملة والمستفيد
      // 8. لا تسمح بصرف حوالة ملغاة أو منتهية أو غير معتمدة
      if (masterRem.status === 'paid') {
        return {
          success: false,
          isDuplicate: true,
          error: `رفض النظام: الحوالة رقم ${cleanNum} حالتها في السجل المعتمد [مصروفة مسبقاً].`,
        };
      }

      if (masterRem.status === 'cancelled' || masterRem.status === 'refunded') {
        return {
          success: false,
          error: `رفض النظام: لا يمكن صرف الحوالة رقم ${cleanNum} لأنها ملغاة ومستردة بقيد محاسبي عكسي.`,
        };
      }

      if (masterRem.status !== 'available' && masterRem.status !== 'approved') {
        return {
          success: false,
          error: `رفض النظام: الحوالة بحالة [${masterRem.status}] وليست متاحة للصرف والتسليم.`,
        };
      }

      // 2. لا تثق في المبلغ أو العملة القادمة من المتصفح، تحقق من تطابقها مع السجل المعتمد
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

      // 7. تحقق من السيولة المتاحة في الصندوق قبل الصرف
      if (typeof params.cashierDrawerBalance === 'number') {
        if (params.cashierDrawerBalance < masterRem.amount && !params.managerOverride) {
          return {
            success: false,
            error: `عجز في رصيد الصندوق: الرصيد المتاح (${params.cashierDrawerBalance} ${masterRem.currency}) أقل من مبلغ الحوالة (${masterRem.amount} ${masterRem.currency}). يتطلب تغذية الصندوق أو اعتماد المدير.`,
          };
        }
      }

      const now = new Date();
      const paidAtStr = now.toISOString().replace('T', ' ').substring(0, 16);
      const voucherNum = params.voucherNumber || `V-PAY-${Date.now().toString().slice(-4)}`;
      const entryNum = params.journalEntryReference || `JV-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      // إنشاء سجل الصرف
      const payoutRecord: RemittancePayoutRecord = {
        idempotencyKey: params.idempotencyKey,
        transferId: masterRem.id,
        transferNumber: cleanNum,
        recipientIdType: params.recipientIdType,
        recipientIdNumber: params.recipientIdNumber.trim(),
        tellerId: params.tellerId,
        tellerName: params.tellerName,
        tellerRole: params.tellerRole,
        amount: masterRem.amount, // المبلغ المعتمد من السيرفر
        currency: masterRem.currency, // العملة المعتمدة من السيرفر
        paidAt: paidAtStr,
        voucherNumber: voucherNum,
        journalEntryReference: entryNum,
        cashMovementReference: voucherNum,
        managerOverride: Boolean(params.managerOverride),
        managerOverrideBy: params.managerOverride ? params.tellerName : undefined,
        managerOverrideReason: params.managerOverrideReason,
      };

      // 10. تحديث ذري لسجل الصرف والسجل الماستر
      this.payouts.set(cleanNum, payoutRecord);
      if (params.idempotencyKey) {
        this.idempotencyStore.set(params.idempotencyKey, payoutRecord);
      }

      // تحديث حالة الحوالة الأصلية في السجل الرئيسي
      masterRem.status = 'paid';
      masterRem.paidAt = paidAtStr;
      masterRem.recipientIdType = params.recipientIdType;
      masterRem.recipientIdNumber = params.recipientIdNumber.trim();
      masterRem.voucherNumber = voucherNum;
      masterRem.journalEntryReference = entryNum;
      masterRem.cashMovementReference = voucherNum;
      masterRem.payoutRecordId = voucherNum;
      this.masterRemittances.set(cleanNum, masterRem);

      // 12. تسجيل الموظف والفرع والتاريخ والوقت ورقم السند والهوية والمبلغ والعملة في سجل التدقيق
      const auditEntry: RemittanceAuditRecord = {
        id: `audit-pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        category: 'financial',
        action: 'صرف حوالة وتسليم نقدية للمستفيد (معتمد ذرياً)',
        details: `تم صرف الحوالة ${cleanNum} بمبلغ ${masterRem.amount} ${masterRem.currency} للمستفيد (${masterRem.recipientName} - إثبات هوية: ${params.recipientIdType} ${params.recipientIdNumber}) بواسطة ${params.tellerName} (${params.tellerRole}). سند الصرف: ${voucherNum}، القيد المحاسبي: ${entryNum}.${params.managerOverride ? ` [تجاوز سيولة معتمد: ${params.managerOverrideReason || 'بموافقة المدير'}]` : ''}`,
        performedBy: params.tellerName,
        userRole: params.tellerRole,
        timestamp: paidAtStr,
        oldValue: 'status: available',
        newValue: `status: paid (Voucher: ${voucherNum}, JV: ${entryNum})`,
      };

      this.auditLogs.unshift(auditEntry);

      // حفظ التغييرات على القرص
      this.savePayoutsToDisk();
      this.saveMasterRemittancesToDisk();
      this.saveAuditLogsToDisk();

      return {
        success: true,
        record: payoutRecord,
        masterRemittance: masterRem,
      };
    } finally {
      // فك القفل الذري للطلب
      this.inFlightPayouts.delete(cleanNum);
    }
  }

  // =========================================================================
  // سادساً: آلية المصالحة المحاسبية والتدقيق (Financial Reconciliation Engine)
  // =========================================================================

  /**
   * 10. إضافة آلية مصالحة تكشف أي حوالة مصروفة دون قيد أو حركة صندوق مرتبطة بها
   */
  public reconcilePayouts(): ReconciliationResult {
    const paidRemittances = Array.from(this.masterRemittances.values()).filter((r) => r.status === 'paid');
    const discrepancies: ReconciliationResult['discrepancies'] = [];
    let matchedCount = 0;

    for (const rem of paidRemittances) {
      const cleanNum = rem.transferNumber.trim().toUpperCase();
      const payoutRecord = this.payouts.get(cleanNum);

      if (!payoutRecord) {
        discrepancies.push({
          transferNumber: cleanNum,
          issue: 'MISSING_PAYOUT_RECORD',
          details: `الحوالة ${cleanNum} حالتها مدفوعة ولكن سجل الصرف والتسليم غير موجود في payouts registry.`,
        });
        continue;
      }

      if (!payoutRecord.journalEntryReference || !payoutRecord.voucherNumber) {
        discrepancies.push({
          transferNumber: cleanNum,
          issue: 'MISSING_JOURNAL_OR_VOUCHER_LINK',
          details: `الحوالة ${cleanNum} تفتقر إلى مرجع القيد المحاسبي (${payoutRecord.journalEntryReference}) أو رقم السند (${payoutRecord.voucherNumber}).`,
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
      timestamp: new Date().toISOString(),
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
