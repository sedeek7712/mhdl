import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('server shift registry snapshots ledger balances and requires documented variance', async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mhdl-shifts-'));
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

  const { serverCashBoxShiftRegistry: registry } = await import('../src/server/services/serverCashBoxShiftRegistry.ts');
  const balances = { YER_OLD: 120000, YER_NEW: 0, SAR: 500, USD: 100 };
  assert.equal(registry.getActiveShift(), null);

  const openKey = crypto.randomUUID();
  const opened = registry.openShift({
    idempotencyKey: openKey, balances, actorId: 'owner-1', actorName: 'مالك الاختبار', actorRole: 'owner',
  });
  assert.equal(opened.success, true);
  assert.deepEqual(opened.shift?.openingBalances, balances);
  assert.equal(registry.openShift({
    idempotencyKey: openKey, balances, actorId: 'owner-1', actorName: 'مالك الاختبار', actorRole: 'owner',
  }).replayed, true);
  assert.equal(registry.openShift({
    idempotencyKey: crypto.randomUUID(), balances, actorId: 'owner-1', actorName: 'مالك الاختبار', actorRole: 'owner',
  }).success, false);

  const shiftId = opened.shift!.id;
  const actual = { ...balances, YER_OLD: 119000 };
  const closeKey = crypto.randomUUID();
  const undocumented = registry.closeShift({
    idempotencyKey: closeKey, shiftId, expectedBalances: balances, actualBalances: actual,
    notes: 'عجز', actorId: 'owner-1', actorName: 'مالك الاختبار',
  });
  assert.equal(undocumented.success, false);
  assert.equal(registry.getActiveShift()?.id, shiftId);

  const closed = registry.closeShift({
    idempotencyKey: closeKey, shiftId, expectedBalances: balances, actualBalances: actual,
    notes: 'عجز نقدي بعد العد اليدوي ومراجعة سندات الصندوق', actorId: 'owner-1', actorName: 'مالك الاختبار',
  });
  assert.equal(closed.success, true);
  assert.equal(closed.shift?.discrepancies.YER_OLD, -1000);
  assert.equal(registry.getActiveShift(), null);
  assert.equal(registry.getHistory().length, 1);
  assert.equal(registry.closeShift({
    idempotencyKey: closeKey, shiftId, expectedBalances: balances, actualBalances: actual,
    notes: 'عجز نقدي بعد العد اليدوي ومراجعة سندات الصندوق', actorId: 'owner-1', actorName: 'مالك الاختبار',
  }).replayed, true);

  const reopened = registry.openShift({
    idempotencyKey: crypto.randomUUID(), balances: { ...balances, YER_OLD: 119000 },
    actorId: 'owner-1', actorName: 'مالك الاختبار', actorRole: 'owner',
  });
  assert.equal(reopened.success, true);
  assert.equal(reopened.shift?.openingBalances.YER_OLD, 119000);
});
