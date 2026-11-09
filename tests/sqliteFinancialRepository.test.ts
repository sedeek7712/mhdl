import assert from 'node:assert/strict';
import test from 'node:test';
import { openSqliteDatabase, runSqliteMigrations } from '../src/server/db/sqliteDatabase.js';
import { SQLITE_MIGRATIONS } from '../src/server/db/sqliteMigrations.js';
import {
  insertBalancedJournalEntry,
  insertSqliteAccount,
  insertSqliteRemittance,
  toScaledInteger,
  type SqliteJournalEntryInput,
  type SqliteRemittanceInput,
} from '../src/server/db/sqliteFinancialRepository.js';

function createDatabase(t: { after: (fn: () => void) => void }) {
  const db = openSqliteDatabase({ filePath: ':memory:' });
  t.after(() => db.close());
  runSqliteMigrations(db, SQLITE_MIGRATIONS);
  return db;
}

const zeroBalances = { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 } as const;

function seedAccounts(db: ReturnType<typeof openSqliteDatabase>) {
  insertSqliteAccount(db, {
    id: 'cash-usd',
    code: '1102-USD',
    nameAr: 'صندوق الدولار',
    accountType: 'asset',
    category: 'cash_box',
    balancesMilli: { ...zeroBalances },
  });
  insertSqliteAccount(db, {
    id: 'commission-usd',
    code: '4101-USD',
    nameAr: 'إيراد العمولة',
    accountType: 'revenue',
    category: 'commission',
    balancesMilli: { ...zeroBalances },
  });
}

function balancedEntry(overrides: Partial<SqliteJournalEntryInput> = {}): SqliteJournalEntryInput {
  return {
    id: 'journal-1',
    entryNumber: 'JV-0001',
    date: '2026-11-09',
    time: '10:30:00',
    descriptionAr: 'اختبار قيد متوازن',
    referenceType: 'exchange',
    referenceId: 'EX-0001',
    branchId: 'main',
    createdBy: 'مالك النظام',
    idempotencyKey: 'idem-jv-0001',
    lines: [
      {
        accountId: 'cash-usd',
        accountNameArSnapshot: 'صندوق الدولار',
        currency: 'USD',
        debitMilli: 250_000,
        creditMilli: 0,
      },
      {
        accountId: 'commission-usd',
        accountNameArSnapshot: 'إيراد العمولة',
        currency: 'USD',
        debitMilli: 0,
        creditMilli: 250_000,
      },
    ],
    ...overrides,
  };
}

function remittance(overrides: Partial<SqliteRemittanceInput> = {}): SqliteRemittanceInput {
  return {
    id: 'remittance-1',
    transferNumber: 'TR-TEST-0001',
    direction: 'outgoing',
    status: 'available',
    senderName: 'مرسل تجريبي',
    senderPhone: '',
    recipientName: 'مستفيد تجريبي',
    recipientPhone: '',
    networkName: 'شبكة تجريبية',
    amountMilli: 100_000,
    currency: 'YER_OLD',
    feeAmountMilli: 5_000,
    totalPaidMilli: 105_000,
    branchId: 'main',
    branchName: 'الفرع الرئيسي',
    tellerId: 'owner-1',
    tellerName: 'مالك تجريبي',
    tellerRole: 'owner',
    createdAt: '2026-11-09T10:00:00.000Z',
    reservationRegisteredAt: '2026-11-09T10:00:00.000Z',
    reservationRegisteredBy: 'owner-1',
    reservationMode: 'automatic',
    ...overrides,
  };
}

test('actual financial schema applies all migrations and creates financial and operational tables', (t) => {
  const db = createDatabase(t);
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all() as Array<{ name: string }>;
  const names = new Set(tables.map((row) => row.name));

  for (const name of [
    'accounts', 'account_balances', 'journal_entries', 'journal_lines',
    'idempotency_records', 'remittance_settings', 'remittance_number_reservations',
    'remittances', 'remittance_payouts', 'remittance_audit_logs',
    'exchange_rates', 'exchange_rate_audit', 'cashier_shifts',
    'cashier_shift_balances', 'cashier_shift_events',
    'app_users', 'security_events', 'whatsapp_dispatches',
    'whatsapp_webhook_events', 'voucher_attachments',
  ]) assert.equal(names.has(name), true, `Missing table ${name}`);

  const migrationCount = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number };
  assert.equal(Number(migrationCount.count), 3);
  const journalColumns = db.prepare('PRAGMA table_info(journal_entries)').all() as Array<{ name: string }>;
  assert.equal(journalColumns.some((column) => column.name === 'customer_phone'), true);
});

test('balanced journal is persisted atomically and updates account balances in thousandths', (t) => {
  const db = createDatabase(t);
  seedAccounts(db);

  const result = insertBalancedJournalEntry(db, balancedEntry());
  assert.deepEqual(result, { id: 'journal-1', replayed: false });

  const debit = db.prepare(
    'SELECT balance_milli FROM account_balances WHERE account_id=? AND currency=?'
  ).get('cash-usd', 'USD') as { balance_milli: number };
  const credit = db.prepare(
    'SELECT balance_milli FROM account_balances WHERE account_id=? AND currency=?'
  ).get('commission-usd', 'USD') as { balance_milli: number };

  assert.equal(debit.balance_milli, 250_000);
  assert.equal(credit.balance_milli, 250_000);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM journal_lines').get()?.count, 2);
  assert.equal(
    (db.prepare('SELECT customer_phone FROM journal_entries WHERE id=?').get('journal-1') as { customer_phone: string | null }).customer_phone,
    null
  );
});

