/**
 * سجل إدارة وترقيم الحوالات المالية المركزي - نظام عمرو النماري للصرافة
 * Central Enterprise Remittance Numbering & Security Registry
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

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export type RemittanceNumberingMode = 'automatic' | 'manual';

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
  category: 'remittance_numbering' | 'security' | 'financial';
  action: string;
  details: string;
  performedBy: string;
  userRole: string;
  timestamp: string;
  oldValue?: string;
  newValue?: string;
}

export interface RemittancePayoutRecord {
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
  managerOverride?: boolean;
}

class RemittanceRegistry {
  private settings: RemittanceSettingsRecord;
  private registeredNumbers: Map<string, { registeredAt: string; registeredBy: string; mode: string }> = new Map();
  private auditLogs: RemittanceAuditRecord[] = [];
  private payouts: Map<string, RemittancePayoutRecord> = new Map();

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
          this.payouts.set(item.transferNumber.trim().toUpperCase(), item);
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
    } catch (err) {
      console.warn('[RemittanceRegistry] Error loading state from disk, using fallback defaults:', err);
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

  private saveSettingsToDisk() {
    try {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[RemittanceRegistry] Failed to save settings to disk:', err);
    }
  }

  private saveNumbersToDisk() {
    try {
      const list = Array.from(this.registeredNumbers.entries()).map(([number, data]) => ({
        number,
        ...data,
      }));
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

  public getSettings(): RemittanceSettingsRecord {
    return { ...this.settings };
  }

  public updateSettings(
    newSettings: Partial<RemittanceSettingsRecord>,
    userRole: string,
    userName: string
  ): { success: boolean; settings: RemittanceSettingsRecord; error?: string } {
    // ضابط الأمان: الإعداد متاح للمالك أو المدير المخوّل فقط
    if (userRole !== 'owner' && userRole !== 'general_manager') {
      return {
        success: false,
        settings: this.settings,
        error: 'صلاحية غير كافية: تعديل طريقة ترقيم الحوالات مقتصر حصراً على المالك والمدير العام.',
      };
    }

    const oldMode = this.settings.numberingMode;
    const requestedMode = newSettings.numberingMode || this.settings.numberingMode;

    const previousSnapshot = `${oldMode} (Next: ${this.settings.prefix}${this.settings.nextSequence})`;

    this.settings = {
      ...this.settings,
      ...newSettings,
      updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      updatedBy: userName || this.settings.updatedBy,
      updatedByRole: userRole,
    };

    const newSnapshot = `${this.settings.numberingMode} (Next: ${this.settings.prefix}${this.settings.nextSequence})`;

    // تسجيل التغيير في سجل التدقيق Audit Log
    const auditEntry: RemittanceAuditRecord = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      category: 'remittance_numbering',
      action: 'تعديل طريقة إصدار أرقام الحوالات',
      details:
        oldMode !== requestedMode
          ? `تم تغيير سياسة الترقيم من [${oldMode === 'automatic' ? 'تلقائي' : 'يدوي'}] إلى [${
              requestedMode === 'automatic' ? 'تلقائي' : 'يدوي'
            }] بواسطة ${userName} (${userRole})`
          : `تحديث معلمات الترقيم بواسطة ${userName} (${userRole})`,
      performedBy: userName,
      userRole,
      timestamp: this.settings.updatedAt,
      oldValue: previousSnapshot,
      newValue: newSnapshot,
    };

    this.auditLogs.unshift(auditEntry);
    this.saveSettingsToDisk();
    this.saveAuditLogsToDisk();

    return { success: true, settings: { ...this.settings } };
  }

  /**
   * التحقق من عدم استخدام الرقم مسبقاً (قيد UNIQUE الصارم)
   */
  public validateTransferNumber(transferNumber: string): { isUnique: boolean; message?: string } {
    if (!transferNumber || !transferNumber.trim()) {
      return { isUnique: false, message: 'رقم الحوالة لا يمكن أن يكون فارغاً' };
    }

    const cleanNum = transferNumber.trim().toUpperCase();
    if (this.registeredNumbers.has(cleanNum)) {
      return {
        isUnique: false,
        message: `رقم الحوالة (${transferNumber}) مستخدم مسبقاً في النظام. يرجى إدخال رقم فريد آخر.`,
      };
    }

    return { isUnique: true };
  }

  /**
   * تسجيل رقم الحوالة واعتماده في السجل المركزي
   */
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
      registeredAt: new Date().toISOString(),
      registeredBy: operatorName,
      mode,
    });

    this.saveNumbersToDisk();
    return { success: true };
  }

  /**
   * توليد رقم متسلسل تلقائي وحجزه ذرياً
   */
  public getNextAtomicSequence(operatorName: string): { transferNumber: string; sequence: number } {
    let candidate = '';
    let seq = this.settings.nextSequence;

    // Search until we find an unregistered sequence
    while (true) {
      candidate = `${this.settings.prefix}${String(seq).padStart(6, '0')}`;
      if (!this.registeredNumbers.has(candidate.toUpperCase())) {
        break;
      }
      seq += 1;
    }

    // Reserve candidate atomically
    this.registeredNumbers.set(candidate.toUpperCase(), {
      registeredAt: new Date().toISOString(),
      registeredBy: operatorName,
      mode: 'automatic',
    });

    this.settings.nextSequence = seq + 1;
    this.saveSettingsToDisk();
    this.saveNumbersToDisk();

    return { transferNumber: candidate, sequence: seq };
  }

  /**
   * فحص ما إذا كانت الحوالة مصروفة مسبقاً في السجل المركزي
   */
  public isRemittancePaid(transferNumber: string): boolean {
    if (!transferNumber) return false;
    return this.payouts.has(transferNumber.trim().toUpperCase());
  }

  public getPayoutRecord(transferNumber: string): RemittancePayoutRecord | undefined {
    if (!transferNumber) return undefined;
    return this.payouts.get(transferNumber.trim().toUpperCase());
  }

  /**
   * صرف الحوالة مع الحماية الصارمة من الصرف المكرر على مستوى الخادم
   */
  public payoutRemittance(params: {
    transferId: string;
    transferNumber: string;
    recipientIdType: string;
    recipientIdNumber: string;
    tellerId: string;
    tellerName: string;
    tellerRole: string;
    amount: number;
    currency: string;
    voucherNumber?: string;
    managerOverride?: boolean;
  }): { success: boolean; record?: RemittancePayoutRecord; error?: string } {
    const cleanNum = params.transferNumber.trim().toUpperCase();

    // Check duplicate payout (المطلب 2: منع الصرف المكرر)
    if (this.payouts.has(cleanNum)) {
      const existing = this.payouts.get(cleanNum)!;
      return {
        success: false,
        record: existing,
        error: `رفض النظام: الحوالة رقم ${cleanNum} تم صرفها مسبقاً بتاريخ ${existing.paidAt} بواسطة ${existing.tellerName}. يمنع صرف الحوالة مرتين منعاً باتاً.`,
      };
    }

    // Role check: Teller, Branch Manager, General Manager, or Owner required
    const allowedRoles = ['teller', 'branch_manager', 'general_manager', 'owner'];
    if (!allowedRoles.includes(params.tellerRole)) {
      return {
        success: false,
        error: `صلاحية غير كافية: دور [${params.tellerRole}] غير مخول بتنفيذ عمليات صرف الحوالات وتسليم النقدية.`,
      };
    }

    if (!params.recipientIdNumber || !params.recipientIdNumber.trim()) {
      return {
        success: false,
        error: 'رقم إثبات هوية المستفيد حقل إلزامي لصرف الحوالة وفقاً لمعايير الامتثال ومكافحة غسل الأموال (AML/KYC).',
      };
    }

    const now = new Date();
    const paidAtStr = now.toISOString().replace('T', ' ').substring(0, 16);
    const voucherNum = params.voucherNumber || `V-PAY-${Date.now().toString().slice(-4)}`;

    const payoutRecord: RemittancePayoutRecord = {
      transferId: params.transferId,
      transferNumber: cleanNum,
      recipientIdType: params.recipientIdType,
      recipientIdNumber: params.recipientIdNumber.trim(),
      tellerId: params.tellerId,
      tellerName: params.tellerName,
      tellerRole: params.tellerRole,
      amount: params.amount,
      currency: params.currency,
      paidAt: paidAtStr,
      voucherNumber: voucherNum,
      managerOverride: Boolean(params.managerOverride),
    };

    // Store in atomic payout map
    this.payouts.set(cleanNum, payoutRecord);

    // Also register number if not registered
    if (!this.registeredNumbers.has(cleanNum)) {
      this.registeredNumbers.set(cleanNum, {
        registeredAt: now.toISOString(),
        registeredBy: params.tellerName,
        mode: 'incoming_payout',
      });
      this.saveNumbersToDisk();
    }

    // Audit log
    const auditEntry: RemittanceAuditRecord = {
      id: `audit-pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      category: 'financial',
      action: 'صرف حوالة وتسليم نقدية للمستفيد',
      details: `تم صرف الحوالة ${cleanNum} بمبلغ ${params.amount} ${params.currency} للمستفيد (إثبات هوية: ${params.recipientIdType} ${params.recipientIdNumber}) بواسطة ${params.tellerName} (${params.tellerRole}). سند الصرف: ${voucherNum}.${params.managerOverride ? ' [باعتماد تجاوز المدير]' : ''}`,
      performedBy: params.tellerName,
      userRole: params.tellerRole,
      timestamp: paidAtStr,
      oldValue: 'status: available',
      newValue: 'status: paid',
    };

    this.auditLogs.unshift(auditEntry);
    this.savePayoutsToDisk();
    this.saveAuditLogsToDisk();

    return {
      success: true,
      record: payoutRecord,
    };
  }

  public getAuditLogs(): RemittanceAuditRecord[] {
    return [...this.auditLogs];
  }
}

export const remittanceRegistry = new RemittanceRegistry();
