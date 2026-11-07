/**
 * خدمة المصادقة والتحقق من الصلاحيات والحد من المعدل (Authentication, RBAC & Rate Limiting)
 * نظام عمرو النماري للصرافة والحسابات
 * معالجة نتائج التدقيق الأمني FIND-001, FIND-002, FIND-003, FIND-004, FIND-005, FIND-010
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

export interface AuthenticatedUser {
  id: string;
  name: string;
  role: 'owner' | 'general_manager' | 'branch_manager' | 'teller' | 'auditor' | 'accountant' | 'compliance_officer';
  username: string;
  branchId: string;
  branchName: string;
}

export interface SecurityAuditEntry {
  id: string;
  timestamp: string;
  event: 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'ROLE_ACCESS_DENIED' | 'RATE_LIMIT_EXCEEDED' | 'BRUTE_FORCE_BLOCKED';
  usernameOrRole: string;
  ip: string;
  details: string;
}

// 5. جعل "JWT_SECRET" إلزامياً في الإنتاج، وإيقاف تشغيل الخادم إذا لم يكن مضبوطاً
function getJwtSecret(): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const secret = process.env.JWT_SECRET || process.env.APP_SECRET;

  if (isProduction) {
    if (!secret || secret.trim().length < 32 || secret === 'alnamari_secure_hmac_secret_2026_finance_erp') {
      const errMsg = 'FATAL SECURITY ERROR: JWT_SECRET environment variable is strictly required in production mode and must be at least 32 characters long.';
      console.error(errMsg);
      throw new Error(errMsg);
    }
    return secret;
  }

  // Development safe fallback
  return secret || 'alnamari_secure_hmac_secret_2026_finance_erp_dev_mode';
}

const JWT_SECRET = getJwtSecret();

/**
 * دالة تجزئة آمنة للمرور/PIN باستخدام PBKDF2 مع Salt فريد
 */
export function hashPinWithSalt(pin: string, salt: string): string {
  return crypto.pbkdf2Sync(pin.trim(), salt, 100000, 32, 'sha256').toString('hex');
}

/**
 * فحص الرمز السري بطريقة آمنة ومقاومة لهجمات التوقيت (Timing-Attack Resistant)
 */
