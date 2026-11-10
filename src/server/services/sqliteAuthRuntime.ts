import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDefaultSqliteDatabasePath,
  openSqliteDatabase,
  type SqliteDatabaseOptions,
} from '../db/sqliteDatabase.js';
import { runSqliteMigrations } from '../db/sqliteDatabase.js';
import { SQLITE_MIGRATIONS } from '../db/sqliteMigrations.js';
import { listSqlitePublicUsers } from '../db/sqliteAuthRepository.js';
import { createSqliteAuthRouter } from '../routes/sqliteAuthRoutes.js';
import { loadOrCreateJwtSecret, resolveJwtSecretFilePath } from '../security/jwtSecret.js';
import {
  SqliteAuthService,
  type SqliteAuthServiceOptions,
} from './sqliteAuthService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SqliteAuthRuntimeOptions {
  databaseFile?: string;
  jwtSecretFile?: string;
  jwtSecret?: string;
  env?: NodeJS.ProcessEnv;
  busyTimeoutMs?: SqliteDatabaseOptions['busyTimeoutMs'];
  tokenExpiryHours?: SqliteAuthServiceOptions['tokenExpiryHours'];
  maxFailedAttempts?: SqliteAuthServiceOptions['maxFailedAttempts'];
  lockDurationMs?: SqliteAuthServiceOptions['lockDurationMs'];
  now?: SqliteAuthServiceOptions['now'];
  timestamp?: SqliteAuthServiceOptions['timestamp'];
}

export interface SqliteAuthRuntime {
  databaseFile: string;
  service: SqliteAuthService;
  router: ReturnType<typeof createSqliteAuthRouter>;
  close(): void;
}

/**
 * Creates the SQLite auth runtime only after schema, owner, integrity, and FK
 * checks pass. It does not mount routes or change the active JSON-backed server.
 */
export function createSqliteAuthRuntime(options: SqliteAuthRuntimeOptions = {}): SqliteAuthRuntime {
  const env = options.env ?? process.env;
  const configuredDatabaseFile = options.databaseFile || env.ALNAMARI_SQLITE_DB_PATH ||
    getDefaultSqliteDatabasePath(env);
  const databaseFile = configuredDatabaseFile === ':memory:'
    ? ':memory:'
    : path.resolve(configuredDatabaseFile);

  if (databaseFile !== ':memory:') {
    let databaseStat: fs.Stats;
    try {
      databaseStat = fs.lstatSync(databaseFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('SQLite auth database file does not exist. Run the reviewed account import against the exact configured database path before enabling SQLite auth.');
      }
      throw error;
    }
    if (databaseStat.isSymbolicLink() || !databaseStat.isFile()) {
      throw new Error('SQLite auth database path must reference an existing regular file, not a symbolic link or directory.');
    }
  }

  const secretFile = options.jwtSecretFile ||
    resolveJwtSecretFilePath(__dirname, env);
  const jwtSecret = options.jwtSecret?.trim() || loadOrCreateJwtSecret(secretFile, env);
  if (jwtSecret.length < 32) {
    throw new Error('SQLite auth runtime requires a JWT secret of at least 32 characters.');
  }

  const db = openSqliteDatabase({
    filePath: databaseFile,
    busyTimeoutMs: options.busyTimeoutMs,
  });

  try {
    runSqliteMigrations(db, SQLITE_MIGRATIONS);

    const users = listSqlitePublicUsers(db);
    const ownerCount = users.filter((user) => user.role === 'owner').length;
    const activeOwnerCount = users.filter((user) => user.role === 'owner' && user.isActive).length;
    if (ownerCount !== 1 || activeOwnerCount !== 1) {
      throw new Error(
        'SQLite auth startup refused: exactly one active owner account is required. Import and verify the complete user set before starting authentication.'
      );
    }

    const integrity = db.prepare('PRAGMA integrity_check').get() as
      | { integrity_check?: unknown }
      | undefined;
    if (String(integrity?.integrity_check ?? '') !== 'ok') {
      throw new Error('SQLite auth startup refused: database integrity_check did not return ok.');
    }
    const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyViolations.length > 0) {
      throw new Error('SQLite auth startup refused: foreign-key violations were detected.');
    }

    const service = new SqliteAuthService({
      db,
      jwtSecret,
      tokenExpiryHours: options.tokenExpiryHours,
      maxFailedAttempts: options.maxFailedAttempts,
      lockDurationMs: options.lockDurationMs,
      now: options.now,
      timestamp: options.timestamp,
    });
    const router = createSqliteAuthRouter(service);
    let closed = false;

    return {
      databaseFile,
      service,
      router,
      close() {
        if (closed) return;
        closed = true;
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
