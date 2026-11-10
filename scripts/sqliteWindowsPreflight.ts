import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

interface Options {
  databaseFile: string;
  stagedFile: string;
  expectedSha256: string;
  archiveDirectory: string;
  help: boolean;
}

interface Check {
  name: string;
  status: 'PASS' | 'WARN' | 'BLOCK';
  detail: string;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    databaseFile: '',
    stagedFile: '',
    expectedSha256: '',
    archiveDirectory: '',
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--help' || value === '-h') options.help = true;
    else if (value === '--database-file' && args[index + 1]) options.databaseFile = args[++index];
    else if (value === '--staged-file' && args[index + 1]) options.stagedFile = args[++index];
    else if (value === '--expected-staged-sha256' && args[index + 1]) options.expectedSha256 = args[++index];
    else if (value === '--archive-directory' && args[index + 1]) options.archiveDirectory = args[++index];
    else throw new Error('Unknown or incomplete argument: ' + value);
  }
  if (!options.help && (!options.databaseFile || !options.stagedFile ||
      !/^[a-f0-9]{64}$/i.test(options.expectedSha256) || !options.archiveDirectory)) {
    throw new Error('preflight requires --database-file, --staged-file, --expected-staged-sha256, and --archive-directory.');
  }
  return options;
}

function regularFile(filePath: string, label: string): string {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(label + ' must be a regular non-symlink file.');
  return resolved;
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verifyDatabase(filePath: string): string {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check?: string }>;
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
      throw new Error('SQLite integrity_check did not return exactly one ok row.');
    }
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length !== 0) throw new Error('SQLite foreign_key_check found violations.');
    return 'integrity_check=ok; foreign_key_check=0';
  } finally {
    db.close();
  }
}

function inspectWindowsProcesses(databaseFile: string): { status: 'PASS' | 'BLOCK'; detail: string } {
  if (process.platform !== 'win32') {
    return { status: 'BLOCK', detail: 'This operational preflight is Windows-only; run it on the target Windows machine.' };
  }
  const command = [
    '$target = [System.IO.Path]::GetFullPath(' + JSON.stringify(databaseFile) + ').ToLowerInvariant()',
    '$items = @(Get-CimInstance Win32_Process | Where-Object {',
    '  $_.Name -match \'^(node|electron)\\.exe$\' -and (',
    '    $_.Name -match \'^electron\\.exe$\' -or',
    '    ($_.CommandLine -and ($_.CommandLine.ToLowerInvariant().Contains($target) -or $_.CommandLine -match \'server\\.(ts|js)|dist[\\\\/]server\'))',
    '  )',
    '} | Select-Object ProcessId, Name, CommandLine)',
    'ConvertTo-Json -InputObject $items -Compress -Depth 3',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return { status: 'BLOCK', detail: 'Could not inspect Windows Node/Electron processes: ' + (result.error?.message || result.stderr.trim() || 'PowerShell failed.') };
  }
  let processes: Array<{ ProcessId?: number; Name?: string }> = [];
  try {
    const parsed = JSON.parse(result.stdout.trim() || '[]') as unknown;
    processes = Array.isArray(parsed) ? parsed as typeof processes : parsed ? [parsed as { ProcessId?: number; Name?: string }] : [];
  } catch {
    return { status: 'BLOCK', detail: 'Windows process inspection returned unreadable output; manual inspection is required.' };
  }
  if (processes.length > 0) {
    const summary = processes.map((item) => (item.Name || 'process') + ' PID ' + String(item.ProcessId || '?')).join(', ');
    return { status: 'BLOCK', detail: 'Potential application process(es) detected: ' + summary + '. Close and inspect them before any rehearsal.' };
  }
  return { status: 'PASS', detail: 'No matching Node server or Electron process was detected; this is not proof that workers, jobs, viewers, or other processes are stopped.' };
}

