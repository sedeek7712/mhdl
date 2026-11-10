import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { openSqliteDatabase } from '../src/server/db/sqliteDatabase.js';

function makeDirectory(t: { after: (fn: () => void) => void }): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-windows-preflight-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function seedDatabase(filePath: string, value: string): void {
  const db = openSqliteDatabase({ filePath });
  try {
    db.exec('CREATE TABLE preflight_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT');
    db.prepare('INSERT INTO preflight_probe (id, value) VALUES (?, ?)').run('probe-1', value);
  } finally {
    db.close();
  }
}

function runPreflight(directory: string, expectedSha256: string): ReturnType<typeof JSON.parse> {
  const scriptFile = fileURLToPath(new URL('../scripts/sqliteWindowsPreflight.ts', import.meta.url));
  const databaseFile = path.join(directory, 'current.sqlite');
  const stagedFile = path.join(directory, 'staged.sqlite');
  const archiveDirectory = path.join(directory, 'new-archive');
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', scriptFile,
    '--database-file', databaseFile,
    '--staged-file', stagedFile,
    '--expected-staged-sha256', expectedSha256,
    '--archive-directory', archiveDirectory,
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.ok(result.stdout, result.stderr);
  return JSON.parse(result.stdout) as ReturnType<typeof JSON.parse>;
}

test('Windows preflight is read-only and reports integrity, checksum, and operator gates', (t) => {
  const directory = makeDirectory(t);
  const databaseFile = path.join(directory, 'current.sqlite');
  const stagedFile = path.join(directory, 'staged.sqlite');
  seedDatabase(databaseFile, 'current-synthetic');
  seedDatabase(stagedFile, 'staged-synthetic');
  const beforeCurrent = fs.readFileSync(databaseFile);
  const beforeStaged = fs.readFileSync(stagedFile);
  const sha256 = crypto.createHash('sha256').update(beforeStaged).digest('hex');

  const report = runPreflight(directory, sha256);
  assert.equal(report.readOnly, true);
  assert.ok(['BLOCKED', 'REVIEW_REQUIRED', 'READY_FOR_SUPERVISED_REHEARSAL'].includes(report.status));
  assert.ok(report.checks.some((check: { name: string; status: string }) => check.name === 'current_database_integrity' && check.status === 'PASS'));
  assert.ok(report.checks.some((check: { name: string; status: string }) => check.name === 'staged_database_integrity' && check.status === 'PASS'));
  assert.ok(report.checks.some((check: { name: string; status: string }) => check.name === 'staged_sha256' && check.status === 'PASS'));
  assert.equal(report.requiredOperatorChecks.length >= 3, true);
  assert.deepEqual(fs.readFileSync(databaseFile), beforeCurrent);
  assert.deepEqual(fs.readFileSync(stagedFile), beforeStaged);
  assert.equal(fs.existsSync(path.join(directory, 'new-archive')), false);
});

test('Windows preflight blocks an unapproved staged checksum without changing files', (t) => {
  const directory = makeDirectory(t);
  const databaseFile = path.join(directory, 'current.sqlite');
  const stagedFile = path.join(directory, 'staged.sqlite');
  seedDatabase(databaseFile, 'current-synthetic');
  seedDatabase(stagedFile, 'staged-synthetic');
  const beforeCurrent = fs.readFileSync(databaseFile);
  const beforeStaged = fs.readFileSync(stagedFile);

  const report = runPreflight(directory, '0'.repeat(64));
  assert.equal(report.status, 'BLOCKED');
  assert.ok(report.checks.some((check: { name: string; status: string }) => check.name === 'staged_sha256' && check.status === 'BLOCK'));
  assert.deepEqual(fs.readFileSync(databaseFile), beforeCurrent);
  assert.deepEqual(fs.readFileSync(stagedFile), beforeStaged);
  assert.equal(fs.existsSync(path.join(directory, 'new-archive')), false);
});
