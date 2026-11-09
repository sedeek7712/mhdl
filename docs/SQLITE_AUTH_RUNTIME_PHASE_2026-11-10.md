# Shared JWT secret and SQLite authentication runtime

## Shared secret lifecycle

The JSON AuthService and the isolated SQLite runtime now use the same JWT-secret helper and the same secret-file location rules. Production requires an explicitly configured secret of at least 32 characters and rejects placeholder/default values. Development/test creates a random 256-bit secret with exclusive file creation, fsync, restrictive file permissions, and read-back verification. A malformed or symbolic-link secret file fails closed; the code no longer silently falls back to an ephemeral key when disk persistence fails.

## SQLite runtime factory

The runtime factory requires the configured SQLite path (or platform default) to point to an existing regular file; it does not create a new database when the path is missing or points to a symbolic link/directory. It applies the immutable migrations, checks that exactly one active owner exists, runs SQLite integrity and foreign-key checks, and then creates the SqliteAuthService and isolated Express router. If any check fails, it closes the database and throws instead of accepting logins with a partial or unowned database.

## Important boundary

The runtime factory is not called from server.ts. The production server remains JSON-backed. No user import or live financial migration was run. Before server adoption, an explicit rollout plan must set the database path, back up the existing data, import the actual owner/staff set, verify token compatibility with the shared key on the Windows deployment, test service restart and restore, and retain a rollback route.
