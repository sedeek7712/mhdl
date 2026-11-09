# SQLite user-account import — 2026-11-10

## Purpose and current boundary

This tool imports the existing JSON authentication account set into the SQLite app_users table. It is a migration utility only. It does not switch the live authentication service to SQLite, does not replace system_users.local.json, and does not change the runtime source of truth.

The normal application still authenticates against the JSON-backed AuthService. Do not remove or rename the source JSON file after running this utility.

## Safety behavior

- Dry-run is the default and always uses an in-memory SQLite database.
- A permanent import requires both the explicit --apply flag and an explicit --database-file path.
- The source file must be supplied explicitly with --source-file.
- The tool validates the supported user shape, role set, credential field formats, and exactly one active owner.
- Existing PIN salts, PIN hashes, user IDs, usernames, roles, branch assignments, account status, mustChangePin, and session versions are preserved.
- Permanent import creates a mode-restricted backup beside the source file and verifies its SHA-256 checksum before touching SQLite.
- User rows are imported in one BEGIN IMMEDIATE transaction by importSqliteUsers.
- Import refuses a SQLite database that already contains any user rows. It never merges user sets.
- The original JSON file is read-only and is not deleted or rewritten.
- The tool prints aggregate counts and a source checksum, not usernames, PIN hashes, or PIN salts.

## Commands

Safe in-memory dry-run:

~~~bash
npm run migrate:sqlite:auth -- --source-file "./data/system_users.local.json"
~~~

Explicit permanent import into a selected database:

~~~bash
npm run migrate:sqlite:auth -- --source-file "./data/system_users.local.json" --apply --database-file "./exchange.sqlite"
~~~

Use a new or already-migrated SQLite database whose app_users table is empty. Do not point this command at a production database until the backup/restore procedure and Windows runtime have been validated.

## What this tool does not prove

A successful import proves that the account records were stored and read back with matching user IDs and session versions, and that SQLite integrity checks passed. It does not prove login, JWT issuance, session revocation, persisted brute-force throttling, security-event retrieval, or restart behavior through the HTTP server. Those require a separate SQLite-backed AuthService integration with dedicated HTTP and restart tests.

## Required next stage

Before SQLite becomes the live authentication source:

1. Persist login throttling state and security events in SQLite.
2. Load the authoritative user record from SQLite during token verification, so changes invalidate old tokens across restarts and multiple server processes.
3. Make user creation, activation, PIN reset, and PIN change use the SQLite repository only.
4. Add integration tests for login, logout/session validation, disable/re-enable, reset/change PIN, concurrent updates, and process restart.
5. Keep JSON as a verified rollback source until the final cutover is explicitly approved.
