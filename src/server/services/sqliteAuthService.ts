import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getYemenDateTimeString } from '../utils/atomicFileStorage.js';
import {
  appendSqliteSecurityEvent,
  changeSqliteUserPin,
  clearSqliteLoginAttempt,
  getSqliteLoginAttempt,
  getSqliteUserByUsername,
  insertSqliteUser,
  listSqlitePublicUsers,
  listSqliteSecurityEvents,
  recordSqliteLoginFailure,
  resetSqliteStaffPin,
  setSqliteUserActive,
  type SqlitePublicUser,
  type SqliteSecurityEventType,
  type SqliteUserRecord,
} from '../db/sqliteAuthRepository.js';

export type SqliteAuthRole = SqliteUserRecord['role'];

export interface SqliteAuthenticatedUser {
  id: string;
  name: string;
  role: SqliteAuthRole;
  username: string;
  branchId: string;
  branchName: string;
}

export interface SqliteAuthTokenPayload {
  userId: string;
  username: string;
  name: string;
  role: SqliteAuthRole;
  branchId: string;
  branchName: string;
  sessionVersion: string;
  iat: number;
  exp: number;
}

export interface SqliteAuthServiceOptions {
  db: DatabaseSync;
  jwtSecret: string;
  tokenExpiryHours?: number;
  maxFailedAttempts?: number;
  lockDurationMs?: number;
  now?: () => number;
  timestamp?: () => string;
}

export interface SqliteAuthResult {
  success: boolean;
  token?: string;
  user?: SqliteAuthenticatedUser;
  error?: string;
  locked?: boolean;
}

const ALLOWED_ROLES: SqliteAuthRole[] = [
  'owner', 'general_manager', 'branch_manager', 'teller',
  'auditor', 'accountant', 'compliance_officer',
];

const STAFF_ROLES: SqliteAuthRole[] = [
  'general_manager', 'branch_manager', 'teller',
  'auditor', 'accountant', 'compliance_officer',
];

export function hashSqliteAuthPin(pin: string, salt: string): string {
  return crypto.pbkdf2Sync(pin.trim(), salt, 100000, 32, 'sha256').toString('hex');
}

export function verifySqliteAuthPin(pin: string, salt: string, expectedHash: string): boolean {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin) ||
      !/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
    return false;
  }
  const calculated = Buffer.from(hashSqliteAuthPin(pin, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return calculated.length === expected.length && crypto.timingSafeEqual(calculated, expected);
}

function validStrongPin(pin: string): boolean {
  return typeof pin === 'string' && /^\d{6}$/.test(pin) &&
    !/^(\d)\1+$/.test(pin) &&
    !['123456', '654321', '000000', '111111', '222222', '123321'].includes(pin);
}

function toAuthenticatedUser(user: SqliteUserRecord): SqliteAuthenticatedUser {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    username: user.username,
    branchId: user.branchId,
    branchName: user.branchName,
  };
}

function isRole(value: unknown): value is SqliteAuthRole {
  return typeof value === 'string' && ALLOWED_ROLES.includes(value as SqliteAuthRole);
}

export class SqliteAuthService {
  private readonly db: DatabaseSync;
  private readonly jwtSecret: string;
  private readonly tokenExpiryHours: number;
  private readonly maxFailedAttempts: number;
  private readonly lockDurationMs: number;
  private readonly now: () => number;
  private readonly timestamp: () => string;

