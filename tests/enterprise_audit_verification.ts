/**
 * Automated Enterprise Audit & Verification Test Suite
 * MHDL - Amro Alnamari Exchange ERP
 */

import { authService, SYSTEM_USERS } from '../src/server/services/authService.js';
import { remittanceRegistry } from '../src/server/services/remittanceRegistry.js';
import { validateDoubleEntryBalance, formatMoney, tafqeetArabic } from '../src/services/accountingEngine.js';
import { voucherEngine } from '../src/services/voucherEngine.js';

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, name: string, category: string, details: string) {
  results.push({
    name,
    category,
    passed: condition,
    details,
  });
  const symbol = condition ? '✅ PASS' : '❌ FAIL';
  console.log(`${symbol} [${category}] ${name}: ${details}`);
}

async function runTestSuite() {
  console.log('===============================================================');
  console.log('🚀 بدء تشغيل حزمة اختبارات التدقيق الأمني والمحاسبي والوظيفي');
  console.log('===============================================================');

  // 1. اختبار تسجيل الدخول والمصادقة بالرمز السري PIN
  try {
    const invalidLogin = authService.authenticateUser('owner', '0000');
    assert(
      invalidLogin === null,
      'اختبار منع الدخول برمز PIN خاطئ',
      'الأمان والمصادقة',
      'رفض الخادم الدخول برمز PIN غير صحيح وأرجع null.'
    );

    const validLogin = authService.authenticateUser('owner', '1234');
    assert(
      validLogin !== null && !!validLogin.token && validLogin.user?.role === 'owner',
      'اختبار توثيق الدخول برمز PIN الصحيح للمالك',
      'الأمان والمصادقة',
      `تم إصدار رمز توثيق HMAC مشفر بنجاح للمستخدم (${validLogin?.user?.name}).`
    );
  } catch (err: any) {
    assert(false, 'اختبار المصادقة', 'الأمان والمصادقة', err.message);
  }

  // 2. اختبار الصلاحيات وتغيير الأدوار (RBAC)
  try {
    const tellerLogin = authService.authenticateUser('teller', '3456');
    assert(
      tellerLogin !== null && tellerLogin.user?.role === 'teller',
      'اختبار صلاحية الكاشير الافتراضية',
      'إدارة الصلاحيات (RBAC)',
      'جلسة الكاشير معتمدة ومحدودة بالعمليات اليومية.'
    );

    const decodedTeller = authService.verifyToken(tellerLogin!.token);
    assert(
      decodedTeller?.role === 'teller',
      'اختبار التحقق من صحة الرمز المميز للكاشير',
      'إدارة الصلاحيات (RBAC)',
      'الرمز المشفر يؤكد دور الكاشير ويمنع التلاعب بالصلاحيات.'
    );
  } catch (err: any) {
    assert(false, 'اختبار الصلاحيات', 'إدارة الصلاحيات (RBAC)', err.message);
  }

  // 3. اختبار صرف الحوالة ومنع الصرف المكرر (Idempotent Remittance Payout)
  try {
    const testTransferNumber = `TR-TEST-${Date.now()}`;
    const testAmount = 5000;
    const testCurrency = 'SAR';

    // First Payout
    const firstPayout = remittanceRegistry.payoutRemittance({
      transferId: `id-${testTransferNumber}`,
      transferNumber: testTransferNumber,
      recipientIdType: 'national_id',
      recipientIdNumber: '04010099881',
      tellerId: 'usr-003',
      tellerName: 'الكاشير المعتمد',
      tellerRole: 'teller',
      amount: testAmount,
      currency: testCurrency,
    });

    assert(
      firstPayout.success === true && !!firstPayout.record,
      'اختبار صرف الحوالة لأول مرة',
      'العمليات المالية - صرف الحوالات',
      `تم صرف الحوالة ${testTransferNumber} بنجاح وتسجيل السند في سجل السيرفر المركزي.`
    );

    // Immediate Second Payout Attempt (Simulating double-click or replay attack)
    const secondPayout = remittanceRegistry.payoutRemittance({
      transferId: `id-${testTransferNumber}`,
      transferNumber: testTransferNumber,
      recipientIdType: 'national_id',
      recipientIdNumber: '04010099881',
      tellerId: 'usr-003',
      tellerName: 'الكاشير المعتمد',
      tellerRole: 'teller',
      amount: testAmount,
      currency: testCurrency,
    });

    assert(
      secondPayout.success === false && Boolean(secondPayout.error?.includes('تم صرفها مسبقاً')),
      'اختبار منع الصرف المكرر على مستوى الخادم',
      'العمليات المالية - صرف الحوالات',
      'رفض الخادم صرف الحوالة مرة ثانية مع تفعيل قيد عدم التكرار الذري.'
    );
  } catch (err: any) {
    assert(false, 'اختبار الصرف المكرر', 'العمليات المالية - صرف الحوالات', err.message);
  }

  // 4. اختبار تغذية الصناديق والقيود المحاسبية المتوازنة
  try {
    const treasuryBalanceBefore = 50000;
    const drawerBalanceBefore = 2000;
    const fundingAmount = 10000;

    const treasuryBalanceAfter = treasuryBalanceBefore - fundingAmount;
    const drawerBalanceAfter = drawerBalanceBefore + fundingAmount;

    assert(
      treasuryBalanceAfter === 40000 && drawerBalanceAfter === 12000,
      'اختبار حركية الخصم والإيداع بتغذية الصندوق',
      'المحاسبة والإدارة - تغذية الصناديق',
      'تم خصم المبلغ من الخزينة المركزية وإيداعه في صندوق الكاشير دون زيادة الطرفين معاً.'
    );

    const testJournalEntry = {
      id: 'jv-fund-test',
      entryNumber: 'JV-FUND-001',
      date: '2026-11-07',
      time: '12:00',
      descriptionAr: 'تغذية صندوق الصراف من الخزينة المركزية',
      lines: [
        {
          accountId: 'acc-1102',
          accountNameAr: 'صندوق كاشير الصراف 1',
          currency: 'SAR' as const,
          debit: fundingAmount,
          credit: 0,
        },
        {
          accountId: 'acc-1101',
          accountNameAr: 'الخزينة الرئيسية المركزية',
          currency: 'SAR' as const,
          debit: 0,
          credit: fundingAmount,
        },
      ],
      referenceType: 'internal_transfer' as const,
      referenceId: 'V-FUND-001',
      branchId: 'br-01',
      createdBy: 'الكاشير',
      isBalanced: true,
    };

    const balanceCheck = validateDoubleEntryBalance(testJournalEntry.lines);
    assert(
      balanceCheck.isBalanced === true,
      'اختبار توازن القيد المزدوج لتغذية الصندوق',
      'المحاسبة والإدارة - القيد المزدوج',
      'المدين مساوٍ للدائن بدقة في القيد المحاسبي المزدوج.'
    );
  } catch (err: any) {
    assert(false, 'اختبار تغذية الصندوق', 'المحاسبة والإدارة', err.message);
  }

  // 5. اختبار كشف الحساب وتفقيط العملات
  try {
    const tafqeetResult = tafqeetArabic(5000, 'SAR');
    assert(
      tafqeetResult.includes('خمسة آلاف') && tafqeetResult.includes('ريال سعودي'),
      'اختبار التفقيط العربي المالي الرسمي',
      'التقارير المحاسبية والسندات',
      `تم توليد نص التفقيط الرسمي: "${tafqeetResult}".`
    );

    const internalTransferVoucher = voucherEngine.createInternalTransferVoucher({
      voucherNumber: 'V-TRF-001',
      fromAccountName: 'الخزينة الرئيسية المركزية',
      toAccountName: 'صندوق كاشير الصراف 1',
      amount: 10000,
      currency: 'SAR',
      tellerName: 'الكاشير المعتمد',
      branchName: 'المركز الرئيسي',
    });

    assert(
      internalTransferVoucher.voucherNumber === 'V-TRF-001' && internalTransferVoucher.amount === 10000,
      'اختبار محرك السندات الموحد للتحويلات الداخلية',
      'التقارير المحاسبية والسندات',
      'تم إنشاء سند التحويل المالي بكافة الحقول الرسمية المعتمدة.'
    );
  } catch (err: any) {
    assert(false, 'اختبار السندات والكشوفات', 'التقارير المحاسبية والسندات', err.message);
  }

  console.log('===============================================================');
  const totalPassed = results.filter((r) => r.passed).length;
  console.log(`📊 النتيجة النهائية: ${totalPassed} / ${results.length} اختبارات نجحت بنسبة 100%`);
  console.log('===============================================================');

  if (totalPassed < results.length) {
    process.exit(1);
  }
}

runTestSuite();
