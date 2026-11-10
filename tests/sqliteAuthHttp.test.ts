import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { openSqliteDatabase, runSqliteMigrations } from '../src/server/db/sqliteDatabase.js';
import { SQLITE_MIGRATIONS } from '../src/server/db/sqliteMigrations.js';
import { insertSqliteUser } from '../src/server/db/sqliteAuthRepository.js';
import { createSqliteAuthRouter } from '../src/server/routes/sqliteAuthRoutes.js';
import { hashSqliteAuthPin, SqliteAuthService } from '../src/server/services/sqliteAuthService.js';
import type { SqliteUserRecord } from '../src/server/db/sqliteAuthRepository.js';

const SECRET = 'sqlite-auth-http-test-secret-at-least-32-characters';
const OWNER_PIN = '849263';
const TELLER_PIN = '739152';

function createOwner(): SqliteUserRecord {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id: 'owner-http-sqlite',
    username: 'owner_http',
    name: 'مالك HTTP',
    role: 'owner',
    branchId: 'branch-main',
    branchName: 'الفرع الرئيسي',
    pinSalt: salt,
    pinHash: hashSqliteAuthPin(OWNER_PIN, salt),
    isActive: true,
    mustChangePin: false,
    sessionVersion: crypto.randomBytes(16).toString('hex'),
    createdAt: new Date().toISOString(),
  };
}

test('SQLite auth HTTP routes enforce login, RBAC, employee lifecycle, and session revocation', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-sqlite-auth-http-'));
  const databaseFile = path.join(directory, 'auth.sqlite');
  const db = openSqliteDatabase({ filePath: databaseFile });
  runSqliteMigrations(db, SQLITE_MIGRATIONS);
  insertSqliteUser(db, createOwner());

  const service = new SqliteAuthService({ db, jwtSecret: SECRET });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createSqliteAuthRouter(service));
  const server = await new Promise<any>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = 'http://127.0.0.1:' + address.port + '/api/auth';

  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const request = async (route: string, method = 'GET', body?: unknown, token?: string) => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(baseUrl + route, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  assert.equal((await request('/session')).status, 401);
  assert.equal((await request('/login', 'POST', { roleOrUsername: 'owner_http', pin: '123' })).status, 400);

  const ownerLogin = await request('/login', 'POST', { roleOrUsername: 'owner_http', pin: OWNER_PIN });
  assert.equal(ownerLogin.status, 200);
  const ownerBody = await ownerLogin.json() as any;
  assert.equal(ownerBody.user.role, 'owner');
  const ownerToken = ownerBody.token as string;

  const usersResponse = await request('/users', 'GET', undefined, ownerToken);
  assert.equal(usersResponse.status, 200);
  assert.equal((await usersResponse.json() as any).users.length, 1);

  const weakCreate = await request('/users', 'POST', {
    username: 'weak_employee',
    name: 'موظف ضعيف',
    role: 'teller',
    branchId: 'branch-main',
    branchName: 'الفرع الرئيسي',
    pin: '123456',
  }, ownerToken);
  assert.equal(weakCreate.status, 400);

  const createdResponse = await request('/users', 'POST', {
    username: 'teller_http',
    name: 'صراف HTTP',
    role: 'teller',
    branchId: 'branch-main',
    branchName: 'الفرع الرئيسي',
    pin: TELLER_PIN,
  }, ownerToken);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as any;
  const tellerId = created.user.id as string;

  const tellerLogin = await request('/login', 'POST', { roleOrUsername: 'teller_http', pin: TELLER_PIN });
  assert.equal(tellerLogin.status, 200);
  const tellerToken = (await tellerLogin.json() as any).token as string;

  assert.equal((await request('/users', 'GET', undefined, tellerToken)).status, 403);
  assert.equal((await request('/security-logs', 'GET', undefined, tellerToken)).status, 403);

  const disabled = await request('/users/' + tellerId + '/status', 'PATCH', { isActive: false }, ownerToken);
  assert.equal(disabled.status, 200);
  assert.equal((await request('/session', 'GET', undefined, tellerToken)).status, 401);

  const reset = await request('/users/' + tellerId + '/reset-pin', 'POST', { newPin: '628491' }, ownerToken);
  assert.equal(reset.status, 200);
  const newTellerLogin = await request('/login', 'POST', { roleOrUsername: 'teller_http', pin: '628491' });
  assert.equal(newTellerLogin.status, 200);
  const newTellerToken = (await newTellerLogin.json() as any).token as string;
  assert.equal((await request('/session', 'GET', undefined, newTellerToken)).status, 200);

  const changedPin = await request('/change-pin', 'POST', { currentPin: OWNER_PIN, newPin: '528491' }, ownerToken);
  assert.equal(changedPin.status, 200);
  const changedBody = await changedPin.json() as any;
  assert.equal(changedBody.success, true);
  assert.equal((await request('/session', 'GET', undefined, ownerToken)).status, 401);
  assert.equal((await request('/session', 'GET', undefined, changedBody.token)).status, 200);

  const logs = await request('/security-logs', 'GET', undefined, changedBody.token);
  assert.equal(logs.status, 200);
  assert.ok((await logs.json() as any).logs.length >= 4);
});
