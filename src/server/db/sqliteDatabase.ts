import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface SqliteDatabaseOptions {
  filePath?: string;
  busyTimeoutMs?: number;
}

export interface SqliteMigration {
  version: number;
  name: string;
  sql: string;
}

interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
}

function readPragmaNumber(db: DatabaseSync, pragma: string, column: string): number {
  const row = db.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
  const value = row?.[column];
  if (typeof value !== 'number') {
    throw new Error(`SQLite did not return a numeric value for PRAGMA ${pragma}.`);
  }
  return value;
}

export function getDefaultSqliteDatabasePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory = os.homedir()
): string {
  if (platform === 'win32') {
    const windowsPath = path.win32;
    const local = env.LOCALAPPDATA?.trim();
    const roaming = env.APPDATA?.trim();
    const baseDirectory = local || roaming || windowsPath.join(homeDirectory, 'AppData', 'Local');
    return windowsPath.join(baseDirectory, 'AmroAlnamariExchange', 'exchange.sqlite');
  }

  const baseDirectory = env.XDG_DATA_HOME?.trim() || path.join(homeDirectory, '.local', 'share');
  return path.join(baseDirectory, 'AmroAlnamariExchange', 'exchange.sqlite');
}

/**
 * Opens an explicitly located SQLite database. This module is deliberately not
 * imported by the running JSON-backed services yet; adoption happens only after
 * migration and parity tests have been reviewed.
 */
export function openSqliteDatabase(options: SqliteDatabaseOptions = {}): DatabaseSync {
  const filePath = options.filePath || getDefaultSqliteDatabasePath();
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;

  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 60000) {
    throw new Error('SQLite busyTimeoutMs must be an integer between 0 and 60000.');
  }

  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }

  const db = new DatabaseSync(filePath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    if (filePath !== ':memory:') {
      db.exec('PRAGMA journal_mode = WAL');
    }
    db.exec('PRAGMA synchronous = FULL');
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);

    if (readPragmaNumber(db, 'foreign_keys', 'foreign_keys') !== 1) {
      throw new Error('SQLite foreign-key enforcement could not be enabled.');
    }
    if (readPragmaNumber(db, 'synchronous', 'synchronous') !== 2) {
      throw new Error('SQLite synchronous=FULL could not be enabled.');
    }
    if (readPragmaNumber(db, 'busy_timeout', 'timeout') !== busyTimeoutMs) {
      throw new Error('SQLite busy_timeout did not retain the requested value.');
    }

    if (filePath !== ':memory:') {
      const journal = db.prepare('PRAGMA journal_mode').get() as Record<string, unknown> | undefined;
      if (String(journal?.journal_mode).toLowerCase() !== 'wal') {
        throw new Error('SQLite WAL journal mode could not be enabled for the database file.');
      }
    }

    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function migrationChecksum(migration: SqliteMigration): string {
  return crypto.createHash('sha256').update(migration.sql, 'utf8').digest('hex');
}

function validateMigrations(migrations: SqliteMigration[]): void {
  const versions = new Set<number>();
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version < 1) {
      throw new Error('SQLite migration versions must be positive safe integers.');
    }
    if (!migration.name.trim() || !migration.sql.trim()) {
      throw new Error(`SQLite migration ${migration.version} must have a name and SQL.`);
    }
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate SQLite migration version: ${migration.version}.`);
    }
    versions.add(migration.version);
  }
}

export function runSqliteMigrations(db: DatabaseSync, migrations: SqliteMigration[]): AppliedMigration[] {
  validateMigrations(migrations);
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  for (const migration of ordered) {
    const checksum = migrationChecksum(migration);
    const prior = db.prepare(
      'SELECT version, name, checksum FROM schema_migrations WHERE version = ?'
    ).get(migration.version) as AppliedMigration | undefined;

    if (prior) {
      if (prior.name !== migration.name || prior.checksum !== checksum) {
        throw new Error(
          `SQLite migration ${migration.version} differs from the version already applied; refusing to continue.`
        );
      }
      continue;
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)'
      ).run(migration.version, migration.name, checksum, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Preserve the original migration error.
      }
      throw error;
    }
  }

  return db.prepare(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version'
  ).all() as AppliedMigration[];
}