  constructor(options: SqliteAuthServiceOptions) {
    if (!options || !options.db) throw new Error('SQLite auth service requires an open database.');
    if (typeof options.jwtSecret !== 'string' || options.jwtSecret.trim().length < 32) {
      throw new Error('SQLite auth service requires a JWT secret of at least 32 characters.');
    }
    const tokenExpiryHours = options.tokenExpiryHours ?? 12;
    const maxFailedAttempts = options.maxFailedAttempts ?? 5;
    const lockDurationMs = options.lockDurationMs ?? 5 * 60 * 1000;
    if (!Number.isSafeInteger(tokenExpiryHours) || tokenExpiryHours < 1 || tokenExpiryHours > 24) {
      throw new Error('Token expiry must be an integer between 1 and 24 hours.');
    }
    if (!Number.isSafeInteger(maxFailedAttempts) || maxFailedAttempts < 1 || maxFailedAttempts > 100) {
      throw new Error('Maximum failed attempts must be between 1 and 100.');
    }
    if (!Number.isSafeInteger(lockDurationMs) || lockDurationMs < 1000) {
      throw new Error('Lock duration must be at least one second.');
    }
    this.db = options.db;
    this.jwtSecret = options.jwtSecret.trim();
    this.tokenExpiryHours = tokenExpiryHours;
    this.maxFailedAttempts = maxFailedAttempts;
    this.lockDurationMs = lockDurationMs;
    this.now = options.now ?? Date.now;
    this.timestamp = options.timestamp ?? getYemenDateTimeString;
  }

  private attemptKey(identity: string, ip: string): string {
    return crypto.createHmac('sha256', this.jwtSecret)
      .update(identity + '\u0000' + ip)
      .digest('hex');
  }

  private writeSecurityEvent(
    eventType: SqliteSecurityEventType,
    usernameOrRole: string,
    ipAddress: string,
    details: string
  ): void {
    appendSqliteSecurityEvent(this.db, {
      id: 'sec-' + this.now() + '-' + crypto.randomUUID(),
      occurredAt: this.timestamp(),
      eventType,
      usernameOrRole: String(usernameOrRole || 'unknown').slice(0, 120),
      ipAddress: String(ipAddress || '127.0.0.1').slice(0, 64),
      details: String(details || '').slice(0, 2000) || 'No additional details.',
    });
  }

  private failure(key: string, username: string, ip: string, reason: string): SqliteAuthResult {
    const result = recordSqliteLoginFailure(
      this.db,
      key,
      this.now(),
      this.lockDurationMs,
      this.maxFailedAttempts,
      this.timestamp()
    );
    this.writeSecurityEvent(
      'LOGIN_FAILED',
      username,
      ip,
      'Failed login: ' + reason + '. Attempt ' + result.attempts + ' of ' + this.maxFailedAttempts + '.'
    );
    if (result.locked) {
      return {
        success: false,
        locked: true,
        error: 'تم حظر محاولات الدخول مؤقتاً بعد تجاوز عدد المحاولات المسموح. يرجى المحاولة بعد 5 دقائق.',
      };
    }
    return { success: false, error: 'بيانات الاعتماد أو الرمز السري غير صحيح' };
  }

