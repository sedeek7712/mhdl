import {
  createSqliteBackup,
  restoreSqliteBackup,
} from '../src/server/db/sqliteBackupRestore.js';

type Mode = 'backup' | 'restore';

interface CliOptions {
  mode: Mode | '';
  sourceFile: string;
  backupFile: string;
  destinationFile: string;
  expectedSha256: string;
  serverStopped: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliOptions {
  let mode: Mode | '' = '';
  let sourceFile = '';
  let backupFile = '';
  let destinationFile = '';
  let expectedSha256 = '';
  let serverStopped = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
    } else if (argument === 'backup' || argument === 'restore') {
      if (mode) throw new Error('Choose exactly one mode: backup or restore.');
      mode = argument;
    } else if (argument === '--source-file' && args[index + 1]) {
      sourceFile = args[++index];
    } else if (argument === '--backup-file' && args[index + 1]) {
      backupFile = args[++index];
    } else if (argument === '--destination-file' && args[index + 1]) {
      destinationFile = args[++index];
    } else if (argument === '--expected-sha256' && args[index + 1]) {
      expectedSha256 = args[++index];
    } else if (argument === '--server-stopped') {
      serverStopped = true;
    } else {
      throw new Error('Unknown or incomplete argument: ' + argument);
    }
  }

  if (!help && !mode) throw new Error('A backup or restore mode is required.');
  if (!help && !destinationFile) throw new Error('--destination-file is required.');
  if (!help && mode === 'backup' && !sourceFile) {
    throw new Error('--source-file is required in backup mode.');
  }
  if (!help && mode === 'restore' && (!backupFile || !expectedSha256)) {
    throw new Error('--backup-file and --expected-sha256 are required in restore mode.');
  }
  if (!help && mode === 'restore' && !serverStopped) {
    throw new Error('Stop the application before restore, then pass --server-stopped.');
  }
  if (!help && mode === 'backup' && (backupFile || expectedSha256 || serverStopped)) {
    throw new Error('Restore-only arguments cannot be used in backup mode.');
  }
  if (!help && mode === 'restore' && sourceFile) {
    throw new Error('--source-file is not accepted in restore mode.');
  }
  return { mode, sourceFile, backupFile, destinationFile, expectedSha256, serverStopped, help };
}

const usage =
  'Encrypted SQLite backup:\n' +
  '  npm run sqlite:backup -- backup --source-file "<exchange.sqlite>" --destination-file "<backup.alnbackup>"\n\n' +
  'Restore into a NEW database path (application must be stopped):\n' +
  '  npm run sqlite:restore -- restore --backup-file "<backup.alnbackup>" --destination-file "<restored.sqlite>" --expected-sha256 "<sha256>" --server-stopped\n\n' +
  'Both commands require ALNAMARI_SQLITE_BACKUP_KEY_HEX to contain exactly 64 hexadecimal characters.\n' +
  'The key is never stored in the backup or printed by this tool. Restore does not replace a live database.';

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage + '\n');
  } else {
    const encryptionKeyHex = (process.env.ALNAMARI_SQLITE_BACKUP_KEY_HEX || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(encryptionKeyHex)) {
      throw new Error('ALNAMARI_SQLITE_BACKUP_KEY_HEX must be configured as a 64-character hexadecimal key.');
    }

    if (options.mode === 'backup') {
      const report = await createSqliteBackup({
        sourceFile: options.sourceFile,
        destinationFile: options.destinationFile,
        encryptionKeyHex,
      });
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
      const report = await restoreSqliteBackup({
        backupFile: options.backupFile,
        destinationFile: options.destinationFile,
        expectedSha256: options.expectedSha256,
        encryptionKeyHex,
      });
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown SQLite backup/restore error.';
  process.stderr.write(message + '\n' + usage + '\n');
  process.exitCode = 1;
}
