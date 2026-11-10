import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as sqlite from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { applyPrivateFilePermissions } from '../security/privateFilePermissions.js';

type SqliteBackupFunction = (
  sourceDb: sqlite.DatabaseSync,
  destination: string,
  options?: { rate?: number }
) => Promise<number>;

const ENCRYPTED_BACKUP_MAGIC = Buffer.from('ALNDB001', 'ascii');
const ENCRYPTED_BACKUP_IV_BYTES = 12;
const ENCRYPTED_BACKUP_TAG_BYTES = 16;
const ENCRYPTED_BACKUP_HEADER_BYTES =
  ENCRYPTED_BACKUP_MAGIC.length + ENCRYPTED_BACKUP_IV_BYTES + ENCRYPTED_BACKUP_TAG_BYTES;

export interface SqliteBackupOptions {
  sourceFile: string;
  destinationFile: string;
  /** Exactly 64 hexadecimal characters (32 bytes); keep it outside the database and backups. */
  encryptionKeyHex: string;
  busyTimeoutMs?: number;
}

export interface SqliteRestoreOptions {
  backupFile: string;
  destinationFile: string;
  expectedSha256: string;
  /** The same 32-byte key used to create the encrypted backup. */
  encryptionKeyHex: string;
  busyTimeoutMs?: number;
}

export interface SqliteBackupResult {
  file: string;
  sha256: string;
  sizeBytes: number;
  pages: number;
  encryption: 'AES-256-GCM';
}

