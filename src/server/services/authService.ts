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
import { loadOrCreateJwtSecret } from '../security/jwtSecret.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.NODE_ENV === 'test' && process.env.ALNAMARI_TEST_DATA_DIR
  ? path.resolve(process.env.ALNAMARI_TEST_DATA_DIR)
  : path.resolve(__dirname, '../../../data');
const USERS_FILE = path.resolve(DATA_DIR, 'system_users.local.json');
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
  mustChangePin: boolean;
  sessionVersion: string;
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
  sessionVersion: string;
  iat: number;
  exp: number;
}

const JWT_SECRET = loadOrCreateJwtSecret(JWT_SECRET_FILE, process.env);



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
    // Keep one active owner, while allowing the operational roles required by an exchange office.
    // Users authenticate by username; a role is never a shared credential.
    const loadedUsers = safeReadJson<StoredUserRecord[]>(USERS_FILE, [], {
      failOnCorruption: true,
      failOnMissing: true,
    });
    const allowedRoles: AuthenticatedUser['role'][] = [
      'owner',
      'general_manager',
      'branch_manager',
      'teller',
      'auditor',
      'accountant',
      'compliance_officer',
    ];
    if (!Array.isArray(loadedUsers) || loadedUsers.length === 0) {
      throw new Error('توقف آمن: ملف المستخدمين فارغ أو غير صالح. يلزم إعداد حساب مالك قبل التشغيل.');
    }

    const usernames = new Set<string>();
    const userIds = new Set<string>();
    let ownerCount = 0;
    let activeOwnerCount = 0;
    for (const user of loadedUsers) {
      if (!user || typeof user.id !== 'string' || !user.id.trim() ||
          typeof user.name !== 'string' || !user.name.trim() ||
          typeof user.username !== 'string' || !/^[a-zA-Z0-9._-]{3,32}$/.test(user.username.trim()) ||
          !allowedRoles.includes(user.role) ||
          typeof user.branchId !== 'string' || !user.branchId.trim() ||
          typeof user.branchName !== 'string' || !user.branchName.trim() ||
          typeof user.pinSalt !== 'string' || !/^[a-f0-9]{32}$/i.test(user.pinSalt) ||
          typeof user.pinHash !== 'string' || !/^[a-f0-9]{64}$/i.test(user.pinHash) ||
          typeof user.sessionVersion !== 'string' || !/^[a-f0-9]{32}$/i.test(user.sessionVersion) ||
          typeof user.isActive !== 'boolean' || typeof user.mustChangePin !== 'boolean' ||
          typeof user.createdAt !== 'string' || !user.createdAt.trim()) {
        throw new Error('توقف آمن: يوجد حساب مستخدم غير مكتمل أو ببيانات اعتماد قديمة. أعد تهيئة بيانات الحساب بصورة آمنة قبل التشغيل.');
      }
      const normalizedUsername = user.username.trim().toLowerCase();
      if (usernames.has(normalizedUsername) || userIds.has(user.id)) {
        throw new Error('توقف آمن: اسم المستخدم أو معرف الحساب مكرر في ملف المستخدمين.');
      }
      usernames.add(normalizedUsername);
      userIds.add(user.id);
      if (user.role === 'owner') {
        ownerCount += 1;
        if (user.isActive) activeOwnerCount += 1;
      }
    }
    if (ownerCount !== 1 || activeOwnerCount !== 1) {
      throw new Error('توقف آمن: يجب وجود حساب مالك واحد بالضبط، ويجب أن يكون نشطاً. لم يتم تحميل حسابات الموظفين.');
    }

    this.users.clear();
    for (const user of loadedUsers) {
      this.users.set(user.username.trim().toLowerCase(), user);
    }
  }
  public saveUsersToDisk(): void {
    const list = Array.from(new Set(this.users.values()));
    safeAtomicWriteJson(USERS_FILE, list);
  }

  public getAllPublicUsers(): Omit<StoredUserRecord, 'pinSalt' | 'pinHash' | 'mustChangePin' | 'sessionVersion'>[] {
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

  public findUser(username: string): StoredUserRecord | undefined {
    const key = String(username || '').trim().toLowerCase();
    if (!key) return undefined;
    // Role names are public labels, never login identifiers. Authentication is username-only.
    return this.users.get(key);
  }

  private persistUserSet(nextUsers: StoredUserRecord[]): void {
    safeAtomicWriteJson(USERS_FILE, nextUsers);
    this.users.clear();
    for (const user of nextUsers) this.users.set(user.username.trim().toLowerCase(), user);
  }

  private validStrongPin(pin: string): boolean {
    return /^\d{6}$/.test(pin) &&
      !/^(\d)\1+$/.test(pin) &&
      !['123456', '654321', '000000', '111111', '222222', '123321'].includes(pin);
  }

  public createUser(params: {
    username: string; name: string; role: AuthenticatedUser['role'];
    branchId: string; branchName: string; pin: string;
  }): { success: boolean; user?: Omit<StoredUserRecord, 'pinSalt' | 'pinHash' | 'mustChangePin' | 'sessionVersion'>; error?: string } {
    const username = String(params.username || '').trim().toLowerCase();
    const name = String(params.name || '').trim();
    const branchId = String(params.branchId || '').trim();
    const branchName = String(params.branchName || '').trim();
    const roles: AuthenticatedUser['role'][] = [
      'general_manager', 'branch_manager', 'teller', 'accountant', 'auditor', 'compliance_officer',
    ];
    if (!/^[a-z0-9._-]{3,32}$/.test(username) || !name || name.length > 120 ||
        !branchId || !branchName || !roles.includes(params.role)) {
      return { success: false, error: 'بيانات الموظف أو اسم الدخول أو الدور أو الفرع غير صالحة.' };
    }
    if (this.users.has(username)) {
      return { success: false, error: 'اسم المستخدم مستخدم مسبقاً.' };
    }
    if (!this.validStrongPin(params.pin)) {
      return { success: false, error: 'يجب أن يكون PIN ستة أرقام وألا يكون متسلسلاً أو مكرراً أو شائعاً.' };
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const created: StoredUserRecord = {
      id: `usr-${crypto.randomUUID()}`,
      name, username, role: params.role, branchId, branchName,
      pinSalt: salt,
      pinHash: hashPinWithSalt(params.pin, salt),
      isActive: true,
      mustChangePin: false,
      sessionVersion: crypto.randomBytes(16).toString('hex'),
      createdAt: getYemenDateTimeString(),
    };
    const next = [...this.users.values(), created];
    try {
      this.persistUserSet(next);
      return { success: true, user: this.toPublicUser(created) };
    } catch (error) {
      return { success: false, error: `تعذر حفظ حساب الموظف: ${error instanceof Error ? error.message : 'خطأ تخزين غير معروف'}` };
    }
  }

  public setUserActive(userId: string, isActive: boolean): { success: boolean; user?: ReturnType<AuthService['toPublicUser']>; error?: string } {
    const target = Array.from(this.users.values()).find((user) => user.id === userId);
    if (!target) return { success: false, error: 'حساب المستخدم غير موجود.' };
    if (typeof isActive !== 'boolean') return { success: false, error: 'حالة تفعيل الحساب غير صالحة.' };
    if (target.role === 'owner' && !isActive) {
      return { success: false, error: 'لا يمكن تعطيل حساب المالك الوحيد من هذه الواجهة.' };
    }
    const updated = { ...target, isActive, sessionVersion: crypto.randomBytes(16).toString('hex') };
    const next = Array.from(this.users.values()).map((user) => user.id === userId ? updated : user);
    try {
      this.persistUserSet(next);
      return { success: true, user: this.toPublicUser(updated) };
    } catch (error) {
      return { success: false, error: `تعذر حفظ حالة الحساب: ${error instanceof Error ? error.message : 'خطأ تخزين غير معروف'}` };
    }
  }

  public resetUserPin(userId: string, newPin: string): { success: boolean; user?: ReturnType<AuthService['toPublicUser']>; error?: string } {
    const target = Array.from(this.users.values()).find((user) => user.id === userId);
    if (!target) return { success: false, error: 'حساب المستخدم غير موجود.' };
    if (target.role === 'owner') return { success: false, error: 'غيّر PIN المالك من جلسة المالك نفسها.' };
    if (!this.validStrongPin(newPin)) return { success: false, error: 'PIN الجديد ضعيف أو غير صالح.' };
    if (verifyPinHash(newPin, target.pinSalt, target.pinHash)) return { success: false, error: 'اختر PIN مختلفاً عن الرمز الحالي.' };
    const salt = crypto.randomBytes(16).toString('hex');
    const updated = {
      ...target,
      pinSalt: salt,
      pinHash: hashPinWithSalt(newPin, salt),
      isActive: true,
      mustChangePin: false,
      sessionVersion: crypto.randomBytes(16).toString('hex'),
    };
    const next = Array.from(this.users.values()).map((user) => user.id === userId ? updated : user);
    try {
      this.persistUserSet(next);
      return { success: true, user: this.toPublicUser(updated) };
    } catch (error) {
      return { success: false, error: `تعذر حفظ PIN الجديد: ${error instanceof Error ? error.message : 'خطأ تخزين غير معروف'}` };
    }
  }

  public changePin(username: string, currentPin: string, newPin: string): { success: boolean; token?: string; user?: AuthenticatedUser; error?: string } {
    const target = this.findUser(username);
    if (!target || !target.isActive || !verifyPinHash(currentPin, target.pinSalt, target.pinHash)) {
      return { success: false, error: 'رمز PIN الحالي غير صحيح.' };
    }
    if (!this.validStrongPin(newPin)) return { success: false, error: 'PIN الجديد ضعيف أو غير صالح.' };
    if (verifyPinHash(newPin, target.pinSalt, target.pinHash)) {
      return { success: false, error: 'اختر PIN مختلفاً عن الرمز الحالي.' };
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const updated = {
      ...target,
      pinSalt: salt,
      pinHash: hashPinWithSalt(newPin, salt),
      mustChangePin: false,
      sessionVersion: crypto.randomBytes(16).toString('hex'),
    };
    const next = Array.from(this.users.values()).map((user) => user.id === target.id ? updated : user);
    try {
      this.persistUserSet(next);
      const user: AuthenticatedUser = {
        id: updated.id, name: updated.name, role: updated.role, username: updated.username,
        branchId: updated.branchId, branchName: updated.branchName,
      };
      return { success: true, token: this.generateToken(updated), user };
    } catch (error) {
      return { success: false, error: `تعذر حفظ PIN الجديد: ${error instanceof Error ? error.message : 'خطأ تخزين غير معروف'}` };
    }
  }

  private toPublicUser(user: StoredUserRecord): Omit<StoredUserRecord, 'pinSalt' | 'pinHash' | 'mustChangePin' | 'sessionVersion'> {
    const { pinSalt: _salt, pinHash: _hash, mustChangePin: _change, sessionVersion: _version, ...publicUser } = user;
    return publicUser;
  }

  public generateToken(user: StoredUserRecord): string {
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
      sessionVersion: user.sessionVersion,
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
      if (!payload || typeof payload.userId !== 'string' || typeof payload.username !== 'string' ||
          typeof payload.role !== 'string' || typeof payload.sessionVersion !== 'string' ||
          !Number.isSafeInteger(payload.exp) || payload.exp <= now) {
        return null;
      }

      // إيقاف الجلسات فور تعطيل الحساب أو تغير هويته/صلاحياته في ملف المستخدمين.
      const currentUser = this.users.get(payload.username.trim().toLowerCase());
      if (!currentUser || !currentUser.isActive || currentUser.id !== payload.userId ||
          currentUser.role !== payload.role || currentUser.branchId !== payload.branchId ||
          currentUser.sessionVersion !== payload.sessionVersion) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  public authenticateUser(
    username: string,
    pin?: string,
    ip = '127.0.0.1'
  ): { success: boolean; token?: string; user?: AuthenticatedUser; error?: string; locked?: boolean } {
    const user = this.findUser(username);
    const lockIdentity = user?.id || String(username).trim().toLowerCase();
    const lockKey = `${lockIdentity}:${ip}`;
    const now = Date.now();
    const failRecord = this.failedLogins.get(lockKey);

    if (failRecord && failRecord.lockUntil > now) {
      const remainingSec = Math.ceil((failRecord.lockUntil - now) / 1000);
      this.recordSecurityEvent({
        event: 'BRUTE_FORCE_BLOCKED',
        usernameOrRole: username,
        ip,
        details: `محاولة دخول خلال فترة الحظر المؤقت. متبقي ${remainingSec} ثانية.`,
      });
      return {
        success: false,
        locked: true,
        error: `تم حظر محاولات الدخول مؤقتاً لتجاوز الحد المسموح من الأخطاء. يرجى المحاولة بعد ${remainingSec} ثانية.`,
      };
    }

    if (!user) {
      const isLocked = this.recordFailedAttempt(lockKey, username, ip, 'اسم المستخدم غير مسجل في النظام');
      return {
        success: false,
        locked: isLocked,
        error: isLocked
          ? 'تم حظر محاولات الدخول مؤقتاً لتجاوز الحد المسموح من الأخطاء (5 محاولات). يرجى المحاولة بعد 5 دقائق.'
          : 'اسم المستخدم غير موجود في النظام المالي المعتمد',
      };
    }

    if (!user.isActive) {
      this.recordSecurityEvent({
        event: 'LOGIN_FAILED',
        usernameOrRole: user.username,
        ip,
        details: 'تم رفض تسجيل الدخول لأن حساب المستخدم معطل.',
      });
      return { success: false, error: 'هذا الحساب معطل. راجع مالك النظام لإعادة تفعيله.' };
    }

    if (typeof pin !== 'string' || !/^\d{6}$/.test(pin) || !verifyPinHash(pin, user.pinSalt, user.pinHash)) {
      const isLocked = this.recordFailedAttempt(lockKey, username, ip, 'رمز PIN غير مطابق للتجزئة المعتمدة');
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
