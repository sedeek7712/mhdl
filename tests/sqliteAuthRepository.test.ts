import assert from 'node:assert/strict';
import test from 'node:test';
import { openSqliteDatabase, runSqliteMigrations } from '../src/server/db/sqliteDatabase.js';
import { SQLITE_MIGRATIONS } from '../src/server/db/sqliteMigrations.js';
import {
  appendSqliteSecurityEvent,
  changeSqliteUserPin,
  getSqliteUserByUsername,
  insertSqliteUser,
  importSqliteUsers,
  listSqlitePublicUsers,
  listSqliteSecurityEvents,
  resetSqliteStaffPin,
  setSqliteUserActive,
  type SqliteUserRecord,
} from '../src/server/db/sqliteAuthRepository.js';

function createDatabase(t: { after: (fn: () => void) => void }) {
  const db = openSqliteDatabase({ filePath: ':memory:' });
  t.after(() => db.close());
  runSqliteMigrations(db, SQLITE_MIGRATIONS);
  return db;
}

function user(overrides: Partial<SqliteUserRecord> = {}): SqliteUserRecord {
  return {
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
    ...overrides,
  };
}

function insertOwner(db: ReturnType<typeof openSqliteDatabase>) {
  return insertSqliteUser(db, user());
}

test('stores users in SQLite and exposes public users without PIN or session secrets', (t) => {
  const db = createDatabase(t);
  insertOwner(db);
  insertSqliteUser(db, user({
    id: 'user-teller-1',
    username: 'teller_01',
    name: 'الصراف الأول',
    role: 'teller',
    pinSalt: 'd'.repeat(32),
    pinHash: 'e'.repeat(64),
    sessionVersion: 'f'.repeat(32),
  }));

  const loaded = getSqliteUserByUsername(db, 'TELLER_01');
  assert.equal(loaded?.id, 'user-teller-1');
  assert.equal(loaded?.role, 'teller');
  assert.equal(loaded?.pinHash, 'e'.repeat(64));

  const publicUsers = listSqlitePublicUsers(db);
  assert.equal(publicUsers.length, 2);
  assert.deepEqual(Object.keys(publicUsers[0]).sort(), [
    'branchId', 'branchName', 'createdAt', 'id', 'isActive', 'name', 'role', 'username',
  ]);
  assert.equal('pinHash' in publicUsers[0], false);
  assert.equal('pinSalt' in publicUsers[0], false);
  assert.equal('sessionVersion' in publicUsers[0], false);
});

test('rejects a second owner and duplicate usernames without partial writes', (t) => {
  const db = createDatabase(t);
  insertOwner(db);

  assert.throws(
    () => insertSqliteUser(db, user({
      id: 'user-owner-2',
      username: 'owner_second',
      sessionVersion: 'd'.repeat(32),
    })),
    /UNIQUE|unique/i
  );
  assert.throws(
    () => insertSqliteUser(db, user({
      id: 'user-teller-duplicate',
      username: 'OWNER_MAIN',
      role: 'teller',
    })),
    /UNIQUE|unique/i
  );
  assert.equal(listSqlitePublicUsers(db).length, 1);
});

test('rejects malformed usernames and credential hashes before touching the database', (t) => {
  const db = createDatabase(t);
  assert.throws(() => insertSqliteUser(db, user({ username: 'x' })), /Username/);
  assert.throws(() => insertSqliteUser(db, user({ pinHash: 'not-a-hash' })), /PIN hash/);
  assert.equal(listSqlitePublicUsers(db).length, 0);
});

test('status changes rotate session version and owner cannot be disabled', (t) => {
  const db = createDatabase(t);
  insertOwner(db);
  insertSqliteUser(db, user({
    id: 'user-teller-1',
    username: 'teller_01',
    name: 'الصراف الأول',
    role: 'teller',
  }));

  assert.throws(
    () => setSqliteUserActive(db, 'user-owner-1', false, 'd'.repeat(32)),
    /owner account cannot be disabled/
  );
  const changed = setSqliteUserActive(db, 'user-teller-1', false, 'e'.repeat(32));
  assert.equal(changed.isActive, false);
  const stored = getSqliteUserByUsername(db, 'teller_01');
  assert.equal(stored?.sessionVersion, 'e'.repeat(32));
});

