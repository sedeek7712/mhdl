import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openSqliteDatabase, runSqliteMigrations } from '../src/server/db/sqliteDatabase.js';
import { SQLITE_MIGRATIONS } from '../src/server/db/sqliteMigrations.js';
import { importSqliteUsers, type SqliteUserRecord } from '../src/server/db/sqliteAuthRepository.js';
import { createSqliteAuthRuntime } from '../src/server/services/sqliteAuthRuntime.js';
import { hashSqliteAuthPin } from '../src/server/services/sqliteAuthService.js';

test('runtime opens, migrates, verifies one active owner, and creates the SQLite router', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-auth-runtime-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databaseFile = path.join(directory, 'exchange.sqlite');
  const db = openSqliteDatabase({ filePath: databaseFile });
  runSqliteMigrations(db, SQLITE_MIGRATIONS);

  const salt = crypto.randomBytes(16).toString('hex');
  const owner: SqliteUserRecord = {
    id: 'runtime-owner',
    username: 'runtime_owner',
    name: 'مالك اختبار التشغيل',
    role: 'owner',
    branchId: 'branch-main',
    branchName: 'الفرع الرئيسي',
    pinSalt: salt,
    pinHash: hashSqliteAuthPin('849263', salt),
    isActive: true,
    mustChangePin: false,
    sessionVersion: crypto.randomBytes(16).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  importSqliteUsers(db, [owner]);
  db.close();

  const runtime = createSqliteAuthRuntime({
    databaseFile,
    jwtSecret: 'runtime-jwt-secret-which-is-at-least-32-characters',
  });
  assert.equal(runtime.databaseFile, databaseFile);
  assert.equal(typeof runtime.router, 'function');
  assert.equal(runtime.service.authenticateUser('runtime_owner', '849263').success, true);
  runtime.close();
});

test('runtime fails closed when the database has no active owner and releases the file', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-auth-runtime-empty-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databaseFile = path.join(directory, 'empty.sqlite');
  const emptyDb = openSqliteDatabase({ filePath: databaseFile });
  runSqliteMigrations(emptyDb, SQLITE_MIGRATIONS);
  emptyDb.close();

  assert.throws(
    () => createSqliteAuthRuntime({
      databaseFile,
      jwtSecret: 'runtime-jwt-secret-which-is-at-least-32-characters',
    }),
    /exactly one active owner/
  );

  const verify = openSqliteDatabase({ filePath: databaseFile });
  try {
    const migrations = verify.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number };
    assert.equal(Number(migrations.count), SQLITE_MIGRATIONS.length);
  } finally {
    verify.close();
  }
});

test('runtime reuses the shared secret file when no environment secret is configured', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-auth-runtime-secret-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databaseFile = path.join(directory, 'exchange.sqlite');
  const secretFile = path.join(directory, 'data', '.jwt_secret');
  const db = openSqliteDatabase({ filePath: databaseFile });
  runSqliteMigrations(db, SQLITE_MIGRATIONS);

  const salt = crypto.randomBytes(16).toString('hex');
  const owner: SqliteUserRecord = {
    id: 'runtime-owner-secret',
    username: 'runtime_secret',
    name: 'مالك اختبار السر',
    role: 'owner',
    branchId: 'branch-main',
    branchName: 'الفرع الرئيسي',
    pinSalt: salt,
    pinHash: hashSqliteAuthPin('849263', salt),
    isActive: true,
    mustChangePin: false,
    sessionVersion: crypto.randomBytes(16).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  importSqliteUsers(db, [owner]);
  db.close();

  const env = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const first = createSqliteAuthRuntime({ databaseFile, jwtSecretFile: secretFile, env });
  const login = first.service.authenticateUser('runtime_secret', '849263');
  assert.equal(login.success, true);
  first.close();

  const second = createSqliteAuthRuntime({ databaseFile, jwtSecretFile: secretFile, env });
  assert.equal(second.service.verifyToken(login.token as string)?.userId, owner.id);
  second.close();
  assert.match(fs.readFileSync(secretFile, 'utf8'), /^[a-f0-9]{64}$/);
});


test('runtime refuses a missing database path without creating an empty file', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-auth-runtime-missing-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databaseFile = path.join(directory, 'missing.sqlite');

  assert.throws(
    () => createSqliteAuthRuntime({
      databaseFile,
      jwtSecret: 'runtime-jwt-secret-which-is-at-least-32-characters',
    }),
    /database file does not exist/
  );
  assert.equal(fs.existsSync(databaseFile), false);
});
