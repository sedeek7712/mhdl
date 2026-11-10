import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPrivateFilePermissions } from '../security/privateFilePermissions.js';
import { openSqliteDatabase, runSqliteMigrations } from './sqliteDatabase.js';
import { SQLITE_MIGRATIONS } from './sqliteMigrations.js';
import {
  getSqliteUserByUsername,
  importSqliteUsers,
  listSqlitePublicUsers,
  type SqliteUserRecord,
} from './sqliteAuthRepository.js';

const ALLOWED_ROLES: SqliteUserRecord['role'][] = [
  'owner', 'general_manager', 'branch_manager', 'teller',
  'auditor', 'accountant', 'compliance_officer',
];

export interface SqliteAuthMigrationOptions {
  sourceFile: string;
  databaseFile?: string;
  apply: boolean;
}

export interface SqliteAuthMigrationReport {
  status: 'PASS';
  mode: 'dry-run' | 'apply';
  sourceFile: string;
  sourceSha256: string;
  userCount: number;
  activeOwnerCount: number;
  staffCount: number;
  sqliteFile: string;
  backupFile?: string;
  integrityCheck: string;
  foreignKeyViolations: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requiredString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new Error('Invalid user file: ' + field + ' must be a non-empty string of at most ' + maxLength + ' characters.');
  }
  return value.trim();
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Parses the user shape supported by the JSON auth service.
 * Existing PIN salt/hash material is preserved; plaintext PINs are never read.
 */
export function parseLegacyAuthUsers(raw: string): SqliteUserRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid user file: JSON parsing failed. No database was changed.');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Invalid user file: expected a non-empty array of user records.');
  }

  const users = parsed.map((entry, index): SqliteUserRecord => {
    if (!isRecord(entry)) {
      throw new Error('Invalid user file: user record ' + (index + 1) + ' is not an object.');
    }

    const role = entry.role;
    if (typeof role !== 'string' || !ALLOWED_ROLES.includes(role as SqliteUserRecord['role'])) {
      throw new Error('Invalid user file: unsupported role in record ' + (index + 1) + '.');
    }
    if (typeof entry.isActive !== 'boolean' || typeof entry.mustChangePin !== 'boolean') {
      throw new Error('Invalid user file: status fields are missing in record ' + (index + 1) + '.');
    }

    return {
      id: requiredString(entry.id, 'id'),
      username: requiredString(entry.username, 'username', 32).toLowerCase(),
      name: requiredString(entry.name, 'name', 120),
      role: role as SqliteUserRecord['role'],
      branchId: requiredString(entry.branchId, 'branchId'),
      branchName: requiredString(entry.branchName, 'branchName'),
      pinSalt: requiredString(entry.pinSalt, 'pinSalt'),
      pinHash: requiredString(entry.pinHash, 'pinHash'),
      isActive: entry.isActive,
      mustChangePin: entry.mustChangePin,
      sessionVersion: requiredString(entry.sessionVersion, 'sessionVersion'),
      createdAt: requiredString(entry.createdAt, 'createdAt'),
    };
  });

  const owners = users.filter((user) => user.role === 'owner');
  if (owners.length !== 1 || owners[0].isActive !== true) {
    throw new Error('User import requires exactly one active owner. No database was changed.');
  }

  return users;
}

function createBackup(sourceFile: string, sourceBytes: Buffer, sourceHash: string): string {
  const backupFile = sourceFile + '.before-sqlite-auth-import-' +
    new Date().toISOString().replace(/[:.]/g, '-') + '.bak';

  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(backupFile, 'wx', 0o600);
    fs.closeSync(descriptor);
    descriptor = undefined;
    applyPrivateFilePermissions(backupFile);
    descriptor = fs.openSync(backupFile, 'r+');
    fs.writeFileSync(descriptor, sourceBytes);
    fs.fsyncSync(descriptor);
  } catch (error) {
    try {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      fs.unlinkSync(backupFile);
    } catch {
      // Preserve the original backup creation failure.
    }
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }

  const backupHash = sha256(fs.readFileSync(backupFile));
  if (backupHash !== sourceHash) {
    throw new Error('Backup checksum verification failed. SQLite import was not started.');
  }
  return backupFile;
}

/**
 * Dry-run is the default and always uses an in-memory database.
 * Permanent import requires apply=true and an explicit database file path.
 * The source JSON is read-only and is never deleted or rewritten.
 */
export function runSqliteAuthUserMigration(
  options: SqliteAuthMigrationOptions
): SqliteAuthMigrationReport {
  const sourceFile = path.resolve(options.sourceFile);
  if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
    throw new Error('User source file does not exist or is not a regular file.');
  }

  if (options.apply && !options.databaseFile) {
    throw new Error('Permanent import requires an explicit SQLite database file path.');
  }
  if (!options.apply && options.databaseFile) {
    throw new Error('A database file is accepted only with --apply. Dry-run always uses an in-memory database.');
  }

  const databaseFile = options.apply ? path.resolve(options.databaseFile as string) : ':memory:';
  if (options.apply && databaseFile === sourceFile) {
    throw new Error('The source JSON file and SQLite database file must be different paths.');
  }

  const sourceBytes = fs.readFileSync(sourceFile);
  const sourceHash = sha256(sourceBytes);
  const users = parseLegacyAuthUsers(sourceBytes.toString('utf8'));
  let backupFile: string | undefined;

  if (options.apply) {
    backupFile = createBackup(sourceFile, sourceBytes, sourceHash);
    if (sha256(fs.readFileSync(sourceFile)) !== sourceHash) {
      throw new Error('The source user file changed during backup. No user import was performed.');
    }
  }

  const db = openSqliteDatabase({ filePath: databaseFile });
  try {
    runSqliteMigrations(db, SQLITE_MIGRATIONS);
    importSqliteUsers(db, users);

    const publicUsers = listSqlitePublicUsers(db);
    const activeOwnerCount = publicUsers.filter(
      (user) => user.role === 'owner' && user.isActive
    ).length;
    if (publicUsers.length !== users.length || activeOwnerCount !== 1) {
      throw new Error('Post-import user parity check failed.');
    }

    for (const user of users) {
      const stored = getSqliteUserByUsername(db, user.username);
      if (!stored || stored.id !== user.id || stored.sessionVersion !== user.sessionVersion) {
        throw new Error('Post-import credential identity check failed.');
      }
    }

    const integrity = db.prepare('PRAGMA integrity_check').get() as
      | { integrity_check?: unknown }
      | undefined;
    const integrityCheck = String(integrity?.integrity_check ?? 'missing');
    const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all().length;
    if (integrityCheck !== 'ok' || foreignKeyViolations !== 0) {
      throw new Error('SQLite integrity or foreign-key validation failed after user import.');
    }

    return {
      status: 'PASS',
      mode: options.apply ? 'apply' : 'dry-run',
      sourceFile: path.basename(sourceFile),
      sourceSha256: sourceHash,
      userCount: publicUsers.length,
      activeOwnerCount,
      staffCount: publicUsers.filter((user) => user.role !== 'owner').length,
      sqliteFile: options.apply ? databaseFile : ':memory:',
      ...(backupFile ? { backupFile: path.basename(backupFile) } : {}),
      integrityCheck,
      foreignKeyViolations,
    };
  } finally {
    db.close();
  }
}
