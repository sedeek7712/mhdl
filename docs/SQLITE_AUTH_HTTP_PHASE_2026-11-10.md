# SQLite authentication HTTP router — opt-in server integration

The Express router is created by the SQLite auth runtime and mounted by `server.ts` at `/api/auth` when `ALNAMARI_AUTH_BACKEND=sqlite`. The default remains the existing JSON backend when the variable is unset or set to `json`.

The router exposes login, session lookup, PIN change, employee creation, employee activation/deactivation, employee PIN reset, user listing, and security-log listing. Its protected routes verify bearer tokens through the SQLite-backed service and enforce route-specific role checks. The server's shared `requireAuth` and `requireRoles` middleware also use the selected auth service for the non-auth application routes.

## Real server integration coverage

`tests/sqliteAuthServerIntegration.test.ts` starts the actual `server.ts` in a child process with `startServer({ port: 0, host: '127.0.0.1', useVite: false })`, a temporary SQLite database, a temporary application data directory, and test-only accounts. It sends real HTTP requests to verify:

- SQLite-backed login and `/api/auth/session`.
- A protected system route accepts the owner and denies the teller.
- Role denial is written to the SQLite security log.
- Employee listing does not expose PIN hashes or salts.
- Disabling a teller revokes an already issued token.
- After closing and restarting the actual server process, the owner token remains valid, the disabled teller remains disabled, and security events remain stored.

All account records and database contents in this test are generated temporary fixtures. The test does not import or modify any production user data.

## Remaining rollout boundary

Passing this test establishes the opt-in authentication path in the actual Express server; it does not authorize a production cutover. The default remains JSON, no live account import has been performed, and financial ledgers, remittances, cashbox shifts, and exchange rates remain JSON-backed. Windows/Electron backup-and-restore rehearsal and a reviewed account migration are still required before enabling SQLite authentication on a live installation.
