/**
 * سجل الإرسال المركزي المستقل - نظام عمرو النماري للصرافة
 * Independent Production-Grade WhatsApp Dispatch Registry with Disk Persistence & Idempotency
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WhatsAppDispatchRecord, WhatsAppLifecycleStatus, WhatsAppVoucherSnapshot } from '../types/whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data files paths
const DATA_DIR = path.resolve(__dirname, '../../../data');
const REGISTRY_FILE = path.resolve(DATA_DIR, 'whatsapp_dispatch_registry.json');
const ARCHIVE_DIR = path.resolve(DATA_DIR, 'archived_vouchers');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(ARCHIVE_DIR)) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

class DispatchRegistry {
  private records: Map<string, WhatsAppDispatchRecord> = new Map();
  private voucherToRecordId: Map<string, string> = new Map();
  private messageIdToRecordId: Map<string, string> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(REGISTRY_FILE)) {
        const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8');
        const list: WhatsAppDispatchRecord[] = JSON.parse(raw);
        for (const item of list) {
          this.records.set(item.id, item);
          if (item.voucherNumber) {
            this.voucherToRecordId.set(item.voucherNumber, item.id);
          }
          if (item.whatsappMessageId) {
            this.messageIdToRecordId.set(item.whatsappMessageId, item.id);
          }
        }
        console.log(`[WhatsApp Registry] Loaded ${this.records.size} dispatch records from disk.`);
      }
    } catch (err) {
      console.warn('[WhatsApp Registry] Could not load registry from disk, starting empty:', err);
    }
  }

  private saveToDisk() {
    try {
      const list = Array.from(this.records.values());
      fs.writeFileSync(REGISTRY_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('[WhatsApp Registry] Failed to persist registry to disk:', err);
    }
  }

  /**
   * حساب بصمة SHA-256 للملف للتأكد من سلامته وربطه بالسجل المالي
   */
  public calculateSha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * حفظ نسخة أرشيفية دائمة لصورة السند على القرص مرتبطة بالبصمة
   */
  public archiveVoucherImage(buffer: Buffer, voucherNumber: string, sha256: string): string {
    const cleanNum = voucherNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${cleanNum}_${sha256.substring(0, 12)}.png`;
    const filepath = path.resolve(ARCHIVE_DIR, filename);
    fs.writeFileSync(filepath, buffer);
    return filename;
  }

  /**
   * التحقق من منع تكرار الإرسال (Idempotency Check)
   */
  public checkIdempotency(voucherNumber: string, forceRetry = false): {
    canSend: boolean;
    existingRecord?: WhatsAppDispatchRecord;
    reason?: string;
  } {
    const recordId = this.voucherToRecordId.get(voucherNumber);
    if (!recordId) {
      return { canSend: true };
    }

    const record = this.records.get(recordId);
    if (!record) {
      return { canSend: true };
    }

    // إذا طلب المستخدم إعادة الإرسال الصريحة (Explicit Retry)
    if (forceRetry) {
      return { canSend: true, existingRecord: record };
    }

    // إذا كان السند قيد الإرسال أو تم إرساله بنجاح
    if (['SENDING', 'UPLOADING'].includes(record.status)) {
      const elapsed = Date.now() - new Date(record.createdAt).getTime();
      if (elapsed < 30000) { // أقل من 30 ثانية
        return {
          canSend: false,
          existingRecord: record,
          reason: 'السند قيد الإرسال حالياً لمزود WhatsApp، يرجى الانتظار لتفادي التكرار.',
        };
      }
    }

    if (['SENT', 'DELIVERED', 'READ'].includes(record.status)) {
      return {
        canSend: false,
        existingRecord: record,
        reason: `تم إرسال هذا السند مسبقاً للعميل (الحالة: ${record.status} بمعرف: ${record.whatsappMessageId}). اضغط على إعادة الإرسال الصريحة إذا كنت ترغب بإرسال نسخة جديدة.`,
      };
    }

    return { canSend: true, existingRecord: record };
  }

  /**
   * إنشاء سجل إرسال جديد أو تهيئة محاولة جديدة
   */
  public createOrUpdateAttempt(params: {
    voucherNumber: string;
    transactionId: string;
    voucherType: string;
    recipientPhone: string;
    caption: string;
    sha256: string;
    fileSizeBytes: number;
    storageKey: string;
    employeeId?: string;
    employeeName?: string;
    snapshot: WhatsAppVoucherSnapshot;
    idempotencyKey?: string;
  }): WhatsAppDispatchRecord {
    const existingId = this.voucherToRecordId.get(params.voucherNumber);
    const existing = existingId ? this.records.get(existingId) : null;

    const recordId = existing ? existing.id : `disp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    const record: WhatsAppDispatchRecord = {
      id: recordId,
      transactionId: params.transactionId,
      voucherNumber: params.voucherNumber,
      voucherType: params.voucherType,
      recipientPhone: params.recipientPhone,
      sha256: params.sha256,
      fileSizeBytes: params.fileSizeBytes,
      metaMediaId: null,
      whatsappMessageId: null,
      status: 'UPLOADING',
      caption: params.caption,
      createdAt: existing ? existing.createdAt : now,
      attemptsCount: existing ? existing.attemptsCount + 1 : 1,
      lastError: null,
      employeeId: params.employeeId || 'CASHIER-1',
      employeeName: params.employeeName || 'عمرو النماري',
      idempotencyKey: params.idempotencyKey || `${params.voucherNumber}_${params.sha256.substring(0, 8)}`,
      storageKey: params.storageKey,
      snapshot: params.snapshot,
      rawWebhookEvents: existing?.rawWebhookEvents || [],
    };

    this.records.set(recordId, record);
    this.voucherToRecordId.set(params.voucherNumber, recordId);
    this.saveToDisk();

    return record;
  }

  /**
   * تسجيل نجاح رفع الوسائط إلى Meta
   */
  public recordMediaUploaded(recordId: string, metaMediaId: string) {
    const record = this.records.get(recordId);
    if (!record) return;

    record.metaMediaId = metaMediaId;
    record.uploadedAt = new Date().toISOString();
    record.status = 'SENDING';
    this.saveToDisk();
  }

  /**
   * تسجيل قبول Meta لطلب الإرسال (حالة SENT الرسمية)
   */
  public recordSent(recordId: string, whatsappMessageId: string) {
    const record = this.records.get(recordId);
    if (!record) return;

    record.whatsappMessageId = whatsappMessageId;
    record.sentAt = new Date().toISOString();
    record.status = 'SENT'; // ملاحظة: لا تسجل DELIVERED هنا، التسليم يأتي فقط من Webhook!
    this.messageIdToRecordId.set(whatsappMessageId, recordId);
    this.saveToDisk();
    console.log(`[WhatsApp Registry] Voucher ${record.voucherNumber} marked as SENT. Message ID: ${whatsappMessageId}`);
  }

  /**
   * N9: تسجيل محاكاة محلية بوضوح. لا SENT ولا sentAt ولا ربط بـ webhook،
   * فلا يُحتسب السند مرسلاً ولا يمكن لأي حدث خارجي ترقيته إلى DELIVERED.
   */
  public recordSimulated(recordId: string, simulatedMessageId: string) {
    const record = this.records.get(recordId);
    if (!record) return;

    record.whatsappMessageId = simulatedMessageId;
    record.status = 'SIMULATED';
    this.saveToDisk();
    console.log(`[WhatsApp Registry] Voucher ${record.voucherNumber} marked as SIMULATED (nothing was sent).`);
  }

  /**
   * تحديث الحالة عند وصول إشعار تسليم حقيقي من Webhook
   */
  public recordWebhookEvent(messageId: string, status: 'sent' | 'delivered' | 'read' | 'failed', rawEvent: any): boolean {
    const recordId = this.messageIdToRecordId.get(messageId);
    if (!recordId) {
      console.warn(`[WhatsApp Registry] Webhook event received for unknown messageId: ${messageId}`);
      return false;
    }

    const record = this.records.get(recordId);
    if (!record) return false;

    // Deduplication: منع معالجة نفس الحدث مرتين
    const isDuplicate = record.rawWebhookEvents?.some(
      (e) => e.id === rawEvent.id && e.status === status && e.timestamp === rawEvent.timestamp
    );
    if (isDuplicate) {
      console.log(`[WhatsApp Registry] Duplicate webhook event ignored for ${messageId}`);
      return true;
    }

    if (!record.rawWebhookEvents) record.rawWebhookEvents = [];
    record.rawWebhookEvents.push(rawEvent);

    const now = new Date().toISOString();
    if (status === 'delivered') {
      record.status = 'DELIVERED';
      record.deliveredAt = now;
      console.log(`[WhatsApp Registry] Voucher ${record.voucherNumber} marked as DELIVERED via Webhook!`);
    } else if (status === 'read') {
      record.status = 'READ';
      record.readAt = now;
      console.log(`[WhatsApp Registry] Voucher ${record.voucherNumber} marked as READ via Webhook!`);
    } else if (status === 'failed') {
      record.status = 'FAILED';
      record.failedAt = now;
      record.lastError = JSON.stringify(rawEvent.errors || 'Webhook delivery failed');
      console.error(`[WhatsApp Registry] Voucher ${record.voucherNumber} marked as FAILED via Webhook!`);
    }

    this.saveToDisk();
    return true;
  }

  /**
   * تسجيل الفشل
   */
  public recordFailure(recordId: string, error: string) {
    const record = this.records.get(recordId);
    if (!record) return;

    record.status = 'FAILED';
    record.lastError = error;
    record.failedAt = new Date().toISOString();
    this.saveToDisk();
    console.warn(`[WhatsApp Registry] Voucher ${record.voucherNumber} marked as FAILED: ${error}`);
  }

  /**
   * استرجاع السجل برقم السند
   */
  public getByVoucherNumber(voucherNumber: string): WhatsAppDispatchRecord | null {
    const id = this.voucherToRecordId.get(voucherNumber);
    return id ? this.records.get(id) || null : null;
  }

  /**
   * استرجاع جميع السجلات
   */
  public getAllRecords(): WhatsAppDispatchRecord[] {
    return Array.from(this.records.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
}

export const dispatchRegistry = new DispatchRegistry();
