# SQLite authentication HTTP router — isolated test stage

This phase adds an Express router factory backed exclusively by SqliteAuthService. It is not mounted by server.ts and does not replace the currently active JSON authentication routes.

The router mirrors the current auth endpoint contract for login, session lookup, PIN change, employee creation, employee activation/deactivation, employee PIN reset, user listing, and security-log listing. Every protected route verifies the bearer token through the SQLite-backed service. Each administrative route has its own role gate.

The HTTP integration test starts a temporary Express server and a temporary SQLite database. It exercises real fetch requests for login, RBAC denial, employee creation, disable/revocation, PIN reset/reactivation, PIN change, and security-log access.

This remains an isolated compatibility stage. Before mounting it in the production server, the host must establish a single stable SQLite path, run migrations before accepting requests, import and reconcile the complete owner/staff account set, unify JWT secret lifecycle, and exercise the migration/restart/restore process on the target Windows/Electron runtime. The current server remains JSON-backed.
