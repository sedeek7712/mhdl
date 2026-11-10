import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runSqliteDryRun } from '../src/server/db/sqliteDryRunMigration.js';

test('checked-in mock JSON dataset imports into disposable SQLite and leaves every source file unchanged', () => {
  const sourceDirectory = path.resolve(process.cwd(), 'tests/fixtures/mock-data');
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
  // PASS means the core dry-run completed; it must not imply full cutover parity.
  assert.equal(report.validation.operationalDataImported, false);
  assert.equal(report.validation.voucherArchivesVerified, true);
  assert.equal(report.validation.completeSystemParity, false);
  assert.equal(
    report.warnings.some((warning) => warning.includes('full system parity is incomplete')),
    true
  );

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
  assert.throws(() => runSqliteDryRun(path.join(process.cwd(), 'tests/fixtures/mock-data', 'does-not-exist')));
});


test('dry-run blocks before creating a database when an unresolved financial transaction marker exists', () => {
  const sourceDirectory = path.resolve(process.cwd(), 'tests/fixtures/mock-data');
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

function writeFixtureJson(directory: string, name: string, value: unknown): void {
  fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2), 'utf8');
}

function createOperationalParityFixture(): { directory: string; imagePath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-operational-parity-test-'));
  fs.cpSync(path.resolve(process.cwd(), 'tests/fixtures/mock-data'), directory, { recursive: true });

  const makeUser = (id: string, username: string, role: string) => ({
    id,
    username,
    name: `Fixture ${role}`,
    role,
    branchId: 'fixture-branch',
    branchName: 'فرع الاختبار',
    pinSalt: 'a'.repeat(32),
    pinHash: 'b'.repeat(64),
    isActive: true,
    mustChangePin: false,
    sessionVersion: 'c'.repeat(32),
    createdAt: '2026-11-10T08:00:00.000Z',
  });
  writeFixtureJson(directory, 'system_users.local.json', [
    makeUser('fixture-owner-id', 'fixture_owner', 'owner'),
    makeUser('fixture-teller-id', 'fixture_teller', 'teller'),
  ]);

  writeFixtureJson(directory, 'exchange_rate_state.json', {
    schemaVersion: 1,
    rates: [{
      id: 'fixture-rate-usd-sar',
      fromCurrency: 'USD',
      toCurrency: 'SAR',
      buyRate: 3.75,
      sellRate: 3.76,
      updatedAt: '2026-11-10T08:10:00.000Z',
      updatedBy: 'fixture_owner',
    }],
    auditLogs: [{
      id: 'fixture-rate-audit-1',
      currencyPair: 'USD / SAR',
      oldBuyRate: 3.7,
      newBuyRate: 3.75,
      oldSellRate: 3.71,
      newSellRate: 3.76,
      changedAt: '2026-11-10T08:10:00.000Z',
      changedBy: 'Fixture owner',
      changedById: 'fixture-owner-id',
      note: 'Fixture rate update',
    }],
  });

  const balances = {
    YER_OLD: 1000,
    YER_NEW: 2000,
    SAR: 10,
    USD: 5,
  };
  const zero = { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 };
  const closedShift = {
    id: 'fixture-closed-shift',
    boxId: 'fixture-closed-box',
    boxNameAr: 'صندوق الوردية المغلقة التجريبية',
    tellerId: 'fixture-teller-id',
    tellerName: 'Fixture teller',
    openedAt: '2026-11-09T08:00:00.000Z',
    closedAt: '2026-11-09T16:00:00.000Z',
    status: 'closed',
    openingBalances: balances,
    expectedBalances: balances,
    actualBalances: balances,
    discrepancies: zero,
    notes: '',
    openedByRole: 'teller',
    closedBy: 'Fixture manager',
    closedById: 'fixture-owner-id',
    openIdempotencyKey: '11111111-1111-4111-8111-111111111111',
    closeIdempotencyKey: '22222222-2222-4222-8222-222222222222',
    openRequestFingerprint: 'd'.repeat(64),
    closeRequestFingerprint: 'e'.repeat(64),
  };
  const activeShift = {
    id: 'fixture-active-shift',
    boxId: 'fixture-active-box',
    boxNameAr: 'صندوق الوردية المفتوحة التجريبية',
    tellerId: 'fixture-teller-id',
    tellerName: 'Fixture teller',
    openedAt: '2026-11-10T08:00:00.000Z',
    status: 'open',
    openingBalances: balances,
    expectedBalances: balances,
    actualBalances: balances,
    discrepancies: zero,
    notes: '',
    openedByRole: 'teller',
    openIdempotencyKey: '33333333-3333-4333-8333-333333333333',
    openRequestFingerprint: 'f'.repeat(64),
  };
  writeFixtureJson(directory, 'cash_box_shift_state.json', {
    schemaVersion: 1,
    activeShift,
    history: [closedShift],
  });

  // Valid 1x1 RGBA PNG (including IHDR/IDAT/IEND chunks and CRCs).
  const image = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c63f80f040009fb03fdfb5e6b2b0000000049454e44ae426082',
    'hex'
  );
  const archiveDirectory = path.join(directory, 'archived_vouchers');
  fs.mkdirSync(archiveDirectory, { recursive: true });
  const imagePath = path.join(archiveDirectory, 'fixture-voucher.png');
  fs.writeFileSync(imagePath, image);
  const imageHash = crypto.createHash('sha256').update(image).digest('hex');
  writeFixtureJson(directory, 'whatsapp_dispatch_registry.json', [{
    id: 'fixture-dispatch-1',
    transactionId: 'fixture-transaction-1',
    voucherNumber: 'FIXTURE-VOUCHER-1',
    voucherType: 'remittance',
    recipientPhone: '+967700000001',
    sha256: imageHash,
    fileSizeBytes: image.length,
    metaMediaId: 'fixture-media-id',
    whatsappMessageId: 'fixture-whatsapp-message-id',
    status: 'SENT',
    caption: 'Fixture voucher',
    createdAt: '2026-11-10T08:20:00.000Z',
    uploadedAt: '2026-11-10T08:20:01.000Z',
    sentAt: '2026-11-10T08:20:02.000Z',
    attemptsCount: 1,
    employeeId: 'fixture-teller-id',
    employeeName: 'Fixture teller',
    idempotencyKey: 'fixture-dispatch-idempotency',
    storageKey: 'fixture-voucher.png',
    snapshot: { transactionId: 'fixture-transaction-1', voucherNumber: 'FIXTURE-VOUCHER-1' },
    rawWebhookEvents: [{
      id: 'fixture-webhook-event',
      status: 'sent',
      timestamp: '2026-11-10T08:20:02.000Z',
      recipient_id: '+967700000001',
    }],
  }]);

  return { directory, imagePath };
}

