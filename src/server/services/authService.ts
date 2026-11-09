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
  pinAlgo?: 'scrypt' | 'pbkdf2';
  /** يزداد عند تغيير/إعادة ضبط الرمز فتبطل كل التوكنات القديمة */
  tokenVersion?: number;
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
  /** نسخة توكن المستخدم وقت الإصدار (N10: إلغاء التوكنات القديمة) */
  tv?: number;
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

// ---------------------------------------------------------------------------
// N3: تجزئة scrypt بملح عشوائي لكل مستخدم، وكلمات مرور عشوائية بدل الرموز الثابتة
// ---------------------------------------------------------------------------
export const MIN_PIN_LENGTH = 8;
const GENERATED_PASSWORD_LENGTH = 12;

export function hashPinWithSalt(pin: string, salt: string, algo: 'scrypt' | 'pbkdf2' = 'scrypt'): string {
  const normalized = pin.trim().normalize('NFKC');
  if (algo === 'pbkdf2') {
    // للتوافق مع السجلات القديمة فقط (تُستبدل فوراً عند التحميل)
    return crypto.pbkdf2Sync(pin.trim(), salt, 100000, 32, 'sha256').toString('hex');
  }
  return crypto
    .scryptSync(normalized, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })
    .toString('hex');
}

export function createPinCredentials(pin: string): { pinSalt: string; pinHash: string; pinAlgo: 'scrypt' } {
  const pinSalt = crypto.randomBytes(16).toString('hex');
  return { pinSalt, pinHash: hashPinWithSalt(pin, pinSalt, 'scrypt'), pinAlgo: 'scrypt' };
}

/**
 * فحص الرمز السري بطريقة آمنة ومقاومة لهجمات التوقيت (Timing-Attack Resistant)
 */
