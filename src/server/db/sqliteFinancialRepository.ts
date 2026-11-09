import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type SqliteCurrency = 'YER_OLD' | 'YER_NEW' | 'SAR' | 'USD';
export type SqliteAccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface SqliteAccountInput {
  id: string;
  code: string;
  nameAr: string;
  accountType: SqliteAccountType;
  category: string;
  balancesMilli: Record<SqliteCurrency, number>;
  isLocked?: boolean;
  createdAt?: string;
}

export interface SqliteJournalLineInput {
  accountId: string;
  accountNameArSnapshot: string;
  currency: SqliteCurrency;
  debitMilli: number;
  creditMilli: number;
  note?: string;
}

export interface SqliteJournalEntryInput {
  id: string;
  entryNumber: string;
  date: string;
  time: string;
  descriptionAr: string;
  referenceType: string;
  referenceId: string;
  branchId: string;
  createdBy: string;
  createdById?: string;
  idempotencyKey?: string;
  exchangeRateMicro?: number;
  grossTargetAmountMilli?: number;
  targetAmountMilli?: number;
  voucherNumber?: string;
  customerPhone?: string;
  lines: SqliteJournalLineInput[];
  /** False only when importing historical entries after seeding the current balance snapshot. */
  applyBalanceMovements?: boolean;
}

export interface SqliteRemittanceInput {
  id: string;
  transferNumber: string;
  direction: 'outgoing' | 'incoming';
  status: 'draft' | 'approved' | 'available' | 'paid' | 'cancelled' | 'refunded' | 'pending';
  senderName: string;
  senderPhone?: string;
  recipientName: string;
  recipientPhone?: string;
  networkName: string;
  amountMilli: number;
  currency: SqliteCurrency;
  feeAmountMilli: number;
  totalPaidMilli: number;
  branchId?: string;
  branchName: string;
  tellerId?: string;
  tellerName: string;
  tellerRole?: string;
  createdAt: string;
  paidAt?: string;
  recipientIdType?: string;
  recipientIdNumber?: string;
  voucherNumber?: string;
  journalEntryReference?: string;
  cashMovementReference?: string;
  payoutRecordId?: string;
  numberingMode?: 'automatic' | 'manual';
  idempotencyKey?: string;
  notes?: string;
  reservationRegisteredAt: string;
  reservationRegisteredBy: string;
  reservationMode: 'automatic' | 'manual';
}

export interface SqliteWriteResult {
  id: string;
  replayed: boolean;
}

const CURRENCIES: SqliteCurrency[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];

function assertText(value: string, field: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
}

function assertSafeInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${field} must be a safe integer greater than or equal to ${minimum}.`);
  }
}

function withImmediateTransaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Keep the original error; the caller must not mistake a failed operation for success.
    }
    throw error;
  }
}

export function toScaledInteger(value: number, scale: number, field = 'amount'): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(scale) || scale < 1) {
    throw new Error(`${field} or scale is invalid.`);
  }
  const scaled = value * scale;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-6) {
    throw new Error(`${field} exceeds the supported precision or safe integer range.`);
  }
  return rounded;
}

export function insertSqliteAccount(db: DatabaseSync, account: SqliteAccountInput): void {
  assertText(account.id, 'account.id');
  assertText(account.code, 'account.code');
  assertText(account.nameAr, 'account.nameAr');
  assertText(account.category, 'account.category');

  withImmediateTransaction(db, () => {
    db.prepare(`
      INSERT INTO accounts (id, code, name_ar, account_type, category, is_locked, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      account.id.trim(),
      account.code.trim(),
      account.nameAr.trim(),
      account.accountType,
      account.category,
      account.isLocked ? 1 : 0,
      account.createdAt || new Date().toISOString()
    );

    const insertBalance = db.prepare(`
      INSERT INTO account_balances (account_id, currency, balance_milli, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    const timestamp = account.createdAt || new Date().toISOString();
    for (const currency of CURRENCIES) {
      const amount = account.balancesMilli[currency];
      if (!Number.isSafeInteger(amount)) {
        throw new Error(`Opening balance for ${currency} must be a safe integer in thousandths.`);
      }
      insertBalance.run(account.id.trim(), currency, amount, timestamp);
    }
  });
}

/**
 * Writes a complete, already-validated double-entry journal and its account
 * balance movements in one SQLite transaction. Amounts are thousandths.
 */
export function insertBalancedJournalEntry(
  db: DatabaseSync,
  entry: SqliteJournalEntryInput
): SqliteWriteResult {
  for (const [field, value] of Object.entries({
    id: entry.id,
    entryNumber: entry.entryNumber,
    date: entry.date,
    time: entry.time,
    descriptionAr: entry.descriptionAr,
    referenceType: entry.referenceType,
    referenceId: entry.referenceId,
    branchId: entry.branchId,
    createdBy: entry.createdBy,
  })) assertText(value, `entry.${field}`);

  if (!Array.isArray(entry.lines) || entry.lines.length < 2) {
    throw new Error('A journal entry must contain at least two lines.');
  }

  const totals = new Map<SqliteCurrency, { debit: bigint; credit: bigint }>();
  const accountDeltas = new Map<string, bigint>();
  const normalizedLines = entry.lines.map((line, index) => {
    assertText(line.accountId, `lines[${index}].accountId`);
    assertText(line.accountNameArSnapshot, `lines[${index}].accountNameArSnapshot`);
    assertSafeInteger(line.debitMilli, `lines[${index}].debitMilli`);
    assertSafeInteger(line.creditMilli, `lines[${index}].creditMilli`);
    if (!CURRENCIES.includes(line.currency)) throw new Error(`Unsupported currency in journal line ${index + 1}.`);
    if (!((line.debitMilli > 0 && line.creditMilli === 0) ||
          (line.creditMilli > 0 && line.debitMilli === 0))) {
      throw new Error(`Journal line ${index + 1} must have exactly one positive side.`);
    }

    const total = totals.get(line.currency) || { debit: 0n, credit: 0n };
    total.debit += BigInt(line.debitMilli);
    total.credit += BigInt(line.creditMilli);
    totals.set(line.currency, total);
    return { ...line };
  });

  for (const [currency, total] of totals) {
    if (total.debit !== total.credit) {
      throw new Error(`Journal entry is not balanced for currency ${currency}.`);
    }
  }

  // Include all business-significant fields in the idempotency fingerprint.
  // applyBalanceMovements is deliberately excluded: it is an import-only execution mode.
  const fingerprintPayload = {
    id: entry.id,
    entryNumber: entry.entryNumber,
    date: entry.date,
    time: entry.time,
    descriptionAr: entry.descriptionAr,
    referenceType: entry.referenceType,
    referenceId: entry.referenceId,
    branchId: entry.branchId,
    createdBy: entry.createdBy,
    createdById: entry.createdById ?? null,
    exchangeRateMicro: entry.exchangeRateMicro ?? null,
    grossTargetAmountMilli: entry.grossTargetAmountMilli ?? null,
    targetAmountMilli: entry.targetAmountMilli ?? null,
    voucherNumber: entry.voucherNumber ?? null,
    customerPhone: entry.customerPhone ?? null,
    lines: normalizedLines,
  };
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify(fingerprintPayload), 'utf8')
    .digest('hex');

  return withImmediateTransaction(db, () => {
    if (entry.idempotencyKey) {
      const prior = db.prepare(
        'SELECT id, request_fingerprint FROM journal_entries WHERE idempotency_key = ?'
      ).get(entry.idempotencyKey) as { id: string; request_fingerprint: string } | undefined;
      if (prior) {
        if (prior.request_fingerprint !== fingerprint) {
          throw new Error('Journal idempotency key was reused with a different request.');
        }
        return { id: prior.id, replayed: true };
      }
    }

    const accountTypeById = new Map<string, SqliteAccountType>();
    for (const line of normalizedLines) {
      if (!accountTypeById.has(line.accountId)) {
        const account = db.prepare('SELECT account_type FROM accounts WHERE id = ?')
          .get(line.accountId) as { account_type: SqliteAccountType } | undefined;
        if (!account) throw new Error(`Journal line references unknown account ${line.accountId}.`);
        accountTypeById.set(line.accountId, account.account_type);
      }

      const accountType = accountTypeById.get(line.accountId)!;
      const normalSign = accountType === 'asset' || accountType === 'expense' ? 1n : -1n;
      const delta = normalSign * (BigInt(line.debitMilli) - BigInt(line.creditMilli));
      const key = `${line.accountId}\u0000${line.currency}`;
      accountDeltas.set(key, (accountDeltas.get(key) || 0n) + delta);
    }

    db.prepare(`
      INSERT INTO journal_entries (
        id, entry_number, entry_date, entry_time, description_ar, reference_type,
        reference_id, branch_id, created_by, created_by_id, is_balanced,
        idempotency_key, request_fingerprint, exchange_rate_micro,
        gross_target_amount_milli, target_amount_milli, voucher_number, customer_phone, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.entryNumber,
      entry.date,
      entry.time,
      entry.descriptionAr,
      entry.referenceType,
      entry.referenceId,
      entry.branchId,
      entry.createdBy,
      entry.createdById || null,
      entry.idempotencyKey || null,
      entry.idempotencyKey ? fingerprint : null,
      entry.exchangeRateMicro ?? null,
      entry.grossTargetAmountMilli ?? null,
      entry.targetAmountMilli ?? null,
      entry.voucherNumber || null,
      entry.customerPhone || null,
      new Date().toISOString()
    );

    const insertLine = db.prepare(`
      INSERT INTO journal_lines (
        entry_id, line_number, account_id, account_name_ar_snapshot,
        currency, debit_milli, credit_milli, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    normalizedLines.forEach((line, index) => {
      insertLine.run(
        entry.id, index + 1, line.accountId, line.accountNameArSnapshot,
        line.currency, line.debitMilli, line.creditMilli, line.note || null
      );
    });

    const updateBalance = db.prepare(`
      UPDATE account_balances
      SET balance_milli = balance_milli + ?, updated_at = ?
      WHERE account_id = ? AND currency = ?
    `);
    const timestamp = new Date().toISOString();
    for (const [key, delta] of accountDeltas) {
      const [accountId, currency] = key.split('\u0000');
      const deltaNumber = Number(delta);
      if (!Number.isSafeInteger(deltaNumber)) {
        throw new Error('Account balance movement exceeds the safe integer range.');
      }
      if (entry.applyBalanceMovements !== false) {
        updateBalance.run(deltaNumber, timestamp, accountId, currency);
      }
      const balance = db.prepare(
        'SELECT 1 AS found FROM account_balances WHERE account_id = ? AND currency = ?'
      ).get(accountId, currency);
      if (!balance) throw new Error(`Missing balance row for account ${accountId} and currency ${currency}.`);
    }

    return { id: entry.id, replayed: false };
  });
}

/**
 * Reserves the normalized transfer number and creates the remittance atomically.
 * A duplicate number (even with different letter case) is rejected by the PK/UNIQUE constraints.
 */
export function insertSqliteRemittance(
  db: DatabaseSync,
  remittance: SqliteRemittanceInput
): SqliteWriteResult {
  assertText(remittance.id, 'remittance.id');
  assertText(remittance.transferNumber, 'remittance.transferNumber');
  const cleanTransferNumber = remittance.transferNumber.trim();
  if (cleanTransferNumber.length < 3 || cleanTransferNumber.length > 64 ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/.test(cleanTransferNumber)) {
    throw new Error('Transfer number must be 3 to 64 letters, digits, or hyphens and start with a letter or digit.');
  }
  assertText(remittance.senderName, 'remittance.senderName');
  assertText(remittance.recipientName, 'remittance.recipientName');
  assertText(remittance.networkName, 'remittance.networkName');
  assertText(remittance.branchName, 'remittance.branchName');
  assertText(remittance.tellerName, 'remittance.tellerName');
  assertSafeInteger(remittance.amountMilli, 'remittance.amountMilli', 1);
  assertSafeInteger(remittance.feeAmountMilli, 'remittance.feeAmountMilli');
  assertSafeInteger(remittance.totalPaidMilli, 'remittance.totalPaidMilli');

  const normalizedNumber = cleanTransferNumber.toUpperCase();
  return withImmediateTransaction(db, () => {
    const priorReservation = db.prepare(`
      SELECT number_original, registered_at, registered_by, numbering_mode
      FROM remittance_number_reservations
      WHERE number_normalized = ?
    `).get(normalizedNumber) as {
      number_original: string;
      registered_at: string;
      registered_by: string;
      numbering_mode: string;
    } | undefined;

    if (priorReservation) {
      if (priorReservation.number_original.trim().toUpperCase() !== normalizedNumber ||
          priorReservation.registered_at !== remittance.reservationRegisteredAt ||
          priorReservation.registered_by !== remittance.reservationRegisteredBy ||
          priorReservation.numbering_mode !== remittance.reservationMode) {
        throw new Error('Existing remittance number reservation does not match the source reservation.');
      }
    } else {
      db.prepare(`
        INSERT INTO remittance_number_reservations (
          number_normalized, number_original, registered_at, registered_by, numbering_mode
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        normalizedNumber,
        remittance.transferNumber.trim(),
        remittance.reservationRegisteredAt,
        remittance.reservationRegisteredBy,
        remittance.reservationMode
      );
    }

    db.prepare(`
      INSERT INTO remittances (
        id, transfer_number, transfer_number_normalized, direction, status,
        sender_name, sender_phone, recipient_name, recipient_phone, network_name,
        amount_milli, currency, fee_amount_milli, total_paid_milli, branch_id,
        branch_name, teller_id, teller_name, teller_role, created_at, paid_at,
        recipient_id_type, recipient_id_number, voucher_number, journal_entry_reference,
        cash_movement_reference, payout_record_id, numbering_mode, idempotency_key, notes
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(
      remittance.id,
      remittance.transferNumber.trim(),
      normalizedNumber,
      remittance.direction,
      remittance.status,
      remittance.senderName.trim(),
      remittance.senderPhone || '',
      remittance.recipientName.trim(),
      remittance.recipientPhone || '',
      remittance.networkName.trim(),
      remittance.amountMilli,
      remittance.currency,
      remittance.feeAmountMilli,
      remittance.totalPaidMilli,
      remittance.branchId || null,
      remittance.branchName.trim(),
      remittance.tellerId || null,
      remittance.tellerName.trim(),
      remittance.tellerRole || null,
      remittance.createdAt,
      remittance.paidAt || null,
      remittance.recipientIdType || null,
      remittance.recipientIdNumber || null,
      remittance.voucherNumber || null,
      remittance.journalEntryReference || null,
      remittance.cashMovementReference || null,
      remittance.payoutRecordId || null,
      remittance.numberingMode || null,
      remittance.idempotencyKey || null,
      remittance.notes || null
    );
    return { id: remittance.id, replayed: false };
  });
}
