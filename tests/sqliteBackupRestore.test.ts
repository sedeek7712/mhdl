import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openSqliteDatabase } from '../src/server/db/sqliteDatabase.js';
import {
  createSqliteBackup,
  restoreSqliteBackup,
} from '../src/server/db/sqliteBackupRestore.js';

function makeDirectory(t: { after: (fn: () => void) => void }): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-sqlite-backup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function seedDatabase(filePath: string): void {
  const db = openSqliteDatabase({ filePath });
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`
      CREATE TABLE branches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      ) STRICT;
      CREATE TABLE financial_records (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches(id),
        amount_milli INTEGER NOT NULL CHECK (amount_milli >= 0),
        currency TEXT NOT NULL
      ) STRICT;
      INSERT INTO branches (id, name) VALUES ('branch-main', 'الفرع الرئيسي');
      INSERT INTO financial_records (id, branch_id, amount_milli, currency)
      VALUES ('record-001', 'branch-main', 125000, 'YER_OLD');
    `);
  } finally {
    db.close();
  }
}

function readRecords(filePath: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(filePath);
  try {
    return db.prepare(
      'SELECT id, branch_id, amount_milli, currency FROM financial_records ORDER BY id'
    ).all().map((row) => ({ ...row })) as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

test('creates a consistent SQLite backup from an open WAL database and leaves the source usable', async (t) => {
  const directory = makeDirectory(t);
  const sourceFile = path.join(directory, 'exchange.sqlite');
  const backupFile = path.join(directory, 'backups', 'exchange-001.sqlite');
  fs.mkdirSync(path.dirname(backupFile));
  seedDatabase(sourceFile);

  const sourceDb = openSqliteDatabase({ filePath: sourceFile });
  try {
    sourceDb.prepare(
      'INSERT INTO financial_records (id, branch_id, amount_milli, currency) VALUES (?, ?, ?, ?)'
    ).run('record-002', 'branch-main', 250000, 'YER_NEW');

    const result = await createSqliteBackup({ sourceFile, destinationFile: backupFile });
    assert.equal(result.file, backupFile);
    assert.equal(result.sha256, crypto.createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex'));
    assert.equal(result.sizeBytes, fs.statSync(backupFile).size);
    assert.ok(result.pages > 0);
    assert.deepEqual(readRecords(backupFile), [
      {
        id: 'record-001',
        branch_id: 'branch-main',
        amount_milli: 125000,
        currency: 'YER_OLD',
      },
      {
        id: 'record-002',
        branch_id: 'branch-main',
        amount_milli: 250000,
        currency: 'YER_NEW',
      },
    ]);

    sourceDb.prepare(
      'INSERT INTO financial_records (id, branch_id, amount_milli, currency) VALUES (?, ?, ?, ?)'
    ).run('record-003', 'branch-main', 300000, 'SAR');
    assert.equal(readRecords(sourceFile).length, 3);
    assert.equal(readRecords(backupFile).length, 2, 'backup must remain an independent snapshot');
  } finally {
    sourceDb.close();
  }
});
test('restores a checksum-verified backup into a new file and preserves relational data', async (t) => {
  const directory = makeDirectory(t);
  const sourceFile = path.join(directory, 'source.sqlite');
  const backupFile = path.join(directory, 'verified.sqlite');
  const restoredFile = path.join(directory, 'restored', 'exchange.sqlite');
  fs.mkdirSync(path.dirname(restoredFile));
  seedDatabase(sourceFile);

  const backup = await createSqliteBackup({ sourceFile, destinationFile: backupFile });
  const restored = await restoreSqliteBackup({
    backupFile,
    destinationFile: restoredFile,
    expectedSha256: backup.sha256,
  });

  assert.equal(restored.file, restoredFile);
  assert.equal(restored.backupSha256, backup.sha256);
  assert.equal(restored.sizeBytes, fs.statSync(restoredFile).size);
  assert.ok(restored.pages > 0);
  assert.deepEqual(readRecords(restoredFile), readRecords(sourceFile));

  const restoredDb = new DatabaseSync(restoredFile);
  try {
    assert.equal(
      String((restoredDb.prepare('PRAGMA integrity_check').get() as any).integrity_check),
      'ok'
    );
    assert.equal(restoredDb.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally {
    restoredDb.close();
  }
  assert.equal(fs.existsSync(sourceFile), true, 'restore must not modify or replace the source database');
  assert.equal(fs.existsSync(backupFile), true, 'restore must preserve the backup file');
});

test('backup and restore refuse to overwrite existing destinations', async (t) => {
  const directory = makeDirectory(t);
  const sourceFile = path.join(directory, 'source.sqlite');
  const validBackupFile = path.join(directory, 'valid-backup.sqlite');
  const backupFile = path.join(directory, 'existing-backup.sqlite');
  const restoreFile = path.join(directory, 'existing-restore.sqlite');
  seedDatabase(sourceFile);
  const validBackup = await createSqliteBackup({ sourceFile, destinationFile: validBackupFile });
  const backupBytes = Buffer.from('preserve-this-backup-target');
  const restoreBytes = Buffer.from('preserve-this-restore-target');
  fs.writeFileSync(backupFile, backupBytes);
  fs.writeFileSync(restoreFile, restoreBytes);

  await assert.rejects(
    createSqliteBackup({ sourceFile, destinationFile: backupFile }),
    /already exists/
  );
  await assert.rejects(
    restoreSqliteBackup({
      backupFile: validBackupFile,
      destinationFile: restoreFile,
      expectedSha256: validBackup.sha256,
    }),
    /already exists/
  );
  assert.deepEqual(fs.readFileSync(backupFile), backupBytes);
  assert.deepEqual(fs.readFileSync(restoreFile), restoreBytes);
});
test('restore rejects a checksum mismatch and does not create the target', async (t) => {
  const directory = makeDirectory(t);
  const sourceFile = path.join(directory, 'source.sqlite');
  const backupFile = path.join(directory, 'backup.sqlite');
  const restoredFile = path.join(directory, 'should-not-exist.sqlite');
  seedDatabase(sourceFile);
  const backup = await createSqliteBackup({ sourceFile, destinationFile: backupFile });

  await assert.rejects(
    restoreSqliteBackup({
      backupFile,
      destinationFile: restoredFile,
      expectedSha256: '0'.repeat(64),
    }),
    /SHA-256 mismatch/
  );
  assert.equal(fs.existsSync(restoredFile), false);
  assert.equal(fs.existsSync(backupFile), true);
  assert.equal(backup.sha256.length, 64);
});

test('restore rejects a corrupt SQLite file even when its supplied hash matches', async (t) => {
  const directory = makeDirectory(t);
  const corruptFile = path.join(directory, 'corrupt.sqlite');
  const restoredFile = path.join(directory, 'should-not-exist.sqlite');
  fs.writeFileSync(corruptFile, Buffer.from('this is not an SQLite database'));
  const digest = crypto.createHash('sha256').update(fs.readFileSync(corruptFile)).digest('hex');

  await assert.rejects(
    restoreSqliteBackup({
      backupFile: corruptFile,
      destinationFile: restoredFile,
      expectedSha256: digest,
    })
  );
  assert.equal(fs.existsSync(restoredFile), false);
});