export interface SqliteRestoreResult {
  file: string;
  backupSha256: string;
  restoredSha256: string;
  sizeBytes: number;
  pages: number;
  encryption: 'AES-256-GCM';
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

function parseEncryptionKey(keyHex: string): Buffer {
  if (typeof keyHex !== 'string' || !/^[a-f0-9]{64}$/i.test(keyHex)) {
    throw new Error('SQLite backup encryption requires a 64-character hexadecimal AES-256 key.');
  }
  return Buffer.from(keyHex, 'hex');
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
    let descriptor: number | undefined;
    let created = false;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      created = true;
      // Lock down the empty file before SQLite or crypto writes sensitive bytes.
      applyPrivateFilePermissions(temporary);
      fs.closeSync(descriptor);
      descriptor = undefined;
      return temporary;
    } catch (error) {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (created) {
        try {
          fs.unlinkSync(temporary);
        } catch {
          // Preserve the original permission or filesystem error.
        }
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Unable to reserve a unique private SQLite temporary file.');
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

/** Writes an authenticated AES-256-GCM envelope; plaintext never becomes the published backup. */
async function encryptSqliteFile(sourceFile: string, encryptedFile: string, key: Buffer): Promise<void> {
  const iv = crypto.randomBytes(ENCRYPTED_BACKUP_IV_BYTES);
  const header = Buffer.concat([
    ENCRYPTED_BACKUP_MAGIC,
    iv,
    Buffer.alloc(ENCRYPTED_BACKUP_TAG_BYTES),
  ]);
  const headerFd = fs.openSync(encryptedFile, 'r+');
  try {
    fs.writeSync(headerFd, header, 0, header.length, 0);
    fs.fsyncSync(headerFd);
  } finally {
    fs.closeSync(headerFd);
  }

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  await pipeline(
    fs.createReadStream(sourceFile),
    cipher,
    fs.createWriteStream(encryptedFile, { flags: 'a' })
  );

  const tag = cipher.getAuthTag();
  const descriptor = fs.openSync(encryptedFile, 'r+');
  try {
    fs.writeSync(
      descriptor,
      tag,
      0,
      tag.length,
      ENCRYPTED_BACKUP_MAGIC.length + ENCRYPTED_BACKUP_IV_BYTES
    );
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  applyPrivateFilePermissions(encryptedFile);
}

/** Decrypts only authenticated ALNDB001 envelopes into a pre-created private temp file. */
async function decryptSqliteFile(encryptedFile: string, destinationFile: string, key: Buffer): Promise<void> {
  const descriptor = fs.openSync(encryptedFile, 'r');
  const header = Buffer.alloc(ENCRYPTED_BACKUP_HEADER_BYTES);
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (bytesRead !== ENCRYPTED_BACKUP_HEADER_BYTES ||
      !header.subarray(0, ENCRYPTED_BACKUP_MAGIC.length).equals(ENCRYPTED_BACKUP_MAGIC)) {
    throw new Error('Unsupported SQLite backup format. A current AES-256-GCM encrypted backup is required.');
  }

  const ivStart = ENCRYPTED_BACKUP_MAGIC.length;
  const tagStart = ivStart + ENCRYPTED_BACKUP_IV_BYTES;
  const iv = header.subarray(ivStart, tagStart);
  const tag = header.subarray(tagStart, ENCRYPTED_BACKUP_HEADER_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  await pipeline(
    fs.createReadStream(encryptedFile, { start: ENCRYPTED_BACKUP_HEADER_BYTES }),
    decipher,
    fs.createWriteStream(destinationFile, { flags: 'w' })
  );
  applyPrivateFilePermissions(destinationFile);
  flushFile(destinationFile);
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
 * Creates a consistent SQLite snapshot and publishes only its AES-256-GCM
 * encrypted envelope. The 32-byte encryption key is supplied by the caller
 * and must be stored separately from the backup.
 */
export async function createSqliteBackup(
  options: SqliteBackupOptions
): Promise<SqliteBackupResult> {
  const backup = requireBackupApi();
  const encryptionKey = parseEncryptionKey(options.encryptionKeyHex);
  const sourceFile = resolveRegularFile(options.sourceFile, 'SQLite source file');
  const destinationFile = resolveNewFile(options.destinationFile, 'SQLite backup destination');
  assertDifferentFiles(sourceFile, destinationFile);
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 60000) {
    throw new Error('SQLite busyTimeoutMs must be an integer between 0 and 60000.');
  }

  const temporaryFile = reserveTemporaryFile(destinationFile);
  let encryptedTemporaryFile: string | undefined;
  let sourceDb: sqlite.DatabaseSync | undefined;
  try {
    encryptedTemporaryFile = reserveTemporaryFile(destinationFile);
    sourceDb = new sqlite.DatabaseSync(sourceFile);
    sourceDb.exec('PRAGMA busy_timeout = ' + busyTimeoutMs);
    sourceDb.exec('PRAGMA foreign_keys = ON');
    sourceDb.exec('PRAGMA query_only = ON');
    verifySqliteFile(sourceFile, busyTimeoutMs);

    const pages = await backup(sourceDb, temporaryFile);
    sourceDb.close();
    sourceDb = undefined;

    verifySqliteFile(temporaryFile, busyTimeoutMs);
    applyPrivateFilePermissions(temporaryFile);
    flushFile(temporaryFile);
    await encryptSqliteFile(temporaryFile, encryptedTemporaryFile, encryptionKey);
    const sha256 = await hashFile(encryptedTemporaryFile);
    const sizeBytes = fs.statSync(encryptedTemporaryFile).size;
    if (!Number.isSafeInteger(pages) || pages < 0 || sizeBytes <= ENCRYPTED_BACKUP_HEADER_BYTES) {
      throw new Error('SQLite backup returned invalid page or encrypted file-size metadata.');
    }

    publishWithoutOverwrite(encryptedTemporaryFile, destinationFile);
    return { file: destinationFile, sha256, sizeBytes, pages, encryption: 'AES-256-GCM' };
  } catch (error) {
    try {
      sourceDb?.close();
    } catch {
      // Preserve the original backup error.
    }
    throw error;
  } finally {
    removeTemporaryFiles(temporaryFile);
    if (encryptedTemporaryFile) removeTemporaryFiles(encryptedTemporaryFile);
  }
}

/**
 * Restores a checksum- and GCM-authenticated encrypted backup into a new file.
 * It never overwrites an existing target and validates the restored database
 * before publishing it at the destination path.
 */
export async function restoreSqliteBackup(
  options: SqliteRestoreOptions
): Promise<SqliteRestoreResult> {
  const backup = requireBackupApi();
  const encryptionKey = parseEncryptionKey(options.encryptionKeyHex);
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

  const decryptedBackupFile = reserveTemporaryFile(destinationFile);
  let temporaryFile: string | undefined;
  let backupDb: sqlite.DatabaseSync | undefined;
  try {
    temporaryFile = reserveTemporaryFile(destinationFile);
    await decryptSqliteFile(backupFile, decryptedBackupFile, encryptionKey);
    verifySqliteFile(decryptedBackupFile, busyTimeoutMs);
    backupDb = new sqlite.DatabaseSync(decryptedBackupFile);
    backupDb.exec('PRAGMA busy_timeout = ' + busyTimeoutMs);
    backupDb.exec('PRAGMA foreign_keys = ON');
    backupDb.exec('PRAGMA query_only = ON');

    const pages = await backup(backupDb, temporaryFile);
    backupDb.close();
    backupDb = undefined;

    verifySqliteFile(temporaryFile, busyTimeoutMs);
    applyPrivateFilePermissions(temporaryFile);
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
      encryption: 'AES-256-GCM',
    };
  } catch (error) {
    try {
      backupDb?.close();
    } catch {
      // Preserve the original restore error.
    }
    throw error;
  } finally {
    removeTemporaryFiles(decryptedBackupFile);
    if (temporaryFile) removeTemporaryFiles(temporaryFile);
  }
}
