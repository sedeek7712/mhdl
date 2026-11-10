import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openSqliteDatabase, runSqliteMigrations } from '../src/server/db/sqliteDatabase.js';
import { SQLITE_MIGRATIONS } from '../src/server/db/sqliteMigrations.js';
import { importSqliteUsers, type SqliteUserRecord } from '../src/server/db/sqliteAuthRepository.js';
import { hashSqliteAuthPin } from '../src/server/services/sqliteAuthService.js';

const JWT_SECRET = 'sqlite-real-server-integration-secret-at-least-32-characters';
const OWNER_PIN = '849263';
const TELLER_PIN = '628491';

function writeJson(directory: string, filename: string, value: unknown): void {
  fs.writeFileSync(path.join(directory, filename), JSON.stringify(value, null, 2), 'utf8');
}

function createUser(
  id: string,
  username: string,
  name: string,
  role: SqliteUserRecord['role'],
  pin: string
): SqliteUserRecord {
  const pinSalt = crypto.randomBytes(16).toString('hex');
  return {
    id,
    username,
    name,
    role,
    branchId: 'branch-main',
    branchName: 'الفرع الرئيسي',
    pinSalt,
    pinHash: hashSqliteAuthPin(pin, pinSalt),
    isActive: true,
    mustChangePin: false,
    sessionVersion: crypto.randomBytes(16).toString('hex'),
    createdAt: new Date().toISOString(),
  };
}

interface RunningServer {
  baseUrl: string;
  stop(): Promise<void>;
}

async function startRealServer(env: NodeJS.ProcessEnv): Promise<RunningServer> {
  const script = [
    "import { startServer } from './server.ts';",
    "const server = await startServer({ port: 0, host: '127.0.0.1', useVite: false });",
    "const address = server.address();",
    "if (!address || typeof address === 'string') throw new Error('HTTP server did not expose a TCP address.');",
    "console.log('SQLITE_AUTH_SERVER_READY:' + address.port);",
    "process.on('message', (message) => {",
    "  if (message === 'shutdown') server.close(() => process.exit(0));",
    "});",
  ].join('\n');

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script],
    { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }
  );

  let stdout = '';
  let stderr = '';
  let settled = false;

  const ready = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Timed out waiting for the real HTTP server.\n' + stdout + '\n' + stderr));
    }, 15000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const match = stdout.match(/SQLITE_AUTH_SERVER_READY:(\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(
        'The real HTTP server exited before readiness (code=' + code + ', signal=' + signal + ').\n' +
        stdout + '\n' + stderr
      ));
    });
  });

  return {
    baseUrl: 'http://127.0.0.1:' + ready,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(forceKill);
          resolve();
        };
        child.once('exit', finish);
        const forceKill = setTimeout(() => {
          child.kill();
          finish();
        }, 5000);
        child.send?.('shutdown');
      });
    },
  };
}

