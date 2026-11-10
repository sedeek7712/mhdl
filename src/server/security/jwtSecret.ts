import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPrivateFilePermissions } from './privateFilePermissions.js';

export function resolveJwtSecretFilePath(
  moduleDirectory: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const dataDirectory = env.NODE_ENV === 'test' && env.ALNAMARI_TEST_DATA_DIR
    ? path.resolve(env.ALNAMARI_TEST_DATA_DIR)
    : path.resolve(moduleDirectory, '../../../data');
  return path.resolve(dataDirectory, '.jwt_secret');
}

function readStoredSecret(secretFilePath: string): string {
  const stat = fs.lstatSync(secretFilePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('JWT secret file must be a regular file and cannot be a symbolic link.');
  }

  applyPrivateFilePermissions(secretFilePath);
  const stored = fs.readFileSync(secretFilePath, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(stored)) {
    throw new Error('JWT secret file is malformed. Refusing to replace or regenerate it automatically.');
  }
  return stored;
}

/**
 * Uses a configured secret in every environment when valid. Production requires
 * an explicit environment secret. Development/test stores one random 256-bit
 * key on disk with exclusive creation; failures are fatal rather than falling
 * back to an ephemeral key that would invalidate every session after restart.
 */
export function loadOrCreateJwtSecret(
  secretFilePath: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const configuredSecret = (env.JWT_SECRET || env.APP_SECRET || '').trim();

  if (env.NODE_ENV === 'production') {
    if (!configuredSecret || configuredSecret.length < 32 ||
        configuredSecret.includes('dev_mode') || configuredSecret.includes('default')) {
      throw new Error('FATAL SECURITY: JWT_SECRET or APP_SECRET must be explicitly configured in production with at least 32 characters.');
    }
    return configuredSecret;
  }

  if (configuredSecret.length >= 32) {
    return configuredSecret;
  }

  const resolvedPath = path.resolve(secretFilePath);
  try {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

    try {
      fs.lstatSync(resolvedPath);
      return readStoredSecret(resolvedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const generated = crypto.randomBytes(32).toString('hex');
    const temporaryPath = resolvedPath + '.tmp-' + crypto.randomUUID();
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
      applyPrivateFilePermissions(temporaryPath);
      fs.writeSync(descriptor, generated, 0, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;

      try {
        // Atomic create-if-absent publication: another process never sees a partial secret file.
        fs.linkSync(temporaryPath, resolvedPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          return readStoredSecret(resolvedPath);
        }
        throw error;
      }
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try {
        fs.unlinkSync(temporaryPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }

    const persisted = readStoredSecret(resolvedPath);
    if (persisted !== generated) {
      throw new Error('Persisted JWT secret did not match the generated key.');
    }
    return persisted;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown filesystem error.';
    throw new Error('Unable to securely load or persist the JWT signing secret: ' + detail);
  }
}
