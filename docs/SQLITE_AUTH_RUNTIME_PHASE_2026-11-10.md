# Shared JWT secret and SQLite authentication runtime

## Shared secret lifecycle

The JSON AuthService and the SQLite runtime use the same JWT-secret helper and secret-file location rules. Production requires an explicitly configured secret of at least 32 characters and rejects placeholder/default values. Development/test creates a random 256-bit secret with exclusive file creation, fsync, restrictive file permissions, and read-back verification. A malformed or symbolic-link secret file fails closed; the code does not silently fall back to an ephemeral key when disk persistence fails.

## SQLite runtime factory and server selection

When `ALNAMARI_AUTH_BACKEND=sqlite`, `authService.ts` creates the SQLite runtime during module initialization. The runtime requires the configured database path (or platform default) to point to an existing regular file; it does not silently create a new database when the path is missing or points to a symbolic link/directory. It applies immutable migrations, checks for exactly one active owner, runs SQLite integrity and foreign-key checks, and only then creates the SQLite auth service and Express router. If a check fails, it closes the database and throws instead of accepting logins against a partial or unowned database.

`server.ts` mounts the selected SQLite router at `/api/auth`. Its shared authorization middleware verifies tokens against the selected auth service for the other protected application routes. The HTTP server closes the SQLite connection when it closes. The default backend remains JSON unless the explicit SQLite flag is set.

## What has and has not been verified

The real-server integration test now starts the actual Express server in a separate process against a temporary SQLite database. It exercises login, session validation, protected route role checks, persistent security events, user disablement/token revocation, and restart persistence. The test fixtures are synthetic and temporary; no real users or operational data have been migrated.

The feature flag does not migrate financial operations: the ledger, remittances, cashbox shifts, exchange rates, and other operational registries remain JSON-backed. Before any live rollout, back up the existing installation, dry-run and review the complete account import, rehearse backup/restore on the target Windows/Electron runtime, verify production secret handling, and test rollback to the JSON backend. Keep the default JSON backend until those gates are independently completed.
