import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openSqliteDatabase } from '../src/server/db/sqliteDatabase.js';
import { createSqliteBackup, restoreSqliteBackup } from '../src/server/db/sqliteBackupRestore.js';
import {
  cutoverSqliteDatabase,
  rollbackSqliteDatabase,
  sha256File,
} from '../src/server/db/sqliteRecovery.js';

const TEST_BACKUP_KEY = 'ef'.repeat(32);

function makeDirectory(t: { after: (fn: () => void) => void }): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function seedDatabase(filePath: string, value: string): void {
  const db = openSqliteDatabase({ filePath });
  try {
    db.exec(`
      CREATE TABLE recovery_probe (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `);
    db.prepare('INSERT INTO recovery_probe (id, value) VALUES (?, ?)').run('probe-1', value);
  } finally {
    db.close();
  }
}

function readDatabaseValue(filePath: string): string {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM recovery_probe WHERE id = ?').get('probe-1') as
      | { value?: unknown }
      | undefined;
    return String(row?.value ?? '');
  } finally {
    db.close();
  }
}

async function makeStagedRestore(directory: string): Promise<{
  liveFile: string;
  stagedFile: string;
  backupFile: string;
  sourceFile: string;
  stagedSha256: string;
}> {
  const sourceFile = path.join(directory, 'trusted-source.sqlite');
  const liveFile = path.join(directory, 'current.sqlite');
  const backupFile = path.join(directory, 'trusted-source.alnbackup');
  const stagedFile = path.join(directory, 'staged-restore.sqlite');

  seedDatabase(sourceFile, 'approved-snapshot');
  seedDatabase(liveFile, 'before-cutover');

  const backup = await createSqliteBackup({
    sourceFile,
    destinationFile: backupFile,
    encryptionKeyHex: TEST_BACKUP_KEY,
  });
  const restored = await restoreSqliteBackup({
    backupFile,
    destinationFile: stagedFile,
    expectedSha256: backup.sha256,
    encryptionKeyHex: TEST_BACKUP_KEY,
  });
  return { liveFile, stagedFile, backupFile, sourceFile, stagedSha256: restored.restoredSha256 };
}

test('guarded cutover archives the previous database and rollback restores its exact bytes', async (t) => {
  const directory = makeDirectory(t);
  const { liveFile, stagedFile, stagedSha256 } = await makeStagedRestore(directory);
  const archiveDirectory = path.join(directory, 'recovery-archive');
  const originalLiveBytes = fs.readFileSync(liveFile);

  const cutover = await cutoverSqliteDatabase({
    databaseFile: liveFile,
    stagedFile,
    expectedStagedSha256: stagedSha256,
    archiveDirectory,
    serverStopped: true,
  });

  assert.equal(cutover.status, 'CUTOVER_COMPLETE');
  assert.equal(readDatabaseValue(liveFile), 'approved-snapshot');
  assert.equal(fs.existsSync(stagedFile), false);
  assert.equal(fs.existsSync(path.join(archiveDirectory, 'originals', 'database.backup')), true);
  assert.equal(fs.existsSync(path.join(archiveDirectory, 'displaced', 'database.displaced')), true);
  assert.deepEqual(
    fs.readFileSync(path.join(archiveDirectory, 'displaced', 'database.displaced')),
    originalLiveBytes,
    'the displaced original must be preserved byte-for-byte'
  );

  const rollback = await rollbackSqliteDatabase({
    manifestFile: cutover.manifestFile,
    serverStopped: true,
  });

  assert.equal(rollback.status, 'ROLLED_BACK');
  assert.equal(readDatabaseValue(liveFile), 'before-cutover');
  assert.deepEqual(fs.readFileSync(liveFile), originalLiveBytes);
  const manifest = JSON.parse(fs.readFileSync(cutover.manifestFile, 'utf8')) as {
    state: string;
  };
  assert.equal(manifest.state, 'rolled_back');
});

