import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { INITIAL_ACCOUNTS } from '../src/data/initialData.ts';

import { buildChartReconciliationPlan } from '../src/server/services/chartOfAccountsMigration.ts';

const chart = [
  { id: 'acc-1101', code: '1101', nameAr: 'الخزينة المركزية', type: 'asset' as const, category: 'cash_box' },
  { id: 'acc-4101', code: '4101', nameAr: 'إيرادات العمولات', type: 'revenue' as const, category: 'commission' },
  { id: 'acc-5101', code: '5101', nameAr: 'مصاريف التشغيل', type: 'expense' as const, category: 'operating_expense' },
];

test('chart reconciliation preserves existing balances and adds only missing accounts at zero', () => {
  const existing = [{
    id: 'acc-1101',
    code: '1101',
    name: 'الخزينة المركزية',
    type: 'asset',
    category: 'cash_box',
    balances: { YER_OLD: 250000, YER_NEW: 500000, SAR: 1500, USD: 100 },
  }];

  const plan = buildChartReconciliationPlan(existing, chart);

  assert.equal(plan.added.length, 2);
  assert.equal(plan.accounts.length, 3);
  assert.deepEqual(plan.accounts[0], existing[0]);
  assert.deepEqual(plan.added.map((account) => account.id), ['acc-4101', 'acc-5101']);
  for (const account of plan.added) {
    assert.deepEqual(account.balances, {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    });
  }
});

test('chart reconciliation rejects unknown ledger accounts', () => {
  const existing = [{
    id: 'acc-9999',
    code: '9999',
    name: 'حساب غير معروف',
    type: 'asset',
    category: 'cash_box',
    balances: { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 },
  }];

  assert.throws(
    () => buildChartReconciliationPlan(existing, chart),
    /غير موجود في الدليل المرجعي/
  );
});

test('chart reconciliation rejects existing metadata mismatches', () => {
  const existing = [{
    id: 'acc-1101',
    code: '1101',
    name: 'اسم مختلف',
    type: 'asset',
    category: 'cash_box',
    balances: { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 },
  }];

  assert.throws(
    () => buildChartReconciliationPlan(existing, chart),
    /لا تطابق الدليل المرجعي/
  );
});

test('chart reconciliation rejects duplicate IDs in the current ledger', () => {
  const account = {
    id: 'acc-1101',
    code: '1101',
    name: 'الخزينة المركزية',
    type: 'asset',
    category: 'cash_box',
    balances: { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 },
  };

  assert.throws(
    () => buildChartReconciliationPlan([account, account], chart),
    /مكرر/
  );
});


test('current repository ledger matches the chart metadata and identifies only the six missing accounts', () => {
  const ledgerPath = path.resolve(process.cwd(), 'data/accounts_ledger.json');
  const currentLedger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const chartDefinitions = INITIAL_ACCOUNTS.map((account) => ({
    id: account.id,
    code: account.code,
    nameAr: account.nameAr,
    type: account.type,
    category: account.category,
  }));

  const plan = buildChartReconciliationPlan(currentLedger, chartDefinitions);

  assert.equal(currentLedger.length, 5);
  assert.equal(plan.accounts.length, 11);
  assert.deepEqual(
    plan.added.map((account) => account.id).sort(),
    ['acc-2101', 'acc-2201', 'acc-3101', 'acc-4101', 'acc-4102', 'acc-5101']
  );

  for (let index = 0; index < currentLedger.length; index += 1) {
    assert.deepEqual(plan.accounts[index], currentLedger[index]);
  }
});