async function jsonRequest(
  baseUrl: string,
  route: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = 'Bearer ' + options.token;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(baseUrl + route, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

test('SQLite auth is mounted in the real server and survives process restart', async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mhdl-sqlite-server-auth-'));
  const databaseFile = path.join(dataDirectory, 'exchange-auth.sqlite');
  let firstServer: RunningServer | undefined;
  let secondServer: RunningServer | undefined;

  const owner = createUser('sqlite-server-owner', 'sqlite_owner', 'مالك اختبار الخادم', 'owner', OWNER_PIN);
  const teller = createUser('sqlite-server-teller', 'sqlite_teller', 'صراف اختبار الخادم', 'teller', TELLER_PIN);

  const seedDb = openSqliteDatabase({ filePath: databaseFile });
  try {
    runSqliteMigrations(seedDb, SQLITE_MIGRATIONS);
    importSqliteUsers(seedDb, [owner, teller]);
  } finally {
    seedDb.close();
  }

  const zero = { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 };
  const accounts = [
    { id: 'acc-1101', code: '1101', nameAr: 'الخزينة الرئيسية', type: 'asset', category: 'cash_box', balances: { ...zero, YER_OLD: 4000 } },
    { id: 'acc-1102', code: '1102', nameAr: 'صندوق الكاشير', type: 'asset', category: 'cash_box', balances: { ...zero, YER_OLD: 10000 } },
    { id: 'acc-1103', code: '1103', nameAr: 'حساب بنكي تجريبي', type: 'asset', category: 'bank', balances: { ...zero } },
    { id: 'acc-1301', code: '1301', nameAr: 'ذمم شبكة الحوالات', type: 'asset', category: 'network', balances: { ...zero } },
    { id: 'acc-2101', code: '2101', nameAr: 'أمانات العملاء ووسيط التسوية', type: 'liability', category: 'customer', balances: { ...zero } },
    { id: 'acc-2201', code: '2201', nameAr: 'الحوالات المعلقة ومستحقات الشبكة', type: 'liability', category: 'remittance', balances: { ...zero } },
    { id: 'acc-4101', code: '4101', nameAr: 'إيرادات عمولات الصرافة', type: 'revenue', category: 'commission', balances: { ...zero } },
    { id: 'acc-5101', code: '5101', nameAr: 'المصروفات التشغيلية', type: 'expense', category: 'operating_expense', balances: { ...zero } },
  ];
  const openingBalances = Object.fromEntries(accounts.map((account) => [
    account.id,
    { type: account.type, balances: { ...account.balances } },
  ]));

  writeJson(dataDirectory, 'system_users.local.json', [{
    id: owner.id,
    name: owner.name,
    role: owner.role,
    username: owner.username,
    branchId: owner.branchId,
    branchName: owner.branchName,
    pinSalt: owner.pinSalt,
    pinHash: owner.pinHash,
    isActive: true,
    mustChangePin: false,
    sessionVersion: owner.sessionVersion,
    createdAt: owner.createdAt,
  }]);
  writeJson(dataDirectory, 'accounts_ledger.json', accounts);
  writeJson(dataDirectory, 'journal_entries.json', []);
  writeJson(dataDirectory, 'financial_baseline_approved.local.json', {
    schemaVersion: 1,
    approvedAt: '2026-11-10 00:00',
    approvedBy: owner.name,
    approvedByUserId: owner.id,
    openingBalances,
  });
  writeJson(dataDirectory, 'remittance_settings.json', {
    numberingMode: 'automatic',
    prefix: 'TR-',
    nextSequence: 1,
    updatedAt: '2026-11-10 00:00',
    updatedBy: owner.name,
    updatedByRole: 'owner',
  });
  writeJson(dataDirectory, 'remittance_numbers_registry.json', []);
  writeJson(dataDirectory, 'remittance_payouts_registry.json', []);
  writeJson(dataDirectory, 'remittance_audit_logs.json', []);
  writeJson(dataDirectory, 'remittances_master.json', []);
  writeJson(dataDirectory, 'exchange_rate_state.json', {
    schemaVersion: 1,
    rates: [{
      id: 'rate-usd-old',
      fromCurrency: 'USD',
      toCurrency: 'YER_OLD',
      buyRate: 535,
      sellRate: 538,
      updatedAt: '2026-11-10 00:00',
      updatedBy: owner.name,
    }],
    auditLogs: [],
  });

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    ALNAMARI_TEST_DATA_DIR: dataDirectory,
    ALNAMARI_AUTH_BACKEND: 'sqlite',
    ALNAMARI_SQLITE_DB_PATH: databaseFile,
    JWT_SECRET,
  };

  t.after(async () => {
    await firstServer?.stop();
    await secondServer?.stop();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  firstServer = await startRealServer(childEnv);

  const health = await jsonRequest(firstServer.baseUrl, '/api/health');
  assert.equal(health.status, 200);

  const ownerLogin = await jsonRequest(firstServer.baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { roleOrUsername: owner.username, pin: OWNER_PIN },
  });
  assert.equal(ownerLogin.status, 200, 'the actual server login route must use SQLite');
  const ownerLoginBody = await ownerLogin.json() as any;
  assert.equal(ownerLoginBody.user.id, owner.id);
  assert.equal(ownerLoginBody.user.role, 'owner');
  const ownerToken = ownerLoginBody.token as string;

  const tellerLogin = await jsonRequest(firstServer.baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { roleOrUsername: teller.username, pin: TELLER_PIN },
  });
  assert.equal(tellerLogin.status, 200);
  const tellerToken = (await tellerLogin.json() as any).token as string;

  const ownerSession = await jsonRequest(firstServer.baseUrl, '/api/auth/session', { token: ownerToken });
  assert.equal(ownerSession.status, 200);
  assert.equal((await ownerSession.json() as any).user.id, owner.id);

  const ownerReport = await jsonRequest(firstServer.baseUrl, '/api/remittances/reconciliation', { token: ownerToken });
  assert.equal(ownerReport.status, 200, 'the real protected route must accept the SQLite owner token');

  const tellerReport = await jsonRequest(firstServer.baseUrl, '/api/remittances/reconciliation', { token: tellerToken });
  assert.equal(tellerReport.status, 403, 'the real protected route must deny the teller role');

  const usersResponse = await jsonRequest(firstServer.baseUrl, '/api/auth/users', { token: ownerToken });
  assert.equal(usersResponse.status, 200);
  const users = (await usersResponse.json() as any).users as any[];
  assert.equal(users.length, 2);
  assert.equal(users.some((user) => user.id === teller.id), true);
  assert.equal(users.some((user) => 'pinHash' in user || 'pinSalt' in user), false);

  const securityLogs = await jsonRequest(firstServer.baseUrl, '/api/auth/security-logs', { token: ownerToken });
  assert.equal(securityLogs.status, 200);
  assert.equal(
    (await securityLogs.json() as any).logs.some((entry: any) => entry.event === 'ROLE_ACCESS_DENIED'),
    true,
    'role denial must be written to the selected SQLite audit store'
  );

  const disabled = await jsonRequest(firstServer.baseUrl, '/api/auth/users/' + teller.id + '/status', {
    method: 'PATCH',
    token: ownerToken,
    body: { isActive: false },
  });
  assert.equal(disabled.status, 200);

  const revokedTellerSession = await jsonRequest(firstServer.baseUrl, '/api/auth/session', { token: tellerToken });
  assert.equal(revokedTellerSession.status, 401, 'disabling a user must revoke an already issued token');

  await firstServer.stop();
  firstServer = undefined;

  secondServer = await startRealServer(childEnv);

  const ownerSessionAfterRestart = await jsonRequest(secondServer.baseUrl, '/api/auth/session', { token: ownerToken });
  assert.equal(ownerSessionAfterRestart.status, 200, 'owner JWT and SQLite identity must remain valid after server restart');

  const disabledTellerLogin = await jsonRequest(secondServer.baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { roleOrUsername: teller.username, pin: TELLER_PIN },
  });
  assert.equal(disabledTellerLogin.status, 401, 'disabled user state must persist after server restart');

  const securityLogsAfterRestart = await jsonRequest(secondServer.baseUrl, '/api/auth/security-logs', { token: ownerToken });
  assert.equal(securityLogsAfterRestart.status, 200);
  assert.equal(
    (await securityLogsAfterRestart.json() as any).logs.some((entry: any) => entry.event === 'ROLE_ACCESS_DENIED'),
    true,
    'SQLite authorization audit entries must persist after server restart'
  );
});