export function verifyPinHash(providedPin: string, salt: string, expectedHash: string): boolean {
  if (!providedPin || typeof providedPin !== 'string') return false;
  const calculatedHash = hashPinWithSalt(providedPin, salt);
  const calcBuf = Buffer.from(calculatedHash, 'hex');
  const expBuf = Buffer.from(expectedHash, 'hex');

  // فحص طول البافر أولاً قبل المقارنة الآمنة لمنع استثناءات Node.js
  if (calcBuf.length !== expBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(calcBuf, expBuf);
}

// 4. تخزين كلمات المرور أو PIN باستخدام خوارزمية تجزئة آمنة مناسبة، مع عدم تخزينها كنص صريح
export const SYSTEM_USERS: Record<
  string,
  AuthenticatedUser & { pinSalt: string; pinHash: string }
> = {
  owner: {
    id: 'usr-001',
    name: 'عمرو النماري',
    username: 'amro',
    role: 'owner',
    pinSalt: 'alnamari_salt_owner_98a7',
    pinHash: '8c53f2d46ded4306597592bce8e0147ee613bdfd5eba04bbd9bac8edeeaae231',
    branchId: 'br-main',
    branchName: 'المركز الرئيسي - تعز',
  },
  general_manager: {
    id: 'usr-002',
    name: 'عبد الله الصبري',
    username: 'abdullah',
    role: 'general_manager',
    pinSalt: 'alnamari_salt_gm_72b1',
    pinHash: 'dfd7647d28dc70c4c828b130055c88e4935f06609e9d19d8a86d9a1dcaa7044f',
    branchId: 'br-main',
    branchName: 'المركز الرئيسي - تعز',
  },
  branch_manager: {
    id: 'usr-006',
    name: 'منصور الحمادي',
    username: 'mansoor',
    role: 'branch_manager',
    pinSalt: 'alnamari_salt_bm_34c5',
    pinHash: 'eeaa05aaf419a15f72ee8ac82b4df567df31d28ac34e9e0e0099e02f7beb7d47',
    branchId: 'br-khadeer',
    branchName: 'فرع دمنة خدير - تعز',
  },
  teller: {
    id: 'usr-003',
    name: 'صديق علي الفتاحي',
    username: 'sedeek',
    role: 'teller',
    pinSalt: 'alnamari_salt_teller_65d9',
    pinHash: 'c34e4ae00d705812236682b17ad9d9484865d5ceefa7ecfc0344d92c81e5d306',
    branchId: 'br-khadeer',
    branchName: 'فرع خدير - الكاشير المعتمد',
  },
  auditor: {
    id: 'usr-007',
    name: 'ماجد مدقق الرقابة',
    username: 'majed',
    role: 'auditor',
    pinSalt: 'alnamari_salt_auditor_81e2',
    pinHash: '113b0e14db870187c876a89c48db45d15d7db778a50fa637f6feb4daf48d04b7',
    branchId: 'br-main',
    branchName: 'إدارة المراجعة والتدقيق المالي الداخلي',
  },
  accountant: {
    id: 'usr-004',
    name: 'محمد المحاسب المالي',
    username: 'mohammed',
    role: 'accountant',
    pinSalt: 'alnamari_salt_accountant_12f8',
    pinHash: '8096c5b5cebb98a812052f7c0b5dc4f84152b34e80022107fa59fc0020eb467b',
    branchId: 'br-main',
    branchName: 'الإدارة المالية - تعز',
  },
  compliance_officer: {
    id: 'usr-005',
    name: 'أحمد مسؤول الامتثال',
    username: 'compliance',
    role: 'compliance_officer',
    pinSalt: 'alnamari_salt_compliance_49a3',
    pinHash: '055443d6518ea137ea3061f573d06dfd789e8739c9ed839437d15ae712da1ae9',
    branchId: 'br-main',
    branchName: 'إدارة الامتثال ومكافحة غسل الأموال',
  },
};

export interface AuthTokenPayload {
  userId: string;
  name: string;
  role: AuthenticatedUser['role'];
  username: string;
  branchId: string;
  branchName: string;
  exp: number; // Unix timestamp
  iat: number;
}

// 8. إضافة تحديد لمحاولات تسجيل الدخول الخاطئة لمنع هجمات التخمين Brute-Force
interface FailedLoginRecord {
  attempts: number;
  lockUntil: number;
}

export class AuthService {
  private failedLogins: Map<string, FailedLoginRecord> = new Map();
  private securityLogs: SecurityAuditEntry[] = [];

  /**
   * إنشاء توكن موقّع مشفر عبر HMAC-SHA256 (صالحة لمدة 24 ساعة)
   */
  public generateToken(user: AuthenticatedUser, expiresInHours = 24): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: AuthTokenPayload = {
      userId: user.id,
      name: user.name,
      role: user.role,
      username: user.username,
      branchId: user.branchId,
      branchName: user.branchName,
      iat: now,
      exp: now + expiresInHours * 3600,
    };

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${data}`)
      .digest('base64url');

    return `${header}.${data}.${signature}`;
  }

  /**
   * فحص وتأكيد صحة التوكن وتوقيع HMAC المشفر
   * 6. إصلاح التحقق من توقيع JWT، بما يشمل التحقق من طول التوقيع قبل المقارنة الآمنة.
   * 7. التحقق من انتهاء صلاحية التوكن وصحة بياناته.
   */
  public verifyToken(token: string): AuthTokenPayload | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, data, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${data}`)
      .digest('base64url');

    const sigBuf = Buffer.from(signature, 'utf-8');
    const expBuf = Buffer.from(expectedSig, 'utf-8');

    // التحقق من طول التوقيع أولاً لتجنب استثناء RangeError من Node.js
    if (sigBuf.length !== expBuf.length) {
      return null;
    }

    // Timing-safe comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    try {
      const payload: AuthTokenPayload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return null; // Expired
      }
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * مصادقة مستخدم بواسطة اسم المستخدم أو الدور مع التحقق الإلزامي من الـ PIN على الخادم
   * 12. تسجيل محاولات الدخول الفاشلة وعمليات تغيير الصلاحيات.
   */
  public authenticateUser(
    roleOrUsername: string,
    pin?: string,
    ip = '127.0.0.1'
  ): { success: boolean; token?: string; user?: AuthenticatedUser; error?: string; locked?: boolean } {
    const lockKey = `${roleOrUsername}:${ip}`;
    const now = Date.now();
    const failRecord = this.failedLogins.get(lockKey);

    // فحص القفل الزمني لمحاولات التخمين
    if (failRecord && failRecord.lockUntil > now) {
      const remainingSec = Math.ceil((failRecord.lockUntil - now) / 1000);
      this.recordSecurityEvent({
        event: 'BRUTE_FORCE_BLOCKED',
        usernameOrRole: roleOrUsername,
        ip,
        details: `محاولة دخول خلال فترة الحظر المؤقت. متبقي ${remainingSec} ثانية.`,
      });
      return {
        success: false,
        locked: true,
        error: `تم حظر محاولات الدخول مؤقتاً لتجاوز الحد المسموح من الأخطاء. يرجى المحاولة بعد ${remainingSec} ثانية.`,
      };
    }

    const key = Object.keys(SYSTEM_USERS).find(
      (k) => k === roleOrUsername || SYSTEM_USERS[k].username === roleOrUsername
    );

    if (!key) {
      const isLocked = this.recordFailedAttempt(lockKey, roleOrUsername, ip, 'المستخدم غير مسجل في النظام');
      return {
        success: false,
        locked: isLocked,
        error: isLocked
          ? 'تم حظر محاولات الدخول مؤقتاً لتجاوز الحد المسموح من الأخطاء (5 محاولات). يرجى المحاولة بعد 5 دقائق.'
          : 'المستخدم أو الدور غير موجود في النظام المالي المعتمد',
      };
    }

    const user = SYSTEM_USERS[key];

    // التحقق الصارم من الـ PIN المشفر على الخادم لجميع المستخدمين لمنع التصعيد غير المصرح به
    if (!pin || !verifyPinHash(pin, user.pinSalt, user.pinHash)) {
      const isLocked = this.recordFailedAttempt(lockKey, roleOrUsername, ip, 'رمز PIN غير مطابق للتجزئة المعتمدة');
      return {
        success: false,
        locked: isLocked,
        error: isLocked
          ? 'تم حظر محاولات الدخول مؤقتاً لتجاوز الحد المسموح من الأخطاء (5 محاولات). يرجى المحاولة بعد 5 دقائق.'
          : 'بيانات الاعتماد أو الرمز السري غير صحيح',
      };
    }

    // النجاح: تصفير المحاولات الفاشلة
    this.failedLogins.delete(lockKey);
    const token = this.generateToken(user);

    this.recordSecurityEvent({
      event: 'LOGIN_SUCCESS',
      usernameOrRole: user.username,
      ip,
      details: `تم توثيق الدخول بنجاح بصلاحية [${user.role}] للمستخدم (${user.name}).`,
    });

    return { success: true, token, user };
  }

  private recordFailedAttempt(lockKey: string, usernameOrRole: string, ip: string, reason: string): boolean {
    const record = this.failedLogins.get(lockKey) || { attempts: 0, lockUntil: 0 };
    record.attempts += 1;
    let isLocked = false;

    // قفل الحساب لمدة 5 دقائق بعد 5 محاولات فاشلة
    if (record.attempts >= 5) {
      record.lockUntil = Date.now() + 5 * 60 * 1000;
      isLocked = true;
      console.warn(`[Security Alert] IP ${ip} / user ${usernameOrRole} locked for 5 minutes after 5 failed login attempts.`);
    }

    this.failedLogins.set(lockKey, record);

    this.recordSecurityEvent({
      event: 'LOGIN_FAILED',
      usernameOrRole,
      ip,
      details: `فشل تسجيل الدخول (${reason}). المحاولة ${record.attempts} من 5.`,
    });

    return isLocked;
  }

  public recordSecurityEvent(entry: Omit<SecurityAuditEntry, 'id' | 'timestamp'>) {
    const fullEntry: SecurityAuditEntry = {
      id: `sec-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.securityLogs.unshift(fullEntry);
    if (this.securityLogs.length > 500) {
      this.securityLogs.pop();
    }
  }

  public getSecurityLogs(): SecurityAuditEntry[] {
    return [...this.securityLogs];
  }
}

export const authService = new AuthService();

/**
 * وسيط فحص المصادقة (Express Authentication Middleware)
 */
export function requireAuth(req: Request & { user?: AuthenticatedUser }, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-api-token']) {
    token = String(req.headers['x-api-token']).trim();
  }

  if (!token) {
    authService.recordSecurityEvent({
      event: 'ROLE_ACCESS_DENIED',
      usernameOrRole: 'ANONYMOUS',
      ip: req.ip || 'unknown',
      details: `محاولة وصول غير مصرح للمسار ${req.path} بدون رمز مصادقة`,
    });
    return res.status(401).json({
      success: false,
      error: 'مرفوض: يتطلب الوصول إلى هذه النقطة رمز مصادقة صالح (Authorization Bearer Token)',
    });
  }

  const payload = authService.verifyToken(token);
  if (!payload) {
    authService.recordSecurityEvent({
      event: 'ROLE_ACCESS_DENIED',
      usernameOrRole: 'INVALID_TOKEN',
      ip: req.ip || 'unknown',
      details: `رمز مصادقة غير صالح أو منتهي الصلاحية للمسار ${req.path}`,
    });
    return res.status(401).json({
      success: false,
      error: 'مرفوض: رمز المصادقة غير صالح أو منتهي الصلاحية',
    });
  }

  req.user = {
    id: payload.userId,
    name: payload.name,
    role: payload.role,
    username: payload.username,
    branchId: payload.branchId,
    branchName: payload.branchName,
  };

  next();
}

/**
 * وسيط فحص الأدوار والصلاحيات (RBAC Authorization Middleware)
 */
export function requireRoles(allowedRoles: Array<AuthenticatedUser['role']>) {
  return (req: Request & { user?: AuthenticatedUser }, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'غير مصادق: يرجى تسجيل الدخول أولاً',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      authService.recordSecurityEvent({
        event: 'ROLE_ACCESS_DENIED',
        usernameOrRole: req.user.username,
        ip: req.ip || 'unknown',
        details: `محاولة تعدي على صلاحيات مقتصرة على [${allowedRoles.join(', ')}] بواسطة [${req.user.role}].`,
      });
      return res.status(403).json({
        success: false,
        error: `صلاحية غير كافية: هذا الإجراء مقتصر على الأدوار [${allowedRoles.join(', ')}]، بينما دورك الحالي هو [${req.user.role}]`,
      });
    }

    next();
  };
}

/**
 * وسيط منع استنزاف الموارد ومعدل الطلبات (In-Memory Sliding Window Rate Limiter)
 * حماية من هجمات DoS على ترقيم الحوالات (FIND-004, FIND-005, FIND-007)
 */
export function createRateLimiter(maxRequests: number, windowSeconds: number) {
  const requests = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = (req.ip || 'unknown-ip') + ':' + (req.path || '');
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    let timestamps = requests.get(key) || [];
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= maxRequests) {
      authService.recordSecurityEvent({
        event: 'RATE_LIMIT_EXCEEDED',
        usernameOrRole: (req as any).user?.username || 'ANONYMOUS',
        ip: req.ip || 'unknown',
        details: `تجاوز الحد المسموح (${maxRequests} طلب خلال ${windowSeconds} ثانية) على المسار ${req.path}`,
      });

      res.setHeader('Retry-After', windowSeconds);
      return res.status(429).json({
        success: false,
        error: `تم تجاوز الحد المسموح من الطلبات (${maxRequests} طلب خلال ${windowSeconds} ثانية). يرجى المحاولة لاحقاً.`,
      });
    }

    timestamps.push(now);
    requests.set(key, timestamps);

    if (requests.size > 2000) {
      for (const [k, v] of requests.entries()) {
        if (v.every((t) => t <= windowStart)) {
          requests.delete(k);
        }
      }
    }

    next();
  };
}
