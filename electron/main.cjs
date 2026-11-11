'use strict';
// Desktop shell: runs the existing local server in-process (127.0.0.1 only) and shows it in a window.
const { app, BrowserWindow, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');

const PORT = Number(process.env.ALNAMARI_PORT || 38417);
// %LOCALAPPDATA% is private to the signed-in Windows user by default (unlike the C:\ root).
const DATA_DIR = process.env.ALNAMARI_DATA_DIR ||
  path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'AlNamari-Data');

const logLines = [];
function log(level, args) {
  const line = `${new Date().toISOString()} [${level}] ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}`;
  logLines.push(line);
  if (logLines.length > 200) logLines.shift();
  try {
    fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, 'logs', 'app.log'), line + '\n');
  } catch { /* logging must never crash the app */ }
}
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => { log(level, args); original(...args); };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  function waitForServer(timeoutMs) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1500 }, (res) => {
          res.resume();
          resolve();
        });
        req.on('error', retry);
        req.on('timeout', () => { req.destroy(); retry(); });
      };
      const retry = () => {
        if (Date.now() - started > timeoutMs) reject(new Error('انتهت مهلة تشغيل الخادم المحلي'));
        else setTimeout(attempt, 400);
      };
      attempt();
    });
  }

  // Production mode requires an explicit session secret (>= 32 chars). Generate once, keep stable across restarts.
  function loadOrCreateAppSecret() {
    const file = path.join(DATA_DIR, '.app_secret');
    try {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (existing.length >= 32) return existing;
    } catch { /* first run */ }
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, secret + '\n', { mode: 0o600 });
    return secret;
  }

  async function start() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    process.env.ALNAMARI_DATA_DIR = DATA_DIR;
    process.env.NODE_ENV = 'production';
    process.env.PORT = String(PORT);
    process.env.JWT_SECRET = loadOrCreateAppSecret();
    log('log', ['data dir:', DATA_DIR, 'port:', PORT]);

    // server.mjs starts itself (host is fixed to 127.0.0.1 inside the server).
    await import(pathToFileURL(path.join(app.getAppPath(), 'server.mjs')).href);

    try {
      await waitForServer(30000);
    } catch (error) {
      const lastErrors = logLines.filter((l) => l.includes('[error]')).slice(-3).join('\n');
      dialog.showErrorBox('تعذّر تشغيل النظام',
        `${error.message}\n\n${lastErrors || 'لا توجد تفاصيل.'}\n\nملف السجل:\n${path.join(DATA_DIR, 'logs', 'app.log')}\n\nإذا كانت الرسالة تذكر الأرصدة الافتتاحية أو حساب المالك فشغّل ملفات الإعداد (setup) الموجودة بجانب البرنامج أولاً.`);
      app.quit();
      return;
    }

    Menu.setApplicationMenu(null);
    mainWindow = new BrowserWindow({
      width: 1366, height: 820, minWidth: 1000, minHeight: 650,
      title: 'النماري للصرافة',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const origin = `http://127.0.0.1:${PORT}`;
    mainWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin)) event.preventDefault(); });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.on('closed', () => { mainWindow = null; });
    await mainWindow.loadURL(origin);
  }

  app.whenReady().then(() => start().catch((error) => {
    log('error', [error]);
    dialog.showErrorBox('خطأ غير متوقع', String(error && error.message || error));
    app.quit();
  }));
  app.on('window-all-closed', () => app.quit());
}
