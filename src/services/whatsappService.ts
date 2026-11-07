/**
 * خدمة وسائط وإرسال السندات عبر WhatsApp Business Cloud API
 * Production-Grade Client Engine for Amro Alnamari Exchange ERP
 */

import { toPng } from 'html-to-image';
import { OfficialVoucher, SUPPORTED_CURRENCIES } from '../types/exchange';
import { formatMoney } from './accountingEngine';

export interface WhatsAppConfigStatus {
  success: boolean;
  provider: string;
  apiVersion: string;
  isConfigured: boolean;
  hasToken: boolean;
  hasPhoneNumberId: boolean;
  hasAppSecret: boolean;
  hasWebhookVerifyToken: boolean;
  webhookUrl: string;
  notes: string;
}

export interface WhatsAppDispatchResponse {
  success: boolean;
  message?: string;
  whatsappMessageId?: string;
  metaMediaId?: string;
  status: 'PENDING' | 'GENERATING' | 'UPLOADING' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RETRY_PENDING';
  record?: any;
  error?: string;
  isDuplicate?: boolean;
  requiresCredentials?: boolean;
  mode?: 'live' | 'sandbox';
  notice?: string;
}

const EXPORT_OPTIONS = {
  quality: 0.98,
  pixelRatio: 2.0,
  backgroundColor: '#ffffff',
  skipFonts: true,
  cacheBust: false,
  imagePlaceholder: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAA',
  onImageErrorHandler: () => {},
};

export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binaryString = atob(parts[1]);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/**
 * 1. توليد صورة السند المالي بدقة عالية بصيغة PNG من عنصر الواجهة
 */
export async function generateVoucherImage(
  element: HTMLElement,
  voucher: OfficialVoucher
): Promise<{ dataUrl: string; blob: Blob }> {
  if (!element) {
    throw new Error('عنصر السند المالي غير موجود في شجرة الواجهة');
  }

  // 1. Generate PNG Data URL with retry fallback
  let dataUrl = '';
  try {
    dataUrl = await toPng(element, EXPORT_OPTIONS);
  } catch (err: any) {
    console.warn('[Voucher Generator] Initial toPng failed, retrying with fallback options:', err);
    try {
      dataUrl = await toPng(element, {
        backgroundColor: '#ffffff',
        pixelRatio: 1.5,
        cacheBust: false,
        skipFonts: true,
        imagePlaceholder: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAA',
        onImageErrorHandler: () => {},
      });
    } catch (fallbackErr: any) {
      const msg =
        fallbackErr?.message ||
        (fallbackErr?.isTrusted
          ? 'تعذر تصوير السند في المتصفح'
          : typeof fallbackErr === 'object'
          ? JSON.stringify(fallbackErr)
          : String(fallbackErr));
      throw new Error(`فشل توليد صورة السند: ${msg}`);
    }
  }

  if (!dataUrl || dataUrl.length < 500) {
    throw new Error('فشل توليد صورة السند: البيانات الناتجة غير صالحة أو فارغة');
  }

  // 2. Deterministically derive Blob from valid Data URL in memory (never fails or returns null)
  const blob = dataUrlToBlob(dataUrl);

  return { dataUrl, blob };
}

/**
 * 2. التحقق من حالة تكوين Meta WhatsApp Cloud API في الخادم
 */
export async function checkMetaConfigStatus(): Promise<WhatsAppConfigStatus> {
  try {
    const res = await fetch('/api/whatsapp/config-status');
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      return await res.json();
    }
    return {
      success: false,
      provider: 'Meta WhatsApp Business Cloud API',
      apiVersion: 'v21.0',
      isConfigured: false,
      hasToken: false,
      hasPhoneNumberId: false,
      hasAppSecret: false,
      hasWebhookVerifyToken: false,
      webhookUrl: '',
      notes: 'الخادم يعمل في نمط المحاكاة والأوفلاين.',
    };
  } catch {
    return {
      success: false,
      provider: 'Meta WhatsApp Business Cloud API',
      apiVersion: 'v21.0',
      isConfigured: false,
      hasToken: false,
      hasPhoneNumberId: false,
      hasAppSecret: false,
      hasWebhookVerifyToken: false,
      webhookUrl: '',
      notes: 'الخادم يعمل في نمط المحاكاة والأوفلاين.',
    };
  }
}

/**
 * 3. استدعاء مسار الإرسال المركزي المؤسسي (مع Idempotency والرفع المباشر إلى Meta)
 */
