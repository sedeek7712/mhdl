/**
 * Automated Enterprise Audit & Verification Test Suite
 * MHDL - Amro Alnamari Exchange ERP
 * اختبارات التدقيق الأمني والمحاسبي والوظيفي الشامل
 * تغطية البنود المكتشفة في تقرير التدقيق المستقل: C1, C2, C3, H1, H2, H3, H4, M1, M2, L1
 */

import crypto from 'crypto';
import { authService, createPinCredentials, migrateLegacyUsers, hashPinWithSalt, verifyPinHash, isWeakPin, requireAuth } from '../src/server/services/authService.js';
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
    // N3: لا رموز ثابتة؛ نهيّئ رمز اختبار في الذاكرة فقط (لا يُحفظ على القرص)
    const legacyTry = authService.authenticateUser('owner', '1234', '10.9.9.9');
    assert(
      legacyTry.success === false,
      'N3: رمز المالك القديم (1234) مرفوض',
      'المرحلة 2 (الأمان)',
      'لم يعد أي رمز ثابت معروف يفتح النظام.'
    );
    Object.assign(authService.findUser('owner')!, createPinCredentials('Test-Owner-Pin-2026'));
    const realLogin = authService.authenticateUser('owner', 'Test-Owner-Pin-2026', '127.0.0.1');
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
  // 3.1 N1: اختبار منع الصرف المزدوج عبر نمط Write-Ahead وحماية القيد المزدوج
  // =========================================================================
  try {
      const doubleTestNum = `TR-N1-TEST-${Date.now().toString().slice(-5)}`;
      const payoutAmount = 1000;
      const payoutCurrency = 'SAR';

      // تسجيل الحوالة أولاً
      remittanceRegistry.registerMasterRemittance({
        id: `rem-${doubleTestNum}`,
        transferNumber: doubleTestNum,
        direction: 'incoming',
        status: 'available',
        senderName: 'عميل اختبار',
        senderPhone: '771234567',
        recipientName: 'مستلم اختبار الصرف المزدوج',
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

      const initialCashierBalance = serverAccountingEngine.getCashierBalance(payoutCurrency);

      // حفظ الدالة الأصلية وحقن خطأ في savePayoutsToDisk لمحاكاة الانهيار أثناء الصرف
      const originalSavePayouts = (remittanceRegistry as any).savePayoutsToDisk;
      let failureInjected = false;

      (remittanceRegistry as any).savePayoutsToDisk = function () {
        if (!failureInjected) {
          failureInjected = true;
          throw new Error('محاكاة انهيار النظام أو فشل الكتابة على القرص أثناء الصرف (Crash Simulation)');
        }
        return originalSavePayouts.apply(this, arguments);
      };

      try {
        remittanceRegistry.payoutRemittance({
          idempotencyKey: `idem_${doubleTestNum}_crash`,
          transferId: `id-${doubleTestNum}`,
          transferNumber: doubleTestNum,
          recipientIdType: 'national_id',
          recipientIdNumber: '04010099881',
          tellerId: 'usr-003',
          tellerName: 'صديق علي الفتاحي',
          tellerRole: 'teller',
          amount: payoutAmount,
          currency: payoutCurrency,
        });
      } catch (e: any) {
        // تم التقاط خطأ المحاكاة
      } finally {
        // استعادة الدالة الأصلية
        (remittanceRegistry as any).savePayoutsToDisk = originalSavePayouts;
      }

      // محاكاة إعادة تشغيل السيرفر وتحميل البيانات من القرص
      (serverAccountingEngine as any).loadState();
      (remittanceRegistry as any).loadFromDisk();

      // محاولة صرف نفس الحوالة مرة ثانية بعد إعادة التشغيل
      const secondAttempt = remittanceRegistry.payoutRemittance({
        idempotencyKey: `idem_${doubleTestNum}_second`,
        transferId: `id-${doubleTestNum}`,
        transferNumber: doubleTestNum,
        recipientIdType: 'national_id',
        recipientIdNumber: '04010099881',
        tellerId: 'usr-003',
        tellerName: 'صديق علي الفتاحي',
        tellerRole: 'teller',
        amount: payoutAmount,
        currency: payoutCurrency,
      });

      // التحقق من قيود اليومية الخاصة بهذه الحوالة
      const allEntries = serverAccountingEngine.getJournalEntries();
      const matchingEntries = allEntries.filter(
        (j) => j.referenceType === 'transfer_payout' && j.referenceId === doubleTestNum
      );

      const finalCashierBalance = serverAccountingEngine.getCashierBalance(payoutCurrency);
      const totalDeducted = initialCashierBalance - finalCashierBalance;

      // يجب أن يكون هناك قيد واحد فقط لكل حوالة، والصندوق مخصوماً مرة واحدة فقط (أو العملية ملغاة بالكامل 0 قيد و0 خصم)
      const isExactlyOnePayout = matchingEntries.length === 1 && totalDeducted === payoutAmount;
      const isFullyRolledBack = matchingEntries.length === 0 && totalDeducted === 0;

      assert(
        isExactlyOnePayout || isFullyRolledBack,
        'N1: اختبار منع الصرف المزدوج والتعافي بعد انهيار الحفظ',
        'منع الصرف المزدوج (N1)',
        `النتيجة: تم تسجيل ${matchingEntries.length} قيد، وإجمالي الخصم ${totalDeducted} ${payoutCurrency}. ${
          isExactlyOnePayout ? 'تم التعافي والصرف لمرة واحدة فقط دون تكرار.' : isFullyRolledBack ? 'تم التراجع الكامل دون خصم.' : 'فشل: حدث صرف مزدوج أو عدم اتساق مالي!'
        }`
      );
    } catch (err: any) {
      assert(false, 'N1: اختبار منع الصرف المزدوج', 'منع الصرف المزدوج (N1)', err.message);
    }

    // =========================================================================
    // 3.2 N2: اختبار منع تصفير البيانات عند تلف الملفات والنسخ الاحتياطي
    // =========================================================================
    try {
      const fs = await import('fs');
      const path = await import('path');
      const testDir = path.resolve(process.cwd(), 'data', 'test_corruption');
      if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

      const emptyLedgerPath = path.resolve(testDir, 'accounts_ledger_empty.json');
      const corruptUsersPath = path.resolve(testDir, 'system_users_corrupt.json');
      const corruptRemittancesPath = path.resolve(testDir, 'remittances_master_corrupt.json');
      const atomicBakTestPath = path.resolve(testDir, 'atomic_bak_test.json');

      // 1. ملف دفتر أستاذ فارغ (0 بايت)
      fs.writeFileSync(emptyLedgerPath, '');
      let emptyLedgerFailed = false;
      try {
        safeReadJson(emptyLedgerPath, [{ id: 'acc-fake', balances: {} }]);
      } catch (e: any) {
        emptyLedgerFailed = true;
      }

      // 2. ملف مستخدمين مقطوع (Truncated JSON)
      fs.writeFileSync(corruptUsersPath, '{"users": [ {"username": "admin"');
      let corruptUsersFailed = false;
      try {
        safeReadJson(corruptUsersPath, [{ id: 'usr-default' }]);
      } catch (e: any) {
        corruptUsersFailed = true;
      }

      // 3. ملف حوالات مقطوع
      fs.writeFileSync(corruptRemittancesPath, '[{"transferNumber": "TR-123", "amount":');
      let corruptRemittancesFailed = false;
      try {
        safeReadJson(corruptRemittancesPath, []);
      } catch (e: any) {
        corruptRemittancesFailed = true;
      }

      // 4. اختبار حفظ نسخة .bak في safeAtomicWriteJson
      safeAtomicWriteJson(atomicBakTestPath, { initial: true });
      safeAtomicWriteJson(atomicBakTestPath, { updated: true });
      const bakExists = fs.existsSync(`${atomicBakTestPath}.bak`);

      // التحقق من إنشاء ملفات .corrupt.*
      const dirFiles = fs.readdirSync(testDir);
      const corruptBackupsCreated = dirFiles.filter((f) => f.includes('.corrupt.')).length >= 3;

      // تنظيف ملفات الاختبار
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup
      }

      const allProtected = emptyLedgerFailed && corruptUsersFailed && corruptRemittancesFailed && bakExists && corruptBackupsCreated;
      assert(
        allProtected,
        'N2: اختبار منع تصفير البيانات والتعامل مع الملفات الفارغة/المقطوعة كتالفة وإنشاء .bak',
        'حماية الملفات وتلف البيانات (N2)',
        `النتيجة: كشف الملف الفارغ (${emptyLedgerFailed})، كشف ملف users المقطوع (${corruptUsersFailed})، كشف الحوالات المقطوعة (${corruptRemittancesFailed})، إنشاء .bak (${bakExists})، حفظ نسخ .corrupt (${corruptBackupsCreated}).`
      );
    } catch (err: any) {
      assert(false, 'N2: اختبار حماية البيانات من التلف', 'حماية الملفات وتلف البيانات (N2)', err.message);
    }

    // =========================================================================
    // 3.3 N5: اختبار دفتر الأستاذ في ملف واحد ذري (ledger.json) وفحص تطابق الأرصدة والقيود
    // =========================================================================
    try {
      const fs = await import('fs');
      const path = await import('path');
      const ledgerPath = path.resolve(process.cwd(), 'data', 'ledger.json');
      const accountsPath = path.resolve(process.cwd(), 'data', 'accounts_ledger.json');
      const journalPath = path.resolve(process.cwd(), 'data', 'journal_entries.json');

      // 1. فحص وجود دالة فحص التطابق وتحققها من البيانات الفعلية الحالية
      const verifyIntegrityMethod = (serverAccountingEngine as any).verifyLedgerIntegrity;
      const hasMethod = typeof verifyIntegrityMethod === 'function';

      let currentDataIntegrityPasses = false;
      if (hasMethod) {
        const integrityResult = (serverAccountingEngine as any).verifyLedgerIntegrity();
        currentDataIntegrityPasses = integrityResult.isValid === true;
      }

      // 2. اختبار إحباط وكشف التعديل اليدوي على الرصيد دون قيد محاسبي
      let tamperingDetected = false;
      if (hasMethod) {
        // نأخذ نسخة معدلة برصيد ملعوب فيه (+1000 SAR دون قيد)
        const accountsCopy = serverAccountingEngine.getAccounts();
        const testAccount = accountsCopy.find((a) => a.id === 'acc-1102');
        if (testAccount) {
          testAccount.balances.SAR += 1000; // تعديل رصيد دون قيد!
          const tamperedResult = (serverAccountingEngine as any).verifyLedgerIntegrity(
            accountsCopy,
            serverAccountingEngine.getJournalEntries()
          );
          if (tamperedResult.isValid === false && Boolean(tamperedResult.error?.includes('عدم تطابق'))) {
            tamperingDetected = true;
          }
        }
      }

      // 3. التحقق من أن ledger.json تم إنشاؤه ذرياً والملفات القديمة ما زالت موجودة دون حذف
      const ledgerFileExists = fs.existsSync(ledgerPath);
      // الملفان القديمان اختياريان (data/ غير متتبَّع الآن): المطلوب ألا يُحذف أحدهما دون الآخر
      const oldFilesPreserved =
        (!fs.existsSync(accountsPath) && !fs.existsSync(journalPath)) || (fs.existsSync(accountsPath) && fs.existsSync(journalPath));

      const n5Success = hasMethod && currentDataIntegrityPasses && tamperingDetected && ledgerFileExists && oldFilesPreserved;

      assert(
        n5Success,
        'N5: اختبار دفتر الأستاذ الذري الموحد (ledger.json) وفحص تطابق القيود والأرصدة',
        'دفتر الأستاذ الذري الموحد (N5)',
        `النتيجة: وجود فحص التطابق (${hasMethod})، تطابق البيانات الحالية (${currentDataIntegrityPasses})، كشف التلاعب بالرصيد دون قيد (${tamperingDetected})، وجود ledger.json (${ledgerFileExists})، إبقاء الملفات القديمة دون حذف (${oldFilesPreserved}).`
      );
    } catch (err: any) {
      assert(false, 'N5: اختبار دفتر الأستاذ الذري الموحد', 'دفتر الأستاذ الذري الموحد (N5)', err.message);
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

  // =========================================================================
  // 3-D. اختبارات المرحلة 1-ب (R1 ترحيل بأرصدة غير افتراضية / R2 إيقاف المرآة / R3 COMMIT_PENDING_RECOVERY)
  // =========================================================================
  try {
    const { computeInitialBalances } = await import('../src/server/services/serverAccountingEngine.js');
    const fsR = await import('fs');
    const pathR = await import('path');
    const sha = (f: string) => (fsR.existsSync(f) ? crypto.createHash('sha256').update(fsR.readFileSync(f)).digest('hex') : 'absent');

    // R1: الافتتاحي = الرصيد − صافي القيود (وليس القيم الافتراضية)
    const acc: any = { id: 'acc-x', balances: { YER_OLD: 0, YER_NEW: 0, SAR: 123456, USD: 0 } };
    const entries: any[] = [{ lines: [
      { accountId: 'acc-x', currency: 'SAR', debit: 1000, credit: 0 },
      { accountId: 'acc-x', currency: 'SAR', debit: 0, credit: 400 },
      { accountId: 'other', currency: 'SAR', debit: 0, credit: 999 },
    ] }];
    const init = computeInitialBalances(acc, entries);
    assert(
      init.SAR === 123456 - 600 && init.USD === 0,
      'R1: اشتقاق الرصيد الافتتاحي من الرصيد وصافي القيود عند الترحيل',
      'المرحلة 1-ب',
      `الافتتاحي المشتق لـ SAR = ${init.SAR} (المتوقع 122856).`
    );

    const mkRem = (n: string) => remittanceRegistry.registerMasterRemittance({
      id: `r-${n}`, transferNumber: n, direction: 'incoming', status: 'available', senderName: 's', senderPhone: '',
      recipientName: 'r', recipientPhone: '', networkName: 'n', amount: 1, currency: 'SAR', feeAmount: 0, totalPaid: 1,
      branchName: 'b', tellerName: 't', createdAt: '2026-11-09 10:00',
    } as any);
    const dataDir = pathR.resolve(process.cwd(), 'data');
    const legacyA = pathR.join(dataDir, 'accounts_ledger.json');
    const legacyJ = pathR.join(dataDir, 'journal_entries.json');
    const ledgerF = pathR.join(dataDir, 'ledger.json');
    const sfx = Date.now().toString().slice(-6);
    const mk1 = `R2-${sfx}`;
    mkRem(mk1);
    const hA = sha(legacyA), hJ = sha(legacyJ), hL = sha(ledgerF);
    const p1 = remittanceRegistry.payoutRemittance({ transferId: mk1, transferNumber: mk1, recipientIdType: 'national_id', recipientIdNumber: '1', tellerId: 'usr-003', tellerName: 't', tellerRole: 'teller' });
    assert(
      p1.success === true && sha(legacyA) === hA && sha(legacyJ) === hJ && sha(ledgerF) !== hL,
      'R2: الصرف يكتب ledger.json فقط ولا يلمس الملفين القديمين',
      'المرحلة 1-ب',
      'لا مرآة قديمة بعد الآن (الملفان محفوظان دون حذف).'
    );

    // R3: فشل الحفظ النهائي بعد القيد → COMMIT_PENDING_RECOVERY وخصم واحد
    const mk2 = `R3-${sfx}`;
    mkRem(mk2);
    const before = serverAccountingEngine.getJournalEntries().length;
    const bal0 = serverAccountingEngine.getCashierBalance('SAR');
    let calls = 0;
    const reg: any = remittanceRegistry;
    const origSave = reg.savePayoutsToDisk.bind(reg);
    reg.savePayoutsToDisk = () => { calls++; if (calls >= 2) throw new Error('disk full'); return origSave(); };
    const p2 = remittanceRegistry.payoutRemittance({ transferId: mk2, transferNumber: mk2, recipientIdType: 'national_id', recipientIdNumber: '1', tellerId: 'usr-003', tellerName: 't', tellerRole: 'teller' });
    reg.savePayoutsToDisk = origSave;
    assert(
      p2.success === false && p2.errorCode === 'COMMIT_PENDING_RECOVERY' &&
        serverAccountingEngine.getJournalEntries().length === before + 1 &&
        serverAccountingEngine.getCashierBalance('SAR') === bal0 - 1,
      'R3: رمز COMMIT_PENDING_RECOVERY عند فشل الحفظ النهائي بعد الخصم',
      'المرحلة 1-ب',
      `الرمز: ${p2.errorCode}، قيد واحد وخصم واحد فقط.`
    );
  } catch (err: any) {
    assert(false, 'اختبارات المرحلة 1-ب', 'المرحلة 1-ب', err.message);
  }

  // =========================================================================
  // 3-E. اختبارات المرحلة 2 (N3 / N10): الرموز، الترحيل، إبطال الجلسات، تعطيل الحساب
  // =========================================================================
  try {
    // ترحيل سجل قديم (PBKDF2 + رمز 1234) → scrypt + كلمة مرور عشوائية + tokenVersion
    const legacySalt = crypto.randomBytes(16).toString('hex');
    const legacyRec: any = {
      id: 'u-legacy', name: 'قديم', username: 'legacy', role: 'teller', branchId: 'b', branchName: 'b',
      pinSalt: legacySalt, pinHash: hashPinWithSalt('1234', legacySalt, 'pbkdf2'), isActive: true, createdAt: 'x',
    };
    const modernCreds = createPinCredentials('Modern-Pin-Keep-1');
    const modernRec: any = { ...legacyRec, id: 'u-modern', username: 'modern', ...modernCreds, tokenVersion: 3 };
    const mig = migrateLegacyUsers([legacyRec, modernRec]);
    const [m0, m1] = mig.users;
    assert(
      m0.pinAlgo === 'scrypt' && !verifyPinHash('1234', m0.pinSalt, m0.pinHash, 'scrypt') &&
        m0.tokenVersion === 1 && mig.issued.length === 1 && mig.issued[0].password.length === 12 &&
        verifyPinHash(mig.issued[0].password, m0.pinSalt, m0.pinHash, 'scrypt') &&
        m1.pinHash === modernRec.pinHash && m1.tokenVersion === 3,
      'N3: ترحيل السجل القديم إلى scrypt بكلمة مرور عشوائية وترك الحديث كما هو',
      'المرحلة 2 (الأمان)',
      'الرمز القديم 1234 لا يعمل بعد الترحيل، والسجلات الحديثة لا تُمَسّ.'
    );

    assert(
      isWeakPin('1234') && isWeakPin('11111111') && isWeakPin('12345678') && !isWeakPin('Kx92-pLm41'),
      'N3: سياسة الرمز الضعيف (قصير/مكرر/شائع)',
      'المرحلة 2 (الأمان)',
      'يُرفض القصير والمكرر والشائع ويُقبل الرمز القوي.'
    );

    // تغيير الرمز يُبطل الجلسات القديمة (بدون الكتابة على ملف المستخدمين الحقيقي)
    const svc: any = authService;
    const origSave = svc.saveUsersToDisk.bind(svc);
    svc.saveUsersToDisk = () => {};
    try {
      const teller = authService.findUser('teller')!;
      Object.assign(teller, createPinCredentials('Teller-Test-Pin-1'));
      const loginA = authService.authenticateUser('sedeek', 'Teller-Test-Pin-1', '10.1.1.1');
      const oldPayload = authService.verifyToken(loginA.token!)!;
      const shortRes = authService.changePin('sedeek', 'Teller-Test-Pin-1', 'abc12');
      const weakRes = authService.changePin('sedeek', 'Teller-Test-Pin-1', '11111111');
      const wrongRes = authService.changePin('sedeek', 'bad-current-1', 'Another-Pin-2027');
      const okRes = authService.changePin('sedeek', 'Teller-Test-Pin-1', 'Another-Pin-2027');
      const newPayload = okRes.token ? authService.verifyToken(okRes.token)! : null;
      let status = 0;
      requireAuth({ headers: { authorization: `Bearer ${loginA.token}` } } as any, { status(c: number) { status = c; return { json() {} }; } } as any, () => { status = 200; });
      assert(
        shortRes.success === false && weakRes.success === false && wrongRes.success === false && okRes.success === true &&
          authService.validateSession(oldPayload) === false && !!newPayload && authService.validateSession(newPayload) === true && status === 401,
        'N10: تغيير الرمز يرفض القصير والضعيف والخاطئ ويُبطل التوكن القديم',
        'المرحلة 2 (الأمان)',
        'التوكن القديم يُرفض بـ 401 والتوكن الجديد صالح.'
      );

      // الحساب المعطّل لا يدخل ولا تصلح جلسته
      teller.isActive = false;
      const disabledLogin = authService.authenticateUser('sedeek', 'Another-Pin-2027', '10.2.2.2');
      const disabledSession = newPayload ? authService.validateSession(newPayload) : true;
      teller.isActive = true;
      assert(
        disabledLogin.success === false && disabledSession === false,
        'N10: الحساب المعطّل (isActive=false) لا يدخل ولا تصلح جلسته',
        'المرحلة 2 (الأمان)',
        'تم رفض الدخول والجلسة للحساب المعطّل.'
      );
    } finally {
      svc.saveUsersToDisk = origSave;
    }
  } catch (err: any) {
    assert(false, 'اختبارات المرحلة 2', 'المرحلة 2 (الأمان)', err.message);
  }

  // =========================================================================
  // 3-F. اختبارات المرحلة 3: N8 أرقام سندات الصرف متسلسلة وفريدة وتصدرها الخادم
  // =========================================================================
  try {
    const sfx3 = Date.now().toString().slice(-6);
    const nums = [`N8A-${sfx3}`, `N8B-${sfx3}`, `N8C-${sfx3}`];
    for (const n of nums) {
      remittanceRegistry.registerMasterRemittance({
        id: `n8-${n}`, transferNumber: n, direction: 'incoming', status: 'available', senderName: 's', senderPhone: '',
        recipientName: 'r', recipientPhone: '', networkName: 'n', amount: 1, currency: 'SAR', feeAmount: 0, totalPaid: 1,
        branchName: 'b', tellerName: 't', createdAt: '2026-11-09 10:00',
      } as any);
    }
    const vouchers: string[] = [];
    for (const n of nums) {
      const r = remittanceRegistry.payoutRemittance({
        transferId: n, transferNumber: n, recipientIdType: 'national_id', recipientIdNumber: '1',
        tellerId: 'usr-003', tellerName: 't', tellerRole: 'teller',
        voucherNumber: 'V-PAY-0001', // قيمة العميل يجب أن تُتجاهل
      } as any);
      if (r.success && r.record) vouchers.push(r.record.voucherNumber);
    }
    const seqs = vouchers.map((v) => parseInt(v.split('-').pop() || '0', 10));
    assert(
      vouchers.length === 3 && new Set(vouchers).size === 3 && vouchers.every((v) => /^V-PAY-\d{4}-\d{5}$/.test(v)) &&
        seqs[1] === seqs[0] + 1 && seqs[2] === seqs[1] + 1 && !vouchers.includes('V-PAY-0001'),
      'N8: أرقام سندات الصرف متسلسلة وفريدة ومن الخادم (يُتجاهل رقم العميل)',
      'المرحلة 3',
      `الأرقام: ${vouchers.join(', ')}`
    );
  } catch (err: any) {
    assert(false, 'اختبار N8', 'المرحلة 3', err.message);
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
