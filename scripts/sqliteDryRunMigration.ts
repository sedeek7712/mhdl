import path from 'node:path';
import { runSqliteDryRun } from '../src/server/db/sqliteDryRunMigration.js';

function readSourceDirectory(args: string[]): string | null {
  const index = args.indexOf('--source-dir');
  if (index < 0 || !args[index + 1]) return null;
  return path.resolve(args[index + 1]);
}

const sourceDirectory = readSourceDirectory(process.argv.slice(2));
if (!sourceDirectory) {
  process.stderr.write(
    'Usage: bun run migrate:sqlite:dry-run -- --source-dir "<local-data-directory>"\n' +
    'The source directory is read-only. The temporary SQLite database is removed after the report.\n'
  );
  process.exitCode = 2;
} else {
  const report = runSqliteDryRun(sourceDirectory);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}
