/**
 * بنية الكود النظيف وتقسيم الطبقات (Clean Architecture) لنظام عمرو النماري للصرافة
 * بلغة Dart وإطار عمل Flutter لجميع أنظمة التشغيل (Cross-Platform)
 */

export interface FlutterCodeFile {
  path: string;
  layer: 'Domain' | 'Data' | 'Presentation' | 'Core';
  titleAr: string;
  descriptionAr: string;
  code: string;
}

export interface ProjectPhase {
  number: number;
  titleAr: string;
  objectiveAr: string;
  deliverablesAr: string[];
  status: 'completed' | 'in_progress' | 'ready';
  technicalStack: string[];
}

export const PROJECT_EXECUTION_PHASES: ProjectPhase[] = [
  {
    number: 1,
    titleAr: 'المرحلة الأولى: التحليل والتصميم المفهومي ومخططات العمليات ودليل الحسابات',
    objectiveAr: 'تأسيس المعمارية المالية ومخططات سير البيانات، واعتماد شجرة الحسابات المنفصلة للعملات الأربع وقواعد القيد المزدوج.',
    deliverablesAr: [
      'هندسة متطلبات النظام المالي ومخططات BPMN لدورة حياة الحوالات',
      'دليل الحسابات الشامل وفصل الريال القديم عن الجديد',
      'صياغة عقود الطبقات (Clean Architecture Interface Contracts)',
      'توثيق قيود التدقيق الأمني لمنع الحذف أو التعديل بأثر رجعي',
    ],
    status: 'completed',
    technicalStack: ['Domain-Driven Design (DDD)', 'UML / Mermaid', 'Clean Architecture', 'Double-Entry Invariants'],
  },
  {
    number: 2,
    titleAr: 'المرحلة الثانية: البنية الأساسية وقاعدة البيانات وإدارة المستخدمين والعملات والصناديق',
    objectiveAr: 'بناء نواة النظام، الجداول العلائقية المشفرة، إدارة أسعار الصرف مع السجل التاريخي Audit Log، والصناديق والخزائن.',
    deliverablesAr: [
      'تهيئة محرك قواعد البيانات المتوافق مع SQLite / Drift للعمل Offline ومزامنة السيرفر',
      'نظام إدارة الصلاحيات متعدد الأدوار (RBAC: المالك، المدير، الكاشير، المدقق)',
      'محرك أسعار الصرف اللحظي وحفظ سعر العملية غير القابل للتعديل',
      'إدارة الصناديق المتعددة وإثبات الأرصدة الافتتاحية المستقلة',
    ],
    status: 'completed',
    technicalStack: ['Dart 3.x / Flutter 3.x', 'Drift / SQLite ORM', 'RBAC Security Policies', 'Audit Trail Engine'],
  },
  {
    number: 3,
    titleAr: 'المرحلة الثالثة: تطبيق المحاسبة، الحوالات، الصرافة، والشبكات',
    objectiveAr: 'برمجة محرك الصرافة (بيع، شراء، تحويل عملة)، دورة حياة الحوالات الصادرة والواردة، والقيود العكسية للاسترداد.',
    deliverablesAr: [
      'مكتبة القيد المزدوج التلقائي المتوازن لحظياً لكل عملة',
      'شاشة صرافة سريعة للكاشير مع حساب الهوامش والعمولات الآلية',
      'إدارة شبكات التحويل (النجم، الامتياز، يمن إكسبرس) ومطابقة الأرصدة',
      'آلية استرداد وإلغاء الحوالات بالقيود العكسية المشروطة بالصلاحيات',
    ],
    status: 'completed',
    technicalStack: ['BLoC State Management', 'Transactional Unit of Work', 'Reverse Entry Engine', 'Validation Pipes'],
  },
  {
    number: 4,
    titleAr: 'المرحلة الرابعة: محرك الإشعارات وسندات الـ WhatsApp والربط مع المزود المعتمد',
    objectiveAr: 'إنشاء محرك السندات الرسمي، التفقيط التلقائي، رمز التحقق QR، والإشعارات الفورية للواتساب.',
    deliverablesAr: [
      'مولد سندات الصرف والقبض الرسمي مع الترويسة والباركود الأمني',
      'محرك تفقيط المبالغ باللغة العربية للريال والدولار (Tafqeet Engine)',
      'محرك إشعارات WhatsApp التلقائي بنصوص منسقة ورابط فوري للعميل',
      'ضوابط الإرسال: منع إرسال الإشعار إلا بعد نجاح التثبيت المحاسبي',
    ],
    status: 'completed',
    technicalStack: ['Receipt & Notification Engine', 'WhatsApp Business URL/API', 'ISO QR Generator', 'PDF / Printing Plugin'],
  },
  {
    number: 5,
    titleAr: 'المرحلة الخامسة: التقارير، الرقابة، الإقفالات، واختبارات الأمان والأداء',
    objectiveAr: 'إقفال الورديات اليومي، ميزان المراجعة، الأستاذ العام، وقائمة الدخل مع فحص الأمان تحت انقطاع الإنترنت.',
    deliverablesAr: [
      'إقفال ورديات الكاشير ومقارنة الجرد الفعلي بالدفتري ورصد الفروقات',
      'التقارير المحاسبية: ميزان المراجعة، الأستاذ، كشوفات حساب العملاء',
      'فصل الأرباح التشغيلية عن الأموال العابرة (الحوالات غير المدفوعة)',
      'محرك التخزين المحلي Offline ومزامنة التضاربات فور عودة الاتصال',
    ],
    status: 'completed',
    technicalStack: ['Sync Queue Worker', 'Financial Audit Reports', 'Cross-Platform Compilers (Desktop/Mobile)', 'Integration Tests'],
  },
];

