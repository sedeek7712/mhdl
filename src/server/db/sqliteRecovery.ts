import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyPrivateFilePermissions } from '../security/privateFilePermissions.js';

const SIDECARS = [
  { kind: 'wal', suffix: '-wal' },
  { kind: 'shm', suffix: '-shm' },
  { kind: 'journal', suffix: '-journal' },
] as const;

type RecoveryFileKind = 'database' | 'wal' | 'shm' | 'journal';
export type SqliteRecoveryState =
  | 'prepared'
  | 'cutover_started'
  | 'cutover_complete'
  | 'rollback_started'
  | 'rolled_back';

interface RecoveryFileRecord {
  kind: RecoveryFileKind;
  livePath: string;
  existed: boolean;
  sha256?: string;
  sizeBytes?: number;
  backupFile?: string;
  displacedFile?: string;
}

export interface SqliteRecoveryManifest {
  format: 'ALNAMARI_SQLITE_RECOVERY_V1';
  operationId: string;
  createdAt: string;
  state: SqliteRecoveryState;
  databaseFile: string;
  stagedFile: string;
  stagedSha256: string;
  archiveDirectory: string;
  files: RecoveryFileRecord[];
}

export interface SqliteCutoverOptions {
  databaseFile: string;
  stagedFile: string;
  expectedStagedSha256: string;
  archiveDirectory: string;
  /** Explicit operator confirmation. This code does not detect or stop processes. */
  serverStopped: boolean;
}

export interface SqliteCutoverResult {
  status: 'CUTOVER_COMPLETE';
  databaseFile: string;
  manifestFile: string;
  archiveDirectory: string;
  databaseSha256: string;
  stagedSha256: string;
}

export interface SqliteRollbackResult {
  status: 'ROLLED_BACK';
  databaseFile: string;
  manifestFile: string;
  restoredSha256: string;
}

/** Hashes large files incrementally instead of reading the complete database into memory. */
export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function assertRegularFile(filePath: string, label: string): string {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(label + ' must be an existing regular file, not a symbolic link or directory.');
  }
  return resolved;
}

function assertDirectory(directory: string, label: string): string {
  const resolved = path.resolve(directory);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(label + ' must be an existing regular directory and cannot be a symbolic link.');
  }
  return resolved;
}

function checkpointSqliteWal(filePath: string): void {
  const db = new DatabaseSync(filePath);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
      | { busy?: unknown; log?: unknown; checkpointed?: unknown }
      | undefined;
    if (Number(checkpoint?.busy ?? 1) !== 0) {
      throw new Error('SQLite WAL checkpoint is busy. Confirm all application processes and database readers are stopped.');
    }
  } finally {
    db.close();
  }
}

function verifySqliteDatabase(filePath: string): void {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON');
    const integrity = db.prepare('PRAGMA integrity_check').get() as
      | { integrity_check?: unknown }
      | undefined;
    if (String(integrity?.integrity_check ?? '') !== 'ok') {
      throw new Error('SQLite recovery verification failed: integrity_check did not return ok.');
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length !== 0) {
      throw new Error('SQLite recovery verification failed: foreign-key violations were detected.');
    }
  } finally {
    db.close();
  }
}

function syncFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, 'r+');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function syncDirectory(directory: string): void {
  if (process.platform === 'win32') return;
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writePrivateFile(filePath: string, contents: string): void {
  const temporaryFile = filePath + '.tmp-' + crypto.randomUUID();
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryFile, 'wx', 0o600);
    applyPrivateFilePermissions(temporaryFile);
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryFile, filePath);
    syncDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporaryFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function writeManifest(manifest: SqliteRecoveryManifest): string {
  const manifestFile = path.join(manifest.archiveDirectory, 'recovery-manifest.json');
  writePrivateFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  return manifestFile;
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith('..' + path.sep) &&
    relative !== '..' && !path.isAbsolute(relative);
}

