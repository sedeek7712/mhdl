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
    name,
    bytes: loaded?.bytes ?? 0,
    sha256: loaded?.sha256 ?? '',
    records: loaded ? safeFileCount(loaded.payload) : 0,
    disposition: loaded ? disposition : 'optional_missing',
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
    const current = fs.readFileSync(filePath, 'utf8');
    if (Buffer.byteLength(current, 'utf8') !== snapshot.bytes || sha256(current) !== snapshot.sha256) {
      return false;
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
      const ids = userRecords.map((user) => stringValue(user.id, 'user.id'));
      if (new Set(ids).size !== ids.length) throw new Error('Duplicate user IDs in source user registry.');
      if (userRecords.some((user) => !optionalText(user, 'pinHash') || !optionalText(user, 'pinSalt'))) {
        throw new Error('A source user record is missing its PIN hash or salt.');
      }
      report.imported.usersValidated = userRecords.length;
      report.warnings.push('User authentication records were validated but not imported because the user/authentication tables are not in SQLite migration v1.');
    }

    const localUsers = loaded.get('system_users.local.json');
    if (localUsers) {
      const userRecords = records(localUsers.payload, 'system_users.local.json');
      report.imported.localUsersValidated = userRecords.length;
      report.warnings.push('Local owner authentication records were validated but not imported; credential records remain outside SQLite migration v1.');
    }

    const whatsApp = loaded.get('whatsapp_dispatch_registry.json');
    if (whatsApp) {
      const recordsList = records(whatsApp.payload, 'whatsapp_dispatch_registry.json');
      report.imported.whatsappDispatchesValidated = recordsList.length;
      if (recordsList.length > 0) {
        report.warnings.push('WhatsApp dispatch rows were validated but not imported because dispatch/event tables are not in SQLite migration v1.');
      }
    }

    for (const deferred of ['exchange_rate_state.json', 'cash_box_shift_state.json']) {
      if (loaded.has(deferred)) {
        report.warnings.push(`${deferred} was detected but is not imported by this first dry-run version; rate/shift parity will be added before a complete-system migration.`);
      }
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
  }

  return report;
}
