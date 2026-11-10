# SQLite-backed authentication service — isolated phase

## Scope

This phase adds an SQLite-backed authentication service as an isolated implementation. It is not imported by server.ts and does not replace the currently active JSON AuthService.

## Persistence added

The next immutable SQLite migration creates auth_login_attempts. The table stores only a keyed HMAC digest of the account/IP lock identity, the failure count, the lock expiry timestamp, and the last update time. It does not store PINs or raw login credentials.

Login failure updates use a BEGIN IMMEDIATE transaction so concurrent requests cannot race the counter. An active lock is preserved across process restarts. Once a lock expires, the next failed login begins a new attempt window. Successful authentication clears the counter. Security events are written to security_events.

## Service behavior

The isolated SqliteAuthService uses the existing PBKDF2 parameters (100,000 rounds, SHA-256, 32-byte output), constant-time hash comparison, HS256 tokens, and a database lookup during token verification. The lookup checks that the account remains active and that identity, role, branch, and session version still match. Disabling an account or changing its PIN therefore invalidates its previous token when another service instance verifies it.

## Validation

Tests cover login and JWT verification, persistent lock state after closing and reopening the database, lock expiry, successful-login counter reset, session invalidation, malformed/tampered/expired tokens, and weak-PIN/owner protections.

## Explicit non-goal

The running Express server still imports the JSON AuthService. Do not switch the server to SqliteAuthService until the database path and secret lifecycle are unified, server HTTP integration tests are added, existing JSON account import is verified on the actual Windows device, and rollback behavior is approved. Financial services remain JSON-backed as well.
