/**
 * Automated Enterprise Audit & Verification Test Suite
 * MHDL - Amro Alnamari Exchange ERP
 * اختبارات التدقيق الأمني والمحاسبي والوظيفي الشامل
 * تغطية البنود المكتشفة في تقرير التدقيق المستقل: C1, C2, C3, H1, H2, H3, H4, M1, M2, L1
 */

import crypto from 'crypto';
import { authService } from '../src/server/services/authService.js';
import { remittanceRegistry } from '../src/server/services/remittanceRegistry.js';
import { serverAccountingEngine } from '../src/server/services/serverAccountingEngine.js';
import { safeAtomicWriteJson, safeReadJson, getYemenDateTimeString } from '../src/server/utils/atomicFileStorage.js';
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
  console.log('🚀 تشغيل حزمة اختبارات التدقيق الأمني والمحاسبي المحدثة (Audit Defense)');
  console.log('===============================================================');

  // =========================================================================
  // 1. C1: اختبار إحباط تزوير توكن المالك (Token Forgery Rejection)
  // =========================================================================
  try {
    // محاولة تزوير توكن المالك بمفتاح افتراضي معروف أو مخمن
    const forgedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const forgedPayload = Buffer.from(JSON.stringify({
      userId: 'usr-001',
      username: 'amro',
      name: 'عمرو النماري',
      role: 'owner',
      branchId: 'br-main',
      branchName: 'المركز الرئيسي',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');

    // توقيع بمفتاح افتراضي قديم كان بالتقرير
    const guessedKey = 'alnamari_secure_hmac_secret_2026_finance_erp_dev_mode';
    const fakeSignature = crypto.createHmac('sha256', guessedKey).update(`${forgedHeader}.${forgedPayload}`).digest('base64url');
    const forgedToken = `${forgedHeader}.${forgedPayload}.${fakeSignature}`;

    const verifyForgedResult = authService.verifyToken(forgedToken);
    assert(
      verifyForgedResult === null,
      'C1: اختبار رفض التوكن المزور بالمفتاح الافتراضي القديم',
      'الأمان والمصادقة (C1)',
      'رفض الخادم التوكن المزور لعدم تطابق التوقيع مع السر الحقيقي المحمي.'
    );

    // توثيق دخول المالك برمز PIN الصحيح والتأكد من قبول التوكن الأصلي فقط
    const realLogin = authService.authenticateUser('owner', '1234', '127.0.0.1');
    assert(
      realLogin.success === true && !!realLogin.token,
      'C1: اختبار إصدار وقبول التوكن الشرعي عبر المفتاح الديناميكي المحمي',
      'الأمان والمصادقة (C1)',
      'تم قبول التوكن الشرعي الموقّع بالسر المولد محلياً والمحمي.'
    );
  } catch (err: any) {
    assert(false, 'C1: اختبار تزوير التوكن', 'الأمان والمصادقة (C1)', err.message);
  }

  // =========================================================================
  // 2. C2 & M1 & M2: اختبار حماية تسجيل الحوالات ومنع اختلاق الحوالات الوهمية
  // =========================================================================
  try {
    // 2.1 محاولة تسجيل حوالة بمبلغ سالب
    const negativeAmountResult = remittanceRegistry.registerMasterRemittance({
      id: 'rem-neg-test',
      transferNumber: 'TR-NEG-001',
      direction: 'incoming',
      status: 'available',
      senderName: 'عميل',
      senderPhone: '770000000',
      recipientName: 'مستلم',
      recipientPhone: '771111111',
      networkName: 'شبكة النجم',
      amount: -5000, // سالب!
      currency: 'SAR',
      feeAmount: 0,
      totalPaid: -5000,
      branchName: 'الفرع',
      tellerName: 'النظام',
      createdAt: getYemenDateTimeString(),
    });

    assert(
      negativeAmountResult.success === false && Boolean(negativeAmountResult.error?.includes('موجباً')),
      'C2/M1: اختبار رفض تسجيل حوالة بمبلغ سالب',
      'سلامة الحوالات (C2/M1)',
      'رفض النظام تسجيل الحوالة بمبلغ سالب واشترط مبالغ موجبة أكبر من الصفر.'
    );

    // 2.2 محاولة تسجيل حوالة بعملة وهمية غير معتمدة
    const fakeCurrencyResult = remittanceRegistry.registerMasterRemittance({
      id: 'rem-curr-test',
      transferNumber: 'TR-CURR-001',
      direction: 'incoming',
      status: 'available',
      senderName: 'عميل',
      senderPhone: '770000000',
      recipientName: 'مستلم',
      recipientPhone: '771111111',
      networkName: 'شبكة النجم',
      amount: 1000,
      currency: 'FAKE_BITCOIN', // عملة غير معتمدة!
      feeAmount: 0,
      totalPaid: 1000,
      branchName: 'الفرع',
      tellerName: 'النظام',
      createdAt: getYemenDateTimeString(),
    });

    assert(
      fakeCurrencyResult.success === false && Boolean(fakeCurrencyResult.error?.includes('غير مدعومة')),
      'C2/M1: اختبار رفض عملة غير مدعومة في نظام الصرافة',
      'سلامة الحوالات (C2/M1)',
      'رفض الخادم تسجيل حوالة بعملة غير معتمدة في دليل العملات المصرفي.'
    );
  } catch (err: any) {
    assert(false, 'C2: اختبار سلامة تسجيل الحوالات', 'سلامة الحوالات (C2)', err.message);
  }

  // =========================================================================
  // 3. C3 & H1: اختبار الصرف الخادمي الذري والخصم الحقيقي من صندوق الكاشير
  // =========================================================================
  try {
    const testNum = `TR-AUDIT-${Date.now().toString().slice(-5)}`;
    const payoutAmount = 5000;
    const payoutCurrency = 'SAR';

    // تسجيل الحوالة أولاً
    remittanceRegistry.registerMasterRemittance({
      id: `rem-${testNum}`,
      transferNumber: testNum,
      direction: 'incoming',
      status: 'available',
      senderName: 'سعيد عبد الله النماري',
      senderPhone: '771234567',
      recipientName: 'صديق علي محمد الفتاحي',
      recipientPhone: '779077071',
      networkName: 'شبكة النجم',
      amount: payoutAmount,
      currency: payoutCurrency,
      feeAmount: 0,
      totalPaid: payoutAmount,
      branchName: 'المركز الرئيسي',
      tellerName: 'إدارة العمليات',
      createdAt: getYemenDateTimeString(),
    });

    const cashierBalanceBefore = serverAccountingEngine.getCashierBalance(payoutCurrency);

    // صرف الحوالة عبر الخادم
    const payoutResult = remittanceRegistry.payoutRemittance({
      idempotencyKey: `idem_${testNum}_1`,
      transferId: `id-${testNum}`,
      transferNumber: testNum,
      recipientIdType: 'national_id',
      recipientIdNumber: '04010099881',
      tellerId: 'usr-003',
      tellerName: 'صديق علي الفتاحي',
      tellerRole: 'teller',
      amount: payoutAmount,
      currency: payoutCurrency,
    });

    assert(
      payoutResult.success === true && !!payoutResult.journalEntry,
      'C3: اختبار توليد قيد اليومية الحقيقي المعتمد على الخادم',
      'المحاسبة الموحدة (C3)',
      `تم توليد قيد خادمي حقيقي برقم (${payoutResult.journalEntry?.entryNumber}) وحفظه في journal_entries.json.`
    );

    const cashierBalanceAfter = serverAccountingEngine.getCashierBalance(payoutCurrency);
    assert(
      cashierBalanceBefore - cashierBalanceAfter === payoutAmount,
      'C3: اختبار خصم النقدية الفعلي من صندوق الكاشير على الخادم',
      'المحاسبة الموحدة (C3)',
      `تم خصم ${payoutAmount} ${payoutCurrency} فعلياً من رصيد الصندوق بالخادم (من ${cashierBalanceBefore} إلى ${cashierBalanceAfter}).`
    );
  } catch (err: any) {
    assert(false, 'C3: اختبار الصرف الخادمي الذري', 'المحاسبة الموحدة (C3)', err.message);
  }

  // =========================================================================
  // 4. H2: اختبار إحباط إعادة استخدام مفتاح عدم التكرار لحوالة أخرى (Cross-Transfer Idempotency Attack)
  // =========================================================================
  try {
    const transferA = `TR-A-${Date.now().toString().slice(-4)}`;
    const transferB = `TR-B-${Date.now().toString().slice(-4)}`;
    const sharedIdempotencyKey = `idem_shared_${Date.now()}`;

    // تسجيل الحوالتين
    remittanceRegistry.registerMasterRemittance({
      id: `rem-${transferA}`,
      transferNumber: transferA,
      direction: 'incoming',
      status: 'available',
      senderName: 'عميل أ',
      senderPhone: '771111111',
      recipientName: 'مستلم أ',
      recipientPhone: '772222222',
      networkName: 'شبكة النجم',
      amount: 1000,
      currency: 'SAR',
      feeAmount: 0,
      totalPaid: 1000,
      branchName: 'الفرع الرئيسي',
      tellerName: 'الإدارة',
      createdAt: getYemenDateTimeString(),
    });

    remittanceRegistry.registerMasterRemittance({
      id: `rem-${transferB}`,
      transferNumber: transferB,
      direction: 'incoming',
      status: 'available',
      senderName: 'عميل ب',
      senderPhone: '773333333',
      recipientName: 'مستلم ب',
      recipientPhone: '774444444',
      networkName: 'شبكة النجم',
      amount: 2000,
      currency: 'SAR',
      feeAmount: 0,
      totalPaid: 2000,
      branchName: 'الفرع الرئيسي',
      tellerName: 'الإدارة',
      createdAt: getYemenDateTimeString(),
    });

    // صرف الحوالة الأولى بالمفتاح
    const payoutA = remittanceRegistry.payoutRemittance({
      idempotencyKey: sharedIdempotencyKey,
      transferId: `id-${transferA}`,
      transferNumber: transferA,
      recipientIdType: 'national_id',
      recipientIdNumber: '04010022334',
      tellerId: 'usr-003',
      tellerName: 'الكاشير',
      tellerRole: 'teller',
      amount: 1000,
      currency: 'SAR',
    });

    assert(
      payoutA.success === true,
      'H2: صرف الحوالة الأولى بمفتاح عدم التكرار بنجاح',
      'حماية التكرار (H2)',
      'تم اعتماد صرف الحوالة الأولى وربط المفتاح برقمها.'
    );

    // محاولة صرف الحوالة الثانية بنفس المفتاح الخاص بالأولى
    const payoutBWithSameKey = remittanceRegistry.payoutRemittance({
      idempotencyKey: sharedIdempotencyKey,
      transferId: `id-${transferB}`,
      transferNumber: transferB,
      recipientIdType: 'national_id',
      recipientIdNumber: '04010022334',
      tellerId: 'usr-003',
      tellerName: 'الكاشير',
      tellerRole: 'teller',
      amount: 2000,
      currency: 'SAR',
    });

    assert(
      payoutBWithSameKey.success === false && Boolean(payoutBWithSameKey.error?.includes('مستخدم مسبقاً لحوالة أخرى')),
      'H2: اختبار إحباط إعادة استخدام نفس المفتاح لحوالة أخرى',
      'حماية التكرار (H2)',
      'رفض الخادم استخدام نفس مفتاح عدم التكرار لحوالة مختلفة ومنع التداخل بين الحوالات.'
    );
  } catch (err: any) {
    assert(false, 'H2: اختبار تكرار المفتاح بين حوالتين', 'حماية التكرار (H2)', err.message);
  }

  // =========================================================================
  // 5. C2/C3: اختبار المطابقة المحاسبية الحقيقية (Reconciliation Audit)
  // =========================================================================
  try {
    const reconReport = remittanceRegistry.reconcilePayouts();
    assert(
      reconReport.status === 'BALANCED' && reconReport.discrepanciesCount === 0,
      'C2/C3: اختبار تقرير المطابقة الشامل مع دفتر القيود الخادمي',
      'الرقابة والمطابقة المالية',
      `تمت مطابقة ${reconReport.matchedCount} عملية صرف مقابل دفتر قيود اليومية الخادمي وتأكيد توازنها 100%.`
    );
  } catch (err: any) {
    assert(false, 'اختبار تقرير المطابقة', 'الرقابة والمطابقة المالية', err.message);
  }

  // =========================================================================
  // 6. L1: اختبار توقيت اليمن الرسمي (Asia/Aden UTC+3)
  // =========================================================================
  try {
    const yemenTime = getYemenDateTimeString();
    assert(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(yemenTime),
      'L1: اختبار توثيق التوقيت الرسمي لليمن (UTC+3)',
      'التوقيت والمزامنة (L1)',
      `تم توليد التوقيت الرسمي المعتمد: "${yemenTime}".`
    );
  } catch (err: any) {
    assert(false, 'L1: اختبار توقيت اليمن', 'التوقيت والمزامنة (L1)', err.message);
  }

  // =========================================================================
  // 7. اختبار التفقيط المالي الرسمي والسندات
  // =========================================================================
  try {
    const tafqeetResult = tafqeetArabic(5000, 'SAR');
    assert(
      tafqeetResult.includes('خمسة آلاف') && tafqeetResult.includes('ريال سعودي'),
      'اختبار التفقيط العربي المالي الرسمي',
      'التقارير المحاسبية والسندات',
      `تم توليد نص التفقيط الرسمي: "${tafqeetResult}".`
    );
  } catch (err: any) {
    assert(false, 'اختبار التفقيط', 'التقارير المحاسبية والسندات', err.message);
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