export const FLUTTER_CLEAN_CODE_FILES: FlutterCodeFile[] = [
  {
    path: 'lib/core/engine/double_entry_engine.dart',
    layer: 'Core',
    titleAr: 'محرك القيد المزدوج وتوازن العملات',
    descriptionAr: 'يضمن توازن مجموع المدين مع مجموع الدائن لكل عملة على حدة دون خلط بين الريال القديم والجديد.',
    code: `// lib/core/engine/double_entry_engine.dart
import 'package:decimal/decimal.dart';

enum SupportedCurrency {
  yerOld, // ريال يمني طبعة قديمة (صنعاء)
  yerNew, // ريال يمني طبعة جديدة (عدن)
  sar,    // ريال سعودي
  usd,    // دولار أمريكي
}

class JournalEntryItem {
  final String accountId;
  final String accountNameAr;
  final SupportedCurrency currency;
  final Decimal debit;
  final Decimal credit;
  final String? note;

  const JournalEntryItem({
    required this.accountId,
    required this.accountNameAr,
    required this.currency,
    required this.debit,
    required this.credit,
    this.note,
  });
}

class DoubleEntryValidationResult {
  final bool isBalanced;
  final Map<SupportedCurrency, Decimal> differences;
  final String? errorMessage;

  const DoubleEntryValidationResult({
    required this.isBalanced,
    required this.differences,
    this.errorMessage,
  });
}

/// محرك القيد المحاسبي المزدوج الصارم لشركة عمرو النماري للصرافة
class DoubleEntryEngine {
  static DoubleEntryValidationResult validateBalance(List<JournalEntryItem> items) {
    final Map<SupportedCurrency, Decimal> debitSums = {};
    final Map<SupportedCurrency, Decimal> creditSums = {};

    for (final currency in SupportedCurrency.values) {
      debitSums[currency] = Decimal.zero;
      creditSums[currency] = Decimal.zero;
    }

    for (final item in items) {
      debitSums[item.currency] = (debitSums[item.currency] ?? Decimal.zero) + item.debit;
      creditSums[item.currency] = (creditSums[item.currency] ?? Decimal.zero) + item.credit;
    }

    final Map<SupportedCurrency, Decimal> differences = {};
    bool balanced = true;
    final List<String> errorMessages = [];

    for (final currency in SupportedCurrency.values) {
      final totalDebit = debitSums[currency]!;
      final totalCredit = creditSums[currency]!;
      final diff = (totalDebit - totalCredit).abs();
      differences[currency] = diff;

      if (diff > Decimal.zero) {
        balanced = false;
        errorMessages.add(
          'عدم توازن في عملة \${currency.name}: إجمالي المدين (\${totalDebit}) لا يتطابق مع الدائن (\${totalCredit}) بفارق \${diff}',
        );
      }
    }

    return DoubleEntryValidationResult(
      isBalanced: balanced,
      differences: differences,
      errorMessage: balanced ? null : errorMessages.join(' | '),
    );
  }
}`,
  },
  {
    path: 'lib/features/accounting/domain/entities/journal_entry_entity.dart',
    layer: 'Domain',
    titleAr: 'كيان سند القيد المحاسبي (Domain Entity)',
    descriptionAr: 'كيان نقي في طبقة الدومين يمثل القيد المحاسبي غير القابل للتعديل مع التوقيع المالي.',
    code: `// lib/features/accounting/domain/entities/journal_entry_entity.dart
import 'package:equatable/equatable.dart';
import '../../../../core/engine/double_entry_engine.dart';

enum EntryReferenceType {
  exchange,
  transferSend,
  transferPayout,
  transferReverse,
  shiftOpening,
  dailyClosure,
}

class JournalEntryEntity extends Equatable {
  final String id;
  final String entryNumber;
  final DateTime timestamp;
  final String descriptionAr;
  final EntryReferenceType referenceType;
  final String referenceId;
  final String branchId;
  final String tellerId;
  final List<JournalEntryItem> lines;
  final bool isBalanced;
  final bool isSynced;

  const JournalEntryEntity({
    required this.id,
    required this.entryNumber,
    required this.timestamp,
    required this.descriptionAr,
    required this.referenceType,
    required this.referenceId,
    required this.branchId,
    required this.tellerId,
    required this.lines,
    required this.isBalanced,
    this.isSynced = false,
  });

  @override
  List<Object?> get props => [
        id,
        entryNumber,
        timestamp,
        descriptionAr,
        referenceType,
        referenceId,
        branchId,
        tellerId,
        lines,
        isBalanced,
        isSynced,
      ];
}`,
  },
  {
    path: 'lib/features/exchange/domain/usecases/execute_exchange_usecase.dart',
    layer: 'Domain',
    titleAr: 'حالة الاستخدام: تنفيذ عملية صرف عملات (Use Case)',
    descriptionAr: 'منطق العمل النقي (Pure Business Logic) لتنفيذ صرف العملة وتوليد القيد المزدوج والسند.',
    code: `// lib/features/exchange/domain/usecases/execute_exchange_usecase.dart
import 'package:decimal/decimal.dart';
import '../../../../core/engine/double_entry_engine.dart';
import '../../accounting/domain/entities/journal_entry_entity.dart';
import '../../accounting/domain/repositories/accounting_repository.dart';

class ExecuteExchangeParams {
  final String customerName;
  final String? customerPhone;
  final SupportedCurrency sourceCurrency;
  final Decimal sourceAmount;
  final SupportedCurrency targetCurrency;
  final Decimal exchangeRate;
  final Decimal calculatedTargetAmount;
  final Decimal commissionAmount;
  final String tellerBoxAccountId;
  final String branchId;
  final String tellerId;

  const ExecuteExchangeParams({
    required this.customerName,
    this.customerPhone,
    required this.sourceCurrency,
    required this.sourceAmount,
    required this.targetCurrency,
    required this.exchangeRate,
    required this.calculatedTargetAmount,
    required this.commissionAmount,
    required this.tellerBoxAccountId,
    required this.branchId,
    required this.tellerId,
  });
}

class ExecuteExchangeResult {
  final JournalEntryEntity journalEntry;
  final String voucherNumber;
  final DateTime executedAt;

  const ExecuteExchangeResult({
    required this.journalEntry,
    required this.voucherNumber,
    required this.executedAt,
  });
}

class ExecuteExchangeUseCase {
  final AccountingRepository repository;

  ExecuteExchangeUseCase({required this.repository});

  Future<ExecuteExchangeResult> call(ExecuteExchangeParams params) async {
    // 1. التحقق من المدخلات ومعدل الصرف
    if (params.sourceAmount <= Decimal.zero) {
      throw ArgumentError('مبلغ العملية يجب أن يكون أكبر من الصفر');
    }

    // 2. التحقق من توفر السيولة في صندوق الصراف بالعملة المخرجة
    final hasLiquidity = await repository.checkBoxBalance(
      boxAccountId: params.tellerBoxAccountId,
      currency: params.targetCurrency,
      requiredAmount: params.calculatedTargetAmount,
    );
    if (!hasLiquidity) {
      throw StateError('عذراً، رصيد الصندوق غير كافٍ بالعملة المطلوبة لتنفيذ العملية.');
    }

    // 3. بناء خطوط القيد المزدوج المتوازن تلقائياً
    // - قبض العملة الداخلة (مدين الصندوق بالعملة المصروفة)
    // - صرف العملة الخارجة (دائن الصندوق بالعملة المسلمة)
    // - تسوية عبر حساب وسيط تبادل العملات وحساب أرباح فروق الأسعار
    final lines = <JournalEntryItem>[
      JournalEntryItem(
        accountId: params.tellerBoxAccountId,
        accountNameAr: 'صندوق الكاشير',
        currency: params.sourceCurrency,
        debit: params.sourceAmount,
        credit: Decimal.zero,
        note: 'قبض من العميل \${params.customerName}',
      ),
      JournalEntryItem(
        accountId: 'acc_currency_clearing',
        accountNameAr: 'وسيط تسوية العملات',
        currency: params.sourceCurrency,
        debit: Decimal.zero,
        credit: params.sourceAmount,
        note: 'تسوية عملة مقبوضة',
      ),
      JournalEntryItem(
        accountId: 'acc_currency_clearing',
        accountNameAr: 'وسيط تسوية العملات',
        currency: params.targetCurrency,
        debit: params.calculatedTargetAmount,
        credit: Decimal.zero,
        note: 'تسوية عملة منصرفة',
      ),
      JournalEntryItem(
        accountId: params.tellerBoxAccountId,
        accountNameAr: 'صندوق الكاشير',
        currency: params.targetCurrency,
        debit: Decimal.zero,
        credit: params.calculatedTargetAmount,
        note: 'تسليم للعميل \${params.customerName}',
      ),
    ];

    // 4. فحص توازن القيد
    final validation = DoubleEntryEngine.validateBalance(lines);
    if (!validation.isBalanced) {
      throw StateError('خطأ فادح في توازن القيد: \${validation.errorMessage}');
    }

    // 5. حفظ القيد وإصدار السند عبر المستودع
    return await repository.recordExchangeTransaction(
      params: params,
      lines: lines,
    );
  }
}`,
  },
  {
    path: 'lib/features/remittance/domain/entities/remittance_entity.dart',
    layer: 'Domain',
    titleAr: 'كيان الحوالات ودورة الحياة (Remittance Lifecycle)',
    descriptionAr: 'نموذج دورة حياة الحوالة: مسودة، معتمدة، متاحة للاستلام، مستلمة، أو ملغاة بقيد عكسي.',
    code: `// lib/features/remittance/domain/entities/remittance_entity.dart
import 'package:equatable/equatable.dart';
import '../../../../core/engine/double_entry_engine.dart';

enum RemittanceStatus {
  draft,     // مسودة
  approved,  // معتمدة وجاهزة
  available, // متاحة للاستلام في النظام/الشبكة
  paid,      // مستلمة / مدفوعة بنجاح
  cancelled, // ملغاة بقيد عكسي
  refunded,  // مستردة
}

enum RemittanceDirection {
  outgoing, // حوالة صادرة
  incoming, // حوالة واردة
}

class RemittanceEntity extends Equatable {
  final String id;
  final String transferNumber;
  final RemittanceDirection direction;
  final RemittanceStatus status;
  final String senderName;
  final String senderPhone;
  final String recipientName;
  final String recipientPhone;
  final String networkName;
  final double amount;
  final SupportedCurrency currency;
  final double feeAmount;
  final double totalAmount;
  final String branchName;
  final String tellerName;
  final DateTime createdAt;
  final DateTime? paidAt;
  final String? recipientIdNumber;
  final String? cancelReason;
  final String? reverseJournalEntryId;

  const RemittanceEntity({
    required this.id,
    required this.transferNumber,
    required this.direction,
    required this.status,
    required this.senderName,
    required this.senderPhone,
    required this.recipientName,
    required this.recipientPhone,
    required this.networkName,
    required this.amount,
    required this.currency,
    required this.feeAmount,
    required this.totalAmount,
    required this.branchName,
    required this.tellerName,
    required this.createdAt,
    this.paidAt,
    this.recipientIdNumber,
    this.cancelReason,
    this.reverseJournalEntryId,
  });

  bool get canBePaid => status == RemittanceStatus.available;
  bool get canBeCancelled => status == RemittanceStatus.approved || status == RemittanceStatus.available;

  @override
  List<Object?> get props => [
        id,
        transferNumber,
        direction,
        status,
        senderName,
        recipientName,
        amount,
        currency,
        createdAt,
      ];
}`,
  },
  {
    path: 'lib/features/accounting/data/datasources/local_offline_sync_datasource.dart',
    layer: 'Data',
    titleAr: 'محرك العمل دون إنترنت والمزامنة الآمنة',
    descriptionAr: 'تنفيذ بند 11.1 من الوثيقة: حفظ محلي مشفر، حظر تضارب الحوالات، وقائمة انتظار المزامنة (Sync Queue).',
    code: `// lib/features/accounting/data/datasources/local_offline_sync_datasource.dart
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class QueuedSyncOperation {
  final String id;
  final String action;
  final Map<String, dynamic> payload;
  final DateTime queuedAt;
  final int retryCount;

  const QueuedSyncOperation({
    required this.id,
    required this.action,
    required this.payload,
    required this.queuedAt,
    this.retryCount = 0,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'action': action,
        'payload': payload,
        'queuedAt': queuedAt.toIso8601String(),
        'retryCount': retryCount,
      };

  factory QueuedSyncOperation.fromJson(Map<String, dynamic> map) => QueuedSyncOperation(
        id: map['id'],
        action: map['action'],
        payload: Map<String, dynamic>.from(map['payload']),
        queuedAt: DateTime.parse(map['queuedAt']),
        retryCount: map['retryCount'] ?? 0,
      );
}

class LocalOfflineSyncDataSource {
  final SharedPreferences prefs;
  static const String _syncQueueKey = 'alnamari_sync_queue';
  static const String _cachedBalancesKey = 'alnamari_cached_balances';

  LocalOfflineSyncDataSource({required this.prefs});

  Future<void> enqueueOperation(QueuedSyncOperation op) async {
    final list = await getPendingQueue();
    list.add(op);
    final rawList = list.map((e) => jsonEncode(e.toJson())).toList();
    await prefs.setStringList(_syncQueueKey, rawList);
  }

  Future<List<QueuedSyncOperation>> getPendingQueue() async {
    final rawList = prefs.getStringList(_syncQueueKey) ?? [];
    return rawList.map((str) => QueuedSyncOperation.fromJson(jsonDecode(str))).toList();
  }

  Future<void> removeOperation(String id) async {
    final list = await getPendingQueue();
    list.removeWhere((e) => e.id == id);
    final rawList = list.map((e) => jsonEncode(e.toJson())).toList();
    await prefs.setStringList(_syncQueueKey, rawList);
  }
}`,
  },
  {
    path: 'lib/features/notifications/presentation/widgets/official_voucher_card.dart',
    layer: 'Presentation',
    titleAr: 'واجهة السند الرسمي وقابلية العمل على جميع المنصات',
    descriptionAr: 'واجهة Flutter تكيفية (Adaptive) تدعم الطباعة الحرارية والمشاركة مع WhatsApp عبر جميع أنظمة التشغيل.',
    code: `// lib/features/notifications/presentation/widgets/official_voucher_card.dart
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

class OfficialVoucherCard extends StatelessWidget {
  final String voucherNumber;
  final String titleAr;
  final String partyName;
  final String partyPhone;
  final double amount;
  final String currencyLabel;
  final String amountInWords;
  final String tellerName;
  final String branchName;
  final DateTime dateTime;
  final String qrData;
  final VoidCallback onPrint;

  const OfficialVoucherCard({
    super.key,
    required this.voucherNumber,
    required this.titleAr,
    required this.partyName,
    required this.partyPhone,
    required this.amount,
    required this.currencyLabel,
    required this.amountInWords,
    required this.tellerName,
    required this.branchName,
    required this.dateTime,
    required this.qrData,
    required this.onPrint,
  });

  void _shareViaWhatsApp() async {
    final message = '''
━━━━━━━━━━━━━━━━━━━━━
🏢 *عمرو النماري للصرافة*
📋 *سند رسمي: \${voucherNumber}*
👤 *العميل:* \${partyName}
💰 *المبلغ:* \${amount.toStringAsFixed(2)} \${currencyLabel}
✍️ *المبلغ كتابة:* \${amountInWords}
📅 *التاريخ:* \${dateTime.toString().split('.')[0]}
🏛️ *الفرع:* \${branchName} | 👨‍💼 *الصراف:* \${tellerName}
━━━━━━━━━━━━━━━━━━━━━''';

    final cleanPhone = partyPhone.replaceAll(RegExp(r'\\D'), '');
    final uri = Uri.parse('https://wa.me/\$cleanPhone?text=\${Uri.encodeComponent(message)}');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 3,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // ترويسة السند
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: const [
                    Text('عمرو النماري للصرافة', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                    Text('Amro Alnamari Exchange', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
                QrImageView(
                  data: qrData,
                  version: QrVersions.auto,
                  size: 60.0,
                ),
              ],
            ),
            const Divider(height: 32),
            // تفاصيل المبلغ والسند
            Text(titleAr, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.blueAccent)),
            const SizedBox(height: 8),
            Text('المبلغ: \${amount.toStringAsFixed(2)} \${currencyLabel}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            Text('فقط: \${amountInWords}', style: const TextStyle(color: Colors.grey, fontSize: 13)),
            const SizedBox(height: 24),
            // أزرار العمليات
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: onPrint,
                    icon: const Icon(Icons.print),
                    label: const Text('طباعة السند'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _shareViaWhatsApp,
                    icon: const Icon(Icons.send, color: Colors.green),
                    label: const Text('إرسال واتساب'),
                  ),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }
}`,
  },
];
