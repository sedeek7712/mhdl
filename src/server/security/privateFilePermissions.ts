import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Applies a private ACL to a sensitive regular file.
 *
 * POSIX: owner read/write only (0600).
 * Windows: reset inherited/default entries, disable inheritance, and grant
 * Full Control only to the current user SID and LocalSystem. Any ACL command
 * failure is fatal; callers must never silently continue with a public file.
 */
export function applyPrivateFilePermissions(filePath: string): void {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Private file permissions require an existing regular file.');
  }

  if (process.platform !== 'win32') {
    fs.chmodSync(resolved, 0o600);
    const mode = fs.statSync(resolved).mode & 0o777;
    if (mode !== 0o600) {
      throw new Error('Unable to verify private POSIX file mode 0600.');
    }
    return;
  }

  const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (identity.error || identity.status !== 0) {
    throw new Error('Unable to determine the current Windows user SID for private file ACLs.');
  }
  const sid = identity.stdout.match(/S-1-(?:[0-9]+-)+[0-9]+/)?.[0];
  if (!sid) {
    throw new Error('The current Windows user SID could not be parsed; private file ACLs were not applied.');
  }

  const runIcacls = (args: string[]): void => {
    const result = spawnSync('icacls.exe', args, {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      throw new Error('Windows refused to apply or verify the private file ACL with icacls.');
    }
  };

  // Reset the newly-created empty file before removing inherited entries.
  runIcacls([resolved, '/reset']);
  runIcacls([resolved, '/inheritance:r']);
  runIcacls([resolved, '/grant:r', '*' + sid + ':(F)']);
  runIcacls([resolved, '/grant', '*S-1-5-18:(F)']);
  runIcacls([resolved, '/verify']);
}