test('staff PIN reset reactivates the account and rotates credentials and session version', (t) => {
  const db = createDatabase(t);
  insertOwner(db);
  insertSqliteUser(db, user({
    id: 'user-teller-1',
    username: 'teller_01',
    name: 'الصراف الأول',
    role: 'teller',
    isActive: false,
  }));

  const updated = resetSqliteStaffPin(
    db, 'user-teller-1', 'd'.repeat(32), 'e'.repeat(64), 'f'.repeat(32)
  );
  assert.equal(updated.isActive, true);
  assert.equal(getSqliteUserByUsername(db, 'teller_01')?.pinHash, 'e'.repeat(64));
  assert.equal(getSqliteUserByUsername(db, 'teller_01')?.sessionVersion, 'f'.repeat(32));

  assert.throws(
    () => resetSqliteStaffPin(db, 'user-owner-1', 'd'.repeat(32), 'e'.repeat(64), 'f'.repeat(32)),
    /Owner PIN/
  );
});

test('owner PIN change uses session-version compare-and-swap and invalidates the previous version', (t) => {
  const db = createDatabase(t);
  insertOwner(db);

  changeSqliteUserPin(
    db, 'user-owner-1', 'c'.repeat(32), 'd'.repeat(32), 'e'.repeat(64), 'f'.repeat(32)
  );
  assert.equal(getSqliteUserByUsername(db, 'owner_main')?.sessionVersion, 'f'.repeat(32));
  assert.throws(
    () => changeSqliteUserPin(
      db, 'user-owner-1', 'c'.repeat(32), '1'.repeat(32), '2'.repeat(64), '3'.repeat(32)
    ),
    /credentials changed concurrently/
  );
});

test('security events persist in SQLite and can be bounded for audit retrieval', (t) => {
  const db = createDatabase(t);
  appendSqliteSecurityEvent(db, {
    id: 'sec-1',
    occurredAt: '2026-11-10T10:00:00.000Z',
    eventType: 'LOGIN_FAILED',
    usernameOrRole: 'unknown_user',
    ipAddress: '127.0.0.1',
    details: 'فشل تسجيل الدخول في اختبار معزول.',
  });
  appendSqliteSecurityEvent(db, {
    id: 'sec-2',
    occurredAt: '2026-11-10T10:01:00.000Z',
    eventType: 'LOGIN_SUCCESS',
    usernameOrRole: 'owner_main',
    ipAddress: '127.0.0.1',
    details: 'نجاح تسجيل الدخول في اختبار معزول.',
  });

  assert.equal(listSqliteSecurityEvents(db, 1)[0].id, 'sec-2');
  assert.equal(listSqliteSecurityEvents(db, 10).length, 2);
  assert.throws(() => listSqliteSecurityEvents(db, 1001), /between 1 and 1000/);
});


test('imports a complete legacy user set atomically and preserves credentials', (t) => {
  const db = createDatabase(t);
  const legacyUsers = [
    user(),
    user({
      id: 'user-teller-1',
      username: 'teller_01',
      name: 'الصراف الأول',
      role: 'teller',
      pinSalt: 'd'.repeat(32),
      pinHash: 'e'.repeat(64),
      sessionVersion: 'f'.repeat(32),
    }),
  ];

  const imported = importSqliteUsers(db, legacyUsers);
  assert.equal(imported.length, 2);
  assert.equal(getSqliteUserByUsername(db, 'owner_main')?.pinHash, 'b'.repeat(64));
  assert.equal(getSqliteUserByUsername(db, 'teller_01')?.pinHash, 'e'.repeat(64));
  assert.equal(listSqlitePublicUsers(db).length, 2);
});

test('rejects partial or ambiguous owner sets before importing any user', (t) => {
  const db = createDatabase(t);
  const teller = user({
    id: 'user-teller-1',
    username: 'teller_01',
    name: 'الصراف الأول',
    role: 'teller',
  });

  assert.throws(() => importSqliteUsers(db, [teller]), /exactly one active owner/);
  assert.throws(() => importSqliteUsers(db, [user(), user({
    id: 'user-owner-2',
    username: 'owner_second',
    sessionVersion: 'd'.repeat(32),
  })]), /exactly one active owner/);
  assert.equal(listSqlitePublicUsers(db).length, 0);
});

test('rolls back the entire user import on duplicate or pre-existing records', (t) => {
  const db = createDatabase(t);
  const duplicateUsername = user({
    id: 'user-teller-1',
    username: 'OWNER_MAIN',
    role: 'teller',
  });
  assert.throws(() => importSqliteUsers(db, [user(), duplicateUsername]), /duplicate usernames or user IDs/);
  assert.equal(listSqlitePublicUsers(db).length, 0);

  insertOwner(db);
  assert.throws(() => importSqliteUsers(db, [
    user(),
    user({
      id: 'user-teller-2',
      username: 'teller_02',
      role: 'teller',
    }),
  ]), /already contains user accounts/);
  assert.equal(listSqlitePublicUsers(db).length, 1);
});
