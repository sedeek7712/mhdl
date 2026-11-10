# SQLite security remediation status — 2026-11-10

Repository: `sedeek7712/mhdl`  
Working branch: `storage/sqlite-parity-v2-2026-11-10`  
Pull request: #6 — Draft, not merged

This document tracks the five blockers identified during the security review. It does not authorize a production rollout.

## B1 — Plaintext SQLite backup

**Code remediation implemented; CI verification pending.**

- SQLite backup artifacts now use AES-256-GCM with a fresh IV and authenticated tag.
- A 32-byte key is mandatory and supplied through `ALNAMARI_SQLITE_BACKUP_KEY_HEX`; no default key is generated or embedded.
- SHA-256 is retained as a transport/operator checksum, while GCM provides cryptographic authentication.
- Restore rejects plaintext/legacy files, bad checksums, and incorrect keys, and it publishes only to a new destination.
- Added a CLI for backup and restore.

**Remaining controls:** select and document the real production key-management method, test key custody/recovery with the deployment operator, and run both CI jobs successfully. The key must be stored separately from the encrypted backups.

## B2 — Sensitive file permissions on Windows

**Code remediation implemented; Windows CI verification pending.**

- Added a shared private-file helper.
- POSIX files are set to mode 0600 and the resulting mode is checked.
- Windows files have inherited ACLs reset, inheritance disabled, Full Control granted to the current user SID and LocalSystem, and `icacls` failures are fatal.
- Applied to JWT secret files, SQLite backup/restore temporary files, encrypted backup artifacts, and authentication import/rollback export files.

**Remaining controls:** verify the Windows job passes under the actual deployment account and NTFS volume. CI execution under GitHub's hosted Windows runner is not a substitute for checking the target machine's account and folder policy.

## B3 — Operational restore and cutover

**Partially addressed; still open.**

- Restore verifies checksum, GCM authentication, SQLite integrity, and foreign keys, then writes a new database file without overwriting the source.
- The CLI requires an explicit `--server-stopped` assertion for restore.

**Not implemented:** automatic server shutdown, WAL/SHM preservation and controlled replacement, application database-path switch, process restart, post-restart HTTP smoke tests, or a full Windows recovery rehearsal. The flag is not a process detector. Do not call this a complete operational recovery procedure.

## B4 — SQLite authentication rollback to JSON

**Account-data export implemented; full application rollback remains a manual operation.**

- Added `migrate:sqlite:auth:export` to create a new private JSON file compatible with the legacy AuthService.
- The export validates SQLite integrity/FKs and exactly one active owner.
- Every `sessionVersion` is rotated inside one SQLite transaction before export, revoking previously issued SQLite tokens.
- The tool does not replace `system_users.local.json` and refuses to overwrite the requested output.
- The user must stop the server and perform the separately reviewed file replacement/restart procedure.

**Remaining boundary:** this is an authentication-user export only. It does not export SQLite security-event history, and it does not reverse financial/remittance data. Those operational domains are still JSON-backed.

## B5 — Electron packaging and execution

**Not addressed; scope decision required.**

The current `package.json` has no Electron dependency, main process, packaging scripts, or EXE build workflow. Windows Node.js CI does not prove Electron behavior. Electron was not added as a speculative dependency because packaging changes the application's runtime and security boundary.

Before claiming Electron support, define whether Electron is the required desktop target, then implement and test its main process, secure IPC, local database path/permissions, installer, update strategy, signing, shutdown, backup and restore, and a real packaged EXE on Windows.

## Release gate

- Keep PR #6 in Draft.
- Keep `main` unchanged.
- Keep JSON as the active authentication source.
- Do not activate SQLite against real data.
- Do not use a real customer database for migration or restore rehearsal.
- Do not merge until B1/B2 CI passes and B3 has a separately reviewed operational runbook and rehearsal. Resolve B5 before describing the product as an Electron desktop application.
