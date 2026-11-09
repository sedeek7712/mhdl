import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('internal transfer commits once, validates replay, and rejects unsafe requests', async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mhdl-internal-transfer-'));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));

  const previousNodeEnv = process.env.NODE_ENV;
  const previousDataDirectory = process.env.ALNAMARI_TEST_DATA_DIR;
  process.env.NODE_ENV = 'test';
  process.env.ALNAMARI_TEST_DATA_DIR = dataDirectory;

  const currencies = {
    YER_OLD: 0,
    YER_NEW: 0,
    SAR: 0,
    USD: 0,
  };

  const accounts = [
    {
      id: 'acc-1101',
      code: '1101',
      nameAr: 'الخزينة الرئيسية',
      type: 'asset',
      category: 'cash_box',
      balances: { ...currencies, SAR: 5000 },
    },
    {
      id: 'acc-1102',
      code: '1102',
      nameAr: 'صندوق الكاشير',
      type: 'asset',
      category: 'cash_box',
      balances: { ...currencies, SAR: 1000 },
    },
  ];

  const owner = {
    id: 'owner-test-1',
    name: 'مالك الاختبار',
    role: 'owner',
    isActive: true,
  };
  const openingBalances = Object.fromEntries(accounts.map((account) => [
    account.id,
    {
      type: account.type,
      balances: { ...account.balances },
    },
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

  try {
    const { serverAccountingEngine } = await import('../src/server/services/serverAccountingEngine.ts');
    const idempotencyKey = crypto.randomUUID();
    const request = {
      fromAccountId: 'acc-1101',
      toAccountId: 'acc-1102',
      amount: 250,
      currency: 'SAR' as const,
      description: 'تحويل بين الخزينة وصندوق الكاشير',
      operatorId: owner.id,
      operatorName: owner.name,
      branchId: 'br-main',
      idempotencyKey,
    };

    const first = serverAccountingEngine.executeInternalTransfer(request);
    assert.equal(first.success, true);
    assert.ok(first.journalEntry);
    assert.equal(first.journalEntry?.referenceType, 'internal_transfer');
    assert.equal(first.journalEntry?.idempotencyKey, idempotencyKey);
    assert.equal(first.journalEntry?.lines.length, 2);
    assert.equal(first.journalEntry?.lines.reduce((sum, line) => sum + line.debit, 0), 250);
    assert.equal(first.journalEntry?.lines.reduce((sum, line) => sum + line.credit, 0), 250);

    const afterFirst = serverAccountingEngine.getAccounts();
    assert.equal(afterFirst.find((account) => account.id === 'acc-1101')?.balances.SAR, 4750);
    assert.equal(afterFirst.find((account) => account.id === 'acc-1102')?.balances.SAR, 1250);

    const replay = serverAccountingEngine.executeInternalTransfer(request);
    assert.equal(replay.success, true);
    assert.equal(replay.journalEntry?.id, first.journalEntry?.id);
    assert.equal(serverAccountingEngine.getJournalEntries().length, 1);
    assert.equal(serverAccountingEngine.getAccounts().find((account) => account.id === 'acc-1101')?.balances.SAR, 4750);
    assert.equal(serverAccountingEngine.getAccounts().find((account) => account.id === 'acc-1102')?.balances.SAR, 1250);

    const mismatchedReplay = serverAccountingEngine.executeInternalTransfer({
      ...request,
      amount: 300,
    });
    assert.equal(mismatchedReplay.success, false);
    assert.equal(serverAccountingEngine.getJournalEntries().length, 1);
    assert.equal(serverAccountingEngine.getAccounts().find((account) => account.id === 'acc-1101')?.balances.SAR, 4750);

    const insufficient = serverAccountingEngine.executeInternalTransfer({
      ...request,
      amount: 6000,
      idempotencyKey: crypto.randomUUID(),
    });
    assert.equal(insufficient.success, false);
    assert.equal(serverAccountingEngine.getJournalEntries().length, 1);
    assert.equal(fs.existsSync(path.join(dataDirectory, 'financial_transaction_pending.json')), false);

    const sameAccount = serverAccountingEngine.executeInternalTransfer({
      ...request,
      toAccountId: 'acc-1101',
      idempotencyKey: crypto.randomUUID(),
    });
    assert.equal(sameAccount.success, false);

    const persistedAccounts = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'accounts_ledger.json'), 'utf8'));
    const persistedJournal = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'journal_entries.json'), 'utf8'));
    assert.equal(persistedAccounts.find((account: { id: string }) => account.id === 'acc-1101').balances.SAR, 4750);
    assert.equal(persistedAccounts.find((account: { id: string }) => account.id === 'acc-1102').balances.SAR, 1250);
    assert.equal(persistedJournal.length, 1);
    assert.equal(persistedJournal[0].idempotencyKey, idempotencyKey);
    assert.equal(fs.existsSync(path.join(dataDirectory, 'financial_transaction_pending.json')), false);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDataDirectory === undefined) delete process.env.ALNAMARI_TEST_DATA_DIR;
    else process.env.ALNAMARI_TEST_DATA_DIR = previousDataDirectory;
  }
});