export function verifyPinHash(
  providedPin: string,
  salt: string,
  expectedHash: string,
  algo: 'scrypt' | 'pbkdf2' = 'scrypt'
): boolean {
  if (!providedPin || typeof providedPin !== 'string') return false;
  const calculatedHash = hashPinWithSalt(providedPin, salt, algo);
  const calcBuf = Buffer.from(calculatedHash, 'hex');
  const expBuf = Buffer.from(expectedHash, 'hex');

  if (calcBuf.length !== expBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(calcBuf, expBuf);
}

export function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < GENERATED_PASSWORD_LENGTH; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

const COMMON_WEAK_PINS = new Set(['12345678', '123456789', '1234567890', '87654321', '00000000', '11111111', 'password', 'qwertyui', 'admin123', '12341234']);

export function isWeakPin(pin: string): boolean {
  const p = (pin || '').trim();
  if (p.length < MIN_PIN_LENGTH) return true;
  if (/^(.)\1+$/.test(p)) return true; // حرف مكرر فقط
  if (COMMON_WEAK_PINS.has(p.toLowerCase())) return true;
  return false;
}

/**
 * N3: ترحيل السجلات القديمة (PBKDF2 / رموز تافهة): كل سجل غير scrypt يُستبدل بكلمة مرور عشوائية جديدة
 * ويُزاد tokenVersion لإبطال التوكنات القديمة. دالة نقية بلا I/O (قابلة للاختبار).
 */
export function migrateLegacyUsers(list: StoredUserRecord[]): {
  users: StoredUserRecord[];
  issued: Array<{ username: string; role: string; password: string }>;
} {
  const issued: Array<{ username: string; role: string; password: string }> = [];
  const users = list.map((u) => {
    if (u.pinAlgo === 'scrypt') {
      return { ...u, tokenVersion: u.tokenVersion ?? 0 };
    }
    const password = generatePassword();
    issued.push({ username: u.username, role: u.role, password });
    return { ...u, ...createPinCredentials(password), tokenVersion: (u.tokenVersion ?? 0) + 1 };
  });
  return { users, issued };
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
    const defaultUsers: StoredUserRecord[] = [
      {
        id: 'usr-001',
        name: 'عمرو النماري',
        username: 'amro',
        role: 'owner',
        branchId: 'br-main',
        branchName: 'المركز الرئيسي - تعز',
        pinSalt: crypto.randomBytes(16).toString('hex'),
        pinHash: '',
        isActive: true,
        createdAt: '2026-11-01 08:00',
      },
      {
        id: 'usr-002',
        name: 'عبد الله الصبري',
        username: 'abdullah',
        role: 'general_manager',
        branchId: 'br-main',
        branchName: 'المركز الرئيسي - تعز',
        pinSalt: crypto.randomBytes(16).toString('hex'),
        pinHash: '',
        isActive: true,
        createdAt: '2026-11-01 08:00',
      },
      {
        id: 'usr-006',
        name: 'منصور الحمادي',
        username: 'mansoor',
        role: 'branch_manager',
        branchId: 'br-khadeer',
        branchName: 'فرع خدير',
        pinSalt: crypto.randomBytes(16).toString('hex'),
        pinHash: '',
        isActive: true,
        createdAt: '2026-11-01 08:00',
      },
      {
        id: 'usr-003',
        name: 'صديق علي الفتاحي',
        username: 'sedeek',
        role: 'teller',
        branchId: 'br-khadeer',
        branchName: 'فرع خدير - الكاشير المعتمد',
        pinSalt: crypto.randomBytes(16).toString('hex'),
        pinHash: '',
        isActive: true,
        createdAt: '2026-11-01 08:00',
      },
      {
        id: 'usr-004',
        name: 'محمد عبد الرقيب الشميري',
        username: 'mohammed',
        role: 'auditor',
        branchId: 'br-main',
        branchName: 'المركز الرئيسي - تعز',
        pinSalt: crypto.randomBytes(16).toString('hex'),
        pinHash: '',
        isActive: true,
        createdAt: '2026-11-01 08:00',
      },
      {
        id: 'usr-005',
        name: 'أحمد سعيد الأصبحي',
        username: 'ahmed',
        role: 'accountant',
        branchId: 'br-main',
        branchName: 'المركز الرئيسي - تعز',
        pinSalt: crypto.randomBytes(16).toString('hex'),
        pinHash: '',
        isActive: true,
        createdAt: '2026-11-01 08:00',
      },
      {
        id: 'usr-007',
        name: 'فؤاد المخلافي',
        username: 'fouad',
        role: 'compliance_officer',
        branchId: 'br-main',
        branchName: 'المركز الرئيسي - تعز',
        pinSalt: crypto.randomBytes(16).toString('hex'),
        pinHash: '',
        isActive: true,
        createdAt: '2026-11-01 08:00',
      },
    ];

    // N2/N3: الملف غير الموجود = أول تشغيل؛ الملف التالف/الفارغ يوقف التشغيل (failOnCorruption)
    const fileExists = fs.existsSync(USERS_FILE);
    const loadedUsers: StoredUserRecord[] = fileExists
      ? safeReadJson<StoredUserRecord[]>(USERS_FILE, [], { failOnCorruption: true })
      : defaultUsers;

    const { users: migrated, issued } = migrateLegacyUsers(loadedUsers);

    if (issued.length > 0) {
      safeAtomicWriteJson(USERS_FILE, migrated);
      const reason = fileExists
        ? 'تم اكتشاف رموز قديمة ضعيفة (PBKDF2) فجرى استبدالها بكلمات مرور عشوائية جديدة وإبطال كل الجلسات القديمة'
        : 'أول تشغيل: أُنشئت كلمات مرور عشوائية للمستخدمين';
      console.warn(
        `\n================ [Security] ${reason} ================\n` +
          'احفظ كلمات المرور التالية الآن، فهي لا تظهر مرة أخرى (لإعادة الضبط: npm run reset-pin -- <username>):\n' +
          issued.map((i) => `   ${i.role.padEnd(20)} (${i.username}) : ${i.password}`).join('\n') +
          '\n=====================================================================\n'
      );
    }

    this.users.clear();
    for (const u of migrated) {
      this.users.set(u.username, u);
      this.users.set(u.role, u);
    }
  }

  /** N10: التحقق من أن جلسة التوكن ما زالت صالحة (المستخدم موجود ونشط ونسخة التوكن مطابقة) */
  public validateSession(payload: AuthTokenPayload): boolean {
    const u = this.users.get(payload.username);
    if (!u || u.isActive === false) return false;
    return (payload.tv ?? 0) === (u.tokenVersion ?? 0);
  }

  public listUsernames(): string[] {
    return Array.from(new Set(Array.from(this.users.values()).map((u) => u.username)));
  }

  /**
   * N3: تغيير الرمز من المستخدم نفسه (يتطلب الرمز الحالي، حداً أدنى 8، ويرفض الضعيف والمكرر)
   * يرفع tokenVersion فتبطل التوكنات القديمة، ويُرجع توكناً جديداً.
   */
  public changePin(
    username: string,
    currentPin: string,
    newPin: string
  ): { success: boolean; error?: string; token?: string } {
    const user = this.users.get(username);
    if (!user || user.isActive === false) return { success: false, error: 'المستخدم غير موجود أو معطّل' };
    if (typeof currentPin !== 'string' || typeof newPin !== 'string') {
      return { success: false, error: 'صيغة الرمز غير صحيحة' };
    }
    if (!verifyPinHash(currentPin, user.pinSalt, user.pinHash, user.pinAlgo ?? 'scrypt')) {
      this.recordSecurityEvent({ event: 'LOGIN_FAILED', usernameOrRole: username, ip: 'local', details: 'فشل تغيير الرمز: الرمز الحالي غير صحيح' });
      return { success: false, error: 'الرمز الحالي غير صحيح' };
    }
    if (newPin.trim().length < MIN_PIN_LENGTH) {
      return { success: false, error: `الرمز الجديد يجب ألا يقل عن ${MIN_PIN_LENGTH} خانات` };
    }
    if (isWeakPin(newPin)) {
      return { success: false, error: 'الرمز الجديد ضعيف (مكرر أو شائع)؛ اختر رمزاً أقوى' };
    }
    if (newPin.trim() === currentPin.trim()) {
      return { success: false, error: 'الرمز الجديد يجب أن يختلف عن الحالي' };
    }

    const previous = { pinSalt: user.pinSalt, pinHash: user.pinHash, pinAlgo: user.pinAlgo, tokenVersion: user.tokenVersion };
    Object.assign(user, createPinCredentials(newPin), { tokenVersion: (user.tokenVersion ?? 0) + 1 });
    try {
      this.saveUsersToDisk();
    } catch {
      Object.assign(user, previous);
      return { success: false, error: 'تعذر حفظ الرمز الجديد على القرص؛ لم يتغير شيء' };
    }
    this.recordSecurityEvent({ event: 'LOGIN_SUCCESS', usernameOrRole: username, ip: 'local', details: 'تم تغيير الرمز السري وإبطال الجلسات القديمة' });
    return { success: true, token: this.generateToken(user, user.tokenVersion ?? 0) };
  }

  /** أداة إدارة محلية (لا تُعرَّض عبر API): كلمة مرور عشوائية جديدة لمستخدم */
  public adminResetPin(username: string): { username: string; password: string } | null {
    const user = this.users.get(username);
    if (!user) return null;
    const password = generatePassword();
    Object.assign(user, createPinCredentials(password), { tokenVersion: (user.tokenVersion ?? 0) + 1 });
    this.saveUsersToDisk();
    return { username: user.username, password };
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

  public generateToken(user: AuthenticatedUser, tokenVersion = 0): string {
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
      tv: tokenVersion,
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

    if (user.isActive === false || !pin || !verifyPinHash(pin, user.pinSalt, user.pinHash, user.pinAlgo ?? 'scrypt')) {
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
    const token = this.generateToken(user, user.tokenVersion ?? 0);

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

  if (!authService.validateSession(payload)) {
    return res.status(401).json({
      success: false,
      error: 'الجلسة لم تعد صالحة (تغيّر الرمز أو عُطّل الحساب). يرجى تسجيل الدخول مجدداً.',
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
