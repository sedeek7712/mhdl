import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openSqliteDatabase, runSqliteMigrations } from './sqliteDatabase.js';
import { SQLITE_MIGRATIONS } from './sqliteMigrations.js';
import {
  insertBalancedJournalEntry,
  insertSqliteAccount,
  insertSqliteRemittance,
  toScaledInteger,
  type SqliteCurrency,
} from './sqliteFinancialRepository.js';

type JsonRecord = Record<string, unknown>;

interface SourceFileSnapshot {
  kind: 'json' | 'binary';
  name: string;
  bytes: number;
  sha256: string;
  records: number;
  disposition: 'imported' | 'validated_only' | 'deferred' | 'optional_missing';
}

interface DryRunIssue {
  file: string;
  code: string;
  message: string;
}

export interface SqliteDryRunReport {
  schemaVersion: 1;
  status: 'PASS' | 'FAIL';
  generatedAt: string;
  sourceFiles: SourceFileSnapshot[];
  imported: Record<string, number>;
  validation: {
    sqliteIntegrity: string;
    foreignKeyViolations: number;
    accountBalanceSnapshotMatches: boolean;
    openingBalanceReconciliation: 'MATCHED' | 'NOT_AVAILABLE';
    journalEntriesBalanced: boolean;
    remittancePayoutsReconciled: boolean;
    operationalDataImported: boolean;
    voucherArchivesVerified: boolean;
    completeSystemParity: boolean;
    sourceFilesUnchanged: boolean;
    temporaryDatabaseRemoved: boolean;
  };
  warnings: string[];
  issues: DryRunIssue[];
}

const CURRENCIES: SqliteCurrency[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];

const REQUIRED_FILES = [
  'accounts_ledger.json',
  'journal_entries.json',
  'remittance_settings.json',
  'remittance_numbers_registry.json',
  'remittance_audit_logs.json',
  'remittance_payouts_registry.json',
  'remittances_master.json',
] as const;

const REQUIRED_OPERATIONAL_FILES = [
  'system_users.local.json',
  'exchange_rate_state.json',
  'cash_box_shift_state.json',
] as const;

const OPTIONAL_FILES = [
  'financial_baseline_approved.local.json',
  'system_users.json',
  'system_users.local.json',
  'whatsapp_dispatch_registry.json',
  'exchange_rate_state.json',
  'cash_box_shift_state.json',
] as const;

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid object in ${field}.`);
  }
  return value as JsonRecord;
}

function records(value: unknown, field: string): JsonRecord[] {
  if (!Array.isArray(value)) throw new Error(`Expected array in ${field}.`);
  return value.map((item, index) => record(item, `${field}[${index}]`));
}

function stringValue(value: unknown, field: string, optional = false): string {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid text field: ${field}.`);
  return value.trim();
}

function numberValue(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Error(`Invalid numeric field: ${field}.`);
  }
  return value;
}

function currencyValue(value: unknown, field: string): SqliteCurrency {
  if (typeof value !== 'string' || !CURRENCIES.includes(value as SqliteCurrency)) {
    throw new Error(`Unsupported currency in ${field}.`);
  }
  return value as SqliteCurrency;
}

