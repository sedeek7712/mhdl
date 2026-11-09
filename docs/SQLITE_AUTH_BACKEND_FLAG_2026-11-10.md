# Explicit SQLite auth backend selection

The main HTTP server now supports a guarded, opt-in auth backend selection:

- Default: \`ALNAMARI_AUTH_BACKEND=json\` (or unset). The existing JSON-backed auth service and route handlers remain active.
- Opt-in: \`ALNAMARI_AUTH_BACKEND=sqlite\`. The application opens the path in \`ALNAMARI_SQLITE_DB_PATH\` (or the platform default), runs immutable migrations, validates SQLite integrity/foreign keys, and requires exactly one active owner before creating the SQLite-backed auth service.

When SQLite is selected, the server mounts the SQLite auth router at \`/api/auth\`. The shared \`requireAuth\` and \`requireRoles\` middleware then verify tokens against the selected backend, so non-authenticated route guards use the same active identity source. The server closes the SQLite connection when the HTTP server closes. CORS now advertises PATCH because employee activation uses a PATCH route.

## Preconditions before enabling

1. Back up the JSON user file and all application data.
2. Run the account import in dry-run mode and inspect the report.
3. Import only to the intended SQLite path with explicit \`--apply\`; do not mix existing user sets.
4. Verify exactly one active owner and all employees/branch assignments.
5. Set a stable \`JWT_SECRET\` in production. Development/test uses the shared persisted secret file.
6. Test startup, login, employee management, all role-gated financial routes, process restart, database restore, and a rollback to JSON on a separate copy before touching live data.

The default remains JSON. This feature flag does not migrate financial operations: the ledger, remittances, cashbox shifts, exchange rates, and other operational registries are still JSON-backed. Do not enable SQLite auth against a production installation until the account migration and Windows/Electron backup/restore rehearsal are complete.
