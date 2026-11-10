# SQLite offline recovery and cutover runbook — 2026-11-10

## Purpose and scope

This runbook describes how to promote a separately restored SQLite file into a configured SQLite database path, preserve the previous database and its sidecar files, and roll back to the exact pre-cutover file set.

**Important current product boundary:** the active Express application still uses JSON-backed services. The SQLite authentication runtime is opt-in and is not mounted by the normal production server. This runbook does not migrate the current JSON application, switch Express to SQLite, or prove that a production database is currently in use. Use it only for a separately approved SQLite deployment or an isolated rehearsal.

## Safety requirements

1. Use a maintenance window and close every process that could access the target SQLite database. This includes the application, background workers, scheduled jobs, database viewers, and any Electron process if one is introduced.
2. Confirm that those processes are stopped before passing `--server-stopped`. The flag is an operator assertion; the CLI does not inspect or terminate Windows processes.
3. Keep the current database, staged restore, and recovery archive on the same filesystem/volume. The operation refuses cross-volume moves.
4. Use a new, non-existing archive directory. Never reuse an old archive directory.
5. Keep the encrypted source backup and its 32-byte key separately. Do not commit the key to Git or place it inside the recovery archive.
6. Do not delete the recovery archive after success. It contains the old database copies, displaced originals, manifest, and any staged sidecars retained during cutover.

## 1. Configure the backup encryption key

In PowerShell, load the approved 64-hex-character key from the organization's secret store into the current process environment:

```powershell
$env:ALNAMARI_SQLITE_BACKUP_KEY_HEX = "<64-hex-character-key-from-your-secret-store>"
```

Do not put a real key in source files, a committed `.env` file, tickets, screenshots, or shell history. Losing this key makes the encrypted backup unrecoverable.

## 2. Create an encrypted backup

Example:

```powershell
npm run sqlite:backup-restore -- backup --source-file "C:\ExchangeData\exchange.sqlite" --destination-file "C:\ExchangeBackups\exchange-before-cutover.alnbackup"
```

Record the `sha256` value returned by the command. This checksum identifies the complete encrypted backup envelope; AES-256-GCM also authenticates the encrypted content.

The backup uses SQLite's online backup API. It is designed to produce a consistent snapshot even when the source database is in WAL mode.

## 3. Restore to a separate staged path

Stop the application first, then restore to a new path that does not exist:

```powershell
npm run sqlite:backup-restore -- restore --backup-file "C:\ExchangeBackups\exchange-before-cutover.alnbackup" --destination-file "C:\ExchangeData\staging\exchange-restored.sqlite" --expected-sha256 "<sha256-from-backup-output>" --server-stopped
```

Record the `restoredSha256` value from the restore report. The restore command verifies the supplied SHA-256, AES-256-GCM authentication and key, SQLite integrity, foreign keys, and creation of a separate destination file. It does not overwrite the current database.

## 4. Promote the staged database (offline cutover)

Before proceeding, verify again that every process using the database is stopped. Use a new archive directory on the same volume:

```powershell
npm run sqlite:recovery -- cutover --database-file "C:\ExchangeData\exchange.sqlite" --staged-file "C:\ExchangeData\staging\exchange-restored.sqlite" --expected-staged-sha256 "<restoredSha256-from-restore-output>" --archive-directory "C:\ExchangeData\recovery-archive-2026-11-10-01" --server-stopped
```

The command rejects a staged hash mismatch, symbolic-link paths, invalid SQLite files, and cross-volume moves. It then checkpoints the staged database, creates a private recovery archive, checksums copies of the current database/WAL/SHM/rollback-journal files, writes a recovery manifest, checkpoints the current WAL, moves sidecars away from the live path, promotes the staged database, and verifies integrity and foreign keys.

The recovery archive contains:

- `originals/`: private verified copies of the original database and sidecars;
- `displaced/`: original paths moved out of the way during cutover;
- `staged-sidecars/`: sidecars produced by the staged restore/checkpoint;
- `failed-cutovers/`: files preserved for diagnosis if cutover or rollback encounters an incomplete state;
- `recovery-manifest.json`: paths, checksums, file-existence state, and recovery status.

Do not manually rename, delete, or edit files inside the archive while the operation is active.

## 5. Roll back to the pre-cutover database

If post-cutover application checks fail, stop every process using the database again. Then run:

```powershell
npm run sqlite:recovery -- rollback --manifest-file "C:\ExchangeData\recovery-archive-2026-11-10-01\recovery-manifest.json" --server-stopped
```

Rollback validates the manifest and archived paths, preserves the current failed/promoted files under `failed-cutovers/`, restores the original sidecars and main database from checksum-verified archive files, and verifies the restored database checksum. It refuses to overwrite unexpected files and refuses to run without the operator's stopped-server confirmation.

If the command reports that automatic rollback failed, keep the application stopped. Do not delete or improvise with the archive; use the manifest and retained files for a separately reviewed recovery.

## 6. Run an isolated rehearsal

This command creates synthetic SQLite databases in a temporary operating-system directory, creates an encrypted backup, restores it to a staged file, performs cutover, verifies the staged data, rolls back, and verifies that the original synthetic data is restored:

```powershell
npm run sqlite:recovery -- rehearse
```

It requires `ALNAMARI_SQLITE_BACKUP_KEY_HEX`. It does not accept database paths and does not read customer data. Temporary rehearsal files are removed when the command finishes.

## Automated verification

The recovery module is included in `npm run test:storage`.

- GitHub Actions run `42736899947` — Ubuntu Node 22.16.0: **97/97 tests passed**, TypeScript passed, production build passed.
- The same run on Windows Node 24.22.2: **97/97 tests passed**, TypeScript passed, production build passed.
- The 97-test suite includes the end-to-end `sqlite:recovery -- rehearse` CLI test using synthetic data, encrypted backup, staged restore, cutover, rollback, and temporary-workspace cleanup.
- GitHub Actions run `42736899956`: the full storage-safety workflow passed, including internal transfers, chart reconciliation, expenses, remittances, exchange accounting/rates, shifts, HTTP integration, TypeScript, and production build.

Hosted CI verifies code paths on GitHub runners. It is not a substitute for a rehearsal on the actual target Windows machine using the actual deployment account, folder ACL policy, and real service shutdown process.

## Remaining limits

- No code automatically stops or detects Express, worker, or Electron processes. The operator must close them before running cutover/rollback.
- This implementation does not restart the application or run authenticated HTTP/user-acceptance checks after cutover.
- Electron packaging/runtime integration is not present in the repository and is not tested by this runbook.
- The current Express server still uses JSON-backed services by default. No production SQLite database has been activated or switched by this work.
- The runbook does not migrate financial JSON files or prove accounting balance parity. Those remain separate migration/release gates.