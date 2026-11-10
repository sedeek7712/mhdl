import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  exportSqliteUsersForJsonRollback,
  getSqliteUserByUsername,
  importSqliteUsers,
  type SqliteUserRecord,
} from '../src/server/db/sqliteAuthRepository.js';
import { openSqliteDatabase, runSqliteMigrations } from '../src/server/db/sqliteDatabase.js';
import { SQLITE_MIGRATIONS } from '../src/server/db/sqliteMigrations.js';

function makeDatabase(t: { after: (fn: () => void) => void }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-auth-rollback-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'auth.sqlite');
  const db = openSqliteDatabase({ filePath });
  runSqliteMigrations(db, SQLITE_MIGRATIONS);
  return db;
}

function makeUser(
  id: string,
  username: string,
  role: SqliteUserRecord['role'],
  isActive = true
): SqliteUserRecord {
  return {
    id,
    username,
    name: username + ' اختبار',
    role,
    branchId: 'branch-main',
    branchName: 'الفرع الرئيسي',
    pinSalt: crypto.randomBytes(16).toString('hex'),
    pinHash: crypto.randomBytes(32).toString('hex'),
    isActive,
    mustChangePin: false,
    sessionVersion: crypto.randomBytes(16).toString('hex'),
    createdAt: '2026-11-10T00:00:00.000Z',
  };
}

test('exports legacy-compatible user records and rotates all SQLite session versions atomically', (t) => {
  const db = makeDatabase(t);
  try {
    const sourceUsers = [
      makeUser('owner-1', 'owner_test', 'owner'),
      makeUser('teller-1', 'teller_test', 'teller'),
      makeUser('auditor-1', 'audit_test', 'auditor', false),
    ];
    importSqliteUsers(db, sourceUsers);

    const before = sourceUsers.map((user) => ({
      id: user.id,
      sessionVersion: getSqliteUserByUsername(db, user.username)?.sessionVersion,
    }));
    const exported = exportSqliteUsersForJsonRollback(db);

    assert.equal(exported.length, sourceUsers.length);
    assert.equal(exported.filter((user) => user.role === 'owner' && user.isActive).length, 1);
    assert.deepEqual(
      exported.map((user) => user.id),
      ['owner-1', 'teller-1', 'auditor-1']
    );

    for (const old of before) {
      const current = exported.find((user) => user.id === old.id);
      assert.ok(current);
      assert.match(current.sessionVersion, /^[a-f0-9]{32}$/);
      assert.notEqual(current.sessionVersion, old.sessionVersion);
      assert.equal(
        getSqliteUserByUsername(db, current.username)?.sessionVersion,
        current.sessionVersion,
        'the new session version must be committed to SQLite to revoke old SQLite tokens too'
      );
    }

    const teller = exported.find((user) => user.id === 'teller-1');
    assert.ok(teller);
    assert.equal(teller.pinSalt, sourceUsers[1].pinSalt);
    assert.equal(teller.pinHash, sourceUsers[1].pinHash);
    assert.equal(teller.role, 'teller');
    assert.equal(teller.branchId, 'branch-main');
    assert.equal(teller.isActive, true);
    assert.equal(teller.mustChangePin, false);
    assert.equal(typeof teller.createdAt, 'string');
  } finally {
    db.close();
  }
});

test('rollback export refuses a database without exactly one active owner and makes no changes', (t) => {
  const db = makeDatabase(t);
  try {
    const owner = makeUser('owner-1', 'owner_test', 'owner');
    importSqliteUsers(db, [owner]);
    db.prepare("UPDATE app_users SET is_active = 0 WHERE id = ?").run(owner.id);

    assert.throws(
      () => exportSqliteUsersForJsonRollback(db),
      /exactly one active owner/
    );
    assert.equal(
      getSqliteUserByUsername(db, owner.username)?.sessionVersion,
      owner.sessionVersion,
      'failed validation must roll back without rotating any sessions'
    );
  } finally {
    db.close();
  }
});
