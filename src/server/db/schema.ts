/**
 * مخطط جداول قاعدة بيانات منظومة السندات وإشعارات الواتساب
 * PostgreSQL Database Schema for Amro Alnamari Exchange ERP
 */

export interface VoucherEntity {
  id: string; // UUID
  tenantId: string;
  branchId: string;
  transactionId: string; // معرف العملية المحاسبية المرتبطة
  voucherNumber: string;
  voucherType: 'exchange' | 'transfer_outgoing' | 'transfer_incoming' | 'receipt' | 'payment';
  partyName: string;
  partyPhone: string;
  amount: number;
  currency: string;
  amountInWordsAr: string;
  exchangeRate?: number;
  receivedAmount?: number;
  receivedCurrency?: string;
  commission: number;
  senderName?: string;
  recipientName?: string;
  recipientPhone?: string;
  networkName?: string;
  tellerId: string;
  tellerName: string;
  generalNumber?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VoucherFileEntity {
  id: string; // UUID
  voucherId: string; // Foreign Key to VoucherEntity
  filePath: string;
  fileType: string; // 'image/png'
  fileSizeBytes: number;
  sha256Hash: string;
  storageProvider: 'meta_media' | 'local_archive' | 's3';
  storageKey: string;
  createdAt: string;
}

export type WhatsAppMessageStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'GENERATED'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED'
  | 'RETRY_PENDING';

export interface WhatsAppMessageEntity {
  id: string; // UUID
  voucherId: string; // Foreign Key to VoucherEntity
  tenantId: string;
  branchId: string;
  recipientPhone: string;
  messageType: 'image';
  caption: string;
  metaMediaId?: string;
  whatsappMessageId?: string; // wamid
  idempotencyKey: string; // Unique key to prevent duplicates
  status: WhatsAppMessageStatus;
  attemptsCount: number;
  lastError?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppMessageEventEntity {
  id: string; // UUID
  messageId: string; // Foreign Key to WhatsAppMessageEntity
  whatsappMessageId: string;
  eventStatus: 'sent' | 'delivered' | 'read' | 'failed';
  rawPayload: any;
  eventTimestamp: string;
  createdAt: string;
}

export interface NotificationLogEntity {
  id: string; // UUID
  voucherNumber: string;
  action: 'GENERATE_IMAGE' | 'META_UPLOAD' | 'DISPATCH' | 'WEBHOOK_EVENT' | 'RETRY';
  status: 'SUCCESS' | 'FAILED' | 'WARNING';
  errorDetails?: string;
  operatorId?: string;
  ipAddress?: string;
  createdAt: string;
}

export interface WhatsAppTemplateEntity {
  id: string; // UUID
  templateName: string;
  languageCode: string;
  voucherType: 'exchange' | 'transfer_outgoing' | 'transfer_incoming' | 'receipt' | 'payment';
  captionTemplate: string;
  isActive: boolean;
  createdAt: string;
}