function validateManifest(manifestFile: string, value: unknown): SqliteRecoveryManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Recovery manifest is not a valid object.');
  }
  const manifest = value as Partial<SqliteRecoveryManifest>;
  if (manifest.format !== 'ALNAMARI_SQLITE_RECOVERY_V1' ||
      typeof manifest.operationId !== 'string' ||
      typeof manifest.databaseFile !== 'string' ||
      typeof manifest.stagedFile !== 'string' ||
      typeof manifest.stagedSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.stagedSha256) ||
      typeof manifest.archiveDirectory !== 'string' ||
      !Array.isArray(manifest.files) ||
      !['prepared', 'cutover_started', 'cutover_complete', 'rollback_started', 'rolled_back'].includes(String(manifest.state))) {
    throw new Error('Recovery manifest format or required fields are invalid.');
  }

  const resolvedManifest = path.resolve(manifestFile);
  const archiveDirectory = path.dirname(resolvedManifest);
  if (path.basename(resolvedManifest) !== 'recovery-manifest.json' ||
      path.resolve(manifest.archiveDirectory) !== archiveDirectory) {
    throw new Error('Recovery manifest is not located in its declared archive directory.');
  }

  const databaseFile = path.resolve(manifest.databaseFile);
  const stagedFile = path.resolve(manifest.stagedFile);
  if (databaseFile === stagedFile) {
    throw new Error('Recovery manifest contains identical database and staged paths.');
  }

  const expectedFiles: Array<{ kind: RecoveryFileKind; livePath: string }> = [
    { kind: 'database', livePath: databaseFile },
    ...SIDECARS.map((item) => ({
      kind: item.kind,
      livePath: databaseFile + item.suffix,
    })),
  ];
  if (manifest.files.length !== expectedFiles.length) {
    throw new Error('Recovery manifest does not contain the complete SQLite database file set.');
  }

  for (let index = 0; index < expectedFiles.length; index += 1) {
    const entry = manifest.files[index] as RecoveryFileRecord;
    const expected = expectedFiles[index];
    if (!entry || entry.kind !== expected.kind || path.resolve(entry.livePath) !== expected.livePath ||
        typeof entry.existed !== 'boolean') {
      throw new Error('Recovery manifest file entries do not match the declared database paths.');
    }
    if (entry.existed) {
      if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256) ||
          typeof entry.backupFile !== 'string' || typeof entry.displacedFile !== 'string' ||
          !isWithin(path.join(archiveDirectory, 'originals'), path.resolve(entry.backupFile)) ||
          !isWithin(path.join(archiveDirectory, 'displaced'), path.resolve(entry.displacedFile))) {
        throw new Error('Recovery manifest contains invalid archive paths or checksums.');
      }
    }
  }

  return manifest as SqliteRecoveryManifest;
}

function readManifest(manifestFile: string): SqliteRecoveryManifest {
  const resolved = assertRegularFile(manifestFile, 'Recovery manifest');
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8')) as unknown;
  return validateManifest(resolved, parsed);
}

function archiveStagedSidecars(stagedFile: string, archiveDirectory: string): void {
  const sidecarDirectory = path.join(archiveDirectory, 'staged-sidecars');
  fs.mkdirSync(sidecarDirectory, { mode: 0o700 });
  for (const sidecar of SIDECARS) {
    const source = stagedFile + sidecar.suffix;
    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('Staged SQLite ' + sidecar.kind + ' sidecar is not a regular file.');
    }
    const archived = path.join(sidecarDirectory, sidecar.kind + '.sidecar');
    fs.renameSync(source, archived);
    applyPrivateFilePermissions(archived);
    syncDirectory(path.dirname(source));
  }
}