test('operational dry-run imports isolated users, rates, shifts, WhatsApp events and archived voucher images', () => {
  const fixture = createOperationalParityFixture();

  try {
    const report = runSqliteDryRun(fixture.directory);

    assert.equal(report.status, 'PASS', JSON.stringify(report.issues));
    assert.equal(report.validation.operationalDataImported, true);
    assert.equal(report.validation.voucherArchivesVerified, true);
    assert.equal(report.validation.completeSystemParity, false);
    assert.equal(report.validation.openingBalanceReconciliation, 'NOT_AVAILABLE');
    assert.equal(report.validation.sourceFilesUnchanged, true);
    assert.equal(report.imported.localUsersImported, 2);
    assert.equal(report.imported.exchangeRates, 1);
    assert.equal(report.imported.exchangeRateAuditLogs, 1);
    assert.equal(report.imported.cashierShifts, 2);
    assert.equal(report.imported.cashierShiftBalances, 32);
    assert.equal(report.imported.cashierShiftEvents, 3);
    assert.equal(report.imported.whatsappDispatches, 1);
    assert.equal(report.imported.whatsappWebhookEvents, 1);
    assert.equal(report.imported.voucherAttachments, 1);

    const imageSnapshot = report.sourceFiles.find((item) => item.name === 'archived_vouchers/fixture-voucher.png');
    assert.equal(imageSnapshot?.kind, 'binary');
    assert.equal(imageSnapshot?.disposition, 'imported');
    assert.equal(fs.existsSync(fixture.imagePath), true);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('operational dry-run rejects a local-user registry without exactly one active owner', () => {
  const fixture = createOperationalParityFixture();

  try {
    writeFixtureJson(fixture.directory, 'system_users.local.json', [{
      id: 'fixture-teller-only',
      username: 'fixture_teller',
      name: 'Fixture teller',
      role: 'teller',
      branchId: 'fixture-branch',
      branchName: 'فرع الاختبار',
      pinSalt: 'a'.repeat(32),
      pinHash: 'b'.repeat(64),
      isActive: true,
      mustChangePin: false,
      sessionVersion: 'c'.repeat(32),
      createdAt: '2026-11-10T08:00:00.000Z',
    }]);

    const report = runSqliteDryRun(fixture.directory);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.validation.operationalDataImported, false);
    assert.equal(report.validation.temporaryDatabaseRemoved, true);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('operational dry-run rejects a WhatsApp voucher archive whose hash does not match its dispatch', () => {
  const fixture = createOperationalParityFixture();

  try {
    fs.appendFileSync(fixture.imagePath, Buffer.from([0x00]));
    const report = runSqliteDryRun(fixture.directory);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.validation.temporaryDatabaseRemoved, true);
    assert.equal(report.validation.completeSystemParity, false);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('operational dry-run rejects unbalanced closed-shift discrepancies and undocumented variances', () => {
  for (const scenario of ['mismatch', 'variance-without-note'] as const) {
    const fixture = createOperationalParityFixture();

    try {
      const statePath = path.join(fixture.directory, 'cash_box_shift_state.json');
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
        history: Array<{
          expectedBalances: Record<string, number>;
          actualBalances: Record<string, number>;
          discrepancies: Record<string, number>;
          notes: string;
        }>;
      };
      const closed = state.history[0];

      if (scenario === 'mismatch') {
        closed.discrepancies.YER_OLD = 1;
      } else {
        closed.actualBalances.YER_OLD = closed.expectedBalances.YER_OLD + 1;
        closed.discrepancies.YER_OLD = 1;
        closed.notes = '';
      }

      writeFixtureJson(fixture.directory, 'cash_box_shift_state.json', {
        schemaVersion: 1,
        activeShift: JSON.parse(fs.readFileSync(
          path.join(fixture.directory, 'cash_box_shift_state.json'),
          'utf8'
        )).activeShift,
        history: state.history,
      });

      const report = runSqliteDryRun(fixture.directory);
      assert.equal(report.status, 'FAIL', scenario);
      assert.equal(report.validation.temporaryDatabaseRemoved, true);
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test('authentication accepts a named username and rejects public role-name aliases', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-auth-username-only-test-'));
  const salt = 'a'.repeat(32);
  const pin = '849263';
  const pinHash = crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex');

  try {
    writeFixtureJson(directory, 'system_users.local.json', [{
      id: 'fixture-auth-owner',
      name: 'Fixture owner',
      role: 'owner',
      username: 'fixture_owner',
      branchId: 'fixture-branch',
      branchName: 'Fixture branch',
      pinSalt: salt,
      pinHash,
      isActive: true,
      mustChangePin: false,
      sessionVersion: 'c'.repeat(32),
      createdAt: '2026-11-10 08:00',
    }]);

    const source = [
      "import { authService } from './src/server/services/authService.ts';",
      "const roleAlias = authService.authenticateUser('owner', '849263', '127.0.0.1');",
      "if (roleAlias.success) process.exit(10);",
      "const namedUser = authService.authenticateUser('fixture_owner', '849263', '127.0.0.2');",
      "if (!namedUser.success || namedUser.user?.username !== 'fixture_owner') process.exit(11);",
    ].join('\n');
    const child = spawnSync(process.execPath, [
      '--import', 'tsx',
      '--input-type=module',
      '--eval', source,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ALNAMARI_TEST_DATA_DIR: directory,
        JWT_SECRET: 'auth-username-only-test-secret-with-at-least-32-characters',
      },
    });

    assert.equal(child.status, 0, child.stderr || child.stdout);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('operational dry-run rejects an empty exchange-rate registry', () => {
  const fixture = createOperationalParityFixture();

  try {
    writeFixtureJson(fixture.directory, 'exchange_rate_state.json', {
      schemaVersion: 1,
      rates: [],
      auditLogs: [],
    });
    const report = runSqliteDryRun(fixture.directory);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.validation.temporaryDatabaseRemoved, true);
    assert.equal(report.validation.completeSystemParity, false);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('operational dry-run rejects all-zero, one-sided, and negative exchange rates', () => {
  const scenarios = [
    { buyRate: 0, sellRate: 0 },
    { buyRate: 0, sellRate: 3.75 },
    { buyRate: -1, sellRate: 3.75 },
  ];

  for (const rate of scenarios) {
    const fixture = createOperationalParityFixture();
    try {
      writeFixtureJson(fixture.directory, 'exchange_rate_state.json', {
        schemaVersion: 1,
        rates: [{
          id: 'fixture-rate-usd-sar',
          fromCurrency: 'USD',
          toCurrency: 'SAR',
          ...rate,
          updatedAt: '2026-11-10T08:10:00.000Z',
          updatedBy: 'fixture_owner',
        }],
        auditLogs: [],
      });
      const report = runSqliteDryRun(fixture.directory);
      assert.equal(report.status, 'FAIL', JSON.stringify(rate));
      assert.equal(report.validation.completeSystemParity, false);
      assert.equal(report.validation.temporaryDatabaseRemoved, true);
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});
