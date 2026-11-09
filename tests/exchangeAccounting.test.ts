import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDoubleEntryBalance } from '../src/services/accountingEngine.js';
import { buildExchangeJournalLines } from '../src/services/exchangeAccounting.js';

test('exchange journal balances each currency and records commission in target currency', () => {
  const posting = buildExchangeJournalLines({
    sourceCurrency: 'SAR',
    sourceAmount: 100,
    targetCurrency: 'YER_OLD',
    targetAmount: 490,
    commission: 10,
  });

  assert.equal(posting.grossTargetAmount, 500);
  assert.equal(posting.lines.length, 5);

  const commissionLine = posting.lines.find((line) => line.accountId === 'acc-4101');
  assert.ok(commissionLine);
  assert.equal(commissionLine?.currency, 'YER_OLD');
  assert.equal(commissionLine?.credit, 10);

  const result = validateDoubleEntryBalance(posting.lines);
  assert.equal(result.isBalanced, true);
  assert.equal(result.byCurrency.SAR.debit, 100);
  assert.equal(result.byCurrency.SAR.credit, 100);
  assert.equal(result.byCurrency.YER_OLD.debit, 500);
  assert.equal(result.byCurrency.YER_OLD.credit, 500);
});

test('exchange journal balances without a commission line', () => {
  const posting = buildExchangeJournalLines({
    sourceCurrency: 'USD',
    sourceAmount: 10,
    targetCurrency: 'SAR',
    targetAmount: 37.5,
    commission: 0,
  });

  assert.equal(posting.grossTargetAmount, 37.5);
  assert.equal(posting.lines.length, 4);
  assert.equal(posting.lines.some((line) => line.accountId === 'acc-4101'), false);
  assert.equal(validateDoubleEntryBalance(posting.lines).isBalanced, true);
});

test('exchange journal rejects invalid currency pairs and commission values', () => {
  assert.throws(() => buildExchangeJournalLines({
    sourceCurrency: 'SAR',
    sourceAmount: 100,
    targetCurrency: 'SAR',
    targetAmount: 500,
    commission: 0,
  }));

  assert.throws(() => buildExchangeJournalLines({
    sourceCurrency: 'SAR',
    sourceAmount: 100,
    targetCurrency: 'YER_OLD',
    targetAmount: 490,
    commission: -10,
  }));

  assert.throws(() => buildExchangeJournalLines({
    sourceCurrency: 'SAR',
    sourceAmount: 100,
    targetCurrency: 'YER_OLD',
    targetAmount: 490,
    commission: 10.001,
  }));

  assert.throws(() => buildExchangeJournalLines({
    sourceCurrency: 'SAR',
    sourceAmount: 100,
    targetCurrency: 'YER_OLD',
    targetAmount: 0,
    commission: 500,
  }));
});
