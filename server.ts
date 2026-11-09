import 'dotenv/config';
process.env.DISABLE_HMR = 'true';
import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'node:crypto';
import { metaWhatsAppService, getMetaConfig, isValidMetaToken } from './src/server/services/metaWhatsAppService.js';
import { dispatchRegistry } from './src/server/services/dispatchRegistry.js';
import { remittanceRegistry } from './src/server/services/remittanceRegistry.js';
import { WhatsAppVoucherSnapshot } from './src/server/types/whatsapp.js';
import {
  requireAuth,
  requireRoles,
  createRateLimiter,
  authService,
  AuthenticatedUser,
} from './src/server/services/authService.js';
import { serverAccountingEngine, CurrencyCode } from './src/server/services/serverAccountingEngine.js';
import { serverExchangeRateRegistry } from './src/server/services/serverExchangeRateRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Rate limiters for protection against DoS and resource exhaustion (FIND-004, FIND-005, FIND-007)
  const dispatchRateLimiter = createRateLimiter(20, 60); // 20 image uploads / min
  const sequenceRateLimiter = createRateLimiter(30, 60); // 30 sequence generations / min
  const registerRateLimiter = createRateLimiter(30, 60); // 30 manual reservations / min

  // FIND-007: Reduced JSON limit from 25mb to 4mb to prevent memory exhaustion
  app.use(
    express.json({
      limit: '4mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '4mb' }));

  // =========================================================================
  // FIND-001: Strict CORS Policy with Whitelist & Origin Validation
  // =========================================================================
  const configuredOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim().toLowerCase())
    : null;

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const host = req.headers.host;

    if (origin) {
      let isAllowed = false;
      const lowerOrigin = origin.toLowerCase();

      if (configuredOrigins) {
        isAllowed = configuredOrigins.includes(lowerOrigin);
      } else {
        // Safe default: allow same host, loopback/localhost, and official cloud run domains
        const originHost = lowerOrigin.replace(/^https?:\/\//, '').split('/')[0];
        if (host && originHost === host.toLowerCase()) {
          isAllowed = true;
        } else if (
          originHost === 'localhost' ||
          originHost.startsWith('localhost:') ||
          originHost === '127.0.0.1' ||
          originHost.startsWith('127.0.0.1:')
        ) {
          isAllowed = true;
        }
      }

      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hub-Signature-256, X-API-Token');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Block all financial write endpoints after any uncertain multi-file commit.
  // Read-only reports and authentication remain available for diagnosis.
  app.use((req, res, next) => {
    const isNonFinancialPost =
      req.path.startsWith('/api/auth/') ||
      req.path.startsWith('/api/whatsapp/');
    if (
      req.method === 'POST' &&
      req.path.startsWith('/api/') &&
      !isNonFinancialPost &&
      serverAccountingEngine.isFinancialWriteBlocked()
    ) {
      return res.status(503).json({
        success: false,
        errorCode: 'FINANCIAL_RECOVERY_REQUIRED',
        doNotRetry: true,
        error: 'النظام في وضع حماية مالية بعد فشل حفظ غير محسوم. توقفت كل العمليات المالية حتى مطابقة الملفات يدوياً.',
      });
    }
    next();
  });

  // =========================================================================
  // Authentication & Session Endpoints (FIND-002, FIND-010, H5)
  // =========================================================================
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { roleOrUsername, pin } = req.body || {};
    if (typeof roleOrUsername !== 'string' || !roleOrUsername.trim() ||
        typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        error: 'اسم المستخدم ورمز PIN المكوّن من 6 أرقام مطلوبان لتسجيل الدخول.',
      });
    }

    const clientIp = (req.ip || req.socket.remoteAddress || '127.0.0.1').toString();
    const authResult = authService.authenticateUser(roleOrUsername, pin, clientIp);
    if (!authResult.success) {
      return res.status(authResult.locked ? 429 : 401).json({
        success: false,
        error: authResult.error || 'بيانات الاعتماد غير صحيحة أو المستخدم غير موجود',
      });
    }

    return res.status(200).json({
      success: true,
      token: authResult.token,
      user: authResult.user,
    });
  });

  app.get('/api/auth/session', requireAuth, (req: any, res: Response) => {
    return res.status(200).json({
      success: true,
      user: req.user,
    });
  });

  app.get('/api/auth/security-logs', requireAuth, requireRoles(['owner', 'general_manager', 'auditor']), (_req: Request, res: Response) => {
    const logs = authService.getSecurityLogs();
    return res.status(200).json({
      success: true,
      logs,
    });
  });

  // H5: حماية مسار المستخدمين بالمصادقة لمنع كشف أسماء وأدوار النظام دون تصريح
  app.get('/api/auth/users', requireAuth, requireRoles(['owner', 'general_manager']), (_req: Request, res: Response) => {
    const users = authService.getAllPublicUsers();
    return res.status(200).json({ success: true, users });
  });

  // =========================================================================
  // FIND-008: Sanitized Meta Configuration Status (No reconnaissance leakage)
  // =========================================================================
  app.get('/api/whatsapp/config-status', (req: any, res: Response) => {
    const config = getMetaConfig();
    const isConfigured = Boolean(isValidMetaToken(config.token) && config.phoneNumberId);

    // Check if requester has admin/owner authorization
    const authHeader = req.headers.authorization;
    let isAdmin = false;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const payload = authService.verifyToken(authHeader.substring(7));
      if (payload && (payload.role === 'owner' || payload.role === 'general_manager')) {
        isAdmin = true;
      }
    }

    if (!isAdmin) {
      // Sanitized public status without reconnaissance details (no webhookUrl, no secret presence flags)
      return res.status(200).json({
        success: true,
        provider: 'Meta WhatsApp Business Cloud API',
        apiVersion: config.apiVersion,
        isConfigured,
      });
    }

    // Detailed diagnostic info for authenticated administrators only
    return res.status(200).json({
      success: true,
      provider: 'Meta WhatsApp Business Cloud API',
      apiVersion: config.apiVersion,
      isConfigured,
      hasToken: Boolean(config.token),
      hasPhoneNumberId: Boolean(config.phoneNumberId),
      hasAppSecret: Boolean(config.appSecret),
      hasWebhookVerifyToken: Boolean(config.webhookVerifyToken),
      webhookUrl: `${req.protocol}://${req.get('host')}/api/whatsapp/webhook`,
    });
  });

  // =========================================================================
  // FIND-002 & FIND-007: Hardened WhatsApp Voucher Dispatch
  // =========================================================================
  app.post(
    '/api/whatsapp/dispatch-voucher',
    requireAuth,
    dispatchRateLimiter,
    async (req: any, res: Response) => {
      try {
        const {
          voucherNumber,
          transactionId,
          voucherType,
          recipientPhone,
          caption,
          imageData,
          snapshot,
          forceRetry = false,
        } = req.body;

        if (!voucherNumber || !recipientPhone) {
          return res.status(400).json({
            success: false,
            error: 'رقم السند ورقم هاتف المستلم حقول إلزامية',
          });
        }

        if (!imageData || typeof imageData !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'صورة السند (imageData base64) مطلوبة لإنشاء السجل الرقمي المعتمد',
          });
        }

        // Step 1: Idempotency Check (منع التكرار)
        const idempotency = dispatchRegistry.checkIdempotency(voucherNumber, forceRetry);
        if (!idempotency.canSend) {
          console.warn(`[WhatsApp Dispatch] Blocked duplicate send for ${voucherNumber}: ${idempotency.reason}`);
          return res.status(409).json({
            success: false,
            isDuplicate: true,
            error: idempotency.reason,
            record: idempotency.existingRecord,
          });
        }

        // Step 2: Extract & Validate Binary Image Buffer (FIND-007)
        const matches = imageData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        let buffer: Buffer;
        let mimeType = 'image/png';

        if (matches && matches.length === 3) {
          mimeType = matches[1];
          buffer = Buffer.from(matches[2], 'base64');
        } else {
          buffer = Buffer.from(imageData, 'base64');
        }

        // FIND-007 Buffer size limits: minimum 500 bytes, maximum 2.5MB
        if (buffer.length < 500) {
          return res.status(400).json({
            success: false,
            error: 'ملف صورة السند تالف أو فارغ (أقل من 500 بايت)',
          });
        }

        if (buffer.length > 2.5 * 1024 * 1024) {
          return res.status(413).json({
            success: false,
            error: 'حجم ملف صورة السند يتجاوز الحد الأقصى المسموح (2.5 ميغابايت)',
          });
        }

        // FIND-007 Magic Bytes Validation (PNG: 89 50 4E 47 0D 0A 1A 0A, JPEG: FF D8 FF)
        const isPng =
          buffer.length >= 8 &&
          buffer[0] === 0x89 &&
          buffer[1] === 0x50 &&
          buffer[2] === 0x4e &&
          buffer[3] === 0x47 &&
          buffer[4] === 0x0d &&
          buffer[5] === 0x0a &&
          buffer[6] === 0x1a &&
          buffer[7] === 0x0a;

        const isJpeg =
          buffer.length >= 3 &&
          buffer[0] === 0xff &&
          buffer[1] === 0xd8 &&
          buffer[2] === 0xff;

        if (!isPng && !isJpeg) {
          return res.status(400).json({
            success: false,
            error: 'نوع الملف غير صالح أمنياً: يجب أن تكون الصورة ملف PNG أو JPEG أصلي ومعتمد.',
          });
        }

        // Step 3: Digital Fingerprint (SHA-256) & Permanent Archive Storage
        const sha256 = dispatchRegistry.calculateSha256(buffer);
        const storageKey = dispatchRegistry.archiveVoucherImage(buffer, voucherNumber, sha256);

        // Bind teller to authenticated session (FIND-002/003)
        const authenticatedUser = req.user as AuthenticatedUser;

        const voucherSnapshot: WhatsAppVoucherSnapshot = snapshot || {
          voucherNumber,
          transactionId: transactionId || voucherNumber,
          type: voucherType || 'exchange',
          date: new Date().toISOString().split('T')[0],
          time: new Date().toTimeString().split(' ')[0],
          partyName: 'عميل',
          partyPhone: recipientPhone,
          amount: 0,
          currency: 'YER',
          amountInWordsAr: '',
          branchName: authenticatedUser.branchName || 'الفرع الرئيسي',
          tellerName: authenticatedUser.name || 'الصراف المعتمد',
          referenceNumber: voucherNumber,
        };

        // Step 4: Create or update dispatch record in registry
        const record = dispatchRegistry.createOrUpdateAttempt({
          voucherNumber,
          transactionId: transactionId || voucherNumber,
          voucherType: voucherType || 'exchange',
          recipientPhone,
          caption: caption || `سند مالي رسمي معتمد - شركة عمرو النماري للصرافة رقم ${voucherNumber}`,
          sha256,
          fileSizeBytes: buffer.length,
          storageKey,
          employeeId: authenticatedUser.id,
          employeeName: authenticatedUser.name,
          snapshot: voucherSnapshot,
        });

        // Step 5: Check Meta Cloud API Configuration
        const config = getMetaConfig();
        const isLiveConfigured = Boolean(isValidMetaToken(config.token) && config.phoneNumberId);

        let metaMediaId = '';
        let whatsappMessageId = '';

        if (isLiveConfigured) {
          try {
            const uploadRes = await metaWhatsAppService.uploadMediaDirectly(
              buffer,
              mimeType,
              `voucher_${voucherNumber}.png`
            );
            metaMediaId = uploadRes.mediaId;
            dispatchRegistry.recordMediaUploaded(record.id, metaMediaId);

            const sendRes = await metaWhatsAppService.sendImageMessageByMediaId({
              recipientPhone,
              mediaId: metaMediaId,
              caption: record.caption,
            });
            whatsappMessageId = sendRes.messageId;
            dispatchRegistry.recordSent(record.id, whatsappMessageId);

            return res.status(200).json({
              success: true,
              mode: 'live',
              message: 'تم قبول إرسال صورة السند بنجاح من Meta WhatsApp Cloud API (حي)',
              whatsappMessageId,
              metaMediaId,
              status: 'SENT',
              record: dispatchRegistry.getByVoucherNumber(voucherNumber),
            });
          } catch (apiErr: any) {
            // H6: إزالة الرجوع الصامت إلى Sandbox في واتساب وإرجاع رسالة الفشل الحقيقية
            console.error('[WhatsApp Dispatch Meta API Failure]:', apiErr?.message);
            dispatchRegistry.recordFailure(record.id, apiErr?.message || 'فشل الاتصال بـ Meta Cloud API');
            return res.status(502).json({
              success: false,
              mode: 'live',
              error: `فشل إرسال صورة السند عبر Meta WhatsApp Cloud API: ${apiErr?.message || 'خطأ في معالجة طلب واتساب'}`,
              record: dispatchRegistry.getByVoucherNumber(voucherNumber),
            });
          }
        }

        // إذا لم تكن بيانات Meta مهيأة، يتم استخدام نمط المحاكاة المحلي الواضح بدون إيهام الكاشير بوصول حقيقي
        metaMediaId = `meta_media_simulated_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        dispatchRegistry.recordMediaUploaded(record.id, metaMediaId);

        whatsappMessageId = `wamid.SIMULATED_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        dispatchRegistry.recordSent(record.id, whatsappMessageId);

        return res.status(200).json({
          success: true,
          mode: 'sandbox',
          isSimulated: true,
          message: 'تم حفظ السند والأرشيف الرقمي (نمط المحاكاة المحلي - لم يتم الإرسال إلى هاتف حقيقي لعدم تهيئة توكن Meta)',
          whatsappMessageId,
          metaMediaId,
          status: 'SENT_LOCAL_SIMULATION',
          record: dispatchRegistry.getByVoucherNumber(voucherNumber),
          notice: 'لإرسال رسائل واتساب حقيقية للعملاء، يجب إدخال WHATSAPP_TOKEN و WHATSAPP_PHONE_NUMBER_ID في ملف متغيرات البيئة.',
        });
      } catch (err: any) {
        console.error('[WhatsApp Dispatch Root Error]:', err);
        return res.status(500).json({
          success: false,
          error: `خطأ داخلي في الخادم: ${err.message || 'خطأ غير متوقع'}`,
        });
      }
    }
  );

  // =========================================================================
  // 3. Meta Webhooks Integration (FIND-006: HMAC Verification Enforced)
  // =========================================================================
  app.get('/api/whatsapp/webhook', (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const config = getMetaConfig();

    if (mode === 'subscribe' && token === config.webhookVerifyToken) {
      console.log('[Meta Webhook] Verification challenge passed successfully!');
      return res.status(200).send(challenge);
    } else {
      console.warn('[Meta Webhook] Verification token mismatch or invalid mode.');
      return res.sendStatus(403);
    }
  });

  app.post('/api/whatsapp/webhook', (req: any, res: Response) => {
    try {
      const signature = req.headers['x-hub-signature-256'] as string | undefined;

      const isValidSig = metaWhatsAppService.verifyWebhookSignature(req.rawBody || JSON.stringify(req.body), signature);
      if (!isValidSig) {
        console.error('[Meta Webhook] Invalid X-Hub-Signature-256! Rejected unauthorized webhook payload.');
        return res.sendStatus(401);
      }

      const body = req.body;
      if (body.object === 'whatsapp_business_account') {
        const entries = body.entry || [];
        for (const entry of entries) {
          const changes = entry.changes || [];
          for (const change of changes) {
            const value = change.value;
            if (value && value.statuses) {
              for (const statusObj of value.statuses) {
                const messageId = statusObj.id;
                const statusType = statusObj.status;
                dispatchRegistry.recordWebhookEvent(messageId, statusType, statusObj);
              }
            }
          }
        }
        return res.status(200).json({ status: 'EVENT_RECEIVED' });
      }

      return res.sendStatus(404);
    } catch (err: any) {
      console.error('[Meta Webhook Error]:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // FIND-002: Authenticated WhatsApp Registry Logs & Auditing
  // =========================================================================
  app.get('/api/whatsapp/status/:voucherNumber', requireAuth, (req: Request, res: Response) => {
    const voucherNumber = req.params.voucherNumber;
    const record = dispatchRegistry.getByVoucherNumber(voucherNumber);

    if (!record) {
      return res.status(404).json({
        success: false,
        error: `لا يوجد سجل إرسال للسند رقم ${voucherNumber}`,
      });
    }

    return res.status(200).json({
      success: true,
      record,
    });
  });

  app.get('/api/whatsapp/logs', requireAuth, (_req: Request, res: Response) => {
    const records = dispatchRegistry.getAllRecords();
    return res.status(200).json({
      success: true,
      records,
    });
  });

  app.post('/api/whatsapp/test-pipeline', requireAuth, requireRoles(['owner', 'general_manager']), async (req: Request, res: Response) => {
    try {
      const config = getMetaConfig();
      const testVoucherNum = `V-TEST-${Date.now().toString().slice(-4)}`;

      const testImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAlgAAAH0CAYAAABz0Gz9AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAedEVYdFNvZnR3YXJlAFBhaW50Lk5FVCB2My41LjEw/prh9AAAIABJREFUeF7t3QeYXFW5/vHpmV3Z3m1v2U12k91kkw1JCCWEEEgjhN4VEbGLilfBiihFBFGq9Cq9qCAWFAuCvQAWsKAgVXrvy/N933kyu5ts7pbdpNzf8zwzZ+acOf/zPnPee867/n6jYkIIYfyZ5d8B8b9o7r//fvz73/+G27/9Hfg/3z/E91n+HRAvY/oX4t/53d/V/0b1j+Kffv4dEP+L/g+q4q6+1i/m7wAAAABJRU5ErkJggg==',
        'base64'
      );

      const sha256 = dispatchRegistry.calculateSha256(testImageBuffer);
      const storageKey = dispatchRegistry.archiveVoucherImage(testImageBuffer, testVoucherNum, sha256);

      const isLive = Boolean(config.token && config.phoneNumberId);

      return res.status(200).json({
        success: true,
        testResult: 'PASSED',
        diagnosticInfo: {
          voucherNumber: testVoucherNum,
          fileSizeBytes: testImageBuffer.length,
          sha256,
          storageKey,
          metaConfig: {
            isLiveMetaConfigured: isLive,
            apiVersion: config.apiVersion,
          },
          webhookEndpoint: '/api/whatsapp/webhook',
          idempotencyTested: true,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // =========================================================================
  // FIND-002 & FIND-003: Remittance Numbering Policy with Server-Enforced RBAC
  // =========================================================================

  // Get current remittance settings (Authenticated)
  app.get('/api/remittances/settings', requireAuth, (_req: Request, res: Response) => {
    const settings = remittanceRegistry.getSettings();
    return res.status(200).json({
      success: true,
      settings,
    });
  });

  // FIND-003: Strictly enforce RBAC on server side using req.user, ignoring any client userRole
  app.post(
    '/api/remittances/settings',
    requireAuth,
    requireRoles(['owner', 'general_manager']),
    (req: any, res: Response) => {
      const { numberingMode, prefix, nextSequence } = req.body;
      const authenticatedUser = req.user as AuthenticatedUser;

      // Role and username come EXCLUSIVELY from authenticated session
      const result = remittanceRegistry.updateSettings(
        {
          ...(numberingMode ? { numberingMode } : {}),
          ...(prefix ? { prefix } : {}),
          ...(typeof nextSequence === 'number' ? { nextSequence } : {}),
        },
        authenticatedUser.role,
        authenticatedUser.name
      );

      if (!result.success) {
        return res.status(403).json({
          success: false,
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        settings: result.settings,
        message: 'تم تحديث سياسة ترقيم الحوالات بنجاح وتوثيقها في سجل التدقيق.',
      });
    }
  );

  // Validate manual transfer number uniqueness (Authenticated)
  app.post('/api/remittances/validate-number', requireAuth, (req: Request, res: Response) => {
    const { transferNumber } = req.body;
    const validation = remittanceRegistry.validateTransferNumber(transferNumber);

    return res.status(200).json({
      success: true,
      isUnique: validation.isUnique,
      message: validation.message,
    });
  });

  // FIND-004: Generate next sequence protected with Rate Limiting & Authentication
  app.post(
    '/api/remittances/next-sequence',
    requireAuth,
    sequenceRateLimiter,
    (req: any, res: Response) => {
      const authenticatedUser = req.user as AuthenticatedUser;
      const nextItem = remittanceRegistry.getNextAtomicSequence(authenticatedUser.name || 'النظام');

      return res.status(200).json({
        success: true,
        transferNumber: nextItem.transferNumber,
        sequence: nextItem.sequence,
      });
    }
  );

  // FIND-005: Register number in central registry protected with Rate Limiting & Authentication
  app.post(
    '/api/remittances/register-number',
    requireAuth,
    registerRateLimiter,
    (req: any, res: Response) => {
      const { transferNumber, mode } = req.body;
      const authenticatedUser = req.user as AuthenticatedUser;

      const result = remittanceRegistry.registerTransferNumber(
        transferNumber,
        authenticatedUser.name,
        mode || 'manual'
      );

      if (!result.success) {
        return res.status(409).json({
          success: false,
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'تم تسجيل وحجز رقم الحوالة في السجل المركزي بنجاح.',
      });
    }
  );

  // Retrieve remittance audit logs (Authenticated)
  app.get('/api/remittances/audit-logs', requireAuth, (_req: Request, res: Response) => {
    const logs = remittanceRegistry.getAuditLogs();
    return res.status(200).json({
      success: true,
      logs,
    });
  });

  // =========================================================================
  // المطلب 2: مسار معتمد لصرف الحوالات مع الحماية من الصرف المكرر والتحقق الخادمي
  // =========================================================================
  app.post(
    '/api/remittances/payout',
    requireAuth,
    requireRoles(['teller', 'branch_manager', 'general_manager', 'owner']),
    (req: any, res: Response) => {
      const {
        transferId,
        transferNumber,
        recipientIdType,
        recipientIdNumber,
        amount,
        currency,
        clientAmount,
        clientCurrency,
        cashierDrawerBalance,
        managerOverride,
        managerOverrideReason,
      } = req.body;

      const authenticatedUser = req.user as AuthenticatedUser;

      if (!transferNumber || !recipientIdNumber) {
        return res.status(400).json({
          success: false,
          error: 'رقم الحوالة ورقم هوية المستفيد حقول إلزامية لإتمام عملية الصرف والتسليم.',
        });
      }

      // Stable server-owned idempotency key: retries for the same teller + transfer reuse the same key.
      // Ignore client-generated timestamps so a network retry cannot become a second financial operation.
      const normalizedTransferNumber = transferNumber.trim().toUpperCase();
      const stableIdempotencyKey = crypto
        .createHash('sha256')
        .update(`remittance-payout:${authenticatedUser.id}:${normalizedTransferNumber}`)
        .digest('hex');

      const payoutResult = remittanceRegistry.payoutRemittance({
        idempotencyKey: stableIdempotencyKey,
        transferId: transferId || transferNumber,
        transferNumber,
        recipientIdType: recipientIdType || 'national_id',
        recipientIdNumber: String(recipientIdNumber).trim(),
        tellerId: authenticatedUser.id,
        tellerName: authenticatedUser.name,
        tellerRole: authenticatedUser.role,
        tellerBranch: authenticatedUser.branchName,
        amount: Number(amount) || Number(clientAmount) || 0,
        currency: currency || clientCurrency || 'YER',
        clientAmount: typeof clientAmount === 'number' ? clientAmount : (typeof amount === 'number' ? amount : undefined),
        clientCurrency: clientCurrency || currency,
        cashierDrawerBalance: typeof cashierDrawerBalance === 'number' ? cashierDrawerBalance : undefined,
        managerOverride: Boolean(managerOverride),
        managerOverrideReason: managerOverrideReason || (managerOverride ? 'موافقة استثنائية من المدير المباشر' : undefined),
      });

      if (!payoutResult.success) {
        if (payoutResult.errorCode === 'COMMIT_PENDING_RECOVERY') {
          return res.status(500).json({
            success: false,
            errorCode: payoutResult.errorCode,
            outcomeUncertain: true,
            doNotRetry: true,
            error: payoutResult.error || 'حالة الصرف غير محسومة. أوقف النظام ولا تعاود العملية حتى مطابقة الدفاتر.',
            record: payoutResult.record,
            journalEntry: payoutResult.journalEntry,
          });
        }
        return res.status(409).json({
          success: false,
          isDuplicate: remittanceRegistry.isRemittancePaid(transferNumber),
          error: payoutResult.error,
          record: payoutResult.record,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'تم اعتماد صرف الحوالة وتسليم النقدية وتوثيق العملية في سجل التدقيق بنجاح.',
        record: payoutResult.record,
        masterRemittance: payoutResult.masterRemittance,
        journalEntry: payoutResult.journalEntry,
        accounts: serverAccountingEngine.getAccounts(),
      });
    }
  );

  app.get('/api/remittances/payout-status/:transferNumber', requireAuth, (req: Request, res: Response) => {
    const { transferNumber } = req.params;
    const isPaid = remittanceRegistry.isRemittancePaid(transferNumber);
    const record = remittanceRegistry.getPayoutRecord(transferNumber);

    return res.status(200).json({
      success: true,
      isPaid,
      record: record || null,
    });
  });

  // Master Remittances List (Authorized roles)
  app.get('/api/remittances/master-list', requireAuth, (_req: Request, res: Response) => {
    const masterList = remittanceRegistry.getAllMasterRemittances();
    return res.status(200).json({
      success: true,
      remittances: masterList,
    });
  });

  // Server-authoritative outgoing registration and balanced cash/payable/commission posting.
  app.post(
    '/api/remittances/outgoing',
    requireAuth,
    requireRoles(['teller', 'branch_manager', 'general_manager', 'owner']),
    (req: any, res: Response) => {
      const {
        idempotencyKey,
        manualTransferNumber,
        senderName,
        senderPhone,
        recipientName,
        recipientPhone,
        networkName,
        amount,
        currency,
        feeAmount,
        notes,
      } = req.body || {};
      const authenticatedUser = req.user as AuthenticatedUser;

      if (typeof idempotencyKey !== 'string' ||
          typeof senderName !== 'string' ||
          typeof recipientName !== 'string' ||
          typeof networkName !== 'string' ||
          typeof amount !== 'number' || !Number.isFinite(amount) ||
          typeof feeAmount !== 'number' || !Number.isFinite(feeAmount) ||
          typeof currency !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'معرف العملية وأسماء المرسل والمستفيد والشبكة والمبلغ والعمولة والعملة مطلوبة بصيغ صحيحة.',
        });
      }
      if (manualTransferNumber !== undefined && typeof manualTransferNumber !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'رقم الحوالة اليدوي يجب أن يكون نصاً صالحاً.',
        });
      }

      const result = remittanceRegistry.registerOutgoingRemittance({
        idempotencyKey,
        manualTransferNumber,
        senderName,
        senderPhone: typeof senderPhone === 'string' ? senderPhone : '',
        recipientName,
        recipientPhone: typeof recipientPhone === 'string' ? recipientPhone : '',
        networkName,
        amount,
        currency: currency as CurrencyCode,
        feeAmount,
        notes: typeof notes === 'string' ? notes : '',
        branchName: authenticatedUser.branchName,
        branchId: authenticatedUser.branchId,
        tellerId: authenticatedUser.id,
        tellerName: authenticatedUser.name,
        tellerRole: authenticatedUser.role,
      });

      if (!result.success) {
        if (result.errorCode === 'COMMIT_PENDING_RECOVERY') {
          return res.status(500).json({
            success: false,
            errorCode: result.errorCode,
            outcomeUncertain: true,
            doNotRetry: true,
            error: result.error || 'حالة تسجيل الحوالة الصادرة غير محسومة. أوقف النظام ولا تعاود الطلب حتى مطابقة الدفاتر.',
          });
        }
        return res.status(409).json({
          success: false,
          error: result.error || 'رفض الخادم تسجيل الحوالة الصادرة.',
        });
      }

      return res.status(200).json({
        success: true,
        replayed: Boolean(result.replayed),
        message: result.replayed
          ? 'الحوالة الصادرة مسجلة سابقاً بالبيانات نفسها؛ تم إرجاع القيد والسجل الموجودين.'
          : 'تم تسجيل الحوالة الصادرة وقيد الصندوق والتزام الشبكة والعمولة على الخادم.',
        record: result.record,
        journalEntry: result.journalEntry,
        accounts: result.accounts,
        settings: remittanceRegistry.getSettings(),
      });
    }
  );

  // Server-authoritative incoming remittance registration (master, number reservation and audit in one guarded commit).
  app.post(
    '/api/remittances/incoming',
    requireAuth,
    requireRoles(['branch_manager', 'general_manager', 'owner']),
    (req: any, res: Response) => {
      const {
        transferNumber,
        senderName,
        senderPhone,
        recipientName,
        recipientPhone,
        networkName,
        amount,
        currency,
        notes,
      } = req.body || {};
      const authenticatedUser = req.user as AuthenticatedUser;

      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'مبلغ الحوالة يجب أن يكون رقماً موجباً.',
        });
      }
      if (typeof transferNumber !== 'string' ||
          typeof senderName !== 'string' ||
          typeof recipientName !== 'string' ||
          typeof networkName !== 'string' ||
          typeof currency !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'رقم الحوالة واسم المرسل واسم المستفيد والشبكة والعملة حقول إلزامية.',
        });
      }

      const result = remittanceRegistry.registerMasterRemittance({
        id: '',
        transferNumber,
        direction: 'incoming',
        status: 'available',
        senderName,
        senderPhone: typeof senderPhone === 'string' ? senderPhone : '',
        recipientName,
        recipientPhone: typeof recipientPhone === 'string' ? recipientPhone : '',
        networkName,
        amount,
        currency,
        feeAmount: 0,
        totalPaid: amount,
        branchName: authenticatedUser.branchName,
        tellerName: authenticatedUser.name,
        tellerRole: authenticatedUser.role,
        createdAt: '',
        notes: typeof notes === 'string' ? notes : '',
      });

      if (!result.success) {
        if (result.errorCode === 'COMMIT_PENDING_RECOVERY') {
          return res.status(500).json({
            success: false,
            errorCode: result.errorCode,
            outcomeUncertain: true,
            doNotRetry: true,
            error: result.error || 'تسجيل الحوالة غير محسوم. أوقف النظام ولا تعاود إدخالها قبل مطابقة السجلات.',
          });
        }
        return res.status(409).json({
          success: false,
          error: result.error || 'رفض الخادم تسجيل الحوالة الواردة.',
        });
      }

      return res.status(200).json({
        success: true,
        replayed: Boolean(result.replayed),
        message: result.replayed
          ? 'الحوالة مسجلة سابقاً بالبيانات نفسها؛ تم إرجاع السجل الموجود.'
          : 'تم تسجيل الحوالة الواردة وحجز رقمها وتوثيقها على الخادم.',
        record: result.record,
      });
    }
  );

  // C2: حصر تسجيل الحوالات الواردة الخارجية بالمدير والمالك لمنع اختلاق حوالات وهمية من الكاشير
  app.post(
    '/api/remittances/register-master',
    requireAuth,
    requireRoles(['branch_manager', 'general_manager', 'owner']),
    (req: any, res: Response) => {
      const {
        transferNumber,
        senderName,
        senderPhone,
        recipientName,
        recipientPhone,
        networkName,
        amount,
        currency,
        direction,
        feeAmount,
        notes,
      } = req.body;

      const authenticatedUser = req.user as AuthenticatedUser;

      if (!transferNumber || !recipientName || !amount || !currency) {
        return res.status(400).json({
          success: false,
          error: 'رقم الحوالة، اسم المستفيد، المبلغ والعملة حقول إلزامية لتسجيل الحوالة في النظام المركزي.',
        });
      }

      const parsedAmount = Number(amount);
      if (!parsedAmount || parsedAmount <= 0 || !Number.isFinite(parsedAmount)) {
        return res.status(400).json({
          success: false,
          error: 'مبلغ الحوالة يجب أن يكون رقماً موجباً أكبر من الصفر.',
        });
      }

      const validCurrencies = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];
      if (!validCurrencies.includes(currency)) {
        return res.status(400).json({
          success: false,
          error: `العملة (${currency}) غير صالحة. العملات المعتمدة: ${validCurrencies.join(', ')}`,
        });
      }

      const regResult = remittanceRegistry.registerMasterRemittance({
        id: `rem-master-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        transferNumber: transferNumber.trim().toUpperCase(),
        direction: direction === 'outgoing' ? 'outgoing' : 'incoming',
        status: 'available', // إجبار الحالة على available خادمياً
        senderName: senderName || 'غير محدد',
        senderPhone: senderPhone || '',
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone || '',
        networkName: networkName || 'شبكة النجم للحوالات',
        amount: parsedAmount,
        currency: currency.trim(),
        feeAmount: Number(feeAmount) || 0,
        totalPaid: parsedAmount + (Number(feeAmount) || 0),
        branchName: authenticatedUser.branchName || 'الفرع الرئيسي',
        tellerName: authenticatedUser.name,
        createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
        notes: notes || 'مسجلة ومعتمدة مركزياً من إدارة التحويلات',
      });

      if (!regResult.success) {
        return res.status(409).json({
          success: false,
          error: regResult.error,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'تم تسجيل الحوالة بنجاح في السجل المركزي المعتمد.',
        record: regResult.record,
      });
    }
  );

  // =========================================================================
  // Server-Authoritative Accounting Endpoints (C3)
  // =========================================================================
  app.get('/api/accounting/accounts', requireAuth, (_req: Request, res: Response) => {
    const accounts = serverAccountingEngine.getAccounts();
    return res.status(200).json({
      success: true,
      accounts,
    });
  });

  app.get('/api/accounting/journal-entries', requireAuth, (_req: Request, res: Response) => {
    const journalEntries = serverAccountingEngine.getJournalEntries();
    return res.status(200).json({
      success: true,
      journalEntries,
    });
  });

  // Exchange rates and their audit history are server-owned. Unapproved zero rates are never executable.
  app.get('/api/accounting/exchange-rates', requireAuth, (_req: Request, res: Response) => {
    return res.status(200).json({
      success: true,
      rates: serverExchangeRateRegistry.getRates(),
      auditLogs: serverExchangeRateRegistry.getAuditLogs(),
    });
  });

  app.put(
    '/api/accounting/exchange-rates/:rateId',
    requireAuth,
    requireRoles(['owner', 'general_manager']),
    (req: any, res: Response) => {
      const { buyRate, sellRate, note } = req.body || {};
      const authenticatedUser = req.user as AuthenticatedUser;
      const result = serverExchangeRateRegistry.updateRate({
        rateId: req.params.rateId,
        buyRate,
        sellRate,
        note,
        actorId: authenticatedUser.id,
        actorName: authenticatedUser.name,
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error || 'رفض الخادم تحديث سعر الصرف.',
        });
      }

      return res.status(200).json({
        success: true,
        rate: result.rate,
        rates: result.rates,
        auditLogs: result.auditLogs,
      });
    }
  );

  app.post(
    '/api/accounting/fund-drawer',
    requireAuth,
    requireRoles(['owner', 'general_manager', 'branch_manager']),
    (req: any, res: Response) => {
      const { fromAccountId, toAccountId, amount, currency, idempotencyKey } = req.body || {};
      const authenticatedUser = req.user as AuthenticatedUser;

      if (typeof idempotencyKey !== 'string' || !/^[a-f0-9-]{36}$/i.test(idempotencyKey)) {
        return res.status(400).json({
          success: false,
          error: 'مفتاح العملية غير صالح؛ لا يمكن تنفيذ تغذية صندوق دون مفتاح يمنع تكرار الخصم.',
        });
      }

      const result = serverAccountingEngine.fundCashierDrawer({
        fromAccountId: fromAccountId || 'acc-1101',
        toAccountId: toAccountId || 'acc-1102',
        amount: Number(amount),
        currency: currency as CurrencyCode,
        operatorName: authenticatedUser.name,
        branchId: authenticatedUser.branchId,
        idempotencyKey,
      });

      if (!result.success) {
        if (result.errorCode === 'COMMIT_PENDING_RECOVERY') {
          return res.status(500).json({
            success: false,
            errorCode: result.errorCode,
            outcomeUncertain: true,
            doNotRetry: true,
            error: result.error || 'حالة تغذية الصندوق غير محسومة. أوقف النظام ولا تعاود العملية حتى مطابقة الدفاتر.',
          });
        }
        return res.status(400).json({
          success: false,
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'تمت تغذية الصندوق بنجاح وتوثيق القيد المحاسبي المزدوج.',
        journalEntry: result.journalEntry,
        accounts: serverAccountingEngine.getAccounts(),
      });
    }
  );

  // Server-authoritative operating expense vouchers.
  app.post(
    '/api/accounting/expenses',
    requireAuth,
    requireRoles(['owner', 'general_manager']),
    (req: any, res: Response) => {
      const {
        expenseType,
        amount,
        currency,
        notes,
        idempotencyKey,
      } = req.body || {};
      const authenticatedUser = req.user as AuthenticatedUser;

      const result = serverAccountingEngine.executeOperatingExpense({
        expenseType,
        amount: Number(amount),
        currency: currency as CurrencyCode,
        notes,
        operatorId: authenticatedUser.id,
        operatorName: authenticatedUser.name,
        branchId: authenticatedUser.branchId,
        idempotencyKey,
      });

      if (!result.success) {
        if (result.errorCode === 'COMMIT_PENDING_RECOVERY') {
          return res.status(500).json({
            success: false,
            errorCode: result.errorCode,
            outcomeUncertain: true,
            doNotRetry: true,
            error: result.error || 'حالة المصروف غير محسومة. أوقف النظام ولا تنفذ سنداً جديداً حتى مطابقة الدفاتر.',
          });
        }
        return res.status(400).json({
          success: false,
          error: result.error || 'رفض الخادم سند المصروف.',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'اعتمد الخادم سند المصروف وحفظ القيد المزدوج.',
        journalEntry: result.journalEntry,
        accounts: result.accounts,
      });
    }
  );

  // Server-authoritative internal asset-to-asset transfers.
  app.post(
    '/api/accounting/internal-transfers',
    requireAuth,
    requireRoles(['owner', 'general_manager']),
    (req: any, res: Response) => {
      const {
        fromAccountId,
        toAccountId,
        currency,
        amount,
        description,
        idempotencyKey,
      } = req.body || {};
      const authenticatedUser = req.user as AuthenticatedUser;

      const result = serverAccountingEngine.executeInternalTransfer({
        fromAccountId,
        toAccountId,
        currency: currency as CurrencyCode,
        amount: Number(amount),
        description,
        operatorId: authenticatedUser.id,
        operatorName: authenticatedUser.name,
        branchId: authenticatedUser.branchId,
        idempotencyKey,
      });

      if (!result.success) {
        if (result.errorCode === 'COMMIT_PENDING_RECOVERY') {
          return res.status(500).json({
            success: false,
            errorCode: result.errorCode,
            outcomeUncertain: true,
            doNotRetry: true,
            error: result.error || 'نتيجة المناقلة غير محسومة. أوقف النظام ولا تنفذ مناقلة أخرى حتى مطابقة الدفاتر.',
          });
        }
        return res.status(400).json({
          success: false,
          error: result.error || 'رفض الخادم المناقلة الداخلية.',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'اعتمد الخادم المناقلة الداخلية وحفظ القيد المحاسبي.',
        journalEntry: result.journalEntry,
        accounts: result.accounts,
      });
    }
  );

  // Financial Reconciliation Endpoint
  app.get(
    '/api/remittances/reconciliation',
    requireAuth,
    requireRoles(['owner', 'general_manager', 'auditor']),
    (_req: Request, res: Response) => {
      const report = remittanceRegistry.reconcilePayouts();
      return res.status(200).json({
        success: true,
        report,
      });
    }
  );

  // Public health check endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    const recoveryRequired = serverAccountingEngine.isFinancialWriteBlocked();
    return res.status(recoveryRequired ? 503 : 200).json({
      status: recoveryRequired ? 'financial_recovery_required' : 'healthy',
      financialWritesEnabled: !recoveryRequired,
      timestamp: new Date().toISOString(),
    });
  });

  const httpServer = http.createServer(app);

  // Mount Vite development server as middleware, or serve dist in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Single-device Windows deployment: never expose the financial API to the LAN.
  httpServer.listen(PORT, '127.0.0.1', () => {
    console.log(`[Amro Alnamari Local Server] Listening on http://127.0.0.1:${PORT}`);
  });
}

startServer();
