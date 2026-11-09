import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('server exchange rates start unapproved and owner updates are audited atomically', async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mhdl-exchange-rates-'));
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

  const { serverExchangeRateRegistry } = await import('../src/server/services/serverExchangeRateRegistry.ts');
  const initialRates = serverExchangeRateRegistry.getRates();
  assert.equal(initialRates.length, 6);
  assert.ok(initialRates.every((rate) => rate.buyRate === 0 && rate.sellRate === 0));
  assert.equal(serverExchangeRateRegistry.getAuditLogs().length, 0);

  const updated = serverExchangeRateRegistry.updateRate({
    rateId: 'rate-2',
    buyRate: 140.25,
    sellRate: 141.5,
    note: 'اعتماد سعر السوق الحالي',
    actorId: 'owner-test',
    actorName: 'مالك الاختبار',
  });

  assert.equal(updated.success, true);
  assert.equal(updated.rate?.buyRate, 140.25);
  assert.equal(updated.rate?.sellRate, 141.5);
  assert.equal(updated.auditLogs?.length, 1);
  assert.equal(updated.auditLogs?.[0].oldBuyRate, 0);
  assert.equal(updated.auditLogs?.[0].newBuyRate, 140.25);
  assert.equal(updated.auditLogs?.[0].changedBy, 'مالك الاختبار');
  assert.equal(updated.auditLogs?.[0].changedById, 'owner-test');

  const persisted = JSON.parse(
    fs.readFileSync(path.join(dataDirectory, 'exchange_rate_state.json'), 'utf8')
  );
  assert.equal(persisted.rates.find((rate: any) => rate.id === 'rate-2').buyRate, 140.25);
  assert.equal(persisted.auditLogs.length, 1);

  const invalid = serverExchangeRateRegistry.updateRate({
    rateId: 'rate-2',
    buyRate: -1,
    sellRate: 141.5,
    note: 'قيمة غير صالحة',
    actorId: 'owner-test',
    actorName: 'مالك الاختبار',
  });
  assert.equal(invalid.success, false);
  assert.equal(serverExchangeRateRegistry.getRates().find((rate) => rate.id === 'rate-2')?.buyRate, 140.25);
  assert.equal(serverExchangeRateRegistry.getAuditLogs().length, 1);
});
