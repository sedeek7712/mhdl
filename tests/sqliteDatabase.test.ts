import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getDefaultSqliteDatabasePath,
  openSqliteDatabase,
  runSqliteMigrations,
  type SqliteMigration,
} from '../src/server/db/sqliteDatabase.js';

const baseMigrations: SqliteMigration[] = [
  {
    version: 1,
    name: 'create_accounts',
    sql: `
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'create_entries',
    sql: `
      CREATE TABLE entries (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0)
      );
    `,
  },
];

function makeTempDirectory(t: { after: (fn: () => void) => void }): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mhdl-sqlite-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('default database path is outside the application directory and uses Windows user data', () => {
  const databasePath = getDefaultSqliteDatabasePath(
    { APPDATA: 'C:\\Users\\Tester\\AppData\\Roaming' },
    'win32',
    'C:\\Users\\Tester'
  );

  assert.match(databasePath, /AmroAlnamariExchange[\\/]exchange\.sqlite$/);
  assert.match(databasePath, /AppData[\\/]Roaming/);
});

test('SQLite enables foreign keys, FULL synchronous mode, WAL, and configured busy timeout', (t) => {
  const directory = makeTempDirectory(t);
  const databasePath = path.join(directory, 'exchange.sqlite');
  const db = openSqliteDatabase({ filePath: databasePath, busyTimeoutMs: 2500 });
  t.after(() => db.close());

  assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);
  assert.equal((db.prepare('PRAGMA synchronous').get() as { synchronous: number }).synchronous, 2);
  assert.equal((db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout, 2500);
  assert.equal((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
  assert.equal(fs.existsSync(databasePath), true);
});

test('migrations are ordered, recorded, repeatable, and enforce foreign keys', (t) => {
  const db = openSqliteDatabase({ filePath: ':memory:' });
  t.after(() => db.close());

  const applied = runSqliteMigrations(db, [...baseMigrations].reverse());
  assert.deepEqual(applied.map((migration) => migration.version), [1, 2]);
  assert.deepEqual(runSqliteMigrations(db, baseMigrations).map((migration) => migration.version), [1, 2]);

  db.prepare('INSERT INTO accounts (id, name) VALUES (?, ?)').run('cash', 'Cash box');
  db.prepare('INSERT INTO entries (id, account_id, amount_minor) VALUES (?, ?, ?)').run('entry-1', 'cash', 1000);
  assert.throws(() => {
    db.prepare('INSERT INTO entries (id, account_id, amount_minor) VALUES (?, ?, ?)').run('entry-2', 'missing', 100);
  });
});

test('a failed migration rolls back its schema changes and migration record', (t) => {
  const db = openSqliteDatabase({ filePath: ':memory:' });
  t.after(() => db.close());

  const failing: SqliteMigration[] = [{
    version: 1,
    name: 'must_rollback',
    sql: 'CREATE TABLE rollback_probe (id TEXT PRIMARY KEY); INSERT INTO missing_table VALUES (1);',
  }];

  assert.throws(() => runSqliteMigrations(db, failing));
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rollback_probe'"
  ).get();
  assert.equal(table, undefined);
  const applied = db.prepare('SELECT version FROM schema_migrations').all();
  assert.deepEqual(applied, []);
});

test('changing an already applied migration is rejected', (t) => {
  const db = openSqliteDatabase({ filePath: ':memory:' });
  t.after(() => db.close());

  runSqliteMigrations(db, [baseMigrations[0]]);
  assert.throws(
    () => runSqliteMigrations(db, [{ ...baseMigrations[0], sql: 'CREATE TABLE changed_table (id TEXT);' }]),
    /differs from the version already applied/
  );
});

test('database contents survive close and reopen', (t) => {
  const directory = makeTempDirectory(t);
  const databasePath = path.join(directory, 'persistent.sqlite');

  const first = openSqliteDatabase({ filePath: databasePath });
  runSqliteMigrations(first, baseMigrations);
  first.prepare('INSERT INTO accounts (id, name) VALUES (?, ?)').run('main-cash', 'Main cash');
  first.close();

  const second = openSqliteDatabase({ filePath: databasePath });
  t.after(() => second.close());
  const row = second.prepare('SELECT name FROM accounts WHERE id = ?').get('main-cash') as { name: string };
  assert.equal(row.name, 'Main cash');
});

test('invalid busy timeout is rejected before opening a database', () => {
  assert.throws(() => openSqliteDatabase({ filePath: ':memory:', busyTimeoutMs: -1 }), /busyTimeoutMs/);
  assert.throws(() => openSqliteDatabase({ filePath: ':memory:', busyTimeoutMs: 60001 }), /busyTimeoutMs/);
});
