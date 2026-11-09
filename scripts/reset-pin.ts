/**
 * أداة إدارة محلية لإعادة ضبط كلمة المرور (N3). تُشغَّل على الجهاز نفسه فقط:
 *   npm run reset-pin -- <username>     (مثال: amro)
 *   npm run reset-pin -- --all
 * تُولِّد كلمة مرور عشوائية جديدة، وتُبطل الجلسات القديمة، وتعرض النتيجة مرة واحدة.
 */
import { authService } from '../src/server/services/authService.js';

const arg = process.argv[2];
if (!arg) {
  console.error('الاستخدام: npm run reset-pin -- <username> | --all');
  console.error('المستخدمون:', authService.listUsernames().join(', '));
  process.exit(1);
}

const targets = arg === '--all' ? authService.listUsernames() : [arg];
let failed = false;
for (const username of targets) {
  const result = authService.adminResetPin(username);
  if (!result) {
    console.error(`المستخدم غير موجود: ${username}`);
    failed = true;
  } else {
    console.log(`${result.username} : ${result.password}`);
  }
}
process.exit(failed ? 1 : 0);
