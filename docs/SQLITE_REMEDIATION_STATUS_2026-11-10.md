# SQLite security remediation status — 2026-11-10

Repository: `sedeek7712/mhdl`  
Working branch: `storage/sqlite-parity-v2-2026-11-10`  
Pull request: #6 — Draft, not merged

This document tracks the five blockers identified during the security review. It does not authorize a production rollout.

## B1 — Plaintext SQLite backup

**Implemented and CI-verified on code commit `e91b04cd974b6d91bb611d9693a3c33d89cd0e2c`.**

- SQLite backup artifacts now use AES-256-GCM with a fresh IV and authenticated tag.
- A 32-byte key is mandatory and supplied through `ALNAMARI_SQLITE_BACKUP_KEY_HEX`; no default key is generated or embedded.
- SHA-256 is retained as a transport/operator checksum, while GCM provides cryptographic authentication.
- Restore rejects plaintext/legacy files, bad checksums, and incorrect keys, and it publishes only to a new destination.
- Added a CLI for backup and restore.

**Remaining controls:** select and document the real production key-management method and test key custody/recovery with the deployment operator. Hosted CI does not prove key retention and recovery procedures on the target machine. The key must be stored separately from the encrypted backups.

## B2 — Sensitive file permissions on Windows

**Implemented and CI-verified on Ubuntu and Windows hosted runners on code commit `e91b04cd974b6d91bb611d9693a3c33d89cd0e2c`.**

- Added a shared private-file helper.
- POSIX files are set to mode 0600 and the resulting mode is checked.
- Windows files have inherited ACLs reset, inheritance disabled, Full Control granted to the current user SID and LocalSystem, and `icacls` failures are fatal.
- Applied to JWT secret files, SQLite backup/restore temporary files, encrypted backup artifacts, and authentication import/rollback export files.

**Remaining controls:** rehearse the helper under the actual deployment account and NTFS folder policy. The hosted Windows runner passed; this does not prove the target machine's account and folder ACL configuration.

## B3 — Offline operational restore, cutover, and rollback

**Offline cutover/rollback tooling implemented and CI-verified; production-machine rehearsal remains open.**

- Added `src/server/db/sqliteRecovery.ts` with guarded cutover and rollback operations.
- Cutover requires the staged restore SHA-256 reported by the restore command, checks the file again before moving anything, verifies SQLite integrity/FKs, and refuses cross-filesystem paths.
- The current database and any WAL/SHM/rollback-journal sidecars are copied into a private archive with SHA-256 verification before cutover. A recovery manifest is written before live-path changes.
- The current WAL is checkpointed only after its original bytes are archived. Staged database sidecars are checkpointed and archived separately so files from two databases cannot be mixed.
- The staged database is promoted only after the sidecar handling and old database displacement. The promoted database is checked again.
- Rollback validates the manifest paths and checksums, preserves failed/promoted files under `failed-cutovers/`, restores the original database and sidecar set, and verifies the restored database checksum.
- Added `npm run sqlite:recovery -- rehearse`, an end-to-end synthetic-data rehearsal that creates an encrypted backup, restores to a staged path, cuts over, verifies the promoted data, rolls back, verifies the original synthetic data, and removes its temporary workspace.
- Added `docs/SQLITE_RECOVERY_RUNBOOK_2026-11-10.md` with PowerShell commands for backup, staged restore, cutover, and rollback.

**Remaining operational boundary:** `--server-stopped` is an operator assertion, not process detection or shutdown. The CLI does not restart Express/Electron or run application-level HTTP smoke tests after promotion. The actual target Windows machine, deployment account, NTFS policy, and any packaged Electron EXE still require a supervised rehearsal. The existing Express application remains JSON-backed by default; this work did not switch its active database or migrate real data.

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

## CI evidence

Latest B3 code/test state: branch head associated with GitHub Actions run `42736899947` (#261) and general workflow run `42736899956` (#647).

- `Verify storage safety and build`, run `42736899956` (#647): passed. Storage safety, internal transfers, chart reconciliation, operating expenses, remittances, exchange accounting/rates, server exchange, cashier shifts, authenticated HTTP, TypeScript, and production build all passed.
- `Validate SQLite foundation`, run `42736899947` (#261): Ubuntu Node 22.16.0 passed **97/97 tests**, TypeScript, and production build; Windows Node 24.22.2 passed **97/97 tests**, TypeScript, and production build.
- The 97-test suite includes the recovery CLI rehearsal against synthetic data, staged hash mismatch protection, cutover, exact rollback, and manifest-path tamper protection.
- These are GitHub-hosted CI results. They do not replace a supervised rehearsal on the actual deployment Windows machine/account or a packaged Electron executable.

## Release gate

- Keep PR #6 in Draft.
- Keep `main` unchanged.
- Keep JSON as the active authentication source.
- Do not activate SQLite against real data.
- Do not use a real customer database for migration or restore rehearsal.
- B1/B2 CI checks passed on Ubuntu and Windows hosted runners.
- Do not merge until B3 has a separately reviewed operational runbook and recovery rehearsal. Resolve B5 before describing the product as an Electron desktop application.
