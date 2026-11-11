// Builds the Windows desktop package: web UI + bundled server + setup tools + node.exe for the setup scripts.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
const NODE_WIN_VERSION = process.env.NODE_WIN_VERSION || '22.23.4';

console.log('1) vite build'); run('npx', ['vite', 'build']);

console.log('2) bundle server + setup tools');
const common = {
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  external: ['vite', 'lightningcss', 'fsevents', '@tailwindcss/vite'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
};
await build({ ...common, entryPoints: [path.join(root, 'server.ts')], outfile: path.join(root, 'server.mjs') });
fs.rmSync(path.join(root, 'tools'), { recursive: true, force: true });
for (const name of ['bootstrapOwner', 'approveFinancialBaseline', 'reconcileChartOfAccounts']) {
  await build({ ...common, entryPoints: [path.join(root, 'scripts', `${name}.ts`)], outfile: path.join(root, 'tools', `${name}.mjs`) });
}

console.log('3) node.exe for setup scripts + .bat launchers');
const extra = path.join(root, 'desktop-extra');
fs.rmSync(extra, { recursive: true, force: true });
fs.mkdirSync(path.join(extra, 'node'), { recursive: true });
const tmp = fs.mkdtempSync(path.join(root, '.nodewin-'));
run('npm', ['pack', `node-win-x64@${NODE_WIN_VERSION}`, '--pack-destination', tmp, '--silent']);
const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
run('tar', ['-xzf', path.join(tmp, tgz), '-C', tmp]);
fs.copyFileSync(path.join(tmp, 'package', 'bin', 'node.exe'), path.join(extra, 'node', 'node.exe'));
fs.rmSync(tmp, { recursive: true, force: true });

const bat = (title, tool, extraNote = '') => [
  '@echo off', 'chcp 65001 >nul', 'setlocal',
  'if not defined ALNAMARI_DATA_DIR set "ALNAMARI_DATA_DIR=%SystemDrive%\\AlNamari-Data"',
  'if not exist "%ALNAMARI_DATA_DIR%" mkdir "%ALNAMARI_DATA_DIR%"',
  `echo ${title}`, 'echo Data folder: %ALNAMARI_DATA_DIR%', extraNote && `echo ${extraNote}`, 'echo.',
  `"%~dp0node\\node.exe" "%~dp0resources\\app\\tools\\${tool}.mjs" %*`,
  'echo.', 'pause',
].filter(Boolean).join('\r\n') + '\r\n';
fs.cpSync(path.join(root, 'tests', 'fixtures', 'mock-data'), path.join(extra, 'demo-data'), { recursive: true, filter: (src) => path.basename(src) !== 'system_users.json' }); // owner-only first run: setup tools require exactly one user
fs.writeFileSync(path.join(extra, '0-load-demo-data.bat'), [
  '@echo off', 'chcp 65001 >nul', 'setlocal',
  'if not defined ALNAMARI_DATA_DIR set "ALNAMARI_DATA_DIR=%SystemDrive%\\AlNamari-Data"',
  'if exist "%ALNAMARI_DATA_DIR%\\accounts_ledger.json" (',
  '  echo Data already exists in %ALNAMARI_DATA_DIR% - nothing was copied.', '  pause', '  exit /b 1', ')',
  'mkdir "%ALNAMARI_DATA_DIR%" 2>nul',
  'xcopy /E /I /Y "%~dp0demo-data" "%ALNAMARI_DATA_DIR%" >nul',
  'echo DEMO (test) data copied to %ALNAMARI_DATA_DIR%. Never use it for real money.', 'pause', ''
].join('\r\n'));
fs.writeFileSync(path.join(extra, '1-setup-owner.bat'), bat('Step 1: create the owner account', 'bootstrapOwner'));
fs.writeFileSync(path.join(extra, '2-setup-chart-of-accounts.bat'), bat('Step 2: reconcile the chart of accounts', 'reconcileChartOfAccounts'));
fs.writeFileSync(path.join(extra, '3-approve-opening-balances.bat'), bat('Step 3: approve opening balances', 'approveFinancialBaseline', 'Only after matching real cash and network statements.'));
fs.writeFileSync(path.join(extra, 'README-FIRST.txt'),
`AlNamari - first run
1) Double-click 1-setup-owner.bat and create the owner account.
2) Double-click 2-setup-chart-of-accounts.bat.
3) Only after reconciling real cash/network statements: 3-approve-opening-balances.bat.
4) Start AlNamari.exe.
Data lives in C:\\AlNamari-Data (not inside the program folder). Back it up regularly.
Use TEST DATA ONLY until the backup/restore rehearsal is done.
`);
console.log('done');
