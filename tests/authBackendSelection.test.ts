import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { openSqliteDatabase, runSqliteMigrations } from '../src/server/db/sqliteDatabase.js';
import { SQLITE_MIGRATIONS } from '../src/server/db/sqliteMigrations.js';
import { importSqliteUsers, type SqliteUserRecord } from '../src/server/db/sqliteAuthRepository.js';
import { hashSqliteAuthPin } from '../src/server/services/sqliteAuthService.js';

test('explicit ALNAMARI_AUTH_BACKEND=sqlite selects SQLite and works with shared HTTP authorization middleware', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-auth-backend-'));
  const databaseFile = path.join(directory, 'exchange.sqlite');
  const previous = {
    backend: process.env.ALNAMARI_AUTH_BACKEND,
    database: process.env.ALNAMARI_SQLITE_DB_PATH,
    jwtSecret: process.env.JWT_SECRET,
    appSecret: process.env.APP_SECRET,
    nodeEnv: process.env.NODE_ENV,
    testData: process.env.ALNAMARI_TEST_DATA_DIR,
  };
  let selectedModule: typeof import('../src/server/services/authService.js') | undefined;
  let httpServer: any;

  t.after(async () => {
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error: Error | undefined) => error ? reject(error) : resolve());
      });
    }
    selectedModule?.closeAuthService();
    for (const [key, value] of Object.entries({
      ALNAMARI_AUTH_BACKEND: previous.backend,
      ALNAMARI_SQLITE_DB_PATH: previous.database,
      JWT_SECRET: previous.jwtSecret,
      APP_SECRET: previous.appSecret,
      NODE_ENV: previous.nodeEnv,
      ALNAMARI_TEST_DATA_DIR: previous.testData,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const salt = crypto.randomBytes(16).toString('hex');
  const owner: SqliteUserRecord = {
    id: 'backend-selector-owner',
    username: 'backend_owner',
    name: 'مالك اختيار الخلفية',
    role: 'owner',
    branchId: 'branch-main',
    branchName: 'الفرع الرئيسي',
    pinSalt: salt,
    pinHash: hashSqliteAuthPin('849263', salt),
    isActive: true,
    mustChangePin: false,
    sessionVersion: crypto.randomBytes(16).toString('hex'),
    createdAt: new Date().toISOString(),
  };

  const seedDb = openSqliteDatabase({ filePath: databaseFile });
  runSqliteMigrations(seedDb, SQLITE_MIGRATIONS);
  importSqliteUsers(seedDb, [owner]);
  seedDb.close();

  process.env.NODE_ENV = 'test';
  process.env.ALNAMARI_TEST_DATA_DIR = directory;
  process.env.ALNAMARI_AUTH_BACKEND = 'sqlite';
  process.env.ALNAMARI_SQLITE_DB_PATH = databaseFile;
  process.env.JWT_SECRET = 'backend-selector-test-secret-with-more-than-32-characters';
  delete process.env.APP_SECRET;

  selectedModule = await import('../src/server/services/authService.js');
  assert.equal(selectedModule.authBackend, 'sqlite');
  assert.equal(typeof selectedModule.sqliteAuthRouter, 'function');

  const login = selectedModule.authService.authenticateUser('backend_owner', '849263', '127.0.0.1');
  assert.equal(login.success, true);
  assert.equal(selectedModule.authService.verifyToken(login.token as string)?.userId, owner.id);

  // Exercise the same shared middleware used by protected routes in server.ts,
  // not only the isolated /api/auth router's private middleware.
  const app = express();
  app.get('/api/owner-only', selectedModule.requireAuth, selectedModule.requireRoles(['owner']), (req, res) => {
    return res.status(200).json({ user: (req as any).user });
  });
  app.get('/api/teller-only', selectedModule.requireAuth, selectedModule.requireRoles(['teller']), (_req, res) => {
    return res.sendStatus(204);
  });
  httpServer = await new Promise<any>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = 'http://127.0.0.1:' + address.port;
  const headers = { Authorization: 'Bearer ' + login.token };

  const ownerRoute = await fetch(baseUrl + '/api/owner-only', { headers });
  assert.equal(ownerRoute.status, 200);
  const ownerRouteBody = await ownerRoute.json() as any;
  assert.equal(ownerRouteBody.user.id, owner.id);
  assert.equal(ownerRouteBody.user.role, 'owner');

  const deniedRoute = await fetch(baseUrl + '/api/teller-only', { headers });
  assert.equal(deniedRoute.status, 403);
  assert.equal(
    selectedModule.authService.getSecurityLogs().some((entry) => entry.event === 'ROLE_ACCESS_DENIED'),
    true
  );
});
