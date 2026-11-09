import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openSqliteDatabase, runSqliteMigrations } from '../src/server/db/sqliteDatabase.js';
import { SQLITE_MIGRATIONS } from '../src/server/db/sqliteMigrations.js';
import { insertSqliteUser, listSqlitePublicUsers } from '../src/server/db/sqliteAuthRepository.js';
import {
  parseLegacyAuthUsers,
  runSqliteAuthUserMigration,
} from '../src/server/db/sqliteAuthMigration.js';
import type { SqliteUserRecord } from '../src/server/db/sqliteAuthRepository.js';

function makeTempDirectory(t: { after: (fn: () => void) => void }): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-auth-migration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function makeUsers(): SqliteUserRecord[] {
  return [
    {
      id: 'user-owner-1',
      username: 'owner_main',
      name: 'مالك الاختبار',
      role: 'owner',
      branchId: 'branch-main',
      branchName: 'المركز الرئيسي',
      pinSalt: 'a'.repeat(32),
      pinHash: 'b'.repeat(64),
      isActive: true,
      mustChangePin: false,
      sessionVersion: 'c'.repeat(32),
      createdAt: '2026-11-10T10:00:00.000Z',
    },
    {
      id: 'user-teller-1',
      username: 'teller_01',
      name: 'الصراف الأول',
      role: 'teller',
      branchId: 'branch-main',
      branchName: 'المركز الرئيسي',
      pinSalt: 'd'.repeat(32),
      pinHash: 'e'.repeat(64),
      isActive: true,
      mustChangePin: true,
      sessionVersion: 'f'.repeat(32),
      createdAt: '2026-11-10T10:01:00.000Z',
    },
  ];
}

function writeSource(directory: string, users = makeUsers()): { sourceFile: string; original: string } {
  const sourceFile = path.join(directory, 'system_users.local.json');
  const original = JSON.stringify(users, null, 2) + '\n';
  fs.writeFileSync(sourceFile, original, { mode: 0o600 });
  return { sourceFile, original };
}

test('parses supported legacy users and preserves normalized identities and credential material', () => {
  const parsed = parseLegacyAuthUsers(JSON.stringify(makeUsers()));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].username, 'owner_main');
  assert.equal(parsed[1].pinHash, 'e'.repeat(64));
  assert.equal(parsed[1].mustChangePin, true);
});

test('rejects corrupt, empty, partial-owner, and malformed credential files', () => {
  assert.throws(() => parseLegacyAuthUsers('{not-json'), /JSON parsing failed/);
  assert.throws(() => parseLegacyAuthUsers('[]'), /non-empty array/);
  assert.throws(
    () => parseLegacyAuthUsers(JSON.stringify(makeUsers().filter((user) => user.role !== 'owner'))),
    /exactly one active owner/
  );

  const malformed = makeUsers();
  malformed[1].pinHash = 'not-a-hash';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-auth-invalid-'));
  try {
    const sourceFile = path.join(directory, 'system_users.local.json');
    fs.writeFileSync(sourceFile, JSON.stringify(malformed));
    assert.throws(
      () => runSqliteAuthUserMigration({ sourceFile, apply: false }),
      /PIN hash/
    );
    assert.equal(fs.readdirSync(directory).length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('default dry-run imports into memory and leaves the source untouched', (t) => {
  const directory = makeTempDirectory(t);
  const { sourceFile, original } = writeSource(directory);
  const report = runSqliteAuthUserMigration({ sourceFile, apply: false });

  assert.equal(report.status, 'PASS');
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.userCount, 2);
  assert.equal(report.activeOwnerCount, 1);
  assert.equal(report.staffCount, 1);
  assert.equal(report.sqliteFile, ':memory:');
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(directory), ['system_users.local.json']);
});

test('apply creates a checksum-verified backup and imports all users without changing JSON', (t) => {
  const directory = makeTempDirectory(t);
  const { sourceFile, original } = writeSource(directory);
  const databaseFile = path.join(directory, 'exchange.sqlite');

  const report = runSqliteAuthUserMigration({ sourceFile, databaseFile, apply: true });
  assert.equal(report.mode, 'apply');
  assert.equal(report.userCount, 2);
  assert.equal(report.integrityCheck, 'ok');
  assert.equal(report.foreignKeyViolations, 0);
  assert.ok(report.backupFile);
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), original);
  assert.equal(fs.readFileSync(path.join(directory, report.backupFile as string), 'utf8'), original);

  const db = openSqliteDatabase({ filePath: databaseFile });
  try {
    runSqliteMigrations(db, SQLITE_MIGRATIONS);
    const users = listSqlitePublicUsers(db);
    assert.equal(users.length, 2);
    assert.equal(users.filter((user) => user.role === 'owner' && user.isActive).length, 1);
  } finally {
    db.close();
  }
});

test('apply refuses an existing user set and preserves the existing SQLite accounts', (t) => {
  const directory = makeTempDirectory(t);
  const { sourceFile, original } = writeSource(directory);
  const databaseFile = path.join(directory, 'existing.sqlite');
  const db = openSqliteDatabase({ filePath: databaseFile });
  try {
    runSqliteMigrations(db, SQLITE_MIGRATIONS);
    insertSqliteUser(db, makeUsers()[0]);
  } finally {
    db.close();
  }

  assert.throws(
    () => runSqliteAuthUserMigration({ sourceFile, databaseFile, apply: true }),
    /already contains user accounts/
  );
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), original);

  const verify = openSqliteDatabase({ filePath: databaseFile });
  try {
    runSqliteMigrations(verify, SQLITE_MIGRATIONS);
    const users = listSqlitePublicUsers(verify);
    assert.equal(users.length, 1);
    assert.equal(users[0].id, 'user-owner-1');
  } finally {
    verify.close();
  }
});

test('apply requires an explicit target and refuses source/database path collisions', (t) => {
  const directory = makeTempDirectory(t);
  const { sourceFile } = writeSource(directory);
  assert.throws(
    () => runSqliteAuthUserMigration({ sourceFile, apply: true }),
    /explicit SQLite database file path/
  );
  assert.throws(
    () => runSqliteAuthUserMigration({ sourceFile, databaseFile: sourceFile, apply: true }),
    /must be different paths/
  );
});
