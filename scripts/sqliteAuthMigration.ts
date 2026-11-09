import { runSqliteAuthUserMigration } from '../src/server/db/sqliteAuthMigration.js';

interface CliOptions {
  sourceFile: string;
  databaseFile?: string;
  apply: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliOptions {
  let sourceFile = '';
  let databaseFile: string | undefined;
  let apply = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
    } else if (argument === '--apply') {
      apply = true;
    } else if (argument === '--source-file' && args[index + 1]) {
      sourceFile = args[++index];
    } else if (argument === '--database-file' && args[index + 1]) {
      databaseFile = args[++index];
    } else {
      throw new Error('Unknown or incomplete argument: ' + argument);
    }
  }

  if (!help && !sourceFile) throw new Error('--source-file is required.');
  if (!help && apply && !databaseFile) throw new Error('--database-file is required with --apply.');
  if (!help && !apply && databaseFile) throw new Error('--database-file can be used only with --apply.');

  return { sourceFile, databaseFile, apply, help };
}

const usage =
  'Usage (safe dry-run):\n' +
  '  npm run migrate:sqlite:auth -- --source-file "<path-to-system_users.local.json>"\n\n' +
  'Permanent import (explicit opt-in):\n' +
  '  npm run migrate:sqlite:auth -- --source-file "<path-to-system_users.local.json>" --apply --database-file "<path-to-exchange.sqlite>"\n\n' +
  'Dry-run uses an in-memory SQLite database. Apply creates a checksum-verified backup and never rewrites the source JSON.';

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage + '\n');
  } else {
    const report = runSqliteAuthUserMigration(options);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown SQLite auth migration error.';
  process.stderr.write(message + '\n' + usage + '\n');
  process.exitCode = 1;
}
