/**
 * تعريفات وأنواع منظومة إرسال السندات المؤسسية عبر WhatsApp Cloud API
 * Amro Alnamari Exchange - Production-Grade WhatsApp Integration Types
 */

export type WhatsAppLifecycleStatus =
  | 'PENDING'         // بانتظار بدء المعالجة
  | 'GENERATING'      // جاري إنشاء صورة السند من الـ DOM
  | 'GENERATED'       // تم اكتمال رسم الصورة وحساب بصمة SHA-256
  | 'UPLOADING'       // جاري رفع الوسائط مباشرة إلى Meta Media API
  | 'UPLOADED'        // تم اكتمال الرفع واستلام Meta Media ID
  | 'SENDING'         // جاري إرسال الرسالة عبر Meta Messages API
  | 'SENT'            // قبلت Meta الطلب وأرجعت معرف الرسالة (wamid)
  | 'DELIVERED'       // وصل إشعار التسليم الحقيقي من Webhook
  | 'READ'            // وصل إشعار القراءة الحقيقي من Webhook
  | 'SIMULATED'       // محاكاة محلية: لم يُرسل شيء فعلياً (لا يُحتسب مرسلاً)
  | 'FAILED'          // فشلت العملية في أي مرحلة
  | 'RETRY_PENDING';  // بانتظار إعادة المحاولة بطلب صريح

export interface WhatsAppVoucherSnapshot {
  voucherNumber: string;
  transactionId: string;
  type: 'exchange' | 'transfer_outgoing' | 'transfer_incoming' | 'receipt' | 'payment';
  date: string;
  time: string;
  partyName: string;
  partyPhone: string;
  amount: number;
  currency: string;
  amountInWordsAr: string;
  branchName: string;
  tellerName: string;
  referenceNumber: string;
  generalNumber?: string;
  receivedAmount?: number;
  receivedCurrency?: string;
  exchangeRate?: number;
  commission?: number;
  recipientName?: string;
  recipientPhone?: string;
  senderName?: string;
  networkName?: string;
  notes?: string;
}

export interface WhatsAppDispatchRecord {
  id: string;                          // معرف سجل الإرسال
  transactionId: string;               // معرف العملية المالية
  voucherNumber: string;               // رقم السند
  voucherType: string;                 // نوع السند
  recipientPhone: string;              // رقم المستلم بصيغة دولية E.164
  sha256: string;                      // البصمة الرقمية لصورة السند
  fileSizeBytes: number;               // حجم ملف الصورة بالبايت
  metaMediaId: string | null;          // معرف وسائط Meta Media API
  whatsappMessageId: string | null;    // معرف رسالة واتساب (wamid)
  status: WhatsAppLifecycleStatus;     // دورة حياة الإرسال
  caption: string;                     // نص السند المصاحب للصورة
  createdAt: string;                   // تاريخ ووقت الإنشاء
  uploadedAt?: string;                 // وقت اكتمال الرفع إلى Meta
  sentAt?: string;                     // وقت قبول Meta للإرسال
  deliveredAt?: string;                // وقت تأكيد التسليم من Webhook
  readAt?: string;                     // وقت تأكيد القراءة من Webhook
  failedAt?: string;                   // وقت حدوث الفشل
  attemptsCount: number;               // عدد محاولات الإرسال
  lastError: string | null;            // تفاصيل آخر خطأ
  employeeId?: string;                 // معرف الموظف
  employeeName?: string;               // اسم الموظف المنفذ
  idempotencyKey: string;              // مفتاح منع التكرار
  storageKey?: string;                 // مسار التخزين الدائم للأرشيف
  snapshot: WhatsAppVoucherSnapshot;   // نسخة السند المجمدة تاريخياً
  rawWebhookEvents?: any[];            // سجل الأحداث الواردة من Webhook
}

export interface MetaMediaUploadResponse {
  id: string; // Meta Media ID
}

export interface MetaMessageSendResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string; message_status?: string }>;
}

export interface WebhookStatusEvent {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string; message?: string }>;
}