export async function dispatchVoucherProduction(params: {
  voucher: OfficialVoucher;
  recipientPhone: string;
  imageData: string;
  forceRetry?: boolean;
}): Promise<WhatsAppDispatchResponse> {
  const { voucher, recipientPhone, imageData, forceRetry = false } = params;

  // Build clean, professional caption
  const cur = SUPPORTED_CURRENCIES[voucher.currency]?.nameAr || voucher.currency;
  let caption = '';
  if (voucher.type === 'transfer_outgoing') {
    caption =
      `سند إرسال حوالة معتمد - شركة عمرو النماري للصرافة\n` +
      `رقم الحوالة: ${voucher.referenceNumber || voucher.voucherNumber}\n` +
      `المبلغ: ${formatMoney(voucher.amount, voucher.currency)}\n` +
      `المرسل: ${voucher.senderName || voucher.partyName || ''}\n` +
      `المستلم: ${voucher.recipientName || ''}\n` +
      `التاريخ: ${voucher.date} ${voucher.time}`;
  } else if (voucher.type === 'transfer_incoming') {
    caption =
      `سند استلام حوالة معتمد - شركة عمرو النماري للصرافة\n` +
      `رقم الحوالة: ${voucher.referenceNumber || voucher.voucherNumber}\n` +
      `المبلغ: ${formatMoney(voucher.amount, voucher.currency)}\n` +
      `المستلم: ${voucher.recipientName || voucher.partyName || ''}\n` +
      `المرسل: ${voucher.senderName || ''}\n` +
      `التاريخ: ${voucher.date} ${voucher.time}`;
  } else {
    caption =
      `سند مالي رسمي معتمد - شركة عمرو النماري للصرافة\n` +
      `رقم السند: ${voucher.voucherNumber}\n` +
      `المبلغ: ${formatMoney(voucher.amount, voucher.currency)}\n` +
      `العميل: ${voucher.partyName}\n` +
      `التاريخ: ${voucher.date} ${voucher.time}`;
  }

  // Freeze Snapshot
  const snapshot = {
    voucherNumber: voucher.voucherNumber,
    transactionId: voucher.referenceNumber || voucher.voucherNumber,
    type: voucher.type,
    date: voucher.date,
    time: voucher.time,
    partyName: voucher.partyName,
    partyPhone: voucher.partyPhone,
    amount: voucher.amount,
    currency: voucher.currency,
    amountInWordsAr: voucher.amountInWordsAr,
    branchName: voucher.branchName,
    tellerName: voucher.tellerName,
    referenceNumber: voucher.referenceNumber,
    generalNumber: voucher.generalNumber,
    receivedAmount: voucher.receivedAmount,
    receivedCurrency: voucher.receivedCurrency,
    exchangeRate: voucher.exchangeRate,
    commission: voucher.commission,
    recipientName: voucher.recipientName,
    recipientPhone: voucher.recipientPhone,
    senderName: voucher.senderName,
    networkName: voucher.networkName,
    notes: voucher.notes,
  };

  const response = await fetch('/api/whatsapp/dispatch-voucher', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      voucherNumber: voucher.voucherNumber,
      transactionId: voucher.referenceNumber || voucher.voucherNumber,
      voucherType: voucher.type,
      recipientPhone,
      caption,
      imageData,
      employeeId: 'EMP-1102',
      employeeName: voucher.tellerName,
      snapshot,
      forceRetry,
    }),
  });

  let data: WhatsAppDispatchResponse;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const rawText = await response.text();
    data = {
      success: false,
      status: 'FAILED',
      error: `استجابة غير متوقعة من الخادم (${response.status}): ${rawText.substring(0, 120)}`,
    };
  }

  if (!response.ok && !data.isDuplicate) {
    throw new Error(data.error || 'فشل إرسال صورة السند عبر مزود WhatsApp Cloud API');
  }

  return data;
}

/**
 * 4. استعلام عن حالة السند اللحظية من سجل الإرسال المركزي
 */
export async function getVoucherDispatchStatus(voucherNumber: string): Promise<any> {
  try {
    const res = await fetch(`/api/whatsapp/status/${encodeURIComponent(voucherNumber)}`);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      return await res.json();
    }
    return { success: false, error: 'استجابة غير صالحة من الخادم' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * 5. فحص واختبار خط الإرسال المتكامل (Pipeline Diagnostic)
 */
export async function runWhatsAppPipelineTest(testPhone = '967779077071'): Promise<any> {
  try {
    const res = await fetch('/api/whatsapp/test-pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testPhone }),
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      return await res.json();
    }
    return { success: false, error: 'استجابة غير صالحة من الخادم' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