function optionalText(row: JsonRecord, key: string): string | undefined {
  const value = row[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sha256(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function sha256Buffer(raw: Buffer): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function safeFileCount(payload: unknown): number {
  return Array.isArray(payload) ? payload.length : 1;
}

function loadJson(sourceDirectory: string, name: string, required: boolean) {
  const filePath = path.join(sourceDirectory, name);
  if (!fs.existsSync(filePath)) {
    if (required) throw new Error(`Required source file is missing: ${name}.`);
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`Source file is not valid JSON: ${name}.`);
  }
  return {
    filePath,
    raw,
    payload,
    bytes: Buffer.byteLength(raw, 'utf8'),
    sha256: sha256(raw),
  };
}

function addSnapshot(
  snapshots: SourceFileSnapshot[],
  name: string,
  loaded: ReturnType<typeof loadJson>,
  disposition: SourceFileSnapshot['disposition']
): void {
  snapshots.push({
    kind: 'json',
    name,
    bytes: loaded?.bytes ?? 0,
    sha256: loaded?.sha256 ?? '',
    records: loaded ? safeFileCount(loaded.payload) : 0,
    disposition: loaded ? disposition : 'optional_missing',
  });
}

function addBinarySnapshot(snapshots: SourceFileSnapshot[], name: string, raw: Buffer): void {
  snapshots.push({
    kind: 'binary',
    name,
    bytes: raw.length,
    sha256: sha256Buffer(raw),
    records: 1,
    disposition: 'imported',
  });
}

function validateCurrencyBalances(value: unknown, field: string): Record<SqliteCurrency, number> {
  const source = record(value, field);
  const result = {} as Record<SqliteCurrency, number>;
  for (const currency of CURRENCIES) {
    result[currency] = toScaledInteger(
      numberValue(source[currency], `${field}.${currency}`, -Number.MAX_SAFE_INTEGER),
      1000,
      `${field}.${currency}`
    );
  }
  return result;
}

function insertHistoricalSettings(db: ReturnType<typeof openSqliteDatabase>, value: unknown): void {
  const settings = record(value, 'remittance_settings.json');
  const mode = stringValue(settings.numberingMode, 'numberingMode');
  if (mode !== 'automatic' && mode !== 'manual') throw new Error('Invalid remittance numbering mode.');
  const sequence = numberValue(settings.nextSequence, 'nextSequence', 1);
  if (!Number.isSafeInteger(sequence)) throw new Error('Invalid remittance sequence.');
  db.prepare(`
    INSERT INTO remittance_settings (
      singleton_id, numbering_mode, prefix, next_sequence,
      updated_at, updated_by, updated_by_role, notes
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    mode,
    stringValue(settings.prefix, 'prefix'),
    sequence,
    stringValue(settings.updatedAt, 'updatedAt'),
    stringValue(settings.updatedBy, 'updatedBy'),
    stringValue(settings.updatedByRole, 'updatedByRole'),
    optionalText(settings, 'notes') ?? null
  );
}

function insertReservations(
  db: ReturnType<typeof openSqliteDatabase>,
  reservations: JsonRecord[]
): Map<string, JsonRecord> {
  const result = new Map<string, JsonRecord>();
  const insert = db.prepare(`
    INSERT INTO remittance_number_reservations (
      number_normalized, number_original, registered_at, registered_by, numbering_mode
    ) VALUES (?, ?, ?, ?, ?)
  `);
  for (const row of reservations) {
    const original = stringValue(row.number, 'reservation.number');
    const normalized = original.toUpperCase();
    if (result.has(normalized)) throw new Error('Duplicate normalized transfer-number reservation.');
    const mode = stringValue(row.mode, 'reservation.mode');
    if (mode !== 'automatic' && mode !== 'manual') throw new Error('Invalid reservation numbering mode.');
    insert.run(
      normalized,
      original,
      stringValue(row.registeredAt, 'reservation.registeredAt'),
      stringValue(row.registeredBy, 'reservation.registeredBy'),
      mode
    );
    result.set(normalized, row);
  }
  return result;
}

function mapRemittance(
  row: JsonRecord,
  reservation: JsonRecord
) {
  const transferNumber = stringValue(row.transferNumber, 'remittance.transferNumber');
  const direction = stringValue(row.direction, 'remittance.direction');
  if (direction !== 'incoming' && direction !== 'outgoing') throw new Error('Invalid remittance direction.');
  const status = stringValue(row.status, 'remittance.status');
  const allowedStatuses = ['draft', 'approved', 'available', 'paid', 'cancelled', 'refunded', 'pending'] as const;
  if (!allowedStatuses.includes(status as typeof allowedStatuses[number])) {
    throw new Error('Invalid remittance status.');
  }
  const mode = optionalText(row, 'numberingMode') || stringValue(reservation.mode, 'reservation.mode');
  if (mode !== 'automatic' && mode !== 'manual') throw new Error('Invalid remittance numbering mode.');

  return {
    id: stringValue(row.id, 'remittance.id'),
    transferNumber,
    direction,
    status: status as typeof allowedStatuses[number],
    senderName: stringValue(row.senderName, 'remittance.senderName'),
    senderPhone: optionalText(row, 'senderPhone'),
    recipientName: stringValue(row.recipientName, 'remittance.recipientName'),
    recipientPhone: optionalText(row, 'recipientPhone'),
    networkName: stringValue(row.networkName, 'remittance.networkName'),
    amountMilli: toScaledInteger(numberValue(row.amount, 'remittance.amount', Number.MIN_VALUE), 1000, 'remittance.amount'),
    currency: currencyValue(row.currency, 'remittance.currency'),
    feeAmountMilli: toScaledInteger(numberValue(row.feeAmount, 'remittance.feeAmount'), 1000, 'remittance.feeAmount'),
    totalPaidMilli: toScaledInteger(numberValue(row.totalPaid, 'remittance.totalPaid'), 1000, 'remittance.totalPaid'),
    branchId: optionalText(row, 'branchId'),
    branchName: stringValue(row.branchName, 'remittance.branchName'),
    tellerId: optionalText(row, 'tellerId'),
    tellerName: stringValue(row.tellerName, 'remittance.tellerName'),
    tellerRole: optionalText(row, 'tellerRole'),
    createdAt: stringValue(row.createdAt, 'remittance.createdAt'),
    paidAt: optionalText(row, 'paidAt'),
    recipientIdType: optionalText(row, 'recipientIdType'),
    recipientIdNumber: optionalText(row, 'recipientIdNumber'),
    voucherNumber: optionalText(row, 'voucherNumber'),
    journalEntryReference: optionalText(row, 'journalEntryReference'),
    cashMovementReference: optionalText(row, 'cashMovementReference'),
    payoutRecordId: optionalText(row, 'payoutRecordId'),
    numberingMode: mode,
    idempotencyKey: optionalText(row, 'idempotencyKey'),
    notes: optionalText(row, 'notes'),
    reservationRegisteredAt: stringValue(reservation.registeredAt, 'reservation.registeredAt'),
    reservationRegisteredBy: stringValue(reservation.registeredBy, 'reservation.registeredBy'),
    reservationMode: stringValue(reservation.mode, 'reservation.mode') as 'automatic' | 'manual',
  } as const;
}

function insertPayouts(
  db: ReturnType<typeof openSqliteDatabase>,
  payouts: JsonRecord[]
): void {
  const insert = db.prepare(`
    INSERT INTO remittance_payouts (
      idempotency_key, transfer_id, transfer_number_normalized,
      recipient_id_type, recipient_id_number, teller_id, teller_name, teller_role,
      amount_milli, currency, paid_at, voucher_number, journal_entry_reference,
      cash_movement_reference, manager_override, manager_override_by, manager_override_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of payouts) {
    const number = stringValue(row.transferNumber, 'payout.transferNumber').toUpperCase();
    const override = row.managerOverride === true;
    insert.run(
      optionalText(row, 'idempotencyKey') ?? null,
      stringValue(row.transferId, 'payout.transferId'),
      number,
      stringValue(row.recipientIdType, 'payout.recipientIdType'),
      stringValue(row.recipientIdNumber, 'payout.recipientIdNumber'),
      stringValue(row.tellerId, 'payout.tellerId'),
      stringValue(row.tellerName, 'payout.tellerName'),
      stringValue(row.tellerRole, 'payout.tellerRole'),
      toScaledInteger(numberValue(row.amount, 'payout.amount', Number.MIN_VALUE), 1000, 'payout.amount'),
      currencyValue(row.currency, 'payout.currency'),
      stringValue(row.paidAt, 'payout.paidAt'),
      stringValue(row.voucherNumber, 'payout.voucherNumber'),
      stringValue(row.journalEntryReference, 'payout.journalEntryReference'),
      optionalText(row, 'cashMovementReference') ?? null,
      override ? 1 : 0,
      optionalText(row, 'managerOverrideBy') ?? null,
      optionalText(row, 'managerOverrideReason') ?? null
    );
  }
}

function insertRemittanceAuditLogs(
  db: ReturnType<typeof openSqliteDatabase>,
  logs: JsonRecord[]
): void {
  const insert = db.prepare(`
    INSERT INTO remittance_audit_logs (
      id, category, action, details, performed_by, user_role,
      occurred_at, old_value, new_value
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of logs) {
    const category = stringValue(row.category, 'remittanceAudit.category');
    if (!['remittance_numbering', 'security', 'financial', 'reconciliation'].includes(category)) {
      throw new Error('Unsupported remittance audit-log category.');
    }
    insert.run(
      stringValue(row.id, 'remittanceAudit.id'),
      category,
      stringValue(row.action, 'remittanceAudit.action'),
      stringValue(row.details, 'remittanceAudit.details'),
      stringValue(row.performedBy, 'remittanceAudit.performedBy'),
      stringValue(row.userRole, 'remittanceAudit.userRole'),
      stringValue(row.timestamp, 'remittanceAudit.timestamp'),
      optionalText(row, 'oldValue') ?? null,
      optionalText(row, 'newValue') ?? null
    );
  }
}


function importExchangeRateState(db: ReturnType<typeof openSqliteDatabase>, value: unknown): { rates: number; auditLogs: number } {
  const state = record(value, 'exchange_rate_state.json');
  if (state.schemaVersion !== 1) throw new Error('Unsupported exchange-rate state schema version.');
  const rates = records(state.rates, 'exchange rates');
  const logs = records(state.auditLogs, 'exchange-rate audit logs');
  if (rates.length === 0) throw new Error('Exchange-rate state must contain at least one active currency pair.');
  const seenIds = new Set<string>();
  const seenPairs = new Set<string>();
  const rateByPair = new Map<string, string>();
  const insertRate = db.prepare('INSERT INTO exchange_rates (id, from_currency, to_currency, buy_rate_micro, sell_rate_micro, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const item of rates) {
    const id = stringValue(item.id, 'rate.id');
    const from = currencyValue(item.fromCurrency, 'rate.fromCurrency');
    const to = currencyValue(item.toCurrency, 'rate.toCurrency');
    if (from === to) throw new Error('An exchange-rate pair cannot use the same currency.');
    const pair = `${from} / ${to}`;
    if (seenIds.has(id) || seenPairs.has(pair)) throw new Error('Duplicate exchange-rate ID or currency pair.');
    seenIds.add(id); seenPairs.add(pair);
    insertRate.run(id, from, to,
      toScaledInteger(numberValue(item.buyRate, 'rate.buyRate'), 1_000_000, 'rate.buyRate'),
      toScaledInteger(numberValue(item.sellRate, 'rate.sellRate'), 1_000_000, 'rate.sellRate'),
      stringValue(item.updatedAt, 'rate.updatedAt', true),
      stringValue(item.updatedBy, 'rate.updatedBy'));
    rateByPair.set(pair, id);
  }
  const insertLog = db.prepare('INSERT INTO exchange_rate_audit (id, rate_id, old_buy_rate_micro, new_buy_rate_micro, old_sell_rate_micro, new_sell_rate_micro, changed_at, changed_by, changed_by_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const logIds = new Set<string>();
  for (const log of logs) {
    const id = stringValue(log.id, 'rateAudit.id');
    if (logIds.has(id)) throw new Error('Duplicate exchange-rate audit identifier.');
    logIds.add(id);
    const rateId = rateByPair.get(stringValue(log.currencyPair, 'rateAudit.currencyPair'));
    if (!rateId) throw new Error('Exchange-rate audit entry references an unknown currency pair.');
    insertLog.run(id, rateId,
      toScaledInteger(numberValue(log.oldBuyRate, 'rateAudit.oldBuyRate'), 1_000_000),
      toScaledInteger(numberValue(log.newBuyRate, 'rateAudit.newBuyRate'), 1_000_000),
      toScaledInteger(numberValue(log.oldSellRate, 'rateAudit.oldSellRate'), 1_000_000),
      toScaledInteger(numberValue(log.newSellRate, 'rateAudit.newSellRate'), 1_000_000),
      stringValue(log.changedAt, 'rateAudit.changedAt'),
      stringValue(log.changedBy, 'rateAudit.changedBy'),
      stringValue(log.changedById, 'rateAudit.changedById'),
      stringValue(log.note, 'rateAudit.note'));
  }
  return { rates: rates.length, auditLogs: logs.length };
}

function importCashierShiftState(db: ReturnType<typeof openSqliteDatabase>, value: unknown): { shifts: number; balances: number; events: number } {
  const state = record(value, 'cash_box_shift_state.json');
  if (state.schemaVersion !== 1 || !Array.isArray(state.history)) throw new Error('Invalid cashier-shift state.');
  const history = records(state.history, 'cashier shift history');
  const active = state.activeShift === null ? null : record(state.activeShift, 'active cashier shift');
  const all = active ? [...history, active] : history;
  const ids = new Set<string>();
  const openKeys = new Set<string>();
  const closeKeys = new Set<string>();
  const currencies: SqliteCurrency[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];
  const kinds = ['opening', 'expected', 'actual', 'discrepancy'] as const;
  const shiftInsert = db.prepare('INSERT INTO cashier_shifts (id, box_id, box_name_ar, teller_id, teller_name, opened_at, closed_at, status, notes, opened_by_role, closed_by, closed_by_id, open_idempotency_key, close_idempotency_key, open_request_fingerprint, close_request_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const balanceInsert = db.prepare('INSERT INTO cashier_shift_balances (shift_id, balance_kind, currency, amount_milli) VALUES (?, ?, ?, ?)');
  const eventInsert = db.prepare('INSERT INTO cashier_shift_events (id, shift_id, event_type, actor_id, actor_name, occurred_at, details) VALUES (?, ?, ?, ?, ?, ?, ?)');
  let balanceCount = 0;
  let eventCount = 0;
  const balancesFor = (input: unknown, field: string, signed = false) => {
    const source = record(input, field);
    const output = {} as Record<SqliteCurrency, number>;
    for (const currency of currencies) {
      const amount = source[currency];
      if (typeof amount !== 'number' || !Number.isFinite(amount) || (!signed && amount < 0) ||
          Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
        throw new Error(`Invalid shift balance: ${field}.${currency}.`);
      }
      output[currency] = toScaledInteger(amount, 1000, `${field}.${currency}`);
    }
    return output;
  };
  for (const shift of all) {
    const id = stringValue(shift.id, 'shift.id');
    const status = stringValue(shift.status, 'shift.status');
    if (ids.has(id) || (status !== 'open' && status !== 'closed') ||
        (shift === active && status !== 'open') || (shift !== active && status !== 'closed')) {
      throw new Error('Invalid or duplicate cashier-shift record.');
    }
    ids.add(id);
    const openKey = stringValue(shift.openIdempotencyKey, 'shift.openIdempotencyKey');
    const closeKey = optionalText(shift, 'closeIdempotencyKey');
    if (!/^[a-f0-9-]{36}$/i.test(openKey) || openKeys.has(openKey) || closeKeys.has(openKey) ||
        (closeKey && (!/^[a-f0-9-]{36}$/i.test(closeKey) || closeKeys.has(closeKey) || openKeys.has(closeKey)))) {
      throw new Error('Invalid or duplicate cashier-shift idempotency key.');
    }
    const openFingerprint = optionalText(shift, 'openRequestFingerprint');
    const closeFingerprint = optionalText(shift, 'closeRequestFingerprint');
    if (!openFingerprint || !/^[a-f0-9]{64}$/i.test(openFingerprint) ||
        (status === 'closed' && (!closeKey || !closeFingerprint || !/^[a-f0-9]{64}$/i.test(closeFingerprint))) ||
        (status === 'open' && (closeKey !== undefined || closeFingerprint !== undefined))) {
      throw new Error('Cashier-shift replay fingerprints are missing or inconsistent.');
    }
    openKeys.add(openKey);
    if (closeKey) closeKeys.add(closeKey);
    shiftInsert.run(
      id, stringValue(shift.boxId, 'shift.boxId'), stringValue(shift.boxNameAr, 'shift.boxNameAr'),
      stringValue(shift.tellerId, 'shift.tellerId'), stringValue(shift.tellerName, 'shift.tellerName'),
      stringValue(shift.openedAt, 'shift.openedAt'), optionalText(shift, 'closedAt') ?? null,
      status, optionalText(shift, 'notes') ?? null, stringValue(shift.openedByRole, 'shift.openedByRole'),
      optionalText(shift, 'closedBy') ?? null, optionalText(shift, 'closedById') ?? null,
      openKey, closeKey ?? null, openFingerprint ?? null, closeFingerprint ?? null
    );
    const groups = {
      opening: balancesFor(shift.openingBalances, 'shift.openingBalances'),
      expected: balancesFor(shift.expectedBalances, 'shift.expectedBalances'),
      actual: balancesFor(shift.actualBalances, 'shift.actualBalances'),
      discrepancy: balancesFor(shift.discrepancies, 'shift.discrepancies', true),
    };
    if (status === 'closed') {
      let hasVariance = false;
      for (const currency of currencies) {
        const expectedMilli = groups.expected[currency];
        const actualMilli = groups.actual[currency];
        const recordedDiscrepancyMilli = groups.discrepancy[currency];
        const calculatedDiscrepancyMilli = Math.round((actualMilli - expectedMilli) / 10) * 10;
        if (calculatedDiscrepancyMilli !== recordedDiscrepancyMilli) {
          throw new Error('Closed cashier shift discrepancy does not reconcile with expected and actual balances.');
        }
        if (recordedDiscrepancyMilli !== 0) hasVariance = true;
      }
      const notes = optionalText(shift, 'notes') ?? '';
      if (hasVariance && notes.length < 10) {
        throw new Error('Closed cashier shift with a variance is missing its required explanatory note.');
      }
    }
    for (const kind of kinds) for (const currency of currencies) {
      balanceInsert.run(id, kind, currency, groups[kind][currency]);
      balanceCount += 1;
    }
    eventInsert.run(`${id}:opened`, id, 'opened',
      stringValue(shift.tellerId, 'shift.tellerId'),
      stringValue(shift.tellerName, 'shift.tellerName'),
      stringValue(shift.openedAt, 'shift.openedAt'),
      JSON.stringify({ boxId: shift.boxId, openIdempotencyKey: openKey }));
    eventCount += 1;
    if (status === 'closed') {
      const closedAt = stringValue(shift.closedAt, 'shift.closedAt');
      const closedById = stringValue(shift.closedById, 'shift.closedById');
      const closedBy = stringValue(shift.closedBy, 'shift.closedBy');
      eventInsert.run(`${id}:closed`, id, 'closed', closedById, closedBy, closedAt,
        JSON.stringify({ closeIdempotencyKey: closeKey, notes: optionalText(shift, 'notes') ?? '', discrepancies: shift.discrepancies }));
      eventCount += 1;
      const hasVariance = currencies.some((currency) => groups.discrepancy[currency] !== 0);
      if (hasVariance) {
        eventInsert.run(`${id}:variance`, id, 'variance_noted', closedById, closedBy, closedAt,
          JSON.stringify({ notes: optionalText(shift, 'notes') ?? '', discrepancies: shift.discrepancies }));
        eventCount += 1;
      }
    }
  }
  return { shifts: all.length, balances: balanceCount, events: eventCount };
}

function importLocalUsers(db: ReturnType<typeof openSqliteDatabase>, value: unknown): number {
  const users = records(value, 'system_users.local.json');
  if (users.length === 0) throw new Error('Local user registry is empty.');
  const roles = ['owner', 'general_manager', 'branch_manager', 'teller', 'auditor', 'accountant', 'compliance_officer'];
  const usernames = new Set<string>();
  const ids = new Set<string>();
  let ownerCount = 0;
  let activeOwnerCount = 0;
  const insert = db.prepare('INSERT INTO app_users (id, username, name, role, branch_id, branch_name, pin_salt, pin_hash, is_active, must_change_pin, session_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const user of users) {
    const username = stringValue(user.username, 'user.username').toLowerCase();
    const id = stringValue(user.id, 'user.id');
    const role = stringValue(user.role, 'user.role');
    const salt = stringValue(user.pinSalt, 'user.pinSalt');
    const hash = stringValue(user.pinHash, 'user.pinHash');
    const session = stringValue(user.sessionVersion, 'user.sessionVersion');
    if (!/^[a-z0-9._-]{3,32}$/.test(username) || !roles.includes(role) ||
        !/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{64}$/i.test(hash) ||
        !/^[a-f0-9]{32}$/i.test(session) ||
        typeof user.isActive !== 'boolean' || typeof user.mustChangePin !== 'boolean' ||
        usernames.has(username) || ids.has(id)) {
      throw new Error('Local user registry contains an invalid or duplicate account.');
    }
    usernames.add(username); ids.add(id);
    if (role === 'owner') {
      ownerCount += 1;
      if (user.isActive) activeOwnerCount += 1;
    }
    insert.run(id, username, stringValue(user.name, 'user.name'), role,
      stringValue(user.branchId, 'user.branchId'), stringValue(user.branchName, 'user.branchName'),
      salt, hash, user.isActive ? 1 : 0, user.mustChangePin ? 1 : 0, session,
      stringValue(user.createdAt, 'user.createdAt'));
  }
  if (ownerCount !== 1 || activeOwnerCount !== 1) {
    throw new Error('Local user registry must contain exactly one active owner.');
  }
  return users.length;
}

function importWhatsAppDispatches(
  db: ReturnType<typeof openSqliteDatabase>, value: unknown, sourceDirectory: string
): { dispatches: number; webhookEvents: number; attachments: number; archiveSnapshots: SourceFileSnapshot[] } {
  const dispatches = records(value, 'whatsapp_dispatch_registry.json');
  const allowedStatuses = ['PENDING', 'GENERATING', 'GENERATED', 'UPLOADING', 'UPLOADED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RETRY_PENDING'];
  const ids = new Set<string>();
  const keys = new Set<string>();
  const insertDispatch = db.prepare('INSERT INTO whatsapp_dispatches (id, transaction_id, voucher_number, voucher_type, recipient_phone, sha256, file_size_bytes, meta_media_id, whatsapp_message_id, status, caption, created_at, uploaded_at, sent_at, delivered_at, read_at, failed_at, attempts_count, last_error, employee_id, employee_name, idempotency_key, snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertEvent = db.prepare('INSERT INTO whatsapp_webhook_events (id, dispatch_id, message_id, event_key, status, occurred_at, recipient_id, raw_event_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertAttachment = db.prepare('INSERT INTO voucher_attachments (id, dispatch_id, voucher_number, transaction_id, storage_key, relative_path, sha256, file_size_bytes, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  let eventCount = 0;
  let attachmentCount = 0;
  const archiveSnapshots: SourceFileSnapshot[] = [];
  const archiveRoot = path.resolve(sourceDirectory, 'archived_vouchers');
  for (const dispatch of dispatches) {
    const id = stringValue(dispatch.id, 'dispatch.id');
    const key = stringValue(dispatch.idempotencyKey, 'dispatch.idempotencyKey');
    const status = stringValue(dispatch.status, 'dispatch.status');
    const hash = stringValue(dispatch.sha256, 'dispatch.sha256').toLowerCase();
    if (ids.has(id) || keys.has(key) || !allowedStatuses.includes(status) || !/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error('WhatsApp dispatch contains a duplicate identifier or invalid status/hash.');
    }
    ids.add(id); keys.add(key);
    const size = numberValue(dispatch.fileSizeBytes, 'dispatch.fileSizeBytes', 1);
    if (!Number.isSafeInteger(size)) throw new Error('WhatsApp image size is not an integer.');
    const messageId = optionalText(dispatch, 'whatsappMessageId');
    const snapshot = record(dispatch.snapshot, 'dispatch.snapshot');
    const events = dispatch.rawWebhookEvents === undefined ? [] : records(dispatch.rawWebhookEvents, 'dispatch.rawWebhookEvents');
    if (events.length && !messageId) throw new Error('Webhook history is not linked to a WhatsApp message ID.');
    insertDispatch.run(
      id, stringValue(dispatch.transactionId, 'dispatch.transactionId'),
      stringValue(dispatch.voucherNumber, 'dispatch.voucherNumber'),
      stringValue(dispatch.voucherType, 'dispatch.voucherType'),
      stringValue(dispatch.recipientPhone, 'dispatch.recipientPhone'), hash, size,
      optionalText(dispatch, 'metaMediaId') ?? null, messageId ?? null, status,
      stringValue(dispatch.caption, 'dispatch.caption', true),
      stringValue(dispatch.createdAt, 'dispatch.createdAt'),
      optionalText(dispatch, 'uploadedAt') ?? null, optionalText(dispatch, 'sentAt') ?? null,
      optionalText(dispatch, 'deliveredAt') ?? null, optionalText(dispatch, 'readAt') ?? null,
      optionalText(dispatch, 'failedAt') ?? null,
      numberValue(dispatch.attemptsCount, 'dispatch.attemptsCount'),
      optionalText(dispatch, 'lastError') ?? null, optionalText(dispatch, 'employeeId') ?? null,
      optionalText(dispatch, 'employeeName') ?? null, key, JSON.stringify(snapshot)
    );
    for (const event of events) {
      const eventStatus = stringValue(event.status, 'webhook.status');
      if (!['sent', 'delivered', 'read', 'failed'].includes(eventStatus)) throw new Error('Unsupported WhatsApp webhook status.');
      const timestamp = String(event.timestamp ?? '');
      if (!timestamp.trim()) throw new Error('WhatsApp webhook event timestamp is missing.');
      const eventKey = optionalText(event, 'id') ?? sha256(JSON.stringify(event));
      const eventId = sha256(`${id}\u0000${eventKey}\u0000${eventStatus}\u0000${timestamp}`);
      insertEvent.run(eventId, id, stringValue(messageId, 'dispatch.whatsappMessageId'),
        eventKey, eventStatus, timestamp,
        optionalText(event, 'recipient_id') ?? null, JSON.stringify(event));
      eventCount += 1;
    }
    const storageKey = stringValue(dispatch.storageKey, 'dispatch.storageKey');
    if (path.basename(storageKey) !== storageKey || storageKey.includes('/') || storageKey.includes('\\')) {
      throw new Error('Voucher archive key is not a safe filename.');
    }
    const imagePath = path.resolve(archiveRoot, storageKey);
    if (!imagePath.startsWith(`${archiveRoot}${path.sep}`) || !fs.existsSync(imagePath) || !fs.lstatSync(imagePath).isFile()) {
      throw new Error('Voucher archive image is missing or is not a regular file.');
    }
    const image = fs.readFileSync(imagePath);
    if (image.length !== size || sha256Buffer(image) !== hash) throw new Error('Voucher archive image size/hash does not match its record.');
    const png = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
    if (!png && !jpeg) throw new Error('Voucher archive image is not a PNG or JPEG file.');
    insertAttachment.run(`attachment:${id}`, id,
      stringValue(dispatch.voucherNumber, 'dispatch.voucherNumber'),
      stringValue(dispatch.transactionId, 'dispatch.transactionId'),
      storageKey, `archived_vouchers/${storageKey}`, hash, size,
      png ? 'image/png' : 'image/jpeg', stringValue(dispatch.createdAt, 'dispatch.createdAt'));
    addBinarySnapshot(archiveSnapshots, `archived_vouchers/${storageKey}`, image);
    attachmentCount += 1;
  }
  return { dispatches: dispatches.length, webhookEvents: eventCount, attachments: attachmentCount, archiveSnapshots };
}
function compareRemittancePayouts(
  masters: JsonRecord[],
  payouts: JsonRecord[],
  journals: JsonRecord[]
): boolean {
  const masterByNumber = new Map<string, JsonRecord>();
  for (const master of masters) {
    const key = stringValue(master.transferNumber, 'master.transferNumber').toUpperCase();
    if (masterByNumber.has(key)) throw new Error('Duplicate normalized remittance number in master registry.');
    masterByNumber.set(key, master);
  }
  const journalByNumber = new Map<string, JsonRecord>();
  for (const journal of journals) {
    journalByNumber.set(stringValue(journal.entryNumber, 'journal.entryNumber'), journal);
  }
  const payoutNumbers = new Set<string>();
  for (const payout of payouts) {
    const number = stringValue(payout.transferNumber, 'payout.transferNumber').toUpperCase();
    if (payoutNumbers.has(number)) throw new Error('Duplicate payout record for the same remittance.');
    payoutNumbers.add(number);
    const master = masterByNumber.get(number);
    if (!master || master.status !== 'paid' ||
        master.amount !== payout.amount || master.currency !== payout.currency ||
        master.journalEntryReference !== payout.journalEntryReference) {
      throw new Error('Payout registry does not match the paid master remittance.');
    }
    const journal = journalByNumber.get(stringValue(payout.journalEntryReference, 'payout.journalEntryReference'));
    if (!journal || journal.referenceType !== 'transfer_payout' ||
        String(journal.referenceId).trim().toUpperCase() !== number || journal.isBalanced !== true) {
      throw new Error('Payout registry does not match a balanced transfer-payout journal entry.');
    }
  }
  for (const master of masters) {
    const key = stringValue(master.transferNumber, 'master.transferNumber').toUpperCase();
    if (master.status === 'paid' && !payoutNumbers.has(key)) {
      throw new Error('A paid master remittance has no matching payout record.');
    }
  }
  return true;
}

function compareOpeningBalances(
  accounts: JsonRecord[],
  journals: JsonRecord[],
  baselineValue: unknown
): boolean {
  const baseline = record(baselineValue, 'financial_baseline_approved.local.json');
  const openingBalances = record(baseline.openingBalances, 'openingBalances');
  const movement = new Map<string, bigint>();

  for (const journal of journals) {
    const lines = records(journal.lines, 'journal.lines');
    for (const line of lines) {
      const accountId = stringValue(line.accountId, 'journalLine.accountId');
      const currency = currencyValue(line.currency, 'journalLine.currency');
      const account = accounts.find((item) => item.id === accountId);
      if (!account) throw new Error('Journal line references an account missing from the account ledger.');
      const type = stringValue(account.type, 'account.type');
      const sign = type === 'asset' || type === 'expense' ? 1n : -1n;
      const debit = BigInt(toScaledInteger(numberValue(line.debit, 'journalLine.debit'), 1000, 'journalLine.debit'));
      const credit = BigInt(toScaledInteger(numberValue(line.credit, 'journalLine.credit'), 1000, 'journalLine.credit'));
      const key = `${accountId}\u0000${currency}`;
      movement.set(key, (movement.get(key) ?? 0n) + sign * (debit - credit));
    }
  }

  for (const account of accounts) {
    const accountId = stringValue(account.id, 'account.id');
    const baselineAccount = record(openingBalances[accountId], 'baseline account');
    if (baselineAccount.type !== account.type) throw new Error('Opening-balance account type differs from the current ledger.');
    const opening = validateCurrencyBalances(baselineAccount.balances, 'baseline balances');
    const current = validateCurrencyBalances(account.balances, 'account balances');
    for (const currency of CURRENCIES) {
      const key = `${accountId}\u0000${currency}`;
      const expected = BigInt(opening[currency]) + (movement.get(key) ?? 0n);
      if (expected !== BigInt(current[currency])) {
        throw new Error('Computed ledger balance differs from the current account balance snapshot.');
      }
    }
  }
  return true;
}

function assertSourceUnchanged(snapshots: SourceFileSnapshot[], sourceDirectory: string): boolean {
  for (const snapshot of snapshots) {
    const filePath = path.join(sourceDirectory, snapshot.name);
    if (snapshot.disposition === 'optional_missing') {
      if (fs.existsSync(filePath)) return false;
      continue;
    }
    if (snapshot.kind === 'binary') {
      if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) return false;
      const current = fs.readFileSync(filePath);
      if (current.length !== snapshot.bytes || sha256Buffer(current) !== snapshot.sha256) return false;
    } else {
      const current = fs.readFileSync(filePath, 'utf8');
      if (Buffer.byteLength(current, 'utf8') !== snapshot.bytes || sha256(current) !== snapshot.sha256) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Reads an explicit local JSON directory, imports supported historical data into a
 * disposable SQLite database, verifies integrity and removes the database.
 * It never writes to, renames, or deletes any source JSON file.
 */
export function runSqliteDryRun(sourceDirectory: string): SqliteDryRunReport {
  const absoluteSource = path.resolve(sourceDirectory);
  if (!fs.existsSync(absoluteSource) || !fs.statSync(absoluteSource).isDirectory()) {
    throw new Error('Source directory does not exist or is not a directory.');
  }

  const report: SqliteDryRunReport = {
    schemaVersion: 1,
    status: 'FAIL',
    generatedAt: new Date().toISOString(),
    sourceFiles: [],
    imported: {},
    validation: {
      sqliteIntegrity: 'NOT_RUN',
      foreignKeyViolations: -1,
      accountBalanceSnapshotMatches: false,
      openingBalanceReconciliation: 'NOT_AVAILABLE',
      journalEntriesBalanced: false,
      remittancePayoutsReconciled: false,
      operationalDataImported: false,
      voucherArchivesVerified: false,
      completeSystemParity: false,
      sourceFilesUnchanged: false,
      temporaryDatabaseRemoved: false,
    },
    warnings: [],
    issues: [],
  };

  // Never migrate while the source ledger says a prior financial transaction is unresolved.
  // The marker contents can contain operational details, so only its presence is reported.
  const pendingTransactionMarker = path.join(absoluteSource, 'financial_transaction_pending.json');
  if (fs.existsSync(pendingTransactionMarker)) {
    report.issues.push({
      file: 'financial_transaction_pending.json',
      code: 'PENDING_FINANCIAL_TRANSACTION',
      message: 'Dry run blocked: an unresolved financial transaction marker exists. Reconcile the ledger manually before retrying.',
    });
    report.validation.temporaryDatabaseRemoved = true;
    return report;
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-sqlite-dry-run-'));
  const databasePath = path.join(temporaryDirectory, 'dry-run.sqlite');
  let db: ReturnType<typeof openSqliteDatabase> | undefined;
  const loaded = new Map<string, NonNullable<ReturnType<typeof loadJson>>>();

  try {
    const payloads = new Map<string, unknown>();
    for (const name of REQUIRED_FILES) {
      const item = loadJson(absoluteSource, name, true);
      if (!item) throw new Error(`Required source file is missing: ${name}.`);
      loaded.set(name, item);
      payloads.set(name, item.payload);
      addSnapshot(report.sourceFiles, name, item, 'imported');
    }
    for (const name of OPTIONAL_FILES) {
      const item = loadJson(absoluteSource, name, false);
      if (item) {
        loaded.set(name, item);
        payloads.set(name, item.payload);
        const deferred = name === 'system_users.json';
        const validatedOnly = name === 'financial_baseline_approved.local.json';
        addSnapshot(report.sourceFiles, name, item, deferred ? 'deferred' : validatedOnly ? 'validated_only' : 'imported');
      } else {
        addSnapshot(report.sourceFiles, name, null, 'optional_missing');
      }
    }

    const accounts = records(payloads.get('accounts_ledger.json'), 'accounts_ledger.json');
    const journals = records(payloads.get('journal_entries.json'), 'journal_entries.json');
    const reservations = records(payloads.get('remittance_numbers_registry.json'), 'remittance_numbers_registry.json');
    const remittanceMasters = records(payloads.get('remittances_master.json'), 'remittances_master.json');
    const payouts = records(payloads.get('remittance_payouts_registry.json'), 'remittance_payouts_registry.json');
    const auditLogs = records(payloads.get('remittance_audit_logs.json'), 'remittance_audit_logs.json');

    if (accounts.length === 0) throw new Error('Account ledger is empty.');
    if (!compareRemittancePayouts(remittanceMasters, payouts, journals)) {
      throw new Error('Remittance-payout reconciliation failed.');
    }
    report.validation.journalEntriesBalanced = true;
    report.validation.remittancePayoutsReconciled = true;

    const baselineFile = loaded.get('financial_baseline_approved.local.json');
    if (baselineFile) {
      report.validation.openingBalanceReconciliation = compareOpeningBalances(
        accounts,
        journals,
        baselineFile.payload
      ) ? 'MATCHED' : 'NOT_AVAILABLE';
    } else {
      report.warnings.push('Approved opening-balance baseline is not present; historical opening-to-current balance reconciliation was not performed.');
    }

    db = openSqliteDatabase({ filePath: databasePath });
    runSqliteMigrations(db, SQLITE_MIGRATIONS);

    const accountIds = new Set<string>();
    const accountCodes = new Set<string>();
    for (const item of accounts) {
      const id = stringValue(item.id, 'account.id');
      const code = stringValue(item.code, 'account.code');
      if (accountIds.has(id) || accountCodes.has(code)) throw new Error('Duplicate account ID or account code.');
      accountIds.add(id);
      accountCodes.add(code);
      const balancesMilli = validateCurrencyBalances(item.balances, 'account balances');
      const accountType = stringValue(item.type, 'account.type');
      const category = stringValue(item.category, 'account.category');
      insertSqliteAccount(db, {
        id,
        code,
        nameAr: stringValue(item.nameAr ?? item.name, 'account.nameAr'),
        accountType: accountType as 'asset' | 'liability' | 'equity' | 'revenue' | 'expense',
        category,
        balancesMilli,
        createdAt: new Date(0).toISOString(),
      });
    }
    report.imported.accounts = accounts.length;

    const entryIds = new Set<string>();
    const entryNumbers = new Set<string>();
    for (const item of journals) {
      const id = stringValue(item.id, 'journal.id');
      const entryNumber = stringValue(item.entryNumber, 'journal.entryNumber');
      if (entryIds.has(id) || entryNumbers.has(entryNumber)) throw new Error('Duplicate journal ID or entry number.');
      entryIds.add(id);
      entryNumbers.add(entryNumber);
      if (item.isBalanced !== true) throw new Error('Journal entry is not marked balanced in the source data.');
      const lines = records(item.lines, 'journal.lines').map((line) => ({
        accountId: stringValue(line.accountId, 'journalLine.accountId'),
        accountNameArSnapshot: stringValue(line.accountNameAr ?? line.accountNameArSnapshot, 'journalLine.accountNameAr'),
        currency: currencyValue(line.currency, 'journalLine.currency'),
        debitMilli: toScaledInteger(numberValue(line.debit, 'journalLine.debit'), 1000, 'journalLine.debit'),
        creditMilli: toScaledInteger(numberValue(line.credit, 'journalLine.credit'), 1000, 'journalLine.credit'),
        note: optionalText(line, 'note'),
      }));
      insertBalancedJournalEntry(db, {
        id,
        entryNumber,
        date: stringValue(item.date, 'journal.date'),
        time: stringValue(item.time, 'journal.time'),
        descriptionAr: stringValue(item.descriptionAr, 'journal.descriptionAr'),
        referenceType: stringValue(item.referenceType, 'journal.referenceType'),
        referenceId: stringValue(item.referenceId, 'journal.referenceId'),
        branchId: stringValue(item.branchId, 'journal.branchId'),
        createdBy: stringValue(item.createdBy, 'journal.createdBy'),
        createdById: optionalText(item, 'createdById'),
        idempotencyKey: optionalText(item, 'idempotencyKey'),
        exchangeRateMicro: item.exchangeRate === undefined ? undefined : toScaledInteger(numberValue(item.exchangeRate, 'journal.exchangeRate'), 1_000_000),
        grossTargetAmountMilli: item.grossTargetAmount === undefined ? undefined : toScaledInteger(numberValue(item.grossTargetAmount, 'journal.grossTargetAmount'), 1000),
        targetAmountMilli: item.targetAmount === undefined ? undefined : toScaledInteger(numberValue(item.targetAmount, 'journal.targetAmount'), 1000),
        voucherNumber: optionalText(item, 'voucherNumber'),
        lines,
        applyBalanceMovements: false,
      });
    }
    report.imported.journalEntries = journals.length;
    report.imported.journalLines = journals.reduce((sum, item) => sum + records(item.lines, 'journal.lines').length, 0);

    insertHistoricalSettings(db, payloads.get('remittance_settings.json'));
    report.imported.remittanceSettings = 1;

    const reservationMap = insertReservations(db, reservations);
    report.imported.remittanceNumberReservations = reservations.length;

    for (const item of remittanceMasters) {
      const transferNumber = stringValue(item.transferNumber, 'master.transferNumber');
      const reservation = reservationMap.get(transferNumber.toUpperCase());
      if (!reservation) throw new Error('Remittance is missing its number reservation.');
      insertSqliteRemittance(db, mapRemittance(item, reservation));
    }
    report.imported.remittances = remittanceMasters.length;

    insertPayouts(db, payouts);
    report.imported.remittancePayouts = payouts.length;

    insertRemittanceAuditLogs(db, auditLogs);
    report.imported.remittanceAuditLogs = auditLogs.length;

    const users = loaded.get('system_users.json');
    if (users) {
      const userRecords = records(users.payload, 'system_users.json');
      const ids = new Set<string>();
      const usernames = new Set<string>();
      const validRoles = ['owner', 'general_manager', 'branch_manager', 'teller', 'auditor', 'accountant', 'compliance_officer'];
      for (const user of userRecords) {
        const id = stringValue(user.id, 'legacyUser.id');
        const username = stringValue(user.username, 'legacyUser.username').toLowerCase();
        if (ids.has(id) || usernames.has(username) ||
            !validRoles.includes(stringValue(user.role, 'legacyUser.role')) ||
            !optionalText(user, 'pinHash') || !optionalText(user, 'pinSalt')) {
          throw new Error('Legacy user registry contains invalid or duplicate account records.');
        }
        ids.add(id);
        usernames.add(username);
      }
      report.imported.usersValidated = userRecords.length;
      report.warnings.push('Legacy system_users.json accounts were validated for audit only; the current local-authentication registry is system_users.local.json.');
    }

    const localUsers = loaded.get('system_users.local.json');
    if (localUsers) {
      const count = importLocalUsers(db, localUsers.payload);
      report.imported.localUsersValidated = count;
      report.imported.localUsersImported = count;
    }

    const exchangeRates = loaded.get('exchange_rate_state.json');
    if (exchangeRates) {
      const result = importExchangeRateState(db, exchangeRates.payload);
      report.imported.exchangeRates = result.rates;
      report.imported.exchangeRateAuditLogs = result.auditLogs;
    }

    const shiftState = loaded.get('cash_box_shift_state.json');
    if (shiftState) {
      const result = importCashierShiftState(db, shiftState.payload);
      report.imported.cashierShifts = result.shifts;
      report.imported.cashierShiftBalances = result.balances;
      report.imported.cashierShiftEvents = result.events;
    }

    const whatsApp = loaded.get('whatsapp_dispatch_registry.json');
    if (whatsApp) {
      const result = importWhatsAppDispatches(db, whatsApp.payload, absoluteSource);
      report.imported.whatsappDispatchesValidated = result.dispatches;
      report.imported.whatsappDispatches = result.dispatches;
      report.imported.whatsappWebhookEvents = result.webhookEvents;
      report.imported.voucherAttachments = result.attachments;
      report.sourceFiles.push(...result.archiveSnapshots);
    }

    report.validation.operationalDataImported =
      REQUIRED_OPERATIONAL_FILES.every((name) => loaded.has(name));
    report.validation.voucherArchivesVerified = Boolean(whatsApp);
    if (!report.validation.operationalDataImported) {
      const missing = REQUIRED_OPERATIONAL_FILES.filter((name) => !loaded.has(name));
      report.warnings.push(`Operational data is incomplete; missing required datasets: ${missing.join(', ')}.`);
    }
    if (!report.validation.voucherArchivesVerified) {
      report.warnings.push('WhatsApp dispatch registry is missing; voucher archive parity was not verified.');
    }

    let snapshotMatches = true;
    const balanceRows = db.prepare(
      'SELECT account_id, currency, balance_milli FROM account_balances ORDER BY account_id, currency'
    ).all() as Array<{ account_id: string; currency: string; balance_milli: number }>;
    for (const row of balanceRows) {
      const original = accounts.find((account) => account.id === row.account_id);
      if (!original) { snapshotMatches = false; break; }
      const expected = toScaledInteger(
        numberValue(record(original.balances, 'account balances')[row.currency], 'account balance'),
        1000,
        'account balance'
      );
      if (expected !== row.balance_milli) { snapshotMatches = false; break; }
    }
    report.validation.accountBalanceSnapshotMatches = snapshotMatches;
    if (!snapshotMatches) throw new Error('Imported account balance snapshot does not match the JSON source.');

    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    report.validation.sqliteIntegrity = String(integrity.integrity_check);
    const foreignKeyRows = db.prepare('PRAGMA foreign_key_check').all();
    report.validation.foreignKeyViolations = foreignKeyRows.length;

    const expectedCounts: Record<string, string> = {
      accounts: 'accounts',
      accountBalances: 'account_balances',
      journalEntries: 'journal_entries',
      journalLines: 'journal_lines',
      remittanceNumberReservations: 'remittance_number_reservations',
      remittances: 'remittances',
      remittancePayouts: 'remittance_payouts',
      remittanceAuditLogs: 'remittance_audit_logs',
      localUsersImported: 'app_users',
      exchangeRates: 'exchange_rates',
      exchangeRateAuditLogs: 'exchange_rate_audit',
      cashierShifts: 'cashier_shifts',
      cashierShiftBalances: 'cashier_shift_balances',
      cashierShiftEvents: 'cashier_shift_events',
      whatsappDispatches: 'whatsapp_dispatches',
      whatsappWebhookEvents: 'whatsapp_webhook_events',
      voucherAttachments: 'voucher_attachments',
    };
    for (const [key, table] of Object.entries(expectedCounts)) {
      const result = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      const count = Number(result.count);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid imported table count.');
      if (report.imported[key] !== undefined && report.imported[key] !== count) {
        throw new Error(`Imported row count mismatch for ${table}.`);
      }
      report.imported[key] = count;
    }

    if (report.validation.sqliteIntegrity !== 'ok' || report.validation.foreignKeyViolations !== 0) {
      throw new Error('SQLite integrity or foreign-key check failed.');
    }

    report.validation.sourceFilesUnchanged = assertSourceUnchanged(report.sourceFiles, absoluteSource);
    if (!report.validation.sourceFilesUnchanged) throw new Error('A source JSON file changed while the dry run was executing.');

    report.status = 'PASS';
  } catch {
    report.issues.push({
      file: 'source-data',
      code: 'DRY_RUN_VALIDATION_FAILED',
      message: 'The dry run stopped safely. Review local JSON structure, data consistency, and the required fields; source values were not printed.',
    });
  } finally {
    if (db) {
      try { db.close(); } catch { /* preserve the validation result */ }
    }
    try {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      report.validation.temporaryDatabaseRemoved = !fs.existsSync(temporaryDirectory);
    } catch {
      report.validation.temporaryDatabaseRemoved = false;
    }
  }

  if (!report.validation.temporaryDatabaseRemoved && report.status === 'PASS') {
    report.status = 'FAIL';
    report.issues.push({
      file: 'temporary-database',
      code: 'TEMPORARY_DATABASE_CLEANUP_FAILED',
      message: 'Temporary database cleanup could not be verified.',
    });
  }
  if (!report.validation.sourceFilesUnchanged && report.status === 'PASS') {
    report.status = 'FAIL';
    report.issues.push({
      file: 'source-data',
      code: 'SOURCE_DATA_CHANGED_DURING_DRY_RUN',
      message: 'One or more source files changed while the dry run was executing.',
    });
  }

  report.validation.completeSystemParity =
    report.validation.operationalDataImported &&
    report.validation.voucherArchivesVerified &&
    report.validation.openingBalanceReconciliation === 'MATCHED' &&
    report.validation.sourceFilesUnchanged &&
    report.validation.sqliteIntegrity === 'ok' &&
    report.validation.foreignKeyViolations === 0 &&
    report.validation.temporaryDatabaseRemoved;

  if (!report.validation.completeSystemParity && report.status === 'PASS') {
    report.warnings.push('Core SQLite dry run passed, but full system parity is incomplete. Do not cut over until all operational datasets, voucher archives, and the approved opening-balance reconciliation are verified.');
  }

  return report;
}