test('unbalanced entry is rejected before any journal line or balance is committed', (t) => {
  const db = createDatabase(t);
  seedAccounts(db);

  const invalid = balancedEntry({
    lines: [
      {
        accountId: 'cash-usd',
        accountNameArSnapshot: 'صندوق الدولار',
        currency: 'USD',
        debitMilli: 100_000,
        creditMilli: 0,
      },
      {
        accountId: 'commission-usd',
        accountNameArSnapshot: 'إيراد العمولة',
        currency: 'USD',
        debitMilli: 0,
        creditMilli: 99_999,
      },
    ],
  });

  assert.throws(() => insertBalancedJournalEntry(db, invalid), /not balanced/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM journal_entries').get()?.count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM journal_lines').get()?.count, 0);
  const cash = db.prepare(
    'SELECT balance_milli FROM account_balances WHERE account_id=? AND currency=?'
  ).get('cash-usd', 'USD') as { balance_milli: number };
  assert.equal(cash.balance_milli, 0);
});

test('journal idempotency replays the same request and rejects a changed request', (t) => {
  const db = createDatabase(t);
  seedAccounts(db);
  const input = balancedEntry();

  assert.equal(insertBalancedJournalEntry(db, input).replayed, false);
  assert.deepEqual(insertBalancedJournalEntry(db, input), { id: 'journal-1', replayed: true });
  assert.throws(
    () => insertBalancedJournalEntry(db, { ...input, descriptionAr: 'بيانات مختلفة' }),
    /reused with a different request/
  );
  assert.throws(
    () => insertBalancedJournalEntry(db, { ...input, exchangeRateMicro: 1_000_000 }),
    /reused with a different request/
  );
  assert.throws(
    () => insertBalancedJournalEntry(db, { ...input, targetAmountMilli: 125_000 }),
    /reused with a different request/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM journal_entries').get()?.count, 1);
  const cash = db.prepare(
    'SELECT balance_milli FROM account_balances WHERE account_id=? AND currency=?'
  ).get('cash-usd', 'USD') as { balance_milli: number };
  assert.equal(cash.balance_milli, 250_000);
});

test('journal writes roll back if a referenced account or balance row is missing', (t) => {
  const db = createDatabase(t);
  insertSqliteAccount(db, {
    id: 'cash-usd',
    code: '1102-USD',
    nameAr: 'صندوق الدولار',
    accountType: 'asset',
    category: 'cash_box',
    balancesMilli: { ...zeroBalances },
  });

  const input = balancedEntry({
    lines: [
      {
        accountId: 'cash-usd',
        accountNameArSnapshot: 'صندوق الدولار',
        currency: 'USD',
        debitMilli: 10_000,
        creditMilli: 0,
      },
      {
        accountId: 'missing-account',
        accountNameArSnapshot: 'حساب غير موجود',
        currency: 'USD',
        debitMilli: 0,
        creditMilli: 10_000,
      },
    ],
  });

  assert.throws(() => insertBalancedJournalEntry(db, input), /unknown account/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM journal_entries').get()?.count, 0);
});

test('remittance number reservation and remittance creation are atomic and case-insensitively unique', (t) => {
  const db = createDatabase(t);

  assert.deepEqual(
    insertSqliteRemittance(db, remittance()),
    { id: 'remittance-1', replayed: false }
  );

  assert.throws(
    () => insertSqliteRemittance(db, remittance({
      id: 'remittance-2',
      transferNumber: 'tr-test-0001',
    })),
    /UNIQUE constraint failed/
  );

  const count = db.prepare('SELECT COUNT(*) AS count FROM remittances').get() as { count: number };
  const reservations = db.prepare(
    'SELECT COUNT(*) AS count FROM remittance_number_reservations'
  ).get() as { count: number };
  assert.equal(count.count, 1);
  assert.equal(reservations.count, 1);
});

test('remittance insertion rolls back reservation when the remittance row violates a constraint', (t) => {
  const db = createDatabase(t);

  assert.throws(
    () => insertSqliteRemittance(db, remittance({ currency: 'INVALID' as any })),
    /CHECK constraint failed/
  );

  const reservations = db.prepare(
    'SELECT COUNT(*) AS count FROM remittance_number_reservations'
  ).get() as { count: number };
  assert.equal(reservations.count, 0);
});

test('scaled decimal conversion accepts thousandths and millionths without float columns', () => {
  assert.equal(toScaledInteger(12.345, 1000), 12_345);
  assert.equal(toScaledInteger(535.123456, 1_000_000), 535_123_456);
  assert.throws(() => toScaledInteger(12.3456, 1000), /precision/);
});