async function archiveCurrentDatabase(
  databaseFile: string,
  stagedFile: string,
  stagedSha256: string,
  archiveDirectory: string
): Promise<SqliteRecoveryManifest> {
  const databaseStat = fs.statSync(databaseFile);
  const stagedStat = fs.statSync(stagedFile);
  const archiveParent = path.dirname(archiveDirectory);
  const archiveParentStat = fs.statSync(archiveParent);
  if (databaseStat.dev !== stagedStat.dev || databaseStat.dev !== archiveParentStat.dev) {
    throw new Error('Database, staged restore, and archive must be on the same filesystem for safe cutover.');
  }

  verifySqliteDatabase(databaseFile);
  verifySqliteDatabase(stagedFile);

  fs.mkdirSync(archiveDirectory, { recursive: false, mode: 0o700 });
  try {
    const originalsDirectory = path.join(archiveDirectory, 'originals');
    const displacedDirectory = path.join(archiveDirectory, 'displaced');
    const failedDirectory = path.join(archiveDirectory, 'failed-cutovers');
    fs.mkdirSync(originalsDirectory, { mode: 0o700 });
    fs.mkdirSync(displacedDirectory, { mode: 0o700 });
    fs.mkdirSync(failedDirectory, { mode: 0o700 });

    const files: RecoveryFileRecord[] = [];
    const allPaths: Array<{ kind: RecoveryFileKind; livePath: string }> = [
      { kind: 'database', livePath: databaseFile },
      ...SIDECARS.map((item) => ({ kind: item.kind, livePath: databaseFile + item.suffix })),
    ];

    for (const entry of allPaths) {
      let stat: fs.Stats | undefined;
      try {
        stat = fs.lstatSync(entry.livePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (stat && (stat.isSymbolicLink() || !stat.isFile())) {
        throw new Error('Current SQLite ' + entry.kind + ' path is not a regular file.');
      }
      if (!stat) {
        files.push({ ...entry, existed: false });
        continue;
      }

      const backupFile = path.join(originalsDirectory, entry.kind + '.backup');
      const displacedFile = path.join(displacedDirectory, entry.kind + '.displaced');
      const sourceHashBeforeCopy = await sha256File(entry.livePath);
      fs.copyFileSync(entry.livePath, backupFile, fs.constants.COPYFILE_EXCL);
      applyPrivateFilePermissions(backupFile);
      syncFile(backupFile);
      const [sourceHashAfterCopy, backupHash] = await Promise.all([
        sha256File(entry.livePath),
        sha256File(backupFile),
      ]);
      if (sourceHashBeforeCopy !== sourceHashAfterCopy || sourceHashAfterCopy !== backupHash) {
        throw new Error('SQLite ' + entry.kind + ' changed while it was being archived, or its archive checksum failed.');
      }
      files.push({
        ...entry,
        existed: true,
        sha256: sourceHashAfterCopy,
        sizeBytes: stat.size,
        backupFile,
        displacedFile,
      });
    }

    const manifest: SqliteRecoveryManifest = {
      format: 'ALNAMARI_SQLITE_RECOVERY_V1',
      operationId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      state: 'prepared',
      databaseFile,
      stagedFile,
      stagedSha256,
      archiveDirectory,
      files,
    };
    writeManifest(manifest);
    return manifest;
  } catch (error) {
    try {
      fs.rmSync(archiveDirectory, { recursive: true, force: true });
    } catch {
      // Preserve the original archive failure; live database files have not moved.
    }
    throw error;
  }
}

/**
 * Promotes a separately restored and verified SQLite file to the configured path.
 * The previous database and any WAL/SHM/journal sidecars are preserved both as
 * verified copies and as displaced originals. The application must be stopped.
 */
export async function cutoverSqliteDatabase(
  options: SqliteCutoverOptions
): Promise<SqliteCutoverResult> {
  if (options.serverStopped !== true) {
    throw new Error('Cutover refused: stop every application process and confirm with serverStopped=true.');
  }

  const databaseFile = assertRegularFile(options.databaseFile, 'Current SQLite database');
  const stagedFile = assertRegularFile(options.stagedFile, 'Staged SQLite restore');
  if (typeof options.expectedStagedSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(options.expectedStagedSha256)) {
    throw new Error('Cutover requires the 64-character SHA-256 reported by the verified staged restore.');
  }
  const suppliedStagedSha256 = await sha256File(stagedFile);
  if (suppliedStagedSha256 !== options.expectedStagedSha256.toLowerCase()) {
    throw new Error('Staged SQLite restore SHA-256 does not match the supplied restore report. Cutover was refused.');
  }
  verifySqliteDatabase(stagedFile);
  // Checkpoint the stage before recording the manifest hash and moving any live files.
  checkpointSqliteWal(stagedFile);
  verifySqliteDatabase(stagedFile);
  const stagedSha256 = await sha256File(stagedFile);
  assertDirectory(path.dirname(path.resolve(options.archiveDirectory)), 'Archive parent directory');
  const archiveDirectory = path.resolve(options.archiveDirectory);
  if (databaseFile === stagedFile || databaseFile === archiveDirectory || stagedFile === archiveDirectory) {
    throw new Error('Current database, staged restore, and archive paths must be different.');
  }
  if (fs.existsSync(archiveDirectory)) {
    throw new Error('Recovery archive directory already exists. Refusing to overwrite it.');
  }

  const manifest = await archiveCurrentDatabase(databaseFile, stagedFile, stagedSha256, archiveDirectory);
  const manifestFile = path.join(archiveDirectory, 'recovery-manifest.json');
  try {
    manifest.state = 'cutover_started';
    writeManifest(manifest);

    // Checkpoint/truncate WAL after its original bytes have been archived.
    // A busy result aborts; automatic rollback restores the exact archived file set.
    checkpointSqliteWal(databaseFile);

    // Preserve any staged WAL/SHM sidecars after the checkpoint. The staged
    // database file can then be promoted without mixing sidecars from two DBs.
    archiveStagedSidecars(stagedFile, archiveDirectory);

    // Move every current sidecar out of the live path. WAL checkpointing may
    // remove or truncate a sidecar; the pre-checkpoint copy is already archived.
    for (const entry of manifest.files.filter((item) => item.kind !== 'database')) {
      let stat: fs.Stats | undefined;
      try {
        stat = fs.lstatSync(entry.livePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (!stat) continue;
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error('SQLite ' + entry.kind + ' sidecar changed to a non-regular file during cutover.');
      }
      const displacedFile = entry.displacedFile ||
        path.join(manifest.archiveDirectory, 'failed-cutovers', entry.kind + '.post-checkpoint-' + crypto.randomUUID());
      fs.renameSync(entry.livePath, displacedFile);
      applyPrivateFilePermissions(displacedFile);
      syncDirectory(path.dirname(entry.livePath));
    }

    const primary = manifest.files.find((item) => item.kind === 'database');
    if (!primary?.existed || !primary.displacedFile) {
      throw new Error('Recovery archive does not contain the original SQLite database file.');
    }
    fs.renameSync(primary.livePath, primary.displacedFile);
    applyPrivateFilePermissions(primary.displacedFile);
    syncDirectory(path.dirname(primary.livePath));

    fs.renameSync(stagedFile, databaseFile);
    syncFile(databaseFile);
    verifySqliteDatabase(databaseFile);
    manifest.state = 'cutover_complete';
    writeManifest(manifest);

    return {
      status: 'CUTOVER_COMPLETE',
      databaseFile,
      manifestFile,
      archiveDirectory,
      databaseSha256: await sha256File(databaseFile),
      stagedSha256,
    };
  } catch (error) {
    try {
      await rollbackSqliteDatabase({ manifestFile, serverStopped: true });
    } catch (rollbackError) {
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : 'unknown rollback failure';
      throw new Error(
        'SQLite cutover failed: ' + (error instanceof Error ? error.message : 'unknown error') +
        '. Automatic rollback also failed: ' + rollbackMessage +
        '. Keep the application stopped and use the recovery manifest for manual recovery.'
      );
    }
    throw new Error(
      'SQLite cutover failed; the previous database and sidecars were restored: ' +
      (error instanceof Error ? error.message : 'unknown error')
    );
  }
}

/**
 * Restores the exact pre-cutover database file set from the recovery archive.
 * New/partial cutover files are retained under failed-cutovers for diagnosis.
 */
export async function rollbackSqliteDatabase(options: {
  manifestFile: string;
  serverStopped: boolean;
}): Promise<SqliteRollbackResult> {
  if (options.serverStopped !== true) {
    throw new Error('Rollback refused: stop every application process and confirm with serverStopped=true.');
  }

  const manifest = readManifest(options.manifestFile);
  if (manifest.state === 'rolled_back') {
    verifySqliteDatabase(manifest.databaseFile);
    return {
      status: 'ROLLED_BACK',
      databaseFile: manifest.databaseFile,
      manifestFile: path.resolve(options.manifestFile),
      restoredSha256: await sha256File(manifest.databaseFile),
    };
  }
  if (manifest.state === 'prepared') {
    // No live paths were moved; verify the original remains untouched.
    const primary = manifest.files.find((item) => item.kind === 'database');
    if (!primary?.existed || await sha256File(primary.livePath) !== primary.sha256) {
      throw new Error('Prepared recovery archive cannot prove the original database is still at its configured path.');
    }
  }

  manifest.state = 'rollback_started';
  writeManifest(manifest);
  const failedDirectory = path.join(manifest.archiveDirectory, 'failed-cutovers');

  // First move every changed/current file away so no original path is overwritten.
  for (const entry of manifest.files) {
    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(entry.livePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('Rollback found a non-regular file at ' + entry.livePath + '; manual review is required.');
    }

    if (entry.existed && await sha256File(entry.livePath) === entry.sha256) {
      continue;
    }

    const failedFile = path.join(
      failedDirectory,
      entry.kind + '.current-' + crypto.randomUUID()
    );
    fs.renameSync(entry.livePath, failedFile);
    applyPrivateFilePermissions(failedFile);
    syncDirectory(path.dirname(entry.livePath));
  }

  // Restore original sidecars first and the main database last.
  const restoreOrder: RecoveryFileKind[] = ['wal', 'shm', 'journal', 'database'];
  for (const kind of restoreOrder) {
    const entry = manifest.files.find((item) => item.kind === kind);
    if (!entry?.existed) continue;

    let liveExists = fs.existsSync(entry.livePath);
    if (liveExists) {
      if (await sha256File(entry.livePath) !== entry.sha256) {
        throw new Error('Rollback refused to overwrite an unexpected file at ' + entry.livePath + '.');
      }
      continue;
    }

    const candidates = [entry.displacedFile, entry.backupFile].filter(
      (candidate): candidate is string => Boolean(candidate) && fs.existsSync(candidate as string)
    );
    let restored = false;
    for (const candidate of candidates) {
      if (await sha256File(candidate) !== entry.sha256) continue;
      const temporary = entry.livePath + '.restore-' + crypto.randomUUID();
      try {
        fs.copyFileSync(candidate, temporary, fs.constants.COPYFILE_EXCL);
        applyPrivateFilePermissions(temporary);
        syncFile(temporary);
        if (await sha256File(temporary) !== entry.sha256) {
          throw new Error('Rollback copy checksum mismatch for ' + entry.kind + '.');
        }
        fs.renameSync(temporary, entry.livePath);
        syncDirectory(path.dirname(entry.livePath));
        restored = true;
        break;
      } finally {
        try {
          fs.unlinkSync(temporary);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    if (!restored) {
      throw new Error('Rollback cannot locate a verified archived copy of the original ' + entry.kind + ' file.');
    }
  }

  const primary = manifest.files.find((entry) => entry.kind === 'database');
  if (!primary?.existed || !fs.existsSync(primary.livePath)) {
    throw new Error('Rollback did not restore the original SQLite database.');
  }
  verifySqliteDatabase(primary.livePath);
  const restoredSha256 = await sha256File(primary.livePath);
  if (restoredSha256 !== primary.sha256) {
    throw new Error('Rollback completed but the restored database checksum differs from the archived original.');
  }

  manifest.state = 'rolled_back';
  writeManifest(manifest);
  return {
    status: 'ROLLED_BACK',
    databaseFile: primary.livePath,
    manifestFile: path.resolve(options.manifestFile),
    restoredSha256,
  };
}
