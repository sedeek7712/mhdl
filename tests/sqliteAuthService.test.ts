import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openSqliteDatabase, runSqliteMigrations } from '../src/server/db/sqliteDatabase.js';
import { SQLITE_MIGRATIONS } from '../src/server/db/sqliteMigrations.js';
import { insertSqliteUser, getSqliteUserByUsername } from '../src/server/db/sqliteAuthRepository.js';
import {
  hashSqliteAuthPin,
  SqliteAuthService,
} from '../src/server/services/sqliteAuthService.js';
import type { SqliteUserRecord } from '../src/server/db/sqliteAuthRepository.js';

const SECRET = 'sqlite-auth-test-secret-with-at-least-32-characters';
const OWNER_PIN = '849263';

function ownerRecord(): SqliteUserRecord {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id: 'owner-sqlite-auth-test',
    username: 'owner_test',
    name: 'مالك اختبار SQLite',
    role: 'owner',
    branchId: 'branch-main',
    branchName: 'الفرع الرئيسي',
    pinSalt: salt,
    pinHash: hashSqliteAuthPin(OWNER_PIN, salt),
    isActive: true,
    mustChangePin: false,
    sessionVersion: crypto.randomBytes(16).toString('hex'),
    createdAt: '2026-11-10T10:00:00.000Z',
  };
}

function makeService(db: ReturnType<typeof openSqliteDatabase>, clock: { value: number }) {
  return new SqliteAuthService({
    db,
    jwtSecret: SECRET,
    now: () => clock.value,
    timestamp: () => new Date(clock.value).toISOString(),
  });
}

test('SQLite auth issues a verifiable JWT and persists login audit events', (t) => {
  const db = openSqliteDatabase({ filePath: ':memory:' });
  t.after(() => db.close());
  runSqliteMigrations(db, SQLITE_MIGRATIONS);
  const owner = ownerRecord();
  insertSqliteUser(db, owner);
  const clock = { value: Date.parse('2026-11-10T10:00:00.000Z') };
  const service = makeService(db, clock);

  const login = service.authenticateUser('OWNER_TEST', OWNER_PIN, '127.0.0.1');
  assert.equal(login.success, true);
  assert.ok(login.token);
  assert.equal(login.user?.id, owner.id);
  assert.equal(service.verifyToken(login.token as string)?.userId, owner.id);
  assert.equal(service.getSecurityLogs()[0].event, 'LOGIN_SUCCESS');
});

