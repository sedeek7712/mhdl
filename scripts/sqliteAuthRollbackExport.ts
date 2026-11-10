import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { exportSqliteUsersForJsonRollback } from '../src/server/db/sqliteAuthRepository.js';
import { applyPrivateFilePermissions } from '../src/server/security/privateFilePermissions.js';

interface CliOptions {
  databaseFile: string;
  outputFile: string;
  serverStopped: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliOptions {
  let databaseFile = '';
  let outputFile = '';
  let serverStopped = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
    } else if (argument === '--server-stopped') {
      serverStopped = true;
    } else if (argument === '--database-file' && args[index + 1]) {
      databaseFile = args[++index];
    } else if (argument === '--output-file' && args[index + 1]) {
      outputFile = args[++index];
    } else {
      throw new Error('Unknown or incomplete argument: ' + argument);
    }
  }

  if (!help && (!databaseFile || !outputFile)) {
    throw new Error('--database-file and --output-file are required.');
  }
  if (!help && !serverStopped) {
    throw new Error('Stop the application first, then pass --server-stopped to confirm the offline rollback window.');
  }
  return { databaseFile, outputFile, serverStopped, help };
}

const usage =
  'Usage (run only after stopping the application):\n' +
  '  npm run migrate:sqlite:auth:export -- --database-file "<path-to-exchange.sqlite>" --output-file "<new-json-output-path>" --server-stopped\n\n' +
  'The tool exports the full legacy JSON user shape, rotates every SQLite sessionVersion in one transaction,\n' +
  'writes a new private JSON file, and refuses to overwrite an existing output or the source database.\n' +
  'It does not replace system_users.local.json or switch the running server.';

function requireExistingDatabase(filePath: string): string {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('SQLite database must be an existing regular file and cannot be a symbolic link.');
  }
  return resolved;
}

function resolveNewOutput(filePath: string, databaseFile: string): string {
  const resolved = path.resolve(filePath);
  const parent = path.dirname(resolved);
  const parentStat = fs.lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error('Rollback output directory must be an existing regular directory.');
  }
  if (process.platform === 'win32'
    ? resolved.toLowerCase() === databaseFile.toLowerCase()
    : resolved === databaseFile) {
    throw new Error('Rollback JSON output and SQLite database paths must be different.');
  }
  if (fs.existsSync(resolved)) {
    throw new Error('Rollback output already exists. Refusing to overwrite it.');
  }
  return resolved;
}

function writePrivateNewFile(outputFile: string, contents: string): void {
  const temporaryFile = path.join(
    path.dirname(outputFile),
    '.' + path.basename(outputFile) + '.tmp-' + crypto.randomUUID()
  );
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryFile, 'wx', 0o600);
    fs.closeSync(descriptor);
    descriptor = undefined;
    applyPrivateFilePermissions(temporaryFile);
    descriptor = fs.openSync(temporaryFile, 'r+');
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(temporaryFile, outputFile);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporaryFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage + '\n');
  } else {
    const databaseFile = requireExistingDatabase(options.databaseFile);
    const outputFile = resolveNewOutput(options.outputFile, databaseFile);
    const db = new DatabaseSync(databaseFile);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      db.exec('PRAGMA foreign_keys = ON');
      const integrity = db.prepare('PRAGMA integrity_check').get() as
        | { integrity_check?: unknown }
        | undefined;
      if (String(integrity?.integrity_check ?? '') !== 'ok') {
        throw new Error('Rollback export refused: SQLite integrity_check did not return ok.');
      }
      if (db.prepare('PRAGMA foreign_key_check').all().length !== 0) {
        throw new Error('Rollback export refused: SQLite foreign-key violations were detected.');
      }

      const users = exportSqliteUsersForJsonRollback(db);
      const activeOwnerCount = users.filter((user) => user.role === 'owner' && user.isActive).length;
      const json = JSON.stringify(users, null, 2) + '\n';
      writePrivateNewFile(outputFile, json);
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(outputFile)).digest('hex');

      process.stdout.write(JSON.stringify({
        status: 'PASS',
        mode: 'offline-json-rollback-export',
        userCount: users.length,
        activeOwnerCount,
        sessionsRotated: true,
        outputFile,
        outputSha256: sha256,
        outputSizeBytes: fs.statSync(outputFile).size,
      }, null, 2) + '\n');
    } finally {
      db.close();
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown SQLite authentication rollback export error.';
  process.stderr.write(message + '\n' + usage + '\n');
  process.exitCode = 1;
}
