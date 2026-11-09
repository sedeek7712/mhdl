import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('incoming remittance registration is idempotent and leaves a recovery marker on partial save', async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mhdl-incoming-remittance-'));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));

  const previousNodeEnv = process.env.NODE_ENV;
  const previousDataDirectory = process.env.ALNAMARI_TEST_DATA_DIR;
  process.env.NODE_ENV = 'test';
  process.env.ALNAMARI_TEST_DATA_DIR = dataDirectory;

  const zeroBalances = { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 };
  const accounts = [
    {
      id: 'acc-1101',
      code: '1101',
      nameAr: 'الخزينة الرئيسية',
      type: 'asset',
      category: 'cash_box',
      balances: { ...zeroBalances, SAR: 1000 },
    },
    {
      id: 'acc-1102',
      code: '1102',
      nameAr: 'صندوق الكاشير',
      type: 'asset',
      category: 'cash_box',
      balances: { ...zeroBalances, SAR: 500 },
    },
  ];
  const owner = {
    id: 'owner-incoming-test',
    name: 'مالك الاختبار',
    role: 'owner',
    isActive: true,
  };
  const openingBalances = Object.fromEntries(accounts.map((account) => [
    account.id,
    { type: account.type, balances: { ...account.balances } },
  ]));

  fs.writeFileSync(path.join(dataDirectory, 'accounts_ledger.json'), JSON.stringify(accounts), 'utf8');
  fs.writeFileSync(path.join(dataDirectory, 'journal_entries.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(dataDirectory, 'system_users.local.json'), JSON.stringify([owner]), 'utf8');
  fs.writeFileSync(
    path.join(dataDirectory, 'financial_baseline_approved.local.json'),
    JSON.stringify({
      schemaVersion: 1,
      approvedAt: '2026-11-09 12:00:00',
      approvedBy: owner.name,
      approvedByUserId: owner.id,
      openingBalances,
    }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(dataDirectory, 'remittance_settings.json'),
    JSON.stringify({
      numberingMode: 'automatic',
      prefix: 'TR-',
      nextSequence: 100001,
      updatedAt: '2026-11-09 12:00',
      updatedBy: owner.name,
      updatedByRole: 'owner',
    }),
    'utf8'
  );
  fs.writeFileSync(path.join(dataDirectory, 'remittance_numbers_registry.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(dataDirectory, 'remittance_payouts_registry.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(dataDirectory, 'remittance_audit_logs.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(dataDirectory, 'remittances_master.json'), '[]', 'utf8');

  try {
    const { remittanceRegistry } = await import('../src/server/services/remittanceRegistry.ts');
    const { serverAccountingEngine } = await import('../src/server/services/serverAccountingEngine.ts');

    const request = {
      id: 'client-must-not-control-id',
      transferNumber: 'tr-100001',
      direction: 'incoming' as const,
      status: 'paid' as const,
      senderName: 'المرسل التجريبي',
      senderPhone: '770000001',
      recipientName: 'المستفيد التجريبي',
      recipientPhone: '770000002',
      networkName: 'شبكة النجم',
      amount: 250,
      currency: 'SAR',
      feeAmount: 0,
      totalPaid: 250,
      branchName: 'الفرع الرئيسي',
      tellerName: owner.name,
      tellerRole: owner.role,
      createdAt: '1999-01-01 00:00',
      notes: 'حوالة واردة للاختبار',
    };

    const first = remittanceRegistry.registerMasterRemittance(request);
    assert.equal(first.success, true);
    assert.equal(first.replayed, false);
    assert.ok(first.record);
    assert.equal(first.record?.transferNumber, 'TR-100001');
    assert.equal(first.record?.direction, 'incoming');
    assert.equal(first.record?.status, 'available');
    assert.notEqual(first.record?.id, request.id);
    assert.notEqual(first.record?.createdAt, request.createdAt);
    assert.ok(first.record?.voucherNumber?.startsWith('V-INC-'));
    assert.equal(serverAccountingEngine.isFinancialWriteBlocked(), false);

    const replay = remittanceRegistry.registerMasterRemittance(request);
    assert.equal(replay.success, true);
    assert.equal(replay.replayed, true);
    assert.equal(replay.record?.id, first.record?.id);

    const conflict = remittanceRegistry.registerMasterRemittance({
      ...request,
      amount: 300,
      totalPaid: 300,
    });
    assert.equal(conflict.success, false);
    assert.match(conflict.error || '', /ببيانات مختلفة/);

    const master = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'remittances_master.json'), 'utf8'));
    const numbers = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'remittance_numbers_registry.json'), 'utf8'));
    const audit = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'remittance_audit_logs.json'), 'utf8'));
    assert.equal(master.length, 1);
    assert.equal(master[0].transferNumber, 'TR-100001');
    assert.equal(master[0].status, 'available');
    assert.equal(numbers.length, 1);
    assert.equal(numbers[0].number, 'TR-100001');
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'تسجيل حوالة واردة في السجل المركزي');
    assert.equal(fs.existsSync(path.join(dataDirectory, 'financial_transaction_pending.json')), false);

    const reservedOnly = remittanceRegistry.registerTransferNumber('TR-100002', owner.name, 'manual');
    assert.equal(reservedOnly.success, true);
    const reservedConflict = remittanceRegistry.registerMasterRemittance({
      ...request,
      transferNumber: 'TR-100002',
    });
    assert.equal(reservedConflict.success, false);
    assert.match(reservedConflict.error || '', /محجوزة مسبقاً/);

    Object.defineProperty(remittanceRegistry, 'saveNumbersToDisk', {
      configurable: true,
      value: () => {
        throw new Error('injected registry write failure');
      },
    });

    const partialFailure = remittanceRegistry.registerMasterRemittance({
      ...request,
      transferNumber: 'TR-200001',
    });
    assert.equal(partialFailure.success, false);
    assert.equal(partialFailure.errorCode, 'COMMIT_PENDING_RECOVERY');
    assert.equal(remittanceRegistry.getMasterRemittance('TR-200001'), undefined);
    assert.equal(serverAccountingEngine.isFinancialWriteBlocked(), true);
    assert.equal(fs.existsSync(path.join(dataDirectory, 'financial_transaction_pending.json')), true);

    const persistedAfterFailure = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'remittances_master.json'), 'utf8'));
    assert.equal(persistedAfterFailure.some((record: { transferNumber: string }) => record.transferNumber === 'TR-200001'), true);
    // The marker explains the partial disk state; no subsequent operation may silently proceed.
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDataDirectory === undefined) delete process.env.ALNAMARI_TEST_DATA_DIR;
    else process.env.ALNAMARI_TEST_DATA_DIR = previousDataDirectory;
  }
});
