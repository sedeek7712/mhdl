import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('server exchange uses approved rate, posts target-currency commission, and replays once', async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mhdl-server-exchange-'));
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDataDirectory = process.env.ALNAMARI_TEST_DATA_DIR;
  process.env.NODE_ENV = 'test';
  process.env.ALNAMARI_TEST_DATA_DIR = dataDirectory;

  t.after(() => {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDataDirectory === undefined) delete process.env.ALNAMARI_TEST_DATA_DIR;
    else process.env.ALNAMARI_TEST_DATA_DIR = previousDataDirectory;
  });

  const zero = { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 };
  const accounts = [
    { id: 'acc-1101', code: '1101', nameAr: 'الخزينة الرئيسية', type: 'asset', category: 'cash_box', balances: { ...zero } },
    { id: 'acc-1102', code: '1102', nameAr: 'صندوق الكاشير', type: 'asset', category: 'cash_box', balances: { ...zero, YER_OLD: 10000 } },
    { id: 'acc-2101', code: '2101', nameAr: 'أمانات العملاء ووسيط التسوية', type: 'liability', category: 'customer', balances: { ...zero } },
    { id: 'acc-4101', code: '4101', nameAr: 'إيرادات عمولات الصرافة', type: 'revenue', category: 'commission', balances: { ...zero } },
  ];
  const owner = { id: 'owner-exchange-test', name: 'مالك الاختبار', role: 'owner', isActive: true };
  const openingBalances = Object.fromEntries(accounts.map((account) => [
    account.id,
    { type: account.type, balances: { ...account.balances } },
  ]));
  fs.writeFileSync(path.join(dataDirectory, 'accounts_ledger.json'), JSON.stringify(accounts), 'utf8');
  fs.writeFileSync(path.join(dataDirectory, 'journal_entries.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(dataDirectory, 'system_users.local.json'), JSON.stringify([owner]), 'utf8');
  fs.writeFileSync(path.join(dataDirectory, 'financial_baseline_approved.local.json'), JSON.stringify({
    schemaVersion: 1,
    approvedAt: '2026-11-09 12:00:00',
    approvedBy: owner.name,
    approvedByUserId: owner.id,
    openingBalances,
  }), 'utf8');
  fs.writeFileSync(path.join(dataDirectory, 'exchange_rate_state.json'), JSON.stringify({
    schemaVersion: 1,
    rates: [{
      id: 'rate-usd-old',
      fromCurrency: 'USD',
      toCurrency: 'YER_OLD',
      buyRate: 535,
      sellRate: 538,
      updatedAt: '2026-11-09 08:00',
      updatedBy: owner.name,
    }],
    auditLogs: [],
  }), 'utf8');

  const [{ serverAccountingEngine }, { serverExchangeRateRegistry }] = await Promise.all([
    import('../src/server/services/serverAccountingEngine.ts'),
    import('../src/server/services/serverExchangeRateRegistry.ts'),
  ]);
  const rate = serverExchangeRateRegistry.getRates()[0];
  const idempotencyKey = crypto.randomUUID();
  const request = {
    rate,
    rateMode: 'buy' as const,
    sourceCurrency: 'USD' as const,
    targetCurrency: 'YER_OLD' as const,
    sourceAmount: 10,
    commission: 50,
    customerName: 'عميل اختبار',
    customerPhone: '700000000',
    notes: 'اختبار قيد الصرافة',
    operatorId: owner.id,
    operatorName: owner.name,
    branchId: 'br-main',
    idempotencyKey,
  };

  const first = serverAccountingEngine.executeExchange(request);
  assert.equal(first.success, true);
  assert.equal(first.effectiveRate, 535);
  assert.equal(first.grossTargetAmount, 5350);
  assert.equal(first.targetAmount, 5300);
  assert.equal(first.journalEntry?.referenceType, 'exchange');
  assert.equal(first.journalEntry?.idempotencyKey, idempotencyKey);
  assert.equal(first.journalEntry?.lines.length, 5);

  const after = serverAccountingEngine.getAccounts();
  assert.equal(after.find((account) => account.id === 'acc-1102')?.balances.USD, 10);
  assert.equal(after.find((account) => account.id === 'acc-1102')?.balances.YER_OLD, 4700);
  assert.equal(after.find((account) => account.id === 'acc-2101')?.balances.USD, 10);
  assert.equal(after.find((account) => account.id === 'acc-2101')?.balances.YER_OLD, -5350);
  assert.equal(after.find((account) => account.id === 'acc-4101')?.balances.YER_OLD, 50);

  const replay = serverAccountingEngine.executeExchange(request);
  assert.equal(replay.success, true);
  assert.equal(replay.journalEntry?.id, first.journalEntry?.id);
  assert.equal(serverAccountingEngine.getJournalEntries().length, 1);
  assert.equal(serverAccountingEngine.getAccounts().find((account) => account.id === 'acc-1102')?.balances.YER_OLD, 4700);

  const mismatchedReplay = serverAccountingEngine.executeExchange({ ...request, commission: 60 });
  assert.equal(mismatchedReplay.success, false);
  assert.equal(serverAccountingEngine.getJournalEntries().length, 1);

  const insufficient = serverAccountingEngine.executeExchange({
    ...request,
    idempotencyKey: crypto.randomUUID(),
    sourceAmount: 100,
  });
  assert.equal(insufficient.success, false);
  assert.equal(serverAccountingEngine.getJournalEntries().length, 1);
  assert.equal(fs.existsSync(path.join(dataDirectory, 'financial_transaction_pending.json')), false);

  const persisted = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'journal_entries.json'), 'utf8'));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].requestFingerprint, first.journalEntry?.requestFingerprint);
});
