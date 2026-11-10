import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  loadOrCreateJwtSecret,
  resolveJwtSecretFilePath,
} from '../src/server/security/jwtSecret.js';

test('creates one persistent 256-bit secret and reuses the exact same value', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-jwt-secret-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'private', '.jwt_secret');
  const env = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;

  const first = loadOrCreateJwtSecret(file, env);
  const second = loadOrCreateJwtSecret(file, env);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(second, first);
  assert.equal(fs.readFileSync(file, 'utf8'), first);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});

test('configured environment secret is shared without creating a local secret file', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-jwt-env-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, '.jwt_secret');
  const configured = 'configured-jwt-secret-that-is-at-least-32-characters';
  const result = loadOrCreateJwtSecret(file, {
    NODE_ENV: 'test',
    JWT_SECRET: configured,
  } as NodeJS.ProcessEnv);
  assert.equal(result, configured);
  assert.equal(fs.existsSync(file), false);
});

test('production refuses missing, weak, or placeholder secrets', () => {
  assert.throws(
    () => loadOrCreateJwtSecret('/tmp/unused-jwt-secret', { NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    /must be explicitly configured/
  );
  assert.throws(
    () => loadOrCreateJwtSecret('/tmp/unused-jwt-secret', {
      NODE_ENV: 'production',
      JWT_SECRET: 'too-short',
    } as NodeJS.ProcessEnv),
    /must be explicitly configured/
  );
  assert.throws(
    () => loadOrCreateJwtSecret('/tmp/unused-jwt-secret', {
      NODE_ENV: 'production',
      JWT_SECRET: 'default-placeholder-secret-which-is-long-enough',
    } as NodeJS.ProcessEnv),
    /must be explicitly configured/
  );
});

test('does not silently rotate a malformed existing secret file', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-jwt-bad-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, '.jwt_secret');
  fs.writeFileSync(file, 'not-a-valid-secret');
  assert.throws(
    () => loadOrCreateJwtSecret(file, { NODE_ENV: 'test' } as NodeJS.ProcessEnv),
    /malformed/
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'not-a-valid-secret');
});

test('resolves the same test data secret path used by the legacy auth service', () => {
  const resolved = resolveJwtSecretFilePath('/repo/src/server/services', {
    NODE_ENV: 'test',
    ALNAMARI_TEST_DATA_DIR: '/tmp/alnamari-test-data',
  } as NodeJS.ProcessEnv);
  assert.equal(resolved, path.resolve('/tmp/alnamari-test-data/.jwt_secret'));
});
