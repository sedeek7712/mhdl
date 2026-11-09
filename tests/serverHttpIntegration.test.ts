import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import express from 'express';

function writeJson(directory: string, filename: string, value: unknown): void {
  fs.writeFileSync(path.join(directory, filename), JSON.stringify(value, null, 2), 'utf8');
}

test('real HTTP routes enforce authentication, RBAC, active shifts, idempotency and documented close variances', async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mhdl-http-integration-'));
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    dataDirectory: process.env.ALNAMARI_TEST_DATA_DIR,
    jwtSecret: process.env.JWT_SECRET,
  };
  process.env.NODE_ENV = 'test';
  process.env.ALNAMARI_TEST_DATA_DIR = dataDirectory;
  process.env.JWT_SECRET = 'http-integration-test-secret-with-at-least-32-characters';

  const ownerId = 'owner-http-integration';
  const pin = '849263';
  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex');
  const owner = {
    id: ownerId,
    name: 'مالك اختبار HTTP',
    role: 'owner',
    username: 'http-owner',
    branchId: 'br-main',
    branchName: 'الفرع الرئيسي',
    pinSalt: salt,
    pinHash,
    isActive: true,
    mustChangePin: false,
    sessionVersion: crypto.randomBytes(16).toString('hex'),
    createdAt: '2026-11-09 00:00',
  };
  const zero = { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 };
  const accounts = [
    { id: 'acc-1101', code: '1101', nameAr: 'الخزينة الرئيسية', type: 'asset', category: 'cash_box', balances: { ...zero, YER_OLD: 4000 } },
    { id: 'acc-1102', code: '1102', nameAr: 'صندوق الكاشير', type: 'asset', category: 'cash_box', balances: { ...zero, YER_OLD: 10000 } },
    { id: 'acc-1103', code: '1103', nameAr: 'حساب بنكي تجريبي', type: 'asset', category: 'bank', balances: { ...zero } },
    { id: 'acc-1301', code: '1301', nameAr: 'ذمم شبكة الحوالات', type: 'asset', category: 'network', balances: { ...zero } },
    { id: 'acc-2101', code: '2101', nameAr: 'أمانات العملاء ووسيط التسوية', type: 'liability', category: 'customer', balances: { ...zero } },
    { id: 'acc-2201', code: '2201', nameAr: 'الحوالات المعلقة ومستحقات الشبكة', type: 'liability', category: 'remittance', balances: { ...zero } },
    { id: 'acc-4101', code: '4101', nameAr: 'إيرادات عمولات الصرافة', type: 'revenue', category: 'commission', balances: { ...zero } },
    { id: 'acc-5101', code: '5101', nameAr: 'المصروفات التشغيلية', type: 'expense', category: 'operating_expense', balances: { ...zero } },
  ];
  const openingBalances = Object.fromEntries(accounts.map((account) => [
    account.id,
    { type: account.type, balances: { ...account.balances } },
  ]));

  writeJson(dataDirectory, 'system_users.local.json', [owner]);
  writeJson(dataDirectory, 'accounts_ledger.json', accounts);
  writeJson(dataDirectory, 'journal_entries.json', []);
  writeJson(dataDirectory, 'financial_baseline_approved.local.json', {
    schemaVersion: 1,
    approvedAt: '2026-11-09 00:00',
    approvedBy: owner.name,
    approvedByUserId: owner.id,
    openingBalances,
  });
  writeJson(dataDirectory, 'remittance_settings.json', {
    numberingMode: 'automatic',
    prefix: 'TR-',
    nextSequence: 1,
    updatedAt: '2026-11-09 00:00',
    updatedBy: owner.name,
    updatedByRole: 'owner',
  });
  writeJson(dataDirectory, 'remittance_numbers_registry.json', []);
  writeJson(dataDirectory, 'remittance_payouts_registry.json', []);
  writeJson(dataDirectory, 'remittance_audit_logs.json', []);
  writeJson(dataDirectory, 'remittances_master.json', []);
  writeJson(dataDirectory, 'exchange_rate_state.json', {
    schemaVersion: 1,
    rates: [{
      id: 'rate-usd-old',
      fromCurrency: 'USD',
      toCurrency: 'YER_OLD',
      buyRate: 535,
      sellRate: 538,
      updatedAt: '2026-11-09 00:00',
      updatedBy: owner.name,
    }],
    auditLogs: [],
  });

  let httpServer: any;
  let rbacServer: any;
  t.after(async () => {
    if (rbacServer) await new Promise<void>((resolve) => rbacServer.close(() => resolve()));
    if (httpServer) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.dataDirectory === undefined) delete process.env.ALNAMARI_TEST_DATA_DIR;
    else process.env.ALNAMARI_TEST_DATA_DIR = previous.dataDirectory;
    if (previous.jwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous.jwtSecret;
  });

  const serverModule = await import('../server.ts');
  const { authService, requireAuth, requireRoles } = await import('../src/server/services/authService.ts');
  httpServer = await serverModule.startServer({ port: 0, host: '127.0.0.1', useVite: false });
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const unauthenticatedNoShift = await fetch(`${baseUrl}/api/accounting/exchanges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(unauthenticatedNoShift.status, 401, 'authentication must run before the open-shift guard');

  const invalidToken = await fetch(`${baseUrl}/api/accounting/shifts/active`, {
    headers: { Authorization: 'Bearer invalid.token.value' },
  });
  assert.equal(invalidToken.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleOrUsername: owner.username, pin }),
  });
  assert.equal(login.status, 200);
  const loginBody = await login.json() as any;
  assert.equal(loginBody.success, true);
  assert.equal(loginBody.user.role, 'owner');
  const token = loginBody.token as string;
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const rbacApp = express();
  rbacApp.get('/teller-only', requireAuth, requireRoles(['teller']), (_req, res) => res.json({ success: true }));
  rbacServer = await new Promise<any>((resolve) => {
    const instance = rbacApp.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const rbacAddress = rbacServer.address();
  const denied = await fetch(`http://127.0.0.1:${rbacAddress.port}/teller-only`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(denied.status, 403, 'valid owner session must not pass a teller-only role gate');

  const beforeOpen = await fetch(`${baseUrl}/api/accounting/exchanges`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(beforeOpen.status, 409);
  assert.equal((await beforeOpen.json() as any).errorCode, 'CASHIER_SHIFT_REQUIRED');

  const noShift = await fetch(`${baseUrl}/api/accounting/shifts/active`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(noShift.status, 200);
  assert.equal((await noShift.json() as any).activeShift, null);

  const openKey = crypto.randomUUID();
  const openRequest = () => fetch(`${baseUrl}/api/accounting/shifts/open`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ idempotencyKey: openKey }),
  });
  const opened = await openRequest();
  assert.equal(opened.status, 200);
  const openedBody = await opened.json() as any;
  assert.equal(openedBody.success, true);
  const shiftId = openedBody.shift.id as string;
  assert.equal(openedBody.shift.openingBalances.YER_OLD, 10000);

  const replayedOpen = await openRequest();
  assert.equal(replayedOpen.status, 200);
  assert.equal((await replayedOpen.json() as any).shift.id, shiftId);

  const duplicateOpen = await fetch(`${baseUrl}/api/accounting/shifts/open`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
  });
  assert.equal(duplicateOpen.status, 409);

  const afterOpenInvalidExchange = await fetch(`${baseUrl}/api/accounting/exchanges`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(afterOpenInvalidExchange.status, 400, 'open shift should pass the shift guard and reach endpoint validation');

  const exchangeKey = crypto.randomUUID();
  const exchangeRequest = {
    idempotencyKey: exchangeKey,
    rateId: 'rate-usd-old',
    rateMode: 'buy',
    sourceCurrency: 'USD',
    targetCurrency: 'YER_OLD',
    sourceAmount: 10,
    commission: 50,
    customerName: 'عميل HTTP',
    customerPhone: '700000000',
    notes: 'اختبار HTTP لعملية الصرافة',
  };
  const executeExchange = () => fetch(`${baseUrl}/api/accounting/exchanges`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(exchangeRequest),
  });
  const exchange = await executeExchange();
  assert.equal(exchange.status, 200);
  const exchangeBody = await exchange.json() as any;
  assert.equal(exchangeBody.success, true);
  assert.equal(exchangeBody.effectiveRate, 535);
  assert.equal(exchangeBody.grossTargetAmount, 5350);
  assert.equal(exchangeBody.targetAmount, 5300);
  const journalId = exchangeBody.journalEntry.id;

  const replayedExchange = await executeExchange();
  assert.equal(replayedExchange.status, 200);
  assert.equal((await replayedExchange.json() as any).journalEntry.id, journalId);

  const mismatchedExchange = await fetch(`${baseUrl}/api/accounting/exchanges`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ ...exchangeRequest, commission: 60 }),
  });
  assert.equal(mismatchedExchange.status, 400);
  const ledgerResponse = await fetch(`${baseUrl}/api/accounting/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const ledgerBody = await ledgerResponse.json() as any;
  const cashier = ledgerBody.accounts.find((account: any) => account.id === 'acc-1102');
  assert.equal(cashier.balances.YER_OLD, 4700);
  assert.equal(cashier.balances.USD, 10);

  const outgoingKey = crypto.randomUUID();
  const outgoingRequestBody = {
    idempotencyKey: outgoingKey,
    senderName: 'مرسل حوالة صادرة HTTP',
    senderPhone: '711111111',
    recipientName: 'مستفيد حوالة صادرة HTTP',
    recipientPhone: '722222222',
    networkName: 'شبكة اختبار',
    amount: 200,
    currency: 'YER_OLD',
    feeAmount: 10,
    notes: 'اختبار تسجيل حوالة صادرة عبر HTTP',
  };
  const registerOutgoing = () => fetch(`${baseUrl}/api/remittances/outgoing`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(outgoingRequestBody),
  });
  const outgoing = await registerOutgoing();
  assert.equal(outgoing.status, 200);
  const outgoingBody = await outgoing.json() as any;
  assert.equal(outgoingBody.success, true);
  assert.equal(outgoingBody.record.direction, 'outgoing');
  assert.equal(outgoingBody.journalEntry.referenceType, 'transfer_send');
  assert.equal(outgoingBody.journalEntry.lines.length, 3);

  const outgoingReplay = await registerOutgoing();
  assert.equal(outgoingReplay.status, 200);
  assert.equal((await outgoingReplay.json() as any).replayed, true);

  const incomingRequestBody = {
    transferNumber: 'IN-HTTP-001',
    senderName: 'مرسل حوالة واردة HTTP',
    senderPhone: '733333333',
    recipientName: 'مستفيد حوالة واردة HTTP',
    recipientPhone: '744444444',
    networkName: 'شبكة اختبار',
    amount: 300,
    currency: 'YER_OLD',
    notes: 'اختبار تسجيل حوالة واردة عبر HTTP',
  };
  const registerIncoming = () => fetch(`${baseUrl}/api/remittances/incoming`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(incomingRequestBody),
  });
  const incoming = await registerIncoming();
  assert.equal(incoming.status, 200);
  const incomingBody = await incoming.json() as any;
  assert.equal(incomingBody.success, true);
  assert.equal(incomingBody.record.status, 'available');

  const incomingReplay = await registerIncoming();
  assert.equal(incomingReplay.status, 200);
  assert.equal((await incomingReplay.json() as any).replayed, true);

  const payoutRequestBody = {
    transferId: incomingBody.record.id,
    transferNumber: incomingBody.record.transferNumber,
    recipientIdType: 'national_id',
    recipientIdNumber: '123456789',
    amount: 300,
    currency: 'YER_OLD',
    clientAmount: 300,
    clientCurrency: 'YER_OLD',
  };
  const payout = await fetch(`${baseUrl}/api/remittances/payout`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(payoutRequestBody),
  });
  assert.equal(payout.status, 200);
  const payoutBody = await payout.json() as any;
  assert.equal(payoutBody.success, true);
  assert.equal(payoutBody.masterRemittance.status, 'paid');
  assert.equal(payoutBody.journalEntry.referenceType, 'transfer_payout');

  const payoutReplay = await fetch(`${baseUrl}/api/remittances/payout`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(payoutRequestBody),
  });
  assert.equal(payoutReplay.status, 200);
  assert.equal((await payoutReplay.json() as any).record.id, payoutBody.record.id);

  const expenseKey = crypto.randomUUID();
  const expenseBody = {
    expenseType: 'مصروف اختبار HTTP',
    amount: 75,
    currency: 'YER_OLD',
    notes: 'مصروف للاختبار المتكامل',
    idempotencyKey: expenseKey,
  };
  const executeExpense = () => fetch(`${baseUrl}/api/accounting/expenses`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(expenseBody),
  });
  const expense = await executeExpense();
  assert.equal(expense.status, 200);
  const expenseResult = await expense.json() as any;
  assert.equal(expenseResult.success, true);
  assert.equal(expenseResult.journalEntry.referenceType, 'expense');

  const expenseReplay = await executeExpense();
  assert.equal(expenseReplay.status, 200);
  assert.equal((await expenseReplay.json() as any).journalEntry.id, expenseResult.journalEntry.id);

  const transferKey = crypto.randomUUID();
  const transferBody = {
    fromAccountId: 'acc-1102',
    toAccountId: 'acc-1103',
    currency: 'YER_OLD',
    amount: 100,
    description: 'مناقلة اختبار HTTP بين الصندوق والبنك',
    idempotencyKey: transferKey,
  };
  const executeInternalTransfer = () => fetch(`${baseUrl}/api/accounting/internal-transfers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(transferBody),
  });
  const internalTransfer = await executeInternalTransfer();
  assert.equal(internalTransfer.status, 200);
  const internalTransferBody = await internalTransfer.json() as any;
  assert.equal(internalTransferBody.success, true);
  assert.equal(internalTransferBody.journalEntry.referenceType, 'internal_transfer');

  const internalTransferReplay = await executeInternalTransfer();
  assert.equal(internalTransferReplay.status, 200);
  assert.equal((await internalTransferReplay.json() as any).journalEntry.id, internalTransferBody.journalEntry.id);

  const fundingKey = crypto.randomUUID();
  const fundingBody = {
    fromAccountId: 'acc-1101',
    toAccountId: 'acc-1102',
    amount: 250,
    currency: 'YER_OLD',
    idempotencyKey: fundingKey,
  };
  const fundDrawer = () => fetch(`${baseUrl}/api/accounting/fund-drawer`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(fundingBody),
  });
  const funding = await fundDrawer();
  assert.equal(funding.status, 200);
  const fundingResult = await funding.json() as any;
  assert.equal(fundingResult.success, true);
  assert.equal(fundingResult.journalEntry.referenceType, 'internal_transfer');

  const fundingReplay = await fundDrawer();
  assert.equal(fundingReplay.status, 200);
  assert.equal((await fundingReplay.json() as any).journalEntry.id, fundingResult.journalEntry.id);

  const ledgerBeforeCloseResponse = await fetch(`${baseUrl}/api/accounting/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const ledgerBeforeClose = await ledgerBeforeCloseResponse.json() as any;
  const closeCashier = ledgerBeforeClose.accounts.find((account: any) => account.id === 'acc-1102');
  const closeExpectedBalances = { ...closeCashier.balances };

  const closeKey = crypto.randomUUID();
  const closeRequest = (notes: string) => fetch(`${baseUrl}/api/accounting/shifts/close`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      idempotencyKey: closeKey,
      shiftId,
      actualBalances: (() => {
        const expected = closeExpectedBalances;
        return { ...expected, YER_OLD: Math.max(0, expected.YER_OLD - 10) };
      })(),
      notes,
    }),
  });
  const undocumentedVariance = await closeRequest('');
  assert.equal(undocumentedVariance.status, 409);
  assert.equal((await undocumentedVariance.json() as any).success, false);

  const closed = await closeRequest('فرق جرد تجريبي موثق بعد العد اليدوي');
  assert.equal(closed.status, 200);
  const closedBody = await closed.json() as any;
  assert.equal(closedBody.shift.discrepancies.YER_OLD, -10);
  assert.equal(closedBody.shift.status, 'closed');
  assert.equal(closedBody.shift.expectedBalances.YER_OLD, closeExpectedBalances.YER_OLD);

  const replayedClose = await closeRequest('فرق جرد تجريبي موثق بعد العد اليدوي');
  assert.equal(replayedClose.status, 200);
  assert.equal((await replayedClose.json() as any).shift.id, shiftId);

  const afterClose = await fetch(`${baseUrl}/api/accounting/expenses`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(afterClose.status, 409);
  assert.equal((await afterClose.json() as any).errorCode, 'CASHIER_SHIFT_REQUIRED');

  const finalState = await fetch(`${baseUrl}/api/accounting/shifts/active`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const finalBody = await finalState.json() as any;
  assert.equal(finalBody.activeShift, null);
  assert.equal(finalBody.history.length, 1);

  const secondOpen = await fetch(`${baseUrl}/api/accounting/shifts/open`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
  });
  assert.equal(secondOpen.status, 200);

  // Simulate a failure after the ledger file has been written but before the journal file is saved.
  // The test hook is restricted to NODE_ENV=test and targets this single basename once.
  process.env.ALNAMARI_TEST_FAIL_WRITE_BASENAME = 'journal_entries.json';
  const failingExpenseKey = crypto.randomUUID();
  const failingExpense = await fetch(`${baseUrl}/api/accounting/expenses`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      expenseType: 'مصروف مع فشل تخزين محاكى',
      amount: 50,
      currency: 'YER_OLD',
      notes: 'اختبار فشل كتابة ملف اليومية',
      idempotencyKey: failingExpenseKey,
    }),
  });
  assert.equal(failingExpense.status, 500);
  const failureBody = await failingExpense.json() as any;
  assert.equal(failureBody.errorCode, 'COMMIT_PENDING_RECOVERY');
  assert.equal(fs.existsSync(path.join(dataDirectory, 'financial_transaction_pending.json')), true);
  assert.equal(process.env.ALNAMARI_TEST_FAIL_WRITE_BASENAME, undefined);

  const blockedAfterFailure = await fetch(`${baseUrl}/api/accounting/internal-transfers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      fromAccountId: 'acc-1102',
      toAccountId: 'acc-1103',
      currency: 'YER_OLD',
      amount: 1,
      description: 'يجب منع المناقلة بعد فشل الحفظ',
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  assert.equal(blockedAfterFailure.status, 503);
  assert.equal((await blockedAfterFailure.json() as any).errorCode, 'FINANCIAL_RECOVERY_REQUIRED');

  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  httpServer = null;
  const restarted = spawnSync(process.execPath, ['--import', 'tsx', '--eval', "import('./server.ts')"], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ALNAMARI_TEST_DATA_DIR: dataDirectory,
      JWT_SECRET: 'http-integration-test-secret-with-at-least-32-characters',
    },
    timeout: 15000,
  });
  assert.notEqual(restarted.status, 0, 'server restart must fail closed while a pending transaction marker exists');
  assert.match(`${restarted.stdout}${restarted.stderr}`, /معاملة مالية غير مكتملة|financial transaction/i);
});
