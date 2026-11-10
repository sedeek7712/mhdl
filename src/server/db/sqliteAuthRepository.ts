import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type SqliteUserRole =
  | 'owner'
  | 'general_manager'
  | 'branch_manager'
  | 'teller'
  | 'auditor'
  | 'accountant'
  | 'compliance_officer';

export type SqliteSecurityEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'ROLE_ACCESS_DENIED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'BRUTE_FORCE_BLOCKED';

export interface SqliteUserRecord {
  id: string;
  username: string;
  name: string;
  role: SqliteUserRole;
  branchId: string;
  branchName: string;
  pinSalt: string;
  pinHash: string;
  isActive: boolean;
  mustChangePin: boolean;
  sessionVersion: string;
  createdAt: string;
}

export type SqlitePublicUser = Omit<
  SqliteUserRecord,
  'pinSalt' | 'pinHash' | 'mustChangePin' | 'sessionVersion'
>;

export interface SqliteSecurityEventInput {
  id: string;
  occurredAt: string;
  eventType: SqliteSecurityEventType;
  usernameOrRole: string;
  ipAddress: string;
  details: string;
}

export interface SqliteSecurityEvent extends SqliteSecurityEventInput {}

const ROLES: SqliteUserRole[] = [
  'owner', 'general_manager', 'branch_manager', 'teller',
  'auditor', 'accountant', 'compliance_officer',
];

function assertText(value: string, field: string, maxLength = 200): void {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
}

function assertCredentialMaterial(salt: string, hash: string, sessionVersion: string): void {
  if (!/^[a-f0-9]{32}$/i.test(salt)) throw new Error('PIN salt must be 32 hexadecimal characters.');
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('PIN hash must be 64 hexadecimal characters.');
  if (!/^[a-f0-9]{32}$/i.test(sessionVersion)) {
    throw new Error('Session version must be 32 hexadecimal characters.');
  }
}

function withImmediateTransaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

function mapUser(row: Record<string, unknown> | undefined): SqliteUserRecord | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id),
    username: String(row.username),
    name: String(row.name),
    role: String(row.role) as SqliteUserRole,
    branchId: String(row.branch_id),
    branchName: String(row.branch_name),
    pinSalt: String(row.pin_salt),
    pinHash: String(row.pin_hash),
    isActive: Number(row.is_active) === 1,
    mustChangePin: Number(row.must_change_pin) === 1,
    sessionVersion: String(row.session_version),
    createdAt: String(row.created_at),
  };
}

function selectUserById(db: DatabaseSync, userId: string): SqliteUserRecord | undefined {
  const row = db.prepare('SELECT * FROM app_users WHERE id = ?').get(userId) as
    | Record<string, unknown>
    | undefined;
  return mapUser(row);
}

function validateSqliteUser(user: SqliteUserRecord): void {
  assertText(user.id, 'user.id');
  assertText(user.name, 'user.name', 120);
  assertText(user.branchId, 'user.branchId');
  assertText(user.branchName, 'user.branchName');
  assertText(user.createdAt, 'user.createdAt');
  const username = String(user.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error('Username must contain 3 to 32 letters, digits, dots, underscores, or hyphens.');
  }
  if (!ROLES.includes(user.role)) throw new Error('Unsupported user role.');
  if (user.role === 'owner' && user.isActive !== true) {
    throw new Error('The owner account must be active when it is created.');
  }
  if (typeof user.isActive !== 'boolean' || typeof user.mustChangePin !== 'boolean') {
    throw new Error('User status fields must be boolean values.');
  }
  assertCredentialMaterial(user.pinSalt, user.pinHash, user.sessionVersion);
}