test('failed login lock survives service reconstruction and expires into a fresh attempt window', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-auth-persist-'));
  let currentDb = openSqliteDatabase({ filePath: path.join(directory, 'auth.sqlite') });
  t.after(() => {
    try { currentDb.close(); } catch { /* already closed */ }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  runSqliteMigrations(currentDb, SQLITE_MIGRATIONS);
  insertSqliteUser(currentDb, ownerRecord());
  const clock = { value: Date.parse('2026-11-10T10:00:00.000Z') };
  let service = makeService(currentDb, clock);

  for (let index = 0; index < 5; index += 1) {
    const result = service.authenticateUser('owner_test', '000000', '10.0.0.5');
    assert.equal(result.success, false);
  }
  assert.equal(service.authenticateUser('owner_test', OWNER_PIN, '10.0.0.5').locked, true);
  assert.equal(service.getSecurityLogs().some((entry) => entry.event === 'BRUTE_FORCE_BLOCKED'), true);

  currentDb.close();
  currentDb = openSqliteDatabase({ filePath: path.join(directory, 'auth.sqlite') });
  service = makeService(currentDb, clock);
  const stillLocked = service.authenticateUser('owner_test', OWNER_PIN, '10.0.0.5');
  assert.equal(stillLocked.success, false);
  assert.equal(stillLocked.locked, true);

  clock.value += 5 * 60 * 1000 + 1;
  const expiredLockFailure = service.authenticateUser('owner_test', '000000', '10.0.0.5');
  assert.equal(expiredLockFailure.success, false);
  assert.equal(expiredLockFailure.locked, false);
  const stored = getSqliteUserByUsername(currentDb, 'owner_test');
  assert.equal(stored?.id, 'owner-sqlite-auth-test');
});

test('successful login clears a prior failure counter', (t) => {
  const db = openSqliteDatabase({ filePath: ':memory:' });
  t.after(() => db.close());
  runSqliteMigrations(db, SQLITE_MIGRATIONS);
  const owner = ownerRecord();
  insertSqliteUser(db, owner);
  const clock = { value: Date.parse('2026-11-10T10:00:00.000Z') };
  const service = makeService(db, clock);

  service.authenticateUser('owner_test', '000000', '10.0.0.6');
  const login = service.authenticateUser('owner_test', OWNER_PIN, '10.0.0.6');
  assert.equal(login.success, true);
  for (let index = 0; index < 4; index += 1) {
    assert.equal(service.authenticateUser('owner_test', '000000', '10.0.0.6').locked, false);
  }
  assert.equal(service.authenticateUser('owner_test', '000000', '10.0.0.6').locked, true);
});

test('disabling a user invalidates the JWT across service instances', (t) => {
  const db = openSqliteDatabase({ filePath: ':memory:' });
  t.after(() => db.close());
  runSqliteMigrations(db, SQLITE_MIGRATIONS);
  const owner = ownerRecord();
  insertSqliteUser(db, owner);
  const clock = { value: Date.parse('2026-11-10T10:00:00.000Z') };
  const firstService = makeService(db, clock);
  const token = firstService.authenticateUser('owner_test', OWNER_PIN).token as string;
  const changed = firstService.setUserActive(owner.id, false);
  assert.equal(changed.success, false, 'the sole owner cannot be disabled');
  assert.equal(firstService.verifyToken(token)?.userId, owner.id);

  const tellerSalt = crypto.randomBytes(16).toString('hex');
  const teller: SqliteUserRecord = {
    ...owner,
    id: 'teller-sqlite-auth-test',
    username: 'teller_test',
    name: 'صراف اختبار',
    role: 'teller',
    pinSalt: tellerSalt,
    pinHash: hashSqliteAuthPin(OWNER_PIN, tellerSalt),
    sessionVersion: crypto.randomBytes(16).toString('hex'),
  };
  insertSqliteUser(db, teller);
  const tellerToken = firstService.authenticateUser('teller_test', OWNER_PIN).token as string;
  assert.equal(firstService.setUserActive(teller.id, false).success, true);
  const restartedService = makeService(db, clock);
  assert.equal(restartedService.verifyToken(tellerToken), null);
});

test('changing PIN rotates session version and invalidates the old JWT', (t) => {
  const db = openSqliteDatabase({ filePath: ':memory:' });
  t.after(() => db.close());
  runSqliteMigrations(db, SQLITE_MIGRATIONS);
  const owner = ownerRecord();
  insertSqliteUser(db, owner);
  const clock = { value: Date.parse('2026-11-10T10:00:00.000Z') };
  const service = makeService(db, clock);
  const oldToken = service.authenticateUser('owner_test', OWNER_PIN).token as string;

  const changed = service.changePin('owner_test', OWNER_PIN, '739152');
  assert.equal(changed.success, true);
  assert.equal(service.verifyToken(oldToken), null);
  assert.equal(service.verifyToken(changed.token as string)?.userId, owner.id);
  assert.equal(service.authenticateUser('owner_test', OWNER_PIN).success, false);
  assert.equal(service.authenticateUser('owner_test', '739152').success, true);
});

test('rejects malformed, tampered, expired, and wrong-algorithm tokens', (t) => {
  const db = openSqliteDatabase({ filePath: ':memory:' });
  t.after(() => db.close());
  runSqliteMigrations(db, SQLITE_MIGRATIONS);
  insertSqliteUser(db, ownerRecord());
  const clock = { value: Date.parse('2026-11-10T10:00:00.000Z') };
  const service = makeService(db, clock);
  const token = service.authenticateUser('owner_test', OWNER_PIN).token as string;

  assert.equal(service.verifyToken('a.b.c'), null);
  assert.equal(service.verifyToken(token + 'x'), null);
  const badHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payloadPart = token.split('.')[1];
  const badSignature = crypto.createHmac('sha256', SECRET).update(badHeader + '.' + payloadPart).digest('base64url');
  assert.equal(service.verifyToken(badHeader + '.' + payloadPart + '.' + badSignature), null);
  clock.value += 13 * 60 * 60 * 1000;
  assert.equal(service.verifyToken(token), null);
});

test('rejects weak PINs and prevents creating a second owner account', (t) => {
  const db = openSqliteDatabase({ filePath: ':memory:' });
  t.after(() => db.close());
  runSqliteMigrations(db, SQLITE_MIGRATIONS);
  insertSqliteUser(db, ownerRecord());
  const clock = { value: Date.parse('2026-11-10T10:00:00.000Z') };
  const service = makeService(db, clock);

  assert.equal(service.createUser({
    username: 'weak_pin_user',
    name: 'موظف',
    role: 'teller',
    branchId: 'branch-main',
    branchName: 'الفرع الرئيسي',
    pin: '123456',
  }).success, false);
  assert.equal(service.createUser({
    username: 'second_owner',
    name: 'مالك آخر',
    role: 'owner',
    branchId: 'branch-main',
    branchName: 'الفرع الرئيسي',
    pin: '739152',
  }).success, false);
});