test('cutover refuses to proceed without explicit stopped-server confirmation', async (t) => {
  const directory = makeDirectory(t);
  const { liveFile, stagedFile } = await makeStagedRestore(directory);
  const archiveDirectory = path.join(directory, 'must-not-be-created');
  const originalLiveBytes = fs.readFileSync(liveFile);

  await assert.rejects(
    cutoverSqliteDatabase({
      databaseFile: liveFile,
      stagedFile,
      expectedStagedSha256: stagedSha256,
      archiveDirectory,
      serverStopped: false,
    }),
    /stop every application process/
  );

  assert.deepEqual(fs.readFileSync(liveFile), originalLiveBytes);
  assert.equal(readDatabaseValue(liveFile), 'before-cutover');
  assert.equal(fs.existsSync(archiveDirectory), false);
  assert.equal(fs.existsSync(stagedFile), true);
});

test('rollback refuses to run while the application is not confirmed stopped', async (t) => {
  const directory = makeDirectory(t);
  const { liveFile, stagedFile } = await makeStagedRestore(directory);
  const cutover = await cutoverSqliteDatabase({
    databaseFile: liveFile,
    stagedFile,
    expectedStagedSha256: stagedSha256,
    archiveDirectory: path.join(directory, 'recovery-archive'),
    serverStopped: true,
  });

  await assert.rejects(
    rollbackSqliteDatabase({
      manifestFile: cutover.manifestFile,
      serverStopped: false,
    }),
    /stop every application process/
  );
  assert.equal(readDatabaseValue(liveFile), 'approved-snapshot');
});

test('cutover rejects an invalid staged database without moving the current database', async (t) => {
  const directory = makeDirectory(t);
  const liveFile = path.join(directory, 'current.sqlite');
  const stagedFile = path.join(directory, 'bad-staged.sqlite');
  const archiveDirectory = path.join(directory, 'recovery-archive');
  seedDatabase(liveFile, 'must-survive');
  fs.writeFileSync(stagedFile, 'not a SQLite database');
  const originalLiveBytes = fs.readFileSync(liveFile);

  await assert.rejects(
    cutoverSqliteDatabase({
      databaseFile: liveFile,
      stagedFile,
      expectedStagedSha256: await sha256File(stagedFile),
      archiveDirectory,
      serverStopped: true,
    })
  );

  assert.deepEqual(fs.readFileSync(liveFile), originalLiveBytes);
  assert.equal(readDatabaseValue(liveFile), 'must-survive');
  assert.equal(fs.existsSync(stagedFile), true);
  assert.equal(fs.existsSync(archiveDirectory), false);
});

test('cutover refuses to reuse an existing recovery archive', async (t) => {
  const directory = makeDirectory(t);
  const { liveFile, stagedFile } = await makeStagedRestore(directory);
  const archiveDirectory = path.join(directory, 'existing-archive');
  fs.mkdirSync(archiveDirectory);
  const marker = path.join(archiveDirectory, 'keep.txt');
  fs.writeFileSync(marker, 'do not replace');
  const originalLiveBytes = fs.readFileSync(liveFile);

  await assert.rejects(
    cutoverSqliteDatabase({
      databaseFile: liveFile,
      stagedFile,
      archiveDirectory,
      serverStopped: true,
    }),
    /already exists/
  );

  assert.deepEqual(fs.readFileSync(liveFile), originalLiveBytes);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'do not replace');
  assert.equal(fs.existsSync(stagedFile), true);
});

test('rollback validates manifest paths before touching database files', async (t) => {
  const directory = makeDirectory(t);
  const { liveFile, stagedFile } = await makeStagedRestore(directory);
  const cutover = await cutoverSqliteDatabase({
    databaseFile: liveFile,
    stagedFile,
    archiveDirectory: path.join(directory, 'recovery-archive'),
    serverStopped: true,
  });
  const outsideFile = path.join(directory, 'must-not-be-touched.txt');
  fs.writeFileSync(outsideFile, 'keep me');
  const manifest = JSON.parse(fs.readFileSync(cutover.manifestFile, 'utf8')) as {
    files: Array<{ livePath: string }>;
  };
  manifest.files[0].livePath = outsideFile;
  fs.writeFileSync(cutover.manifestFile, JSON.stringify(manifest, null, 2));

  await assert.rejects(
    rollbackSqliteDatabase({
      manifestFile: cutover.manifestFile,
      serverStopped: true,
    }),
    /file entries do not match/
  );
  assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'keep me');
  assert.equal(readDatabaseValue(liveFile), 'approved-snapshot');
});
