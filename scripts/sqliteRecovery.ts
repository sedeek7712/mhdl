import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteBackup, restoreSqliteBackup } from '../src/server/db/sqliteBackupRestore.js';
import {
  cutoverSqliteDatabase,
  rollbackSqliteDatabase,
  sha256File,
} from '../src/server/db/sqliteRecovery.js';
import { openSqliteDatabase } from '../src/server/db/sqliteDatabase.js';

type Mode = 'cutover' | 'rollback' | 'rehearse';

interface CliOptions {
  mode: Mode | '';
  databaseFile: string;
  stagedFile: string;
  archiveDirectory: string;
  manifestFile: string;
  serverStopped: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliOptions {
  let mode: Mode | '' = '';
  let databaseFile = '';
  let stagedFile = '';
  let archiveDirectory = '';
  let manifestFile = '';
  let serverStopped = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
    } else if (argument === 'cutover' || argument === 'rollback' || argument === 'rehearse') {
      if (mode) throw new Error('Choose exactly one mode: cutover, rollback, or rehearse.');
      mode = argument;
    } else if (argument === '--database-file' && args[index + 1]) {
      databaseFile = args[++index];
    } else if (argument === '--staged-file' && args[index + 1]) {
      stagedFile = args[++index];
    } else if (argument === '--archive-directory' && args[index + 1]) {
      archiveDirectory = args[++index];
    } else if (argument === '--manifest-file' && args[index + 1]) {
      manifestFile = args[++index];
    } else if (argument === '--server-stopped') {
      serverStopped = true;
    } else {
      throw new Error('Unknown or incomplete argument: ' + argument);
    }
  }

  if (!help && !mode) throw new Error('A recovery mode is required.');
  if (!help && mode === 'cutover' && (!databaseFile || !stagedFile || !archiveDirectory || !serverStopped)) {
    throw new Error('cutover requires --database-file, --staged-file, --archive-directory, and --server-stopped.');
  }
  if (!help && mode === 'rollback' && (!manifestFile || !serverStopped)) {
    throw new Error('rollback requires --manifest-file and --server-stopped.');
  }
  if (!help && mode !== 'cutover' && (databaseFile || stagedFile || archiveDirectory)) {
    throw new Error('cutover-only arguments cannot be used in this mode.');
  }
  if (!help && mode !== 'rollback' && manifestFile) {
    throw new Error('rollback-only arguments cannot be used in this mode.');
  }
  if (!help && mode === 'rehearse' && serverStopped) {
    throw new Error('rehearse uses disposable temporary files and does not accept --server-stopped.');
  }
  return {
    mode,
    databaseFile,
    stagedFile,
    archiveDirectory,
    manifestFile,
    serverStopped,
    help,
  };
}

const usage =
  'Guarded SQLite cutover (only after restoring and verifying a staged copy):\n' +
  '  npm run sqlite:recovery -- cutover --database-file "<current.sqlite>" --staged-file "<staged.sqlite>" --archive-directory "<new-archive-folder>" --server-stopped\n\n' +
  'Rollback to the exact pre-cutover database and sidecar set:\n' +
  '  npm run sqlite:recovery -- rollback --manifest-file "<archive-folder/recovery-manifest.json>" --server-stopped\n\n' +
  'Run a complete isolated rehearsal with synthetic data only:\n' +
  '  npm run sqlite:recovery -- rehearse\n\n' +
  'The confirmation flag is an operator assertion; this tool does not detect or stop server/Electron processes.\n' +
  'The current database, staged restore, and archive must be on the same filesystem. Keep the application stopped\n' +
  'until verification finishes. Never run rehearsal with a production database path.';

function readValue(filePath: string): string {
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

function seedProbeDatabase(filePath: string, value: string): void {
  const db = openSqliteDatabase({ filePath });
  try {
    db.exec('CREATE TABLE recovery_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT');
    db.prepare('INSERT INTO recovery_probe (id, value) VALUES (?, ?)').run('probe-1', value);
  } finally {
    db.close();
  }
}

async function runRehearsal(encryptionKeyHex: string): Promise<Record<string, unknown>> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-sqlite-recovery-rehearsal-'));
  try {
    const sourceFile = path.join(directory, 'synthetic-snapshot.sqlite');
    const databaseFile = path.join(directory, 'synthetic-current.sqlite');
    const backupFile = path.join(directory, 'synthetic-snapshot.alnbackup');
    const stagedFile = path.join(directory, 'synthetic-staged.sqlite');
    const archiveDirectory = path.join(directory, 'synthetic-recovery-archive');

    seedProbeDatabase(sourceFile, 'approved-snapshot');
    seedProbeDatabase(databaseFile, 'before-cutover');

    const backup = await createSqliteBackup({
      sourceFile,
      destinationFile: backupFile,
      encryptionKeyHex,
    });
    const restore = await restoreSqliteBackup({
      backupFile,
      destinationFile: stagedFile,
      expectedSha256: backup.sha256,
      encryptionKeyHex,
    });
    if (readValue(stagedFile) !== 'approved-snapshot') {
      throw new Error('Isolated rehearsal failed: staged restore data did not match the approved snapshot.');
    }

    const cutover = await cutoverSqliteDatabase({
      databaseFile,
      stagedFile,
      archiveDirectory,
      serverStopped: true,
    });
    if (readValue(databaseFile) !== 'approved-snapshot') {
      throw new Error('Isolated rehearsal failed: cutover database did not contain the staged snapshot.');
    }

    const rollback = await rollbackSqliteDatabase({
      manifestFile: cutover.manifestFile,
      serverStopped: true,
    });
    if (readValue(databaseFile) !== 'before-cutover') {
      throw new Error('Isolated rehearsal failed: rollback did not restore the original synthetic database.');
    }

    return {
      status: 'PASS',
      rehearsal: 'isolated-synthetic-database',
      encryptedBackupSha256: backup.sha256,
      restoredDatabaseSha256: restore.restoredSha256,
      cutoverDatabaseSha256: cutover.databaseSha256,
      rollbackDatabaseSha256: rollback.restoredSha256,
      cutoverVerified: true,
      rollbackVerified: true,
      originalSyntheticDataPreserved: true,
      allTemporaryFilesRemoved: true,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage + '\n');
  } else if (options.mode === 'rehearse') {
    const encryptionKeyHex = (process.env.ALNAMARI_SQLITE_BACKUP_KEY_HEX || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(encryptionKeyHex)) {
      throw new Error('ALNAMARI_SQLITE_BACKUP_KEY_HEX must be configured for the encrypted isolated recovery rehearsal.');
    }
    process.stdout.write(JSON.stringify(await runRehearsal(encryptionKeyHex), null, 2) + '\n');
  } else if (options.mode === 'cutover') {
    const result = await cutoverSqliteDatabase({
      databaseFile: options.databaseFile,
      stagedFile: options.stagedFile,
      archiveDirectory: options.archiveDirectory,
      serverStopped: options.serverStopped,
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    const result = await rollbackSqliteDatabase({
      manifestFile: options.manifestFile,
      serverStopped: options.serverStopped,
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown SQLite recovery error.';
  process.stderr.write(message + '\n' + usage + '\n');
  process.exitCode = 1;
}
