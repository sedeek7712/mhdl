import assert from 'node:assert/strict';
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
