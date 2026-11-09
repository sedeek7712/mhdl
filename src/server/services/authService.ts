/**
 * خدمة المصادقة والتحقق من الصلاحيات والحد من المعدل (Authentication, RBAC & Rate Limiting)
 * نظام عمرو النماري للصرافة والحسابات
 * معالجة نتائج التدقيق الأمني: C1 (منع تزوير التوكن), H3 (تخزين المستخدمين خارج الكود), H5 (حماية مسار users)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Request, Response, NextFunction } from 'express';
import { safeAtomicWriteJson, safeReadJson, getYemenDateTimeString } from '../utils/atomicFileStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../data');
const USERS_FILE = path.resolve(DATA_DIR, 'system_users.json');
const JWT_SECRET_FILE = path.resolve(DATA_DIR, '.jwt_secret');

export interface AuthenticatedUser {
  id: string;
  name: string;
  role: 'owner' | 'general_manager' | 'branch_manager' | 'teller' | 'auditor' | 'accountant' | 'compliance_officer';
  username: string;
  branchId: string;
  branchName: string;
}

export interface StoredUserRecord extends AuthenticatedUser {
  pinSalt: string;
  pinHash: string;
  isActive: boolean;
  createdAt: string;
}

export interface SecurityAuditEntry {
  id: string;
  timestamp: string;
  event: 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'ROLE_ACCESS_DENIED' | 'RATE_LIMIT_EXCEEDED' | 'BRUTE_FORCE_BLOCKED';
  usernameOrRole: string;
  ip: string;
  details: string;
}

export interface AuthTokenPayload {
  userId: string;
  username: string;
  name: string;
  role: AuthenticatedUser['role'];
  branchId: string;
  branchName: string;
  iat: number;
  exp: number;
}

/**
 * C1: تأمين مفتاح التشفير JWT ومنع استخدام أي مفتاح افتراضي ثابت في الكود
 * في بيئة الإنتاج: يلزم توفير JWT_SECRET قوي
 * في بيئة التطوير: توليد مفتاح عشوائي مشفر 64 بايت وحفظه محلياً في ملف محمي .jwt_secret
 */
function initializeJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET || process.env.APP_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!envSecret || envSecret.trim().length < 32 || envSecret.includes('dev_mode') || envSecret.includes('default')) {
      const errMsg = 'FATAL SECURITY: JWT_SECRET environment variable is strictly required in production and must be at least 32 characters long.';
      console.error(errMsg);
      throw new Error(errMsg);
    }
    return envSecret.trim();
  }

  // إذا تم تمرير متغير بيئة في التطوير نستخدمه
  if (envSecret && envSecret.trim().length >= 32) {
    return envSecret.trim();
  }

  // التحقق من وجود مفتاح عشوائي محفوظ محلياً
  try {
    if (fs.existsSync(JWT_SECRET_FILE)) {
      const existing = fs.readFileSync(JWT_SECRET_FILE, 'utf-8').trim();
      if (existing.length >= 64) {
        return existing;
      }
    }

    // توليد مفتاح عشوائي مشفر 64 بايت وحفظه محلياً لمنع تزوير التوكنات
    const newRandomSecret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(JWT_SECRET_FILE, newRandomSecret, { encoding: 'utf-8', mode: 0o600 });
    console.log('[Security Engine] Generated unique local cryptographic JWT Secret.');
    return newRandomSecret;
  } catch {
    return crypto.randomBytes(32).toString('hex');
  }
}

const JWT_SECRET = initializeJwtSecret();

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

  if (calcBuf.length !== expBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(calcBuf, expBuf);
}

/**
 * H3: إدارة وتخزين بيانات المستخدمين في ملف system_users.json المستقل خارج الكود المصدري
 */
class AuthService {
  private users: Map<string, StoredUserRecord> = new Map();
  private failedLogins: Map<string, { attempts: number; lockUntil: number }> = new Map();
  private securityLogs: SecurityAuditEntry[] = [];
  private readonly TOKEN_EXPIRY_HOURS = 12;

  constructor() {
    this.loadUsersFromDisk();
  }

  private loadUsersFromDisk(): void {
    // لا توجد حسابات أو PIN افتراضية في الكود؛ ملف المستخدمين جزء إلزامي من بيانات التشغيل.
    const loadedUsers = safeReadJson<StoredUserRecord[]>(USERS_FILE, [], {
      failOnCorruption: true,
      failOnMissing: true,
    });

    if (!Array.isArray(loadedUsers) || loadedUsers.length === 0) {
      throw new Error('توقف آمن: ملف المستخدمين فارغ أو لا يحتوي حساباً صالحاً. يجب تنفيذ تهيئة المالك بصورة صريحة قبل تشغيل النظام.');
    }

    const allowedRoles: AuthenticatedUser['role'][] = [
      'owner',
      'general_manager',
      'branch_manager',
      'teller',
      'auditor',
      'accountant',
      'compliance_officer',
    ];
    const usernames = new Set<string>();

    for (const user of loadedUsers) {
      if (!user || typeof user.id !== 'string' || !user.id.trim() ||
          typeof user.name !== 'string' || !user.name.trim() ||
          typeof user.username !== 'string' || !user.username.trim() ||
          !allowedRoles.includes(user.role) ||
          typeof user.branchId !== 'string' || !user.branchId.trim() ||
          typeof user.branchName !== 'string' || !user.branchName.trim() ||
          typeof user.pinSalt !== 'string' || !/^[a-f0-9]{32}$/i.test(user.pinSalt) ||
          typeof user.pinHash !== 'string' || !/^[a-f0-9]{64}$/i.test(user.pinHash) ||
          typeof user.isActive !== 'boolean') {
        throw new Error('توقف آمن: ملف المستخدمين يحتوي بيانات اعتماد أو صلاحيات غير مكتملة؛ لن يتم إنشاء PIN افتراضي.');
      }

      const normalizedUsername = user.username.trim().toLowerCase();
      if (usernames.has(normalizedUsername)) {
        throw new Error(`توقف آمن: اسم المستخدم مكرر في ملف الحسابات (${normalizedUsername}).`);
      }
      usernames.add(normalizedUsername);
    }

    this.users.clear();
    for (const user of loadedUsers) {
      this.users.set(user.username, user);
      this.users.set(user.role, user);
    }
  }
  public saveUsersToDisk(): void {
    const list = Array.from(new Set(this.users.values()));
    safeAtomicWriteJson(USERS_FILE, list);
  }

