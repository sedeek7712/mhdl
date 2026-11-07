/**
 * خدمة تكامل Meta WhatsApp Business Cloud API الرسمية
 * Production-Grade Meta Graph API Integration (Direct Media Upload & Messages API)
 */

import crypto from 'crypto';
import { MetaMediaUploadResponse, MetaMessageSendResponse } from '../types/whatsapp.js';

export interface MetaConfig {
  token: string | null;
  phoneNumberId: string | null;
  appSecret: string | null;
  webhookVerifyToken: string | null;
  apiVersion: string;
}

export function isValidMetaToken(token: string | null): boolean {
  if (!token) return false;
  const t = token.trim();
  // Valid Meta WhatsApp Cloud API access tokens always start with 'EAA' and are >= 30 chars
  return t.startsWith('EAA') && t.length >= 30;
}

export function getMetaConfig(): MetaConfig {
  return {
    token: process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_API_KEY || null,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    appSecret: process.env.WHATSAPP_APP_SECRET || null,
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'amro_alnamari_secure_token_2026',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
  };
}

export class MetaWhatsAppService {
  /**
   * 1. رفع الصورة مباشرة إلى Meta Media API (Direct Binary Upload)
   * لا يتطلب روابط عامة أو localhost! يتم الرفع خادم-إلى-خادم مباشرة إلى Meta
   */
  public async uploadMediaDirectly(
    imageBuffer: Buffer,
    mimeType = 'image/png',
    filename = 'voucher.png'
  ): Promise<{ mediaId: string }> {
    const config = getMetaConfig();

    if (!config.token || !config.phoneNumberId) {
      throw new Error(
        'بيانات اعتماد Meta WhatsApp Cloud API غير مكتملة في الخادم (WHATSAPP_TOKEN أو WHATSAPP_PHONE_NUMBER_ID مفقود).'
      );
    }

    const uploadUrl = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/media`;

    // Construct standard multipart/form-data payload natively with Node.js Blob
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', mimeType);

    const blob = new Blob([new Uint8Array(imageBuffer)], { type: mimeType });
    formData.append('file', blob, filename);

    console.log(`[Meta Cloud API] Uploading media to Meta: ${uploadUrl} (${imageBuffer.length} bytes)...`);

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
      body: formData,
    });

    const responseData = await response.json();

    if (!response.ok) {
      const errMsg = responseData?.error?.message || 'Meta Media API upload rejected';
      // If error is 133010 (Account not registered), attempt auto-registration and retry once
      if (errMsg.includes('133010') || errMsg.includes('Account not registered')) {
        console.info('[Meta Cloud API] Account not registered (#133010). Attempting automatic registration...');
        const registered = await this.registerPhoneNumber();
        if (registered) {
          console.info('[Meta Cloud API] Registration successful. Retrying media upload...');
          const retryRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.token}`,
            },
            body: formData,
          });
          const retryData = await retryRes.json();
          if (retryRes.ok && retryData.id) {
            console.log(`[Meta Cloud API] Media uploaded successfully after registration: ${retryData.id}`);
            return { mediaId: retryData.id };
          }
        }
      }

      console.warn(`[Meta Cloud API] Media upload could not be completed (HTTP ${response.status}): ${errMsg}`);
      throw new Error(`خطأ من Meta Media API: ${errMsg}`);
    }

    if (!responseData.id) {
      throw new Error('لم تقم Meta بإرجاع Media ID صالح للصورة');
    }

    console.log(`[Meta Cloud API] Media uploaded successfully. Meta Media ID: ${responseData.id}`);
    return { mediaId: responseData.id };
  }

  /**
   * تسجيل رقم الهاتف في منظومة WhatsApp Cloud API بنجاح
   */
  public async registerPhoneNumber(pin = '123456'): Promise<boolean> {
    const config = getMetaConfig();
    if (!config.token || !config.phoneNumberId) return false;
    try {
      const regUrl = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/register`;
      const res = await fetch(regUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          pin,
        }),
      });
      const data = await res.json();
      return Boolean(data.success);
    } catch (err: any) {
      console.warn('[Meta Cloud API] Auto-register notice:', err.message);
      return false;
    }
  }

  /**
   * 2. إرسال رسالة صورة باستخدام Meta Media ID الحقيقي (Messages API)
   * نوع الرسالة: "image" حصراً عبر معرف الوسائط "id"
   */
  public async sendImageMessageByMediaId(params: {
    recipientPhone: string;
    mediaId: string;
    caption: string;
  }): Promise<{ messageId: string }> {
    const config = getMetaConfig();

    if (!config.token || !config.phoneNumberId) {
      throw new Error(
        'بيانات اعتماد Meta WhatsApp Cloud API غير مكتملة في الخادم (WHATSAPP_TOKEN أو WHATSAPP_PHONE_NUMBER_ID مفقود).'
      );
    }

    // تنظيف وتنسيق رقم الهاتف بالصيغة الدولية E.164
    let cleanPhone = params.recipientPhone.replace(/\D/g, '');
    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
    if (cleanPhone.startsWith('0') && cleanPhone.length === 10) cleanPhone = '967' + cleanPhone.substring(1);
    if (cleanPhone.length === 9 && !cleanPhone.startsWith('967') && !cleanPhone.startsWith('966')) {
      cleanPhone = '967' + cleanPhone; // اليمن كافتراضي
    }

    const messagesUrl = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;

    // الحمولة الرسمية المعتمدة من Meta لرسائل الصور باستخدام Media ID
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'image',
      image: {
        id: params.mediaId,
        caption: params.caption,
      },
    };

    console.log(`[Meta Cloud API] Dispatching Image message to +${cleanPhone} using Media ID ${params.mediaId}...`);

    const response = await fetch(messagesUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseData: any = await response.json();

    if (!response.ok) {
      const errMsg = responseData?.error?.message || 'Meta Messages API rejected the dispatch request';
      console.warn(`[Meta Cloud API] Message dispatch could not be completed (HTTP ${response.status})`);
      throw new Error(`خطأ من Meta Messages API: ${errMsg}`);
    }

    const messageId = responseData.messages?.[0]?.id;
    if (!messageId) {
      throw new Error('لم تقم Meta بإرجاع معرف رسالة (wamid) صالح');
    }

    console.log(`[Meta Cloud API] Message accepted by Meta. WhatsApp Message ID: ${messageId}`);
    return { messageId };
  }

  /**
   * 3. التحقق الأمني من توقيع Webhook المشفر (X-Hub-Signature-256)
   */
  public verifyWebhookSignature(rawBody: Buffer | string, signatureHeader?: string): boolean {
    const config = getMetaConfig();
    if (!config.appSecret) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[Meta Webhook CRITICAL] WHATSAPP_APP_SECRET is missing in production environment. Webhook signature verification failed.');
        return false;
      }
      console.warn('[Meta Webhook SECURITY NOTICE] WHATSAPP_APP_SECRET is not configured; signature verification skipped in dev only.');
      return true;
    }

    if (!signatureHeader) {
      console.error('[Meta Webhook] Missing X-Hub-Signature-256 header.');
      return false;
    }

    const parts = signatureHeader.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') {
      console.error('[Meta Webhook] Invalid signature format.');
      return false;
    }

    const expectedHash = parts[1];
    const hmac = crypto.createHmac('sha256', config.appSecret);
    const calculatedHash = hmac.update(rawBody).digest('hex');

    return crypto.timingSafeEqual(Buffer.from(calculatedHash, 'hex'), Buffer.from(expectedHash, 'hex'));
  }
}

export const metaWhatsAppService = new MetaWhatsAppService();