  generateToken(user: SqliteUserRecord): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const issuedAt = Math.floor(this.now() / 1000);
    const payload: SqliteAuthTokenPayload = {
      userId: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      branchId: user.branchId,
      branchName: user.branchName,
      sessionVersion: user.sessionVersion,
      iat: issuedAt,
      exp: issuedAt + this.tokenExpiryHours * 3600,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.jwtSecret)
      .update(header + '.' + encodedPayload)
      .digest('base64url');
    return header + '.' + encodedPayload + '.' + signature;
  }

  verifyToken(token: string): SqliteAuthTokenPayload | null {
    if (typeof token !== 'string' || token.length > 8192) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) return null;
    const [headerPart, payloadPart, signaturePart] = parts;

    try {
      const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as Record<string, unknown>;
      if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
      const expected = crypto.createHmac('sha256', this.jwtSecret)
        .update(headerPart + '.' + payloadPart)
        .digest('base64url');
      const actualBuffer = Buffer.from(signaturePart, 'utf8');
      const expectedBuffer = Buffer.from(expected, 'utf8');
      if (actualBuffer.length !== expectedBuffer.length ||
          !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
        return null;
      }

      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as
        Partial<SqliteAuthTokenPayload>;
      const nowSeconds = Math.floor(this.now() / 1000);
      if (!payload || typeof payload.userId !== 'string' ||
          typeof payload.username !== 'string' || typeof payload.name !== 'string' ||
          !isRole(payload.role) || typeof payload.branchId !== 'string' ||
          typeof payload.branchName !== 'string' || typeof payload.sessionVersion !== 'string' ||
          !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
          (payload.iat as number) > nowSeconds + 60 || (payload.exp as number) <= nowSeconds) {
        return null;
      }

      const current = getSqliteUserByUsername(this.db, payload.username);
      if (!current || !current.isActive || current.id !== payload.userId ||
          current.role !== payload.role || current.branchId !== payload.branchId ||
          current.branchName !== payload.branchName ||
          current.sessionVersion !== payload.sessionVersion) {
        return null;
      }
      return payload as SqliteAuthTokenPayload;
    } catch {
      return null;
    }
  }

  authenticateUser(usernameInput: string, pin?: string, ipInput = '127.0.0.1'): SqliteAuthResult {
    const rawUsername = typeof usernameInput === 'string' ? usernameInput.trim() : '';
    const normalizedUsername = rawUsername.toLowerCase();
    const safeIp = String(ipInput || '127.0.0.1').slice(0, 64);
    const lookupAllowed = /^[a-z0-9._-]{3,32}$/.test(normalizedUsername);
    const user = lookupAllowed ? getSqliteUserByUsername(this.db, normalizedUsername) : undefined;
    const identity = user?.id || 'unknown:' + normalizedUsername.slice(0, 120);
    const key = this.attemptKey(identity, safeIp);
    const now = this.now();
    const currentAttempt = getSqliteLoginAttempt(this.db, key);

    if (currentAttempt && currentAttempt.lockUntilMs > now) {
      const remainingSeconds = Math.ceil((currentAttempt.lockUntilMs - now) / 1000);
      this.writeSecurityEvent(
        'BRUTE_FORCE_BLOCKED',
        normalizedUsername || 'unknown',
        safeIp,
        'Login attempt during active lock. Remaining seconds: ' + remainingSeconds + '.'
      );
      return {
        success: false,
        locked: true,
        error: 'تم حظر محاولات الدخول مؤقتاً. يرجى المحاولة بعد ' + remainingSeconds + ' ثانية.',
      };
    }

    if (!user) return this.failure(key, normalizedUsername || 'unknown', safeIp, 'unknown username');

    if (!user.isActive) {
      this.writeSecurityEvent('LOGIN_FAILED', user.username, safeIp, 'Login rejected because the account is inactive.');
      return { success: false, error: 'هذا الحساب معطل. راجع مالك النظام لإعادة تفعيله.' };
    }

    if (typeof pin !== 'string' || !verifySqliteAuthPin(pin, user.pinSalt, user.pinHash)) {
      return this.failure(key, user.username, safeIp, 'PIN did not match the stored credential hash');
    }

    clearSqliteLoginAttempt(this.db, key);
    const token = this.generateToken(user);
    this.writeSecurityEvent('LOGIN_SUCCESS', user.username, safeIp, 'Login succeeded for role [' + user.role + '].');
    return { success: true, token, user: toAuthenticatedUser(user) };
  }

  createUser(params: {
    username: string;
    name: string;
    role: SqliteAuthRole;
    branchId: string;
    branchName: string;
    pin: string;
  }): { success: boolean; user?: SqlitePublicUser; error?: string } {
    const username = String(params.username || '').trim().toLowerCase();
    const name = String(params.name || '').trim();
    const branchId = String(params.branchId || '').trim();
    const branchName = String(params.branchName || '').trim();
    if (!/^[a-z0-9._-]{3,32}$/.test(username) || !name || name.length > 120 ||
        !branchId || !branchName || !STAFF_ROLES.includes(params.role) ||
        !validStrongPin(params.pin)) {
      return { success: false, error: 'بيانات الموظف أو الدور أو الفرع أو PIN غير صالحة.' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const user: SqliteUserRecord = {
      id: 'usr-' + crypto.randomUUID(),
      username,
      name,
      role: params.role,
      branchId,
      branchName,
      pinSalt: salt,
      pinHash: hashSqliteAuthPin(params.pin, salt),
      isActive: true,
      mustChangePin: false,
      sessionVersion: crypto.randomBytes(16).toString('hex'),
      createdAt: this.timestamp(),
    };
    try {
      return { success: true, user: insertSqliteUser(this.db, user) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'تعذر إنشاء حساب الموظف.' };
    }
  }

  setUserActive(userId: string, isActive: boolean): { success: boolean; user?: SqlitePublicUser; error?: string } {
    try {
      return {
        success: true,
        user: setSqliteUserActive(this.db, userId, isActive, crypto.randomBytes(16).toString('hex')),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'تعذر تحديث حالة الحساب.' };
    }
  }

  resetUserPin(userId: string, newPin: string): { success: boolean; user?: SqlitePublicUser; error?: string } {
    if (!validStrongPin(newPin)) return { success: false, error: 'PIN الجديد ضعيف أو غير صالح.' };
    try {
      const salt = crypto.randomBytes(16).toString('hex');
      return {
        success: true,
        user: resetSqliteStaffPin(
          this.db,
          userId,
          salt,
          hashSqliteAuthPin(newPin, salt),
          crypto.randomBytes(16).toString('hex')
        ),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'تعذر إعادة ضبط PIN.' };
    }
  }

  changePin(
    username: string,
    currentPin: string,
    newPin: string
  ): { success: boolean; token?: string; user?: SqliteAuthenticatedUser; error?: string } {
    const target = getSqliteUserByUsername(this.db, username);
    if (!target || !target.isActive ||
        !verifySqliteAuthPin(currentPin, target.pinSalt, target.pinHash)) {
      return { success: false, error: 'رمز PIN الحالي غير صحيح.' };
    }
    if (!validStrongPin(newPin)) return { success: false, error: 'PIN الجديد ضعيف أو غير صالح.' };
    if (verifySqliteAuthPin(newPin, target.pinSalt, target.pinHash)) {
      return { success: false, error: 'اختر PIN مختلفاً عن الرمز الحالي.' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const nextSessionVersion = crypto.randomBytes(16).toString('hex');
    try {
      changeSqliteUserPin(
        this.db,
        target.id,
        target.sessionVersion,
        salt,
        hashSqliteAuthPin(newPin, salt),
        nextSessionVersion
      );
      const updated = getSqliteUserByUsername(this.db, target.username);
      if (!updated) throw new Error('Updated user could not be read back.');
      return { success: true, token: this.generateToken(updated), user: toAuthenticatedUser(updated) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'تعذر تغيير PIN.' };
    }
  }

  getAllPublicUsers(): SqlitePublicUser[] {
    return listSqlitePublicUsers(this.db);
  }

  recordSecurityEvent(entry: {
    event: 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'ROLE_ACCESS_DENIED' | 'RATE_LIMIT_EXCEEDED' | 'BRUTE_FORCE_BLOCKED';
    usernameOrRole: string;
    ip: string;
    details: string;
  }): void {
    this.writeSecurityEvent(entry.event, entry.usernameOrRole, entry.ip, entry.details);
  }

  getSecurityLogs(): Array<{
    id: string;
    timestamp: string;
    event: SqliteSecurityEventType;
    usernameOrRole: string;
    ip: string;
    details: string;
  }> {
    return listSqliteSecurityEvents(this.db, 500).map((entry) => ({
      id: entry.id,
      timestamp: entry.occurredAt,
      event: entry.eventType,
      usernameOrRole: entry.usernameOrRole,
      ip: entry.ipAddress,
      details: entry.details,
    }));
  }
}
