# SQLite authentication import and rollback export — 2026-11-10

## Current runtime boundary

The JSON-backed AuthService remains the production default. SQLite authentication remains opt-in and is not mounted by the normal production server. The import/export tools do not change the active runtime or replace `data/system_users.local.json`.

## JSON to SQLite import

The tool imports the existing JSON authentication account set into SQLite `app_users`. It is a migration utility only.

Safety behavior:
- Dry-run is the default and always uses an in-memory SQLite database.
- A permanent import requires both the explicit `--apply` flag and an explicit `--database-file` path.
- The source file must be supplied explicitly with `--source-file`.
- It validates the supported user shape, role set, credential formats, and exactly one active owner.
- PIN salts, PIN hashes, IDs, usernames, roles, branch assignments, account status, `mustChangePin`, and `sessionVersion` are preserved.
- Permanent import creates a private, ACL-restricted backup beside the source file and verifies its SHA-256 checksum before SQLite import.
- User rows are imported in one `BEGIN IMMEDIATE` transaction. Import refuses an SQLite database that already contains user rows.
- The original JSON file remains read-only and is never deleted or rewritten.

Commands:

~~~bash
npm run migrate:sqlite:auth -- --source-file "./data/system_users.local.json"
npm run migrate:sqlite:auth -- --source-file "./data/system_users.local.json" --apply --database-file "./exchange.sqlite"
~~~

## SQLite to JSON rollback export

A reverse account export is now available:

~~~bash
npm run migrate:sqlite:auth:export -- --database-file "./exchange.sqlite" --output-file "./rollback/system_users.rollback.json" --server-stopped
~~~

The export:
- requires an existing regular SQLite file and an existing output directory;
- checks SQLite integrity and foreign-key consistency;
- refuses an empty user table or anything other than exactly one active owner;
- exports the complete legacy JSON user shape, including PIN salt/hash, role, branch, active state, `mustChangePin`, and timestamps;
- rotates every user's `sessionVersion` inside one SQLite transaction before returning the snapshot, invalidating tokens issued by the SQLite runtime as well as the tokens in the exported JSON snapshot;
- writes a new file with private permissions and refuses to overwrite an existing output;
- prints counts and a checksum, not credential material.

The `--server-stopped` flag is an operator assertion; the script does not detect or stop a running application. The generated file is not copied over `system_users.local.json`, and the application is not switched automatically. For a real rollback, stop the application, preserve the existing JSON file, export to a new path, verify the output, then have the operator perform the separately reviewed file replacement and restart procedure.

The export is limited to authentication user accounts. It does not export SQLite security-event history or convert financial/remittance data. The SQLite database remains available for forensic review, but its auth session versions are rotated by the export operation.

## What the migration tools do not prove

A successful export/import proves account-row preservation and database integrity at the point of execution. It does not by itself prove a full service rollback, HTTP authentication after restart, Windows/Electron process recovery, or parity of all security audit history. The JSON AuthService remains active by default, and no real customer data or production user file was used in the tests.

## Required before any live SQLite authentication cutover

1. Complete an isolated Windows restore and rollback rehearsal with the actual deployment account and NTFS volume.
2. Test login, token issuance, role enforcement, account disable/enable, PIN reset/change, and restart across processes.
3. Decide the supported desktop runtime. A Windows Node.js CI job is not an Electron EXE test.
4. Retain the JSON user file and a separately verified encrypted SQLite backup until the cutover is explicitly approved.
5. Keep PR #6 in Draft until security, Windows, restore, and production-readiness reviews are complete.
