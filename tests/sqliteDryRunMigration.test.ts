import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runSqliteDryRun } from '../src/server/db/sqliteDryRunMigration.js';

test('checked-in mock JSON dataset imports into disposable SQLite and leaves every source file unchanged', () => {
  const sourceDirectory = path.resolve(process.cwd(), 'data');
  const report = runSqliteDryRun(sourceDirectory);

  assert.equal(report.status, 'PASS', JSON.stringify(report.issues));
  assert.equal(report.validation.sqliteIntegrity, 'ok');
  assert.equal(report.validation.foreignKeyViolations, 0);
  assert.equal(report.validation.journalEntriesBalanced, true);
  assert.equal(report.validation.remittancePayoutsReconciled, true);
  assert.equal(report.validation.accountBalanceSnapshotMatches, true);
  assert.equal(report.validation.sourceFilesUnchanged, true);
  assert.equal(report.validation.temporaryDatabaseRemoved, true);
  assert.equal(report.validation.openingBalanceReconciliation, 'NOT_AVAILABLE');

  assert.equal(report.imported.accounts, 5);
  assert.equal(report.imported.journalEntries, 2);
  assert.equal(report.imported.remittanceNumberReservations, 5);
  assert.equal(report.imported.remittances, 4);
  assert.equal(report.imported.remittancePayouts, 2);
  assert.equal(report.imported.remittanceAuditLogs, 10);
  assert.equal(report.imported.usersValidated, 7);
  assert.equal(report.imported.whatsappDispatchesValidated, 0);

  const serializedReport = JSON.stringify(report);
  assert.equal(serializedReport.includes('pinHash'), false);
  assert.equal(serializedReport.includes('pinSalt'), false);
  assert.equal(serializedReport.includes('senderName'), false);
});

test('dry-run rejects a missing or non-directory source path', () => {
  assert.throws(() => runSqliteDryRun(path.join(process.cwd(), 'data', 'does-not-exist')));
});


test('dry-run blocks before creating a database when an unresolved financial transaction marker exists', () => {
  const sourceDirectory = path.resolve(process.cwd(), 'data');
  const isolatedSource = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-pending-marker-test-'));

  try {
    fs.cpSync(sourceDirectory, isolatedSource, { recursive: true });
    fs.writeFileSync(
      path.join(isolatedSource, 'financial_transaction_pending.json'),
      JSON.stringify({ transactionId: 'fixture-only-pending-transaction' }),
      'utf8'
    );

    const report = runSqliteDryRun(isolatedSource);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.issues.some((issue) => issue.code === 'PENDING_FINANCIAL_TRANSACTION'), true);
    assert.equal(report.validation.temporaryDatabaseRemoved, true);
    assert.equal(JSON.stringify(report).includes('fixture-only-pending-transaction'), false);
  } finally {
    fs.rmSync(isolatedSource, { recursive: true, force: true });
  }
});