  public getAllPublicUsers(): Omit<StoredUserRecord, 'pinSalt' | 'pinHash'>[] {
    const unique = Array.from(new Set(this.users.values()));
    return unique.map(({ id, name, username, role, branchId, branchName, isActive, createdAt }) => ({
      id,
      name,
      username,
      role,
      branchId,
      branchName,
      isActive,
      createdAt,
    }));
  }

  public findUser(roleOrUsername: string): StoredUserRecord | undefined {
    return this.users.get(roleOrUsername);
  }

  public generateToken(user: AuthenticatedUser): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.TOKEN_EXPIRY_HOURS * 3600;

    const payload: AuthTokenPayload = {
      userId: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      branchId: user.branchId,
      branchName: user.branchName,
      iat: now,
      exp,
    };

    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${data}`)
      .digest('base64url');

    return `${header}.${data}.${signature}`;
  }

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

    // التحقق من طول التوقيع أولاً لتجنب RangeError
    if (sigBuf.length !== expBuf.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    try {
      const payload: AuthTokenPayload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  public authenticateUser(
    roleOrUsername: string,
    pin?: string,
    ip = '127.0.0.1'
  ): { success: boolean; token?: string; user?: AuthenticatedUser; error?: string; locked?: boolean } {
    const lockKey = `${roleOrUsername}:${ip}`;
    const now = Date.now();
    const failRecord = this.failedLogins.get(lockKey);

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

    const user = this.findUser(roleOrUsername);
    if (!user) {
      const isLocked = this.recordFailedAttempt(lockKey, roleOrUsername, ip, 'المستخدم غير مسجل في النظام');
      return {
        success: false,
        locked: isLocked,
        error: isLocked
          ? 'تم حظر محاولات الدخول مؤقتاً لتجاوز الحد المسموح من الأخطاء (5 محاولات). يرجى المحاولة بعد 5 دقائق.'
          : 'المستخدم أو الدور غير موجود في النظام المالي المعتمد',
      };
    }

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

    this.failedLogins.delete(lockKey);
    const token = this.generateToken(user);

    this.recordSecurityEvent({
      event: 'LOGIN_SUCCESS',
      usernameOrRole: user.username,
      ip,
      details: `تم توثيق الدخول بنجاح بصلاحية [${user.role}] للمستخدم (${user.name}).`,
    });

    return {
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        username: user.username,
        branchId: user.branchId,
        branchName: user.branchName,
      },
    };
  }

  private recordFailedAttempt(lockKey: string, usernameOrRole: string, ip: string, reason: string): boolean {
    const record = this.failedLogins.get(lockKey) || { attempts: 0, lockUntil: 0 };
    record.attempts += 1;
    let isLocked = false;

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
      id: `sec-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      timestamp: getYemenDateTimeString(),
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
 * Middleware: التحقق من التوكن وصلاحيات الجلسة
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'غير مصرح: يلزم تسجيل الدخول وإرفاق رمز مصادقة صالح (Bearer Token).',
    });
  }

  const token = authHeader.substring(7);
  const payload = authService.verifyToken(token);

  if (!payload) {
    return res.status(401).json({
      success: false,
      error: 'رمز المصادقة غير صالح أو منتهي الصلاحية. يرجى تسجيل الدخول مجدداً.',
    });
  }

  (req as any).user = {
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
 * Middleware: التحقق من الأدوار المصرح لها
 */
export function requireRoles(allowedRoles: Array<AuthenticatedUser['role']>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as AuthenticatedUser | undefined;

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'جلسة المستخدم غير معتمدة على الخادم.',
      });
    }

    if (!allowedRoles.includes(user.role)) {
      authService.recordSecurityEvent({
        event: 'ROLE_ACCESS_DENIED',
        usernameOrRole: user.username,
        ip: req.ip || '127.0.0.1',
        details: `محاولة وصول غير مصرح للمسار (${req.originalUrl}) بصلاحية [${user.role}]. الأدوار المصرح بها: [${allowedRoles.join(', ')}].`,
      });

      return res.status(403).json({
        success: false,
        error: `رفض الوصول: العملية مقتصرة على الأدوار المصرح بها [${allowedRoles.join(', ')}] ولا تتوفر لدور [${user.role}].`,
      });
    }

    next();
  };
}

/**
 * Rate Limiter Factory
 */
export function createRateLimiter(maxRequests = 60, windowSeconds = 60) {
  const ipWindowMap = new Map<string, { count: number; windowStart: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Math.floor(Date.now() / 1000);
    const window = ipWindowMap.get(ip);

    if (!window || now - window.windowStart >= windowSeconds) {
      ipWindowMap.set(ip, { count: 1, windowStart: now });
      return next();
    }

    if (window.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: `تم تجاوز الحد المسموح للطلبات (${maxRequests} طلب / ${windowSeconds} ثانية). يرجى المحاولة لاحقاً.`,
      });
    }

    window.count += 1;
    next();
  };
}
