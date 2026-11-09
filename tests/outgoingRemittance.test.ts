import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('outgoing remittance posts cash, network payable and commission once; replay is idempotent', async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mhdl-outgoing-remittance-'));
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
      balances: { ...zeroBalances, SAR: 2000 },
    },
    {
      id: 'acc-1102',
      code: '1102',
      nameAr: 'صندوق الكاشير',
      type: 'asset',
      category: 'cash_box',
      balances: { ...zeroBalances, SAR: 500 },
    },
    {
      id: 'acc-2201',
      code: '2201',
      nameAr: 'حوالات معلقة ومستحقات الشبكة',
      type: 'liability',
      category: 'remittance',
      balances: { ...zeroBalances },
    },
    {
      id: 'acc-4101',
      code: '4101',
      nameAr: 'إيرادات عمولات الحوالات',
      type: 'revenue',
      category: 'commission',
      balances: { ...zeroBalances },
    },
  ];
  const owner = {
    id: 'owner-outgoing-test',
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
      prefix: 'OUT-',
      nextSequence: 1001,
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
    const { RemittanceRegistry } = await import('../src/server/services/remittanceRegistry.ts');
    const { serverAccountingEngine } = await import('../src/server/services/serverAccountingEngine.ts');
    const registry = new RemittanceRegistry();

    const request = {
      idempotencyKey: crypto.randomUUID(),
      senderName: 'المرسل التجريبي',
      senderPhone: '770000001',
      recipientName: 'المستفيد التجريبي',
      recipientPhone: '770000002',
      networkName: 'شبكة النجم',
      amount: 100,
      currency: 'SAR' as const,
      feeAmount: 5,
      notes: 'حوالة صادرة للاختبار',
      branchName: 'الفرع الرئيسي',
      branchId: 'br-main',
      tellerId: owner.id,
      tellerName: owner.name,
      tellerRole: owner.role,
    };

    const first = registry.registerOutgoingRemittance(request);
    assert.equal(first.success, true);
    assert.equal(first.replayed, false);
    assert.ok(first.record);
    assert.ok(first.journalEntry);
    assert.equal(first.record?.direction, 'outgoing');
    assert.equal(first.record?.status, 'approved');
    assert.equal(first.record?.transferNumber, 'OUT-001001');
    assert.equal(first.record?.totalPaid, 105);
    assert.equal(first.record?.idempotencyKey, request.idempotencyKey);
    assert.equal(first.record?.tellerId, owner.id);
    assert.equal(first.record?.branchId, 'br-main');
    assert.equal(first.journalEntry?.referenceType, 'transfer_send');
    assert.equal(first.journalEntry?.createdById, owner.id);
    assert.equal(first.journalEntry?.branchId, 'br-main');
    assert.equal(first.journalEntry?.referenceId, first.record?.transferNumber);
    assert.equal(first.journalEntry?.voucherNumber, first.record?.voucherNumber);
    assert.equal(first.journalEntry?.idempotencyKey, request.idempotencyKey);

    const lines = first.journalEntry!.lines;
    assert.equal(lines.length, 3);
    assert.equal(lines.find((line) => line.accountId === 'acc-1102')?.debit, 105);
    assert.equal(lines.find((line) => line.accountId === 'acc-2201')?.credit, 100);
    assert.equal(lines.find((line) => line.accountId === 'acc-4101')?.credit, 5);
    assert.equal(lines.reduce((sum, line) => sum + line.debit, 0), 105);
    assert.equal(lines.reduce((sum, line) => sum + line.credit, 0), 105);

    const afterFirst = serverAccountingEngine.getAccounts();
    assert.equal(afterFirst.find((account) => account.id === 'acc-1102')?.balances.SAR, 605);
    assert.equal(afterFirst.find((account) => account.id === 'acc-2201')?.balances.SAR, 100);
    assert.equal(afterFirst.find((account) => account.id === 'acc-4101')?.balances.SAR, 5);

    const replay = registry.registerOutgoingRemittance(request);
    assert.equal(replay.success, true);
    assert.equal(replay.replayed, true);
    assert.equal(replay.record?.id, first.record?.id);
    assert.equal(replay.journalEntry?.id, first.journalEntry?.id);
    assert.equal(serverAccountingEngine.getJournalEntries().length, 1);
    assert.equal(serverAccountingEngine.getAccounts().find((account) => account.id === 'acc-1102')?.balances.SAR, 605);

    const changedAmount = registry.registerOutgoingRemittance({
      ...request,
      amount: 110,
    });
    assert.equal(changedAmount.success, false);
    assert.match(changedAmount.error || '', /بيانات مختلفة/);
    assert.equal(serverAccountingEngine.getJournalEntries().length, 1);

    // A retry remains valid even if numbering settings were changed after the original commit.
    (registry as any).settings = {
      ...(registry as any).settings,
      numberingMode: 'manual',
    };
    const replayAfterSettingsChange = registry.registerOutgoingRemittance(request);
    assert.equal(replayAfterSettingsChange.success, true);
    assert.equal(replayAfterSettingsChange.replayed, true);
    assert.equal(replayAfterSettingsChange.record?.transferNumber, 'OUT-001001');

    const master = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'remittances_master.json'), 'utf8'));
    const numbers = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'remittance_numbers_registry.json'), 'utf8'));
    const audit = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'remittance_audit_logs.json'), 'utf8'));
    const settings = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'remittance_settings.json'), 'utf8'));
    const persistedJournal = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'journal_entries.json'), 'utf8'));
    assert.equal(master.length, 1);
    assert.equal(master[0].transferNumber, 'OUT-001001');
    assert.equal(numbers.length, 1);
    assert.equal(numbers[0].number, 'OUT-001001');
    assert.equal(audit.length, 1);
    assert.equal(settings.nextSequence, 1002);
    assert.equal(persistedJournal.length, 1);
    assert.equal(fs.existsSync(path.join(dataDirectory, 'financial_transaction_pending.json')), false);

    // Inject a later registry save failure after the ledger and master/number files were written.
    (registry as any).saveAuditLogsToDisk = () => {
      throw new Error('injected outgoing audit write failure');
    };
    const failedSecond = registry.registerOutgoingRemittance({
      ...request,
      idempotencyKey: crypto.randomUUID(),
      manualTransferNumber: 'OUT-MANUAL-0002',
      amount: 50,
      feeAmount: 0,
      notes: 'محاولة فشل حفظ',
    });
    assert.equal(failedSecond.success, false);
    assert.equal(failedSecond.errorCode, 'COMMIT_PENDING_RECOVERY');
    assert.equal(registry.getMasterRemittance('OUT-MANUAL-0002'), undefined);
    assert.equal(serverAccountingEngine.isFinancialWriteBlocked(), true);
    assert.equal(fs.existsSync(path.join(dataDirectory, 'financial_transaction_pending.json')), true);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDataDirectory === undefined) delete process.env.ALNAMARI_TEST_DATA_DIR;
    else process.env.ALNAMARI_TEST_DATA_DIR = previousDataDirectory;
  }
});
