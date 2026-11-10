# SQLite backup and restore hardening — 2026-11-10

## Encrypted backup format

`src/server/db/sqliteBackupRestore.ts` now publishes an authenticated encrypted backup envelope:
- AES-256-GCM with a fresh random 96-bit IV per backup.
- A 256-bit key is required as exactly 64 hexadecimal characters through `encryptionKeyHex`.
- The envelope stores a format marker, IV, authentication tag, and ciphertext. It never stores the key.
- SHA-256 is calculated over the complete encrypted envelope for transfer and operator verification. AES-GCM authentication rejects a modified file or incorrect key even when a matching SHA-256 is supplied.
- Restore verifies the expected SHA-256, authenticates/decrypts the envelope, checks SQLite integrity and foreign keys, then publishes only to a new destination path.
- Existing destinations and symbolic-link source files are refused.

The CLI is available through:

~~~bash
npm run sqlite:backup-restore -- backup --source-file "./exchange.sqlite" --destination-file "./backups/exchange-001.alnbackup"
~~~

Restore is deliberately restricted to a new destination and requires the operator to confirm that the application is stopped:

~~~bash
npm run sqlite:backup-restore -- restore --backup-file "./backups/exchange-001.alnbackup" --destination-file "./restore-check/exchange.sqlite" --expected-sha256 "<sha256-from-backup-report>" --server-stopped
~~~

Both commands require `ALNAMARI_SQLITE_BACKUP_KEY_HEX` in the process environment. The value must be a 64-character hexadecimal key. The key is not generated, logged, or stored automatically. Store and retain it separately using an approved secret-management process. Losing the key makes the encrypted backup unrecoverable. Never put it in Git, the backup directory, screenshots, or command history.

## Private file permissions

`src/server/security/privateFilePermissions.ts` applies owner-only POSIX mode 0600, verifies the mode, and on Windows resets inherited ACLs, disables inheritance, grants Full Control to the current user SID and LocalSystem, and checks the `icacls` command results. It is used for:
- JWT secret files;
- temporary SQLite backup/restore files;
- encrypted backup artifacts;
- JSON authentication-import backups and rollback-export files.

The SQLite snapshot is temporarily written as a private plaintext temp file before encryption because the SQLite online-backup API writes a database file. Normal completion removes it. An abrupt process termination can leave a private temporary file behind; inspect the backup directory after a crash and remove orphaned temp files only after confirming no backup/restore process is running.

## Compatibility and test coverage

The new restore function accepts only the AES-256-GCM `ALNDB001` envelope. Previous plaintext SQLite backup files are not accepted by this restore path; create a fresh encrypted backup before using the updated restore utility.

`tests/sqliteBackupRestore.test.ts` covers:
- consistent snapshots from WAL-mode databases;
- ciphertext format and absence of known plaintext table/row markers;
- restore to a new path with relational data parity;
- SHA-256 mismatch, wrong-key authentication failure, and legacy plaintext rejection;
- integrity and foreign-key checks;
- refusal to overwrite existing paths and malformed encryption keys.

The SQLite foundation workflow is configured for Ubuntu Node 22.16.0 and Windows Node 24.22.2. A successful code change is not considered validated until those workflow jobs complete successfully.

## Operational boundary — still not a live cutover

The helper restores to a new database file only. `--server-stopped` is an operator assertion, not an automated process detector. The utility does not:
- stop Express or an Electron process;
- capture and replace a live database plus its WAL/SHM files;
- change the application's configured database path;
- restart the application or run authenticated HTTP smoke tests after cutover;
- prove recovery from a real Windows power loss or an Electron EXE.

A production rehearsal must be performed against an isolated copy: stop the application, preserve the current database and sidecar files, restore to a separate path, run integrity/FK and application-level checks, and have an independently reviewed cutover and rollback procedure. No live database or customer records were read, backed up, restored, replaced, or migrated as part of this code change.

SQLite authentication remains opt-in and the normal server remains JSON-backed. Financial and remittance data remain JSON-backed. This phase does not authorize production SQLite activation or PR merge.
