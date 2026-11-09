import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

function runIsolated(source: string, dataDirectory: string) {
  return spawnSync(process.execPath, [
    '--import', 'tsx',
    '--input-type=module',
    '--eval', source,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ALNAMARI_TEST_DATA_DIR: dataDirectory,
    },
  });
}

test('corrupt WhatsApp dispatch JSON prevents startup instead of silently loading an empty registry', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-dispatch-corrupt-'));
  try {
    fs.writeFileSync(path.join(directory, 'whatsapp_dispatch_registry.json'), '{broken', 'utf8');
    const child = runIsolated(
      "await import('./src/server/services/dispatchRegistry.ts');",
      directory
    );
    assert.notEqual(child.status, 0, 'module initialization must fail for corrupt persisted JSON');
    assert.match(child.stderr, /Unexpected token|JSON|توقف آمن/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('WhatsApp registry commits disk state before memory state and archives images atomically', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alnamari-dispatch-atomic-'));
  fs.writeFileSync(path.join(directory, 'whatsapp_dispatch_registry.json'), '[]', 'utf8');

  try {
    const source = [
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      "import { dispatchRegistry } from './src/server/services/dispatchRegistry.ts';",
      "const image = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c63f80f040009fb03fdfb5e6b2b0000000049454e44ae426082', 'hex');",
      "const hash = dispatchRegistry.calculateSha256(image);",
      "const storageKey = dispatchRegistry.archiveVoucherImage(image, 'FIXTURE-001', hash);",
      "if (!storageKey.endsWith('.png')) process.exit(20);",
      "const archivePath = path.join(process.env.ALNAMARI_TEST_DATA_DIR, 'archived_vouchers', storageKey);",
      "if (!fs.existsSync(archivePath) || dispatchRegistry.calculateSha256(fs.readFileSync(archivePath)) !== hash) process.exit(21);",
      "let badHashRejected = false;",
      "try { dispatchRegistry.archiveVoucherImage(image, 'FIXTURE-002', '0'.repeat(64)); } catch { badHashRejected = true; }",
      "if (!badHashRejected) process.exit(22);",
      "const params = {",
      "  voucherNumber: 'FIXTURE-VOUCHER-001', transactionId: 'fixture-transaction-001',",
      "  voucherType: 'receipt', recipientPhone: '+967700000001', caption: 'Fixture voucher',",
      "  sha256: hash, fileSizeBytes: image.length, storageKey, employeeId: 'fixture-teller',",
      "  employeeName: 'Fixture teller', idempotencyKey: 'fixture-idempotency-key',",
      "  snapshot: { voucherNumber: 'FIXTURE-VOUCHER-001', transactionId: 'fixture-transaction-001',",
      "    type: 'receipt', date: '2026-11-10', time: '08:00:00', partyName: 'Fixture customer',",
      "    partyPhone: '+967700000001', amount: 10, currency: 'YER_OLD', amountInWordsAr: 'عشرة',",
      "    branchName: 'Fixture branch', tellerName: 'Fixture teller', referenceNumber: 'FIXTURE-VOUCHER-001' },",
      "};",
      "const created = dispatchRegistry.createOrUpdateAttempt(params);",
      "if (created.status !== 'UPLOADING' || dispatchRegistry.getAllRecords().length !== 1) process.exit(23);",
      "process.env.ALNAMARI_TEST_FAIL_WRITE_BASENAME = 'whatsapp_dispatch_registry.json';",
      "let writeFailurePropagated = false;",
      "try { dispatchRegistry.recordMediaUploaded(created.id, 'fixture-media-id'); } catch { writeFailurePropagated = true; }",
      "if (!writeFailurePropagated) process.exit(24);",
      "const inMemory = dispatchRegistry.getByVoucherNumber('FIXTURE-VOUCHER-001');",
      "if (!inMemory || inMemory.status !== 'UPLOADING' || inMemory.metaMediaId !== null) process.exit(25);",
      "const disk = JSON.parse(fs.readFileSync(path.join(process.env.ALNAMARI_TEST_DATA_DIR, 'whatsapp_dispatch_registry.json'), 'utf8'));",
      "if (disk.length !== 1 || disk[0].status !== 'UPLOADING' || disk[0].metaMediaId !== null) process.exit(26);",
    ].join('\n');
    const child = runIsolated(source, directory);
    assert.equal(child.status, 0, child.stderr || child.stdout);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