function insertUserRow(db: DatabaseSync, user: SqliteUserRecord): SqliteUserRecord {
  const username = user.username.trim().toLowerCase();
  db.prepare(`
    INSERT INTO app_users (
      id, username, name, role, branch_id, branch_name, pin_salt, pin_hash,
      is_active, must_change_pin, session_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id.trim(), username, user.name.trim(), user.role,
    user.branchId.trim(), user.branchName.trim(), user.pinSalt.toLowerCase(),
    user.pinHash.toLowerCase(), user.isActive ? 1 : 0,
    user.mustChangePin ? 1 : 0, user.sessionVersion.toLowerCase(), user.createdAt.trim()
  );
  const created = selectUserById(db, user.id.trim());
  if (!created) throw new Error('Inserted user could not be read back.');
  return created;
}

/** Creates one account in a transaction. The schema's partial unique index permits one owner only. */
export function insertSqliteUser(db: DatabaseSync, user: SqliteUserRecord): SqlitePublicUser {
  validateSqliteUser(user);
  return withImmediateTransaction(db, () => toPublicUser(insertUserRow(db, user)));
}

/**
 * Imports a complete legacy user set atomically.
 * Refuses partial owner sets and refuses to mix imported users with existing accounts.
 */
export function importSqliteUsers(
  db: DatabaseSync,
  users: SqliteUserRecord[]
): SqlitePublicUser[] {
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error('User import requires a non-empty user list.');
  }
  users.forEach(validateSqliteUser);

  const owners = users.filter((user) => user.role === 'owner');
  if (owners.length !== 1 || owners[0].isActive !== true) {
    throw new Error('User import requires exactly one active owner account.');
  }

  const usernames = new Set<string>();
  const userIds = new Set<string>();
  for (const user of users) {
    const username = user.username.trim().toLowerCase();
    const id = user.id.trim();
    if (usernames.has(username) || userIds.has(id)) {
      throw new Error('User import contains duplicate usernames or user IDs.');
    }
    usernames.add(username);
    userIds.add(id);
  }

  return withImmediateTransaction(db, () => {
    const existing = db.prepare('SELECT COUNT(*) AS count FROM app_users').get() as
      | { count: number }
      | undefined;
    if (Number(existing?.count ?? 0) !== 0) {
      throw new Error('User import refused because SQLite already contains user accounts.');
    }

    const imported = users.map((user) => toPublicUser(insertUserRow(db, user)));
    const ownerCount = db.prepare(
      "SELECT COUNT(*) AS count FROM app_users WHERE role = 'owner' AND is_active = 1"
    ).get() as { count: number };
    if (Number(ownerCount.count) !== 1) {
      throw new Error('Imported SQLite users failed the active-owner integrity check.');
    }
    return imported;
  });
}

export function getSqliteUserByUsername(
  db: DatabaseSync,
  username: string
): SqliteUserRecord | undefined {
  const normalized = String(username || '').trim().toLowerCase();
  if (!normalized) return undefined;
  const row = db.prepare('SELECT * FROM app_users WHERE username = ? COLLATE NOCASE').get(normalized) as
    | Record<string, unknown>
    | undefined;
  return mapUser(row);
}

export function listSqlitePublicUsers(db: DatabaseSync): SqlitePublicUser[] {
  const rows = db.prepare(`
    SELECT id, username, name, role, branch_id, branch_name, is_active, created_at
    FROM app_users
    ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, name COLLATE NOCASE
  `).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    username: String(row.username),
    name: String(row.name),
    role: String(row.role) as SqliteUserRole,
    branchId: String(row.branch_id),
    branchName: String(row.branch_name),
    isActive: Number(row.is_active) === 1,
    createdAt: String(row.created_at),
  }));
}

/** Status changes rotate the session version so previously issued JWTs become invalid. */
export function setSqliteUserActive(
  db: DatabaseSync,
  userId: string,
  isActive: boolean,
  nextSessionVersion: string
): SqlitePublicUser {
  assertText(userId, 'userId');
  if (typeof isActive !== 'boolean') throw new Error('isActive must be boolean.');
  if (!/^[a-f0-9]{32}$/i.test(nextSessionVersion)) throw new Error('Invalid session version.');

  return withImmediateTransaction(db, () => {
    const current = selectUserById(db, userId);
    if (!current) throw new Error('User does not exist.');
    if (current.role === 'owner' && !isActive) throw new Error('The only owner account cannot be disabled.');
    db.prepare(`
      UPDATE app_users SET is_active = ?, session_version = ? WHERE id = ?
    `).run(isActive ? 1 : 0, nextSessionVersion.toLowerCase(), userId);
    const updated = selectUserById(db, userId);
    if (!updated) throw new Error('Updated user could not be read back.');
    return toPublicUser(updated);
  });
}

/** PIN reset is owner-managed for staff accounts; the owner changes their own PIN in-session. */
export function resetSqliteStaffPin(
  db: DatabaseSync,
  userId: string,
  pinSalt: string,
  pinHash: string,
  nextSessionVersion: string
): SqlitePublicUser {
  assertCredentialMaterial(pinSalt, pinHash, nextSessionVersion);
  return withImmediateTransaction(db, () => {
    const current = selectUserById(db, userId);
    if (!current) throw new Error('User does not exist.');
    if (current.role === 'owner') throw new Error('Owner PIN must be changed from the owner session.');
    db.prepare(`
      UPDATE app_users
      SET pin_salt = ?, pin_hash = ?, is_active = 1, must_change_pin = 0, session_version = ?
      WHERE id = ?
    `).run(pinSalt.toLowerCase(), pinHash.toLowerCase(), nextSessionVersion.toLowerCase(), userId);
    const updated = selectUserById(db, userId);
    if (!updated) throw new Error('Reset user could not be read back.');
    return toPublicUser(updated);
  });
}

/** Compare-and-swap session version prevents a stale request from overwriting newer credentials. */
export function changeSqliteUserPin(
  db: DatabaseSync,
  userId: string,
  expectedSessionVersion: string,
  pinSalt: string,
  pinHash: string,
  nextSessionVersion: string
): void {
  assertCredentialMaterial(pinSalt, pinHash, nextSessionVersion);
  if (!/^[a-f0-9]{32}$/i.test(expectedSessionVersion)) throw new Error('Invalid expected session version.');
  withImmediateTransaction(db, () => {
    const result = db.prepare(`
      UPDATE app_users
      SET pin_salt = ?, pin_hash = ?, must_change_pin = 0, session_version = ?
      WHERE id = ? AND is_active = 1 AND session_version = ?
    `).run(
      pinSalt.toLowerCase(), pinHash.toLowerCase(), nextSessionVersion.toLowerCase(),
      userId, expectedSessionVersion.toLowerCase()
    );
    if (Number(result.changes) !== 1) {
      throw new Error('User is inactive, missing, or its credentials changed concurrently.');
    }
  });
}

export function appendSqliteSecurityEvent(db: DatabaseSync, event: SqliteSecurityEventInput): void {
  assertText(event.id, 'event.id', 160);
  assertText(event.occurredAt, 'event.occurredAt');
  assertText(event.usernameOrRole, 'event.usernameOrRole', 120);
  assertText(event.ipAddress, 'event.ipAddress', 64);
  assertText(event.details, 'event.details', 2000);
  const allowed: SqliteSecurityEventType[] = [
    'LOGIN_SUCCESS', 'LOGIN_FAILED', 'ROLE_ACCESS_DENIED',
    'RATE_LIMIT_EXCEEDED', 'BRUTE_FORCE_BLOCKED',
  ];
  if (!allowed.includes(event.eventType)) throw new Error('Unsupported security event type.');
  db.prepare(`
    INSERT INTO security_events (id, occurred_at, event_type, username_or_role, ip_address, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    event.id.trim(), event.occurredAt.trim(), event.eventType,
    event.usernameOrRole.trim(), event.ipAddress.trim(), event.details.trim()
  );
}

export function listSqliteSecurityEvents(
  db: DatabaseSync,
  limit = 100
): SqliteSecurityEvent[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('Security event limit must be an integer between 1 and 1000.');
  }
  const rows = db.prepare(`
    SELECT id, occurred_at, event_type, username_or_role, ip_address, details
    FROM security_events
    ORDER BY occurred_at DESC, id DESC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    occurredAt: String(row.occurred_at),
    eventType: String(row.event_type) as SqliteSecurityEventType,
    usernameOrRole: String(row.username_or_role),
    ipAddress: String(row.ip_address),
    details: String(row.details),
  }));
}

/**
 * Produces a complete legacy-JSON-compatible user snapshot for controlled rollback.
 * All session versions are rotated in the same SQLite transaction before the
 * snapshot is returned, invalidating tokens created by the SQLite auth runtime.
 */
export function exportSqliteUsersForJsonRollback(db: DatabaseSync): SqliteUserRecord[] {
  return withImmediateTransaction(db, () => {
    const rows = db.prepare(`
      SELECT * FROM app_users
      ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, name COLLATE NOCASE
    `).all() as Array<Record<string, unknown>>;
    const users = rows.map((row) => mapUser(row)).filter(
      (user): user is SqliteUserRecord => Boolean(user)
    );

    if (users.length === 0) {
      throw new Error('Rollback export refused: SQLite contains no user accounts.');
    }
    users.forEach(validateSqliteUser);
    const ownerCount = users.filter((user) => user.role === 'owner').length;
    const activeOwnerCount = users.filter((user) => user.role === 'owner' && user.isActive).length;
    if (ownerCount !== 1 || activeOwnerCount !== 1) {
      throw new Error('Rollback export refused: exactly one active owner is required.');
    }

    const updateVersion = db.prepare(
      'UPDATE app_users SET session_version = ? WHERE id = ?'
    );
    for (const user of users) {
      const nextVersion = crypto.randomBytes(16).toString('hex');
      const result = updateVersion.run(nextVersion, user.id);
      if (Number(result.changes) !== 1) {
        throw new Error('Rollback export could not rotate every SQLite session version.');
      }
      user.sessionVersion = nextVersion;
    }
    return users;
  });
}

function toPublicUser(user: SqliteUserRecord): SqlitePublicUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    branchId: user.branchId,
    branchName: user.branchName,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}


export interface SqliteLoginAttempt {
  attemptKey: string;
  attempts: number;
  lockUntilMs: number;
  updatedAt: string;
}

function mapLoginAttempt(row: Record<string, unknown> | undefined): SqliteLoginAttempt | undefined {
  if (!row) return undefined;
  return {
    attemptKey: String(row.attempt_key),
    attempts: Number(row.attempts),
    lockUntilMs: Number(row.lock_until_ms),
    updatedAt: String(row.updated_at),
  };
}

export function getSqliteLoginAttempt(
  db: DatabaseSync,
  attemptKey: string
): SqliteLoginAttempt | undefined {
  if (!/^[a-f0-9]{64}$/i.test(attemptKey)) throw new Error('Invalid authentication attempt key.');
  const row = db.prepare(
    'SELECT attempt_key, attempts, lock_until_ms, updated_at ' +
    'FROM auth_login_attempts WHERE attempt_key = ?'
  ).get(attemptKey.toLowerCase()) as Record<string, unknown> | undefined;
  return mapLoginAttempt(row);
}

/**
 * Records a failed attempt atomically across concurrent requests/processes.
 * A lock that has expired starts a fresh failure window.
 */
export function recordSqliteLoginFailure(
  db: DatabaseSync,
  attemptKey: string,
  nowMs: number,
  lockDurationMs: number,
  maxAttempts: number,
  updatedAt: string
): SqliteLoginAttempt & { locked: boolean } {
  if (!/^[a-f0-9]{64}$/i.test(attemptKey)) throw new Error('Invalid authentication attempt key.');
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('Invalid authentication clock value.');
  if (!Number.isSafeInteger(lockDurationMs) || lockDurationMs < 1000) throw new Error('Invalid authentication lock duration.');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) throw new Error('Invalid authentication attempt limit.');
  assertText(updatedAt, 'updatedAt');

  return withImmediateTransaction(db, () => {
    const row = db.prepare(
      'SELECT attempt_key, attempts, lock_until_ms, updated_at ' +
      'FROM auth_login_attempts WHERE attempt_key = ?'
    ).get(attemptKey.toLowerCase()) as Record<string, unknown> | undefined;
    const current = mapLoginAttempt(row);

    if (current && current.lockUntilMs > nowMs) {
      return { ...current, locked: true };
    }

    const previousAttempts = current && current.lockUntilMs === 0
      ? current.attempts
      : 0;
    const attempts = previousAttempts + 1;
    const locked = attempts >= maxAttempts;
    const lockUntilMs = locked ? nowMs + lockDurationMs : 0;

    db.prepare(
      'INSERT INTO auth_login_attempts (attempt_key, attempts, lock_until_ms, updated_at) ' +
      'VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(attempt_key) DO UPDATE SET ' +
      'attempts = excluded.attempts, lock_until_ms = excluded.lock_until_ms, updated_at = excluded.updated_at'
    ).run(attemptKey.toLowerCase(), attempts, lockUntilMs, updatedAt);

    return {
      attemptKey: attemptKey.toLowerCase(),
      attempts,
      lockUntilMs,
      updatedAt,
      locked,
    };
  });
}

export function clearSqliteLoginAttempt(db: DatabaseSync, attemptKey: string): void {
  if (!/^[a-f0-9]{64}$/i.test(attemptKey)) throw new Error('Invalid authentication attempt key.');
  db.prepare('DELETE FROM auth_login_attempts WHERE attempt_key = ?').run(attemptKey.toLowerCase());
}
