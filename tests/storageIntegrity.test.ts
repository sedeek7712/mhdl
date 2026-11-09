import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { safeReadJson } from '../src/server/utils/atomicFileStorage.js';

function makeTempDirectory(t: { after: (fn: () => void) => void }): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mhdl-ledger-storage-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('required financial file: missing file fails closed and is not created', (t) => {
  const directory = makeTempDirectory(t);
  const filePath = path.join(directory, 'accounts_ledger.json');

  assert.throws(
    () => safeReadJson(filePath, [], { failOnCorruption: true, failOnMissing: true }),
    /غير موجود/
  );
  assert.equal(fs.existsSync(filePath), false);
});

test('required financial file: empty file fails closed and is preserved', (t) => {
  const directory = makeTempDirectory(t);
  const filePath = path.join(directory, 'accounts_ledger.json');
  fs.writeFileSync(filePath, '   ', 'utf8');

  assert.throws(
    () => safeReadJson(filePath, [], { failOnCorruption: true, failOnMissing: true }),
    /تالف أو غير صالح/
  );

  const backups = fs.readdirSync(directory).filter((name) => name.startsWith('accounts_ledger.json.corrupt.'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(directory, backups[0]), 'utf8'), '   ');
});

test('required financial file: malformed JSON fails closed and is preserved', (t) => {
  const directory = makeTempDirectory(t);
  const filePath = path.join(directory, 'accounts_ledger.json');
  const malformed = '[{"id":"acc-1101"';
  fs.writeFileSync(filePath, malformed, 'utf8');

  assert.throws(
    () => safeReadJson(filePath, [], { failOnCorruption: true, failOnMissing: true }),
    /تالف أو غير صالح/
  );

  const backups = fs.readdirSync(directory).filter((name) => name.startsWith('accounts_ledger.json.corrupt.'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(directory, backups[0]), 'utf8'), malformed);
});

test('required financial file: valid JSON is read unchanged', (t) => {
  const directory = makeTempDirectory(t);
  const filePath = path.join(directory, 'accounts_ledger.json');
  const expected = [{ id: 'acc-1101', balances: { USD: 0 } }];
  fs.writeFileSync(filePath, JSON.stringify(expected), 'utf8');

  assert.deepEqual(
    safeReadJson(filePath, [], { failOnCorruption: true, failOnMissing: true }),
    expected
  );
});

test('optional file: missing file retains explicit default initialization behavior', (t) => {
  const directory = makeTempDirectory(t);
  const filePath = path.join(directory, 'optional_audit_log.json');
  const fallback = [{ event: 'first-run' }];

  assert.deepEqual(safeReadJson(filePath, fallback), fallback);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), fallback);
});
