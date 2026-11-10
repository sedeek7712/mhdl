import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as sqlite from 'node:sqlite';

type SqliteBackupFunction = (
  sourceDb: sqlite.DatabaseSync,
  destination: string,
  options?: { rate?: number }
) => Promise<number>;

export interface SqliteBackupOptions {
  sourceFile: string;
  destinationFile: string;
  busyTimeoutMs?: number;
}

export interface SqliteRestoreOptions {
  backupFile: string;
  destinationFile: string;
  expectedSha256: string;
  busyTimeoutMs?: number;
}

export interface SqliteBackupResult {
  file: string;
  sha256: string;
  sizeBytes: number;
  pages: number;
}

export interface SqliteRestoreResult {
  file: string;
  backupSha256: string;
  restoredSha256: string;
  sizeBytes: number;
  pages: number;
}

export interface SqliteIntegrityReport {
  integrityCheck: 'ok';
  foreignKeyViolations: 0;
}

const backupDatabase = (sqlite as unknown as { backup?: SqliteBackupFunction }).backup;

function requireBackupApi(): SqliteBackupFunction {
  if (typeof backupDatabase !== 'function') {
    throw new Error('SQLite online backup requires Node.js 22.16.0 or newer with node:sqlite backup support.');
  }
  return backupDatabase;
}

function resolveRegularFile(filePath: string, field: string): string {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error(field + ' must be a non-empty file path.');
  }
  const resolved = path.resolve(filePath);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(field + ' does not exist.');
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(field + ' must be an existing regular file, not a symbolic link or directory.');
  }
  return resolved;
}

function resolveNewFile(filePath: string, field: string): string {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error(field + ' must be a non-empty file path.');
  }
  const resolved = path.resolve(filePath);
  let stat: fs.Stats | undefined;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (stat) {
    throw new Error(field + ' already exists. Refusing to overwrite an existing file.');
  }

  const parent = path.dirname(resolved);
  const parentStat = fs.lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error(field + ' parent path must be an existing regular directory.');
  }
  return resolved;
}

function assertDifferentFiles(first: string, second: string): void {
  const normalize = (value: string) => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  if (normalize(first) === normalize(second)) {
    throw new Error('SQLite source and destination paths must be different.');
  }
}

function reserveTemporaryFile(destinationFile: string): string {
  const directory = path.dirname(destinationFile);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const temporary = path.join(
      directory,
      '.' + path.basename(destinationFile) + '.tmp-' + crypto.randomUUID()
    );
    try {
      const descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.closeSync(descriptor);
      return temporary;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Unable to reserve a unique temporary SQLite backup file.');
}

function applyPrivatePermissions(filePath: string): void {
  if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600);
}

function flushFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, 'r+');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function removeTemporaryFiles(filePath: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      fs.unlinkSync(filePath + suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function verifySqliteFile(filePath: string, busyTimeoutMs: number): SqliteIntegrityReport {
  const db = new sqlite.DatabaseSync(filePath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA query_only = ON');
    db.exec('PRAGMA busy_timeout = ' + busyTimeoutMs);

    const integrity = db.prepare('PRAGMA integrity_check').get() as
      | { integrity_check?: unknown }
      | undefined;
    if (String(integrity?.integrity_check ?? '') !== 'ok') {
      throw new Error('SQLite integrity_check did not return ok.');
    }
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length !== 0) {
      throw new Error('SQLite foreign_key_check detected ' + violations.length + ' violation(s).');
    }
    return { integrityCheck: 'ok', foreignKeyViolations: 0 };
  } finally {
    db.close();
  }
}

function publishWithoutOverwrite(temporaryFile: string, destinationFile: string): void {
  // link() is an atomic create-if-absent operation on the same filesystem.
  // Unlike rename(), it cannot replace a destination created by another process.
  fs.linkSync(temporaryFile, destinationFile);
  fs.unlinkSync(temporaryFile);
}

/**
 * Creates a consistent SQLite snapshot using Node's online backup API.
 * The destination must not exist; the source remains untouched.
 *
 * The resulting file is plaintext. This primitive is intended for controlled
 * test/development workflows until an encrypted backup envelope is integrated.
 */
export async function createSqliteBackup(
  options: SqliteBackupOptions
): Promise<SqliteBackupResult> {
  const backup = requireBackupApi();
  const sourceFile = resolveRegularFile(options.sourceFile, 'SQLite source file');
  const destinationFile = resolveNewFile(options.destinationFile, 'SQLite backup destination');
  assertDifferentFiles(sourceFile, destinationFile);
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 60000) {
    throw new Error('SQLite busyTimeoutMs must be an integer between 0 and 60000.');
  }

  const temporaryFile = reserveTemporaryFile(destinationFile);
  let sourceDb: sqlite.DatabaseSync | undefined;
  try {
    sourceDb = new sqlite.DatabaseSync(sourceFile);
    sourceDb.exec('PRAGMA busy_timeout = ' + busyTimeoutMs);
    sourceDb.exec('PRAGMA foreign_keys = ON');
    sourceDb.exec('PRAGMA query_only = ON');
    verifySqliteFile(sourceFile, busyTimeoutMs);

    const pages = await backup(sourceDb, temporaryFile);
    sourceDb.close();
    sourceDb = undefined;

    verifySqliteFile(temporaryFile, busyTimeoutMs);
    applyPrivatePermissions(temporaryFile);
    flushFile(temporaryFile);
    const sha256 = await hashFile(temporaryFile);
    const sizeBytes = fs.statSync(temporaryFile).size;
    if (!Number.isSafeInteger(pages) || pages < 0 || sizeBytes <= 0) {
      throw new Error('SQLite backup returned invalid page or file-size metadata.');
    }

    publishWithoutOverwrite(temporaryFile, destinationFile);
    return { file: destinationFile, sha256, sizeBytes, pages };
  } catch (error) {
    try {
      sourceDb?.close();
    } catch {
      // Preserve the original backup error.
    }
    throw error;
  } finally {
    removeTemporaryFiles(temporaryFile);
  }
}

/**
 * Restores a verified backup into a new database file.
 * It never overwrites an existing target and validates the restored database
 * before publishing it at the destination path.
 */
export async function restoreSqliteBackup(
  options: SqliteRestoreOptions
): Promise<SqliteRestoreResult> {
  const backup = requireBackupApi();
  const backupFile = resolveRegularFile(options.backupFile, 'SQLite backup file');
  const destinationFile = resolveNewFile(options.destinationFile, 'SQLite restore destination');
  assertDifferentFiles(backupFile, destinationFile);
  if (!/^[a-f0-9]{64}$/i.test(options.expectedSha256)) {
    throw new Error('A valid 64-character SHA-256 checksum is required for restore.');
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 60000) {
    throw new Error('SQLite busyTimeoutMs must be an integer between 0 and 60000.');
  }

  const backupSha256 = await hashFile(backupFile);
  if (backupSha256 !== options.expectedSha256.toLowerCase()) {
    throw new Error('SQLite backup SHA-256 mismatch. Restore was refused.');
  }
  verifySqliteFile(backupFile, busyTimeoutMs);

  const temporaryFile = reserveTemporaryFile(destinationFile);
  let backupDb: sqlite.DatabaseSync | undefined;
  try {
    backupDb = new sqlite.DatabaseSync(backupFile);
    backupDb.exec('PRAGMA busy_timeout = ' + busyTimeoutMs);
    backupDb.exec('PRAGMA foreign_keys = ON');
    backupDb.exec('PRAGMA query_only = ON');

    const pages = await backup(backupDb, temporaryFile);
    backupDb.close();
    backupDb = undefined;

    verifySqliteFile(temporaryFile, busyTimeoutMs);
    applyPrivatePermissions(temporaryFile);
    flushFile(temporaryFile);
    const restoredSha256 = await hashFile(temporaryFile);
    const sizeBytes = fs.statSync(temporaryFile).size;
    if (!Number.isSafeInteger(pages) || pages < 0 || sizeBytes <= 0) {
      throw new Error('SQLite restore returned invalid page or file-size metadata.');
    }

    publishWithoutOverwrite(temporaryFile, destinationFile);
    return {
      file: destinationFile,
      backupSha256,
      restoredSha256,
      sizeBytes,
      pages,
    };
  } catch (error) {
    try {
      backupDb?.close();
    } catch {
      // Preserve the original restore error.
    }
    throw error;
  } finally {
    removeTemporaryFiles(temporaryFile);
  }
}
