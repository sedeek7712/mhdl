# SQLite backup and restore validation phase — 2026-11-10

## Implemented test utility

`src/server/db/sqliteBackupRestore.ts` adds a standalone SQLite database backup/restore utility using the Node `node:sqlite` online backup API (minimum Node.js 22.16.0).

Backup behavior:
- Requires an existing regular SQLite source file; symbolic links and directories are rejected.
- Requires a destination in an existing directory and refuses to replace an existing destination.
- Opens the source with query-only mode, then creates a consistent snapshot using SQLite's online backup API.
- Validates the output with `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.
- Computes SHA-256, flushes the output file, and publishes it with a create-if-absent filesystem link so a concurrent destination cannot be overwritten.

Restore behavior:
- Requires the caller to supply the expected SHA-256; a mismatch is rejected before restore.
- Validates the source backup as a SQLite database and runs integrity/FK checks.
- Restores through SQLite's backup API to a temporary file, validates and flushes that file, then publishes only to a destination that does not already exist.
- Does not overwrite or delete the source backup or any existing database.

The utility is not mounted as an application endpoint or invoked automatically at server startup. It is not a live database replacement tool. A production restore procedure must first stop the application, preserve the current database and WAL state, restore to a separate path, verify it, and only then perform an independently reviewed cutover.

## Automated test coverage

`tests/sqliteBackupRestore.test.ts` uses generated temporary SQLite databases and synthetic rows. It checks:
- Backup of a WAL-mode database and independent snapshot semantics.
- SHA-256 and file-size reporting.
- Restore to a new location with matching relational data.
- Integrity and foreign-key checks on the restored database.
- Refusal to overwrite existing backup and restore destinations.
- Rejection of checksum mismatch and corrupt SQLite input.

The test is included in `npm run test:storage` / CI and must pass on both the Ubuntu Node 22.16.0 and Windows Node 24.22.2 jobs.

## Explicit limitations and live-use blockers

- Backup files produced by this utility are **plaintext SQLite files**. SHA-256 detects accidental changes; it does not encrypt or authenticate a backup against an attacker who can replace both the file and the expected hash. Do not store these backups in shared folders, public cloud buckets, or untrusted removable media.
- Encrypted backup packaging, password/key lifecycle, Windows ACL verification, automatic retention/rotation, and application-level backup scheduling are not implemented here.
- The restore helper publishes to a new file and deliberately refuses to overwrite an existing database. It does not switch the running application to the restored file and does not prove a full Windows/Electron operational recovery.
- This is a code-level and CI test gate only. No actual customer data, production SQLite database, or live JSON store was backed up, restored, replaced, or migrated.
- SQLite authentication remains opt-in; JSON remains the default. Financial and remittance data are still JSON-backed.

Therefore this phase does not authorize production SQLite activation or PR merge by itself. Complete encrypted backup and restore, test Windows/Electron file permissions and process shutdown, rehearse an isolated full restore and rollback, and review the remaining issue register before any live rollout.
