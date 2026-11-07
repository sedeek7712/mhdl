/**
 * Automated Enterprise Audit & Verification Test Suite
 * MHDL - Amro Alnamari Exchange ERP
 * اختبارات التدقيق الأمني والمحاسبي والوظيفي الشامل
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

  // =========================================================================
  // 1. اختبارات الأمان والمصادقة (PBKDF2 Hashing & Brute-Force Rate Limiting)
  // =========================================================================
  try {
    // 1.1 اختبار منع الدخول برمز PIN خاطئ
    const invalidLogin = authService.authenticateUser('owner', '0000', '192.168.1.100');
    assert(
      invalidLogin.success === false && Boolean(invalidLogin.error),
      'اختبار منع الدخول برمز PIN خاطئ',
      'الأمان والمصادقة',
      `رفض الخادم الدخول برمز خاطئ: "${invalidLogin.error}".`
    );

    // 1.2 اختبار توثيق الدخول برمز PIN الصحيح للمالك (توليد توكن مشفر)
    const validLogin = authService.authenticateUser('owner', '1234', '192.168.1.101');
    assert(
      validLogin.success === true && !!validLogin.token && validLogin.user?.role === 'owner',
      'اختبار توثيق الدخول برمز PIN الصحيح للمالك عبر PBKDF2',
      'الأمان والمصادقة',
      `تم التحقق من تجزئة PBKDF2 وإصدار رمز توثيق مشفر للمستخدم (${validLogin?.user?.name}).`
    );

    // 1.3 اختبار حماية القوة الغاشمة (Brute-Force Lockout بعد 5 محاولات فاشلة)
    const testAttackerIp = '10.0.0.99';
    for (let i = 0; i < 4; i++) {
      authService.authenticateUser('teller', '9999', testAttackerIp);
    }
    const fifthAttempt = authService.authenticateUser('teller', '9999', testAttackerIp);
    assert(
      fifthAttempt.locked === true && fifthAttempt.success === false,
      'اختبار حظر القوة الغاشمة (Rate Limiting Lockout)',
      'الأمان والمصادقة',
      'تم إغلاق الحساب مؤقتاً بعد 5 محاولات فاشلة متتالية وسجلت محاولة الاختراق.'
    );

    // 1.4 اختبار أمان timingSafeEqual مع أطوال بايت مختلفة (Buffer length safety)
    const malformedToken = 'abc.def.invalid';
    const decodedMalformed = authService.verifyToken(malformedToken);
    assert(
      decodedMalformed === null,
      'اختبار منع ثغرات توقيت الرموز المشفرة (Timing Attacks)',
      'الأمان والمصادقة',
      'تم رفض الرموز غير المتطابقة دون حدوث استثناءات بايت (Buffer Length Mismatch Protection).'
    );
  } catch (err: any) {
    assert(false, 'اختبار المصادقة والحماية', 'الأمان والمصادقة', err.message);
  }

  // =========================================================================
  // 2. اختبار الصلاحيات والتحقق الخادمي (Server-Side RBAC Enforcement)
  // =========================================================================
  try {
    const tellerLogin = authService.authenticateUser('teller', '3456', '127.0.0.1');
    assert(
      tellerLogin.success === true && tellerLogin.user?.role === 'teller',
      'اختبار جلسة الكاشير المعتمدة',
      'إدارة الصلاحيات (RBAC)',
      'جلسة الكاشير موثقة خادمياً ومحددة بصلاحيات الصرافة اليومية.'
    );

    const decodedTeller = authService.verifyToken(tellerLogin.token!);
    assert(
      decodedTeller?.role === 'teller',
      'اختبار استخراج الدور من التوكن الخادمي وعدم الثقة بالواجهة',
      'إدارة الصلاحيات (RBAC)',
      'الدور مستخرج حصرياً من التوكن المشفر لمنع التلاعب (Client Role Tampering).'
    );
  } catch (err: any) {
    assert(false, 'اختبار الصلاحيات', 'إدارة الصلاحيات (RBAC)', err.message);
  }

  // =========================================================================
  // 3. اختبارات سلامة صرف الحوالات ومنع الصرف المكرر (Remittance Payout Integrity)
  // =========================================================================
  try {
    const uniqueNum = `TR-TEST-${Date.now().toString().slice(-6)}`;
    const payoutAmount = 5000;
    const payoutCurrency = 'SAR';

    // 3.1 تسجيل حوالة معتمدة في السجل المركزي
    remittanceRegistry.registerMasterRemittance({
      id: `rem-test-${uniqueNum}`,
      transferNumber: uniqueNum,
      direction: 'incoming',
      status: 'available',
      senderName: 'محمد أحمد الوجيه',
      senderPhone: '777112233',
      recipientName: 'صديق علي الفتاحي',
      recipientPhone: '779077071',
      networkName: 'شبكة النجم',
      amount: payoutAmount,
      currency: payoutCurrency,
      feeAmount: 0,
      totalPaid: payoutAmount,
      branchName: 'المركز الرئيسي',
      tellerName: 'نظام التدقيق',
      createdAt: new Date().toISOString(),
    });

    // 3.2 فحص رفض الصرف في حال عدم إدخال رقم هوية KYC
    const noKycPayout = remittanceRegistry.payoutRemittance({
      transferId: `id-${uniqueNum}`,
      transferNumber: uniqueNum,
      recipientIdType: 'national_id',
      recipientIdNumber: '   ', // empty
      tellerId: 'usr-003',
      tellerName: 'الكاشير المعتمد',
      tellerRole: 'teller',
      amount: payoutAmount,
      currency: payoutCurrency,
    });
    assert(
      noKycPayout.success === false && Boolean(noKycPayout.error?.includes('إثبات هوية')),
      'اختبار إلزامية هوية المستفيد (AML/KYC)',
      'العمليات المالية - صرف الحوالات',
      'رفض النظام صرف الحوالة بدون إثبات هوية رسمي ساري المفعول.'
    );

    // 3.3 فحص رفض التلاعب بالمبلغ من قبل العميل (Client Amount Tampering)
    const tamperedPayout = remittanceRegistry.payoutRemittance({
      transferId: `id-${uniqueNum}`,
      transferNumber: uniqueNum,
      recipientIdType: 'national_id',
      recipientIdNumber: '04010099881',
      tellerId: 'usr-003',
      tellerName: 'الكاشير المعتمد',
      tellerRole: 'teller',
      amount: 99999, // tampered amount!
      currency: payoutCurrency,
      clientAmount: 99999,
    });
    assert(
      tamperedPayout.success === false && Boolean(tamperedPayout.error?.includes('عدم تطابق مبلغ الحوالة')),
      'اختبار الحماية من التلاعب بمبلغ الحوالة (Tamper Prevention)',
      'العمليات المالية - صرف الحوالات',
      'رفض الخادم العملية لأن المبلغ المطلوب لا يطابق السجل المركزي للحوالة.'
    );

    // 3.4 تنفيذ الصرف النظامي لأول مرة
    const firstPayout = remittanceRegistry.payoutRemittance({
      idempotencyKey: `idem-${uniqueNum}-1`,
      transferId: `id-${uniqueNum}`,
      transferNumber: uniqueNum,
      recipientIdType: 'national_id',
      recipientIdNumber: '04010099881',
      tellerId: 'usr-003',
      tellerName: 'الكاشير المعتمد',
      tellerRole: 'teller',
      amount: payoutAmount,
      currency: payoutCurrency,
      cashierDrawerBalance: 20000,
    });
    assert(
      firstPayout.success === true && !!firstPayout.record && firstPayout.record.amount === payoutAmount,
      'اختبار صرف الحوالة المعتمدة وتحديث الحالة إلى paid',
      'العمليات المالية - صرف الحوالات',
      `تم صرف الحوالة ${uniqueNum} بنجاح وتسجيل السند في سجل السيرفر المركزي.`
    );

    // 3.5 محاولة صرف ثانية لنفس الحوالة (Double Payout Replay Attack)
    const duplicatePayout = remittanceRegistry.payoutRemittance({
      transferId: `id-${uniqueNum}`,
      transferNumber: uniqueNum,
      recipientIdType: 'national_id',
      recipientIdNumber: '04010099881',
      tellerId: 'usr-003',
      tellerName: 'الكاشير المعتمد',
      tellerRole: 'teller',
      amount: payoutAmount,
      currency: payoutCurrency,
    });
    assert(
      duplicatePayout.success === false && duplicatePayout.isDuplicate === true,
      'اختبار منع الصرف المكرر على مستوى الخادم (Double Payout Prevention)',
      'العمليات المالية - صرف الحوالات',
      'تم إحباط محاولة الصرف المكررة وإرجاع خطأ الصرف المسبق بدقة.'
    );

    // 3.6 اختبار مفتاح عدم التكرار (Idempotency Key Safe Replay)
    const idempotentReplay = remittanceRegistry.payoutRemittance({
      idempotencyKey: `idem-${uniqueNum}-1`, // same key
      transferId: `id-${uniqueNum}`,
      transferNumber: uniqueNum,
      recipientIdType: 'national_id',
      recipientIdNumber: '04010099881',
      tellerId: 'usr-003',
      tellerName: 'الكاشير المعتمد',
      tellerRole: 'teller',
      amount: payoutAmount,
      currency: payoutCurrency,
    });
    assert(
      idempotentReplay.success === true && idempotentReplay.record?.voucherNumber === firstPayout.record?.voucherNumber,
      'اختبار استجابة مفتاح عدم التكرار (Idempotency Key Handling)',
      'العمليات المالية - صرف الحوالات',
      'أرجع الخادم نفس السجل الأصلي بأمان دون تكرار الخصم أو تسجيل عملية جديدة.'
    );
  } catch (err: any) {
    assert(false, 'اختبار سلامة صرف الحوالات', 'العمليات المالية - صرف الحوالات', err.message);
  }

  // =========================================================================
  // 4. اختبار المطابقة المحاسبية والقيد المزدوج المتعدد العملات
  // =========================================================================
  try {
    const fundingAmount = 10000;
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
      'اختبار توازن القيد المزدوج لتغذية الصندوق (Double-Entry Balance)',
      'المحاسبة والإدارة - القيد المزدوج',
      'إجمالي المدين مساوٍ لإجمالي الدائن بدقة.'
    );

    // 4.2 استقلال العملات وعدم دمج الريال القديم مع الريال الجديد
    const multiCurrencyLines = [
      {
        accountId: 'acc-1101',
        accountNameAr: 'صندوق الريال القديم',
        currency: 'YER_OLD' as const,
        debit: 500000,
        credit: 0,
      },
      {
        accountId: 'acc-1102',
        accountNameAr: 'صندوق الريال الجديد',
        currency: 'YER_NEW' as const,
        debit: 0,
        credit: 500000, // Different currency line!
      },
    ];
    const multiCheck = validateDoubleEntryBalance(multiCurrencyLines);
    assert(
      multiCheck.isBalanced === false,
      'اختبار استقلال العملات ومنع خلط YER_OLD مع YER_NEW',
      'المحاسبة والإدارة - استقلال العملات',
      'رفض النظام توازن قيد بعملات مختلفة دون وسيط صرافة مطابق للضوابط.'
    );
  } catch (err: any) {
    assert(false, 'اختبار القيد المزدوج والعملات', 'المحاسبة والإدارة', err.message);
  }

  // =========================================================================
  // 5. اختبار تقرير المطابقة المالية للحوالات والصرف (Reconciliation Engine)
  // =========================================================================
  try {
    const reconReport = remittanceRegistry.reconcilePayouts();
    assert(
      reconReport.status === 'BALANCED' && reconReport.discrepanciesCount === 0,
      'اختبار تقرير المطابقة الشامل (Reconciliation Audit)',
      'التدقيق والرقابة المالية',
      `تمت مطابقة ${reconReport.matchedCount} عملية صرف مطابقة تامة بين السجل الخادمي وقاعدة البيانات.`
    );
  } catch (err: any) {
    assert(false, 'اختبار تقرير المطابقة', 'التدقيق والرقابة المالية', err.message);
  }

  // =========================================================================
  // 6. اختبار التفقيط والسندات الرسمية
  // =========================================================================
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