function runPreflight(options: Options): { status: string; readOnly: true; checks: Check[]; requiredOperatorChecks: string[] } {
  const checks: Check[] = [];
  const add = (name: string, status: Check['status'], detail: string) => checks.push({ name, status, detail });
  let databaseFile = '';
  let stagedFile = '';
  let archiveDirectory = '';

  try {
    databaseFile = regularFile(options.databaseFile, 'Current database');
    add('current_database_file', 'PASS', 'Regular file; no symbolic link.');
  } catch (error) {
    add('current_database_file', 'BLOCK', error instanceof Error ? error.message : String(error));
  }
  try {
    stagedFile = regularFile(options.stagedFile, 'Staged database');
    add('staged_database_file', 'PASS', 'Regular file; no symbolic link.');
  } catch (error) {
    add('staged_database_file', 'BLOCK', error instanceof Error ? error.message : String(error));
  }

  archiveDirectory = path.resolve(options.archiveDirectory);
  try {
    if (fs.existsSync(archiveDirectory)) throw new Error('Archive directory already exists; choose a new empty path.');
    const parent = path.dirname(archiveDirectory);
    const parentStat = fs.statSync(parent);
    if (!parentStat.isDirectory()) throw new Error('Archive parent is not a directory.');
    add('archive_destination', 'PASS', 'Destination does not exist and its parent directory exists.');
  } catch (error) {
    add('archive_destination', 'BLOCK', error instanceof Error ? error.message : String(error));
  }

  if (databaseFile && stagedFile) {
    if (databaseFile === stagedFile || databaseFile === archiveDirectory || stagedFile === archiveDirectory) {
      add('distinct_paths', 'BLOCK', 'Current database, staged database, and archive paths must be distinct.');
    } else add('distinct_paths', 'PASS', 'Current, staged, and archive paths are distinct.');
    try {
      const volume = fs.statSync(databaseFile).dev;
      if (fs.statSync(stagedFile).dev !== volume || fs.statSync(path.dirname(archiveDirectory)).dev !== volume) {
        throw new Error('Current database, staged database, and archive parent are not on the same filesystem.');
      }
      add('same_filesystem', 'PASS', 'All promotion paths resolve to the same filesystem.');
    } catch (error) {
      add('same_filesystem', 'BLOCK', error instanceof Error ? error.message : String(error));
    }
    try {
      const actual = sha256File(stagedFile);
      if (actual !== options.expectedSha256.toLowerCase()) throw new Error('Staged SHA-256 does not match the approved restore report.');
      add('staged_sha256', 'PASS', actual);
    } catch (error) {
      add('staged_sha256', 'BLOCK', error instanceof Error ? error.message : String(error));
    }
    for (const [name, filePath] of [['current_database_integrity', databaseFile], ['staged_database_integrity', stagedFile]] as const) {
      try {
        add(name, 'PASS', verifyDatabase(filePath));
      } catch (error) {
        add(name, 'BLOCK', error instanceof Error ? error.message : String(error));
      }
    }
    const processCheck = inspectWindowsProcesses(databaseFile);
    add('windows_process_scan', processCheck.status, processCheck.detail);
  } else {
    add('database_integrity', 'BLOCK', 'Skipped because one or both database files could not be opened safely.');
    add('windows_process_scan', 'BLOCK', 'Skipped because the current database path is not valid.');
  }

  const blocked = checks.some((item) => item.status === 'BLOCK');
  return {
    status: blocked ? 'BLOCKED' : 'READY_FOR_SUPERVISED_REHEARSAL',
    readOnly: true,
    checks,
    requiredOperatorChecks: [
      'Manually verify that Express, all workers, scheduled jobs, database viewers, backup agents, and any Electron process are stopped.',
      'Verify the deployment account and NTFS folder/file ACLs permit the intended operation and do not expose database or backup files to other users.',
      'Confirm a recent encrypted backup exists, its key is safely retrievable from the approved secret store, and its restore report is the source of the staged SHA-256.',
      'Run this preflight again immediately before a supervised synthetic rehearsal; do not use customer data.',
    ],
  };
}

const usage = 'Read-only Windows preflight:\n' +
  '  npm run sqlite:preflight -- --database-file "<current.sqlite>" --staged-file "<staged.sqlite>" --expected-staged-sha256 "<restore-report-sha256>" --archive-directory "<new-archive-folder>"\n\n' +
  'This command does not stop processes, change ACLs, create directories, checkpoint WAL, or modify database files.';

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) process.stdout.write(usage + '\n');
  else {
    const report = runPreflight(options);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.status === 'BLOCKED') process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n' + usage + '\n');
  process.exitCode = 2;
}
