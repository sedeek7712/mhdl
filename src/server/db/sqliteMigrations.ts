import type { SqliteMigration } from './sqliteDatabase.js';

/**
 * Versioned, immutable SQLite schema migrations.
 *
 * Monetary amounts are stored as integer thousandths (1 unit = 1000).
 * Exchange rates are stored as integer millionths (1 rate unit = 1,000,000).
 * Never write JavaScript floating-point amounts directly into these columns.
 */
export const SQLITE_MIGRATIONS: SqliteMigration[] = [
  {
    version: 1,
    name: 'financial_core_ledger_remittances_rates_and_shifts',
    sql: `-- Financial core schema. Monetary amounts use thousandths; FX rates use millionths.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL CHECK (length(trim(name_ar)) > 0),
  account_type TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  category TEXT NOT NULL CHECK (category IN (
    'cash_box', 'bank', 'network', 'customer', 'capital',
    'exchange_profit', 'commission', 'operating_expense', 'remittance', 'operational'
  )),
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE account_balances (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  currency TEXT NOT NULL CHECK (currency IN ('YER_OLD', 'YER_NEW', 'SAR', 'USD')),
  balance_milli INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, currency)
) STRICT;

CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  entry_number TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  entry_time TEXT NOT NULL,
  description_ar TEXT NOT NULL,
  reference_type TEXT NOT NULL CHECK (reference_type IN (
    'exchange', 'transfer_payout', 'transfer_send', 'internal_transfer',
    'expense', 'manual_adjustment', 'transfer_reverse', 'opening'
  )),
  reference_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_id TEXT,
  is_balanced INTEGER NOT NULL CHECK (is_balanced = 1),
  idempotency_key TEXT UNIQUE,
  request_fingerprint TEXT,
  exchange_rate_micro INTEGER CHECK (exchange_rate_micro IS NULL OR exchange_rate_micro >= 0),
  gross_target_amount_milli INTEGER CHECK (gross_target_amount_milli IS NULL OR gross_target_amount_milli >= 0),
  target_amount_milli INTEGER CHECK (target_amount_milli IS NULL OR target_amount_milli >= 0),
  voucher_number TEXT,
  created_at TEXT NOT NULL,
  CHECK ((idempotency_key IS NULL AND request_fingerprint IS NULL) OR
         (idempotency_key IS NOT NULL AND length(trim(idempotency_key)) > 0 AND
          request_fingerprint IS NOT NULL AND length(request_fingerprint) = 64))
) STRICT;

CREATE TABLE journal_lines (
  entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK (line_number >= 1),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  account_name_ar_snapshot TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('YER_OLD', 'YER_NEW', 'SAR', 'USD')),
  debit_milli INTEGER NOT NULL CHECK (debit_milli >= 0),
  credit_milli INTEGER NOT NULL CHECK (credit_milli >= 0),
  note TEXT,
  PRIMARY KEY (entry_id, line_number),
  CHECK ((debit_milli > 0 AND credit_milli = 0) OR
         (credit_milli > 0 AND debit_milli = 0))
) STRICT;

CREATE INDEX idx_journal_entries_date ON journal_entries(entry_date, entry_time);
CREATE INDEX idx_journal_entries_reference ON journal_entries(reference_type, reference_id);
CREATE INDEX idx_journal_lines_account_currency ON journal_lines(account_id, currency);

CREATE TABLE idempotency_records (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, idempotency_key)
) STRICT;

CREATE TABLE remittance_settings (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  numbering_mode TEXT NOT NULL CHECK (numbering_mode IN ('automatic', 'manual')),
  prefix TEXT NOT NULL CHECK (length(trim(prefix)) > 0),
  next_sequence INTEGER NOT NULL CHECK (next_sequence >= 1),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_by_role TEXT NOT NULL,
  notes TEXT
) STRICT;

CREATE TABLE remittance_number_reservations (
  number_normalized TEXT PRIMARY KEY COLLATE NOCASE CHECK (length(trim(number_normalized)) > 0),
  number_original TEXT NOT NULL CHECK (length(trim(number_original)) > 0),
  registered_at TEXT NOT NULL,
  registered_by TEXT NOT NULL,
  numbering_mode TEXT NOT NULL CHECK (numbering_mode IN ('automatic', 'manual'))
) STRICT;

CREATE TABLE remittances (
  id TEXT PRIMARY KEY,
  transfer_number TEXT NOT NULL,
  transfer_number_normalized TEXT NOT NULL UNIQUE COLLATE NOCASE
    REFERENCES remittance_number_reservations(number_normalized) ON UPDATE RESTRICT ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('outgoing', 'incoming')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'available', 'paid', 'cancelled', 'refunded', 'pending')),
  sender_name TEXT NOT NULL,
  sender_phone TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL DEFAULT '',
  network_name TEXT NOT NULL,
  amount_milli INTEGER NOT NULL CHECK (amount_milli > 0),
  currency TEXT NOT NULL CHECK (currency IN ('YER_OLD', 'YER_NEW', 'SAR', 'USD')),
  fee_amount_milli INTEGER NOT NULL CHECK (fee_amount_milli >= 0),
  total_paid_milli INTEGER NOT NULL CHECK (total_paid_milli >= 0),
  branch_id TEXT,
  branch_name TEXT NOT NULL,
  teller_id TEXT,
  teller_name TEXT NOT NULL,
  teller_role TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  recipient_id_type TEXT,
  recipient_id_number TEXT,
  voucher_number TEXT,
  journal_entry_reference TEXT REFERENCES journal_entries(entry_number) ON UPDATE RESTRICT ON DELETE RESTRICT,
  cash_movement_reference TEXT,
  payout_record_id TEXT,
  numbering_mode TEXT CHECK (numbering_mode IS NULL OR numbering_mode IN ('automatic', 'manual')),
  idempotency_key TEXT UNIQUE,
  notes TEXT
) STRICT;

CREATE INDEX idx_remittances_created ON remittances(created_at);
CREATE INDEX idx_remittances_status ON remittances(status, direction);

CREATE TABLE remittance_payouts (
  idempotency_key TEXT UNIQUE,
  transfer_id TEXT NOT NULL,
  transfer_number_normalized TEXT NOT NULL UNIQUE
    REFERENCES remittances(transfer_number_normalized) ON UPDATE RESTRICT ON DELETE RESTRICT,
  recipient_id_type TEXT NOT NULL,
  recipient_id_number TEXT NOT NULL,
  teller_id TEXT NOT NULL,
  teller_name TEXT NOT NULL,
  teller_role TEXT NOT NULL,
  amount_milli INTEGER NOT NULL CHECK (amount_milli > 0),
  currency TEXT NOT NULL CHECK (currency IN ('YER_OLD', 'YER_NEW', 'SAR', 'USD')),
  paid_at TEXT NOT NULL,
  voucher_number TEXT NOT NULL,
  journal_entry_reference TEXT NOT NULL REFERENCES journal_entries(entry_number) ON UPDATE RESTRICT ON DELETE RESTRICT,
  cash_movement_reference TEXT,
  manager_override INTEGER NOT NULL DEFAULT 0 CHECK (manager_override IN (0, 1)),
  manager_override_by TEXT,
  manager_override_reason TEXT
) STRICT;

CREATE TABLE remittance_audit_logs (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('remittance_numbering', 'security', 'financial', 'reconciliation')),
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  user_role TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT
) STRICT;

CREATE TABLE exchange_rates (
  id TEXT PRIMARY KEY,
  from_currency TEXT NOT NULL CHECK (from_currency IN ('YER_OLD', 'YER_NEW', 'SAR', 'USD')),
  to_currency TEXT NOT NULL CHECK (to_currency IN ('YER_OLD', 'YER_NEW', 'SAR', 'USD')),
  buy_rate_micro INTEGER NOT NULL CHECK (buy_rate_micro >= 0),
  sell_rate_micro INTEGER NOT NULL CHECK (sell_rate_micro >= 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (from_currency, to_currency),
  CHECK (from_currency <> to_currency)
) STRICT;

CREATE TABLE exchange_rate_audit (
  id TEXT PRIMARY KEY,
  rate_id TEXT NOT NULL REFERENCES exchange_rates(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  old_buy_rate_micro INTEGER NOT NULL CHECK (old_buy_rate_micro >= 0),
  new_buy_rate_micro INTEGER NOT NULL CHECK (new_buy_rate_micro >= 0),
  old_sell_rate_micro INTEGER NOT NULL CHECK (old_sell_rate_micro >= 0),
  new_sell_rate_micro INTEGER NOT NULL CHECK (new_sell_rate_micro >= 0),
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_by_id TEXT NOT NULL,
  note TEXT NOT NULL CHECK (length(trim(note)) > 0)
) STRICT;

CREATE TABLE cashier_shifts (
  id TEXT PRIMARY KEY,
  box_id TEXT NOT NULL,
  box_name_ar TEXT NOT NULL,
  teller_id TEXT NOT NULL,
  teller_name TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  notes TEXT,
  opened_by_role TEXT NOT NULL,
  closed_by TEXT,
  closed_by_id TEXT,
  open_idempotency_key TEXT NOT NULL UNIQUE,
  close_idempotency_key TEXT UNIQUE
) STRICT;

CREATE UNIQUE INDEX idx_single_open_shift_per_box
  ON cashier_shifts(box_id) WHERE status = 'open';

CREATE TABLE cashier_shift_balances (
  shift_id TEXT NOT NULL REFERENCES cashier_shifts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  balance_kind TEXT NOT NULL CHECK (balance_kind IN ('opening', 'expected', 'actual', 'discrepancy')),
  currency TEXT NOT NULL CHECK (currency IN ('YER_OLD', 'YER_NEW', 'SAR', 'USD')),
  amount_milli INTEGER NOT NULL,
  PRIMARY KEY (shift_id, balance_kind, currency)
) STRICT;

CREATE TABLE cashier_shift_events (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES cashier_shifts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('opened', 'closed', 'recounted', 'variance_noted')),
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  details TEXT
) STRICT;`,
  },
  {
    version: 2,
    name: 'operational_parity_users_whatsapp_and_shift_replay',
    sql: `-- v2 extends the immutable v1 schema without rewriting migration history.
ALTER TABLE cashier_shifts ADD COLUMN open_request_fingerprint TEXT;
ALTER TABLE cashier_shifts ADD COLUMN close_request_fingerprint TEXT;

CREATE TABLE app_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(username)) BETWEEN 3 AND 32),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  role TEXT NOT NULL CHECK (role IN (
    'owner', 'general_manager', 'branch_manager', 'teller',
    'auditor', 'accountant', 'compliance_officer'
  )),
  branch_id TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  pin_salt TEXT NOT NULL CHECK (length(pin_salt) = 32),
  pin_hash TEXT NOT NULL CHECK (length(pin_hash) = 64),
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  must_change_pin INTEGER NOT NULL CHECK (must_change_pin IN (0, 1)),
  session_version TEXT NOT NULL CHECK (length(session_version) = 32),
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_app_users_single_owner
  ON app_users(role) WHERE role = 'owner';

CREATE TABLE security_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'LOGIN_SUCCESS', 'LOGIN_FAILED', 'ROLE_ACCESS_DENIED',
    'RATE_LIMIT_EXCEEDED', 'BRUTE_FORCE_BLOCKED'
  )),
  username_or_role TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  details TEXT NOT NULL
) STRICT;

CREATE INDEX idx_security_events_occurred_at ON security_events(occurred_at);

CREATE TABLE whatsapp_dispatches (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  voucher_number TEXT NOT NULL,
  voucher_type TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),
  meta_media_id TEXT,
  whatsapp_message_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'GENERATING', 'GENERATED', 'UPLOADING', 'UPLOADED',
    'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RETRY_PENDING'
  )),
  caption TEXT NOT NULL,
  created_at TEXT NOT NULL,
  uploaded_at TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  failed_at TEXT,
  attempts_count INTEGER NOT NULL CHECK (attempts_count >= 0),
  last_error TEXT,
  employee_id TEXT,
  employee_name TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
) STRICT;

CREATE INDEX idx_whatsapp_dispatch_voucher ON whatsapp_dispatches(voucher_number);
CREATE INDEX idx_whatsapp_dispatch_transaction ON whatsapp_dispatches(transaction_id);
CREATE INDEX idx_whatsapp_dispatch_status ON whatsapp_dispatches(status, created_at);

CREATE TABLE whatsapp_webhook_events (
  id TEXT PRIMARY KEY,
  dispatch_id TEXT NOT NULL REFERENCES whatsapp_dispatches(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  message_id TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  occurred_at TEXT NOT NULL,
  recipient_id TEXT,
  raw_event_json TEXT NOT NULL CHECK (json_valid(raw_event_json))
) STRICT;

CREATE INDEX idx_whatsapp_webhook_message ON whatsapp_webhook_events(message_id, occurred_at);

CREATE TABLE voucher_attachments (
  id TEXT PRIMARY KEY,
  dispatch_id TEXT NOT NULL UNIQUE REFERENCES whatsapp_dispatches(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  voucher_number TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_voucher_attachments_voucher ON voucher_attachments(voucher_number);
`,
  },

  {
    version: 3,
    name: 'journal_customer_phone_provenance',
    sql: `-- v3 preserves the customer phone bound to a server-generated exchange journal.
ALTER TABLE journal_entries ADD COLUMN customer_phone TEXT
  CHECK (customer_phone IS NULL OR length(customer_phone) <= 40);
`,
  },
  {
    version: 4,
    name: 'persistent_auth_login_throttling',
    sql: "CREATE TABLE auth_login_attempts (\n" +
      "  attempt_key TEXT PRIMARY KEY CHECK (length(attempt_key) = 64),\n" +
      "  attempts INTEGER NOT NULL CHECK (attempts >= 0),\n" +
      "  lock_until_ms INTEGER NOT NULL DEFAULT 0 CHECK (lock_until_ms >= 0),\n" +
      "  updated_at TEXT NOT NULL\n" +
      ") STRICT;\n" +
      "CREATE INDEX idx_auth_login_attempts_lock_until ON auth_login_attempts(lock_until_ms);\n",
  },
];
