# Windows SQLite preflight — 2026-11-10

## Purpose

A read-only gate to run on the target Windows machine after a staged SQLite restore has been created and before a supervised synthetic rehearsal. It is not a cutover command and does not authorize production migration.

## Command

From the project directory in PowerShell:

```powershell
npm run sqlite:preflight -- --database-file "C:\ExchangeData\exchange.sqlite" --staged-file "C:\ExchangeData\staging\exchange-restored.sqlite" --expected-staged-sha256 "<restoredSha256-from-restore-report>" --archive-directory "C:\ExchangeData\recovery-archive-preflight"
```

The archive path must be new and its parent directory must already exist. The expected hash must be copied from the successful staged-restore report, not calculated from an unapproved file.

## Checks performed

- Current and staged paths exist as regular non-symlink files.
- The archive destination does not already exist and its parent exists.
- Current database, staged database, and archive parent resolve to the same filesystem.
- The staged database SHA-256 exactly matches the supplied restore report.
- Both databases pass read-only SQLite `integrity_check` and `foreign_key_check`.
- Windows process inspection looks for Node server processes referencing the database or server entrypoint and all Electron processes.
- `icacls.exe` reads the current DB, staged DB, and archive-parent ACLs. ACL results are emitted for human review; the tool does not certify or change permissions.

## Result interpretation

- `BLOCKED`: one or more hard checks failed. Do not proceed; fix the cause and rerun.
- `REVIEW_REQUIRED`: hard checks passed, but manual ACL review is still required. Do not proceed until the deployment operator reviews the ACL output and the operator checklist.
- `READY_FOR_SUPERVISED_REHEARSAL`: automated checks passed without warnings. This is permission to consider a supervised synthetic rehearsal only, not production cutover.

Exit code is 0 for non-blocked reports and 2 for blocked/error reports. Review the JSON report; do not infer success from the exit code alone.

## Mandatory manual checks

The process scan is deliberately conservative but cannot prove that every process is stopped. Before any rehearsal, the operator must manually verify that Express, workers, scheduled jobs, database viewers, backup agents, and any Electron process are stopped. Review NTFS ACLs for least privilege. Confirm the encrypted backup and its key are retrievable from the approved secret store. Keep all rehearsal data synthetic.

## Non-effects and limitations

This command is read-only. It does not stop processes, modify ACLs, create archive folders, checkpoint WAL, move files, restart the application, or perform HTTP smoke tests. It must not be used with customer data as a substitute for the supervised deployment procedure.
