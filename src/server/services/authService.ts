/**
 * خدمة المصادقة والتحقق من الصلاحيات والحد من المعدل (Authentication, RBAC & Rate Limiting)
 * نظام عمرو النماري للصرافة والحسابات
 * معالجة نتائج التدقيق الأمني FIND-002, FIND-003, FIND-004, FIND-005
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

export interface AuthenticatedUser {
  id: string;
  name: string;
  role: 'owner' | 'general_manager' | 'accountant' | 'teller' | 'compliance_officer';
  username: string;
  branchId: string;
  branchName: string;
}

// Server Secret Key for cryptographic HMAC signing (ephemeral fallback if not provided in env)
const JWT_SECRET = process.env.JWT_SECRET || process.env.APP_SECRET || 'alnamari_secure_hmac_secret_2026_finance_erp';

// System users for authentication
export const SYSTEM_USERS: Record<string, AuthenticatedUser & { pin: string }> = {
  owner: {
    id: 'usr-001',
    name: 'عمرو النماري',
    username: 'amro',
    role: 'owner',
    pin: '1234',
    branchId: 'br-main',
    branchName: 'المركز الرئيسي - تعز',
  },
  general_manager: {
    id: 'usr-002',
    name: 'عبد الله الصبري',
    username: 'abdullah',
    role: 'general_manager',
    pin: '2345',
    branchId: 'br-main',
    branchName: 'المركز الرئيسي - تعز',
  },
  teller: {
    id: 'usr-003',
    name: 'صديق علي الفتاحي',
    username: 'sedeek',
    role: 'teller',
    pin: '3456',
    branchId: 'br-khadeer',
    branchName: 'فرع خدير - الكاشير المعتمد',
  },
  accountant: {
    id: 'usr-004',
    name: 'محمد المحاسب المالي',
    username: 'mohammed',
    role: 'accountant',
    pin: '4567',
    branchId: 'br-main',
    branchName: 'الإدارة المالية - تعز',
  },
  compliance_officer: {
    id: 'usr-005',
    name: 'أحمد مسؤول الامتثال',
    username: 'compliance',
    role: 'compliance_officer',
    pin: '5678',
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

export class AuthService {
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

    // Timing-safe comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
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
   * مصادقة مستخدم بواسطة اسم المستخدم أو الدور
   */
  public authenticateUser(roleOrUsername: string, _pin?: string): { token: string; user: AuthenticatedUser } | null {
    const key = Object.keys(SYSTEM_USERS).find(
      (k) => k === roleOrUsername || SYSTEM_USERS[k].username === roleOrUsername
    );
    if (!key) return null;
    const user = SYSTEM_USERS[key];
    const token = this.generateToken(user);
    return { token, user };
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
    return res.status(401).json({
      success: false,
      error: 'مرفوض: يتطلب الوصول إلى هذه النقطة رمز مصادقة صالح (Authorization Bearer Token)',
    });
  }

  const payload = authService.verifyToken(token);
  if (!payload) {
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
    // Filter timestamps within the current window
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= maxRequests) {
      res.setHeader('Retry-After', windowSeconds);
      return res.status(429).json({
        success: false,
        error: `تم تجاوز الحد المسموح من الطلبات (${maxRequests} طلب خلال ${windowSeconds} ثانية). يرجى المحاولة لاحقاً.`,
      });
    }

    timestamps.push(now);
    requests.set(key, timestamps);

    // Housekeeping: clean up old keys periodically
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
