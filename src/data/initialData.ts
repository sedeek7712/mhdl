import { Account, CashBoxShift, ExchangeRate, ExchangeRateAuditLog, JournalEntry, Remittance, RemittanceSettings, SystemAuditLog, UserProfile } from '../types/exchange';

export const CURRENT_USER: UserProfile = {
  id: 'usr-001',
  name: 'عمرو النماري',
  role: 'owner',
  roleTitleAr: 'المالك والمشرف العام',
  branchId: 'br-01',
  branchName: 'المركز الرئيسي - صنعاء',
};

export const AVAILABLE_ROLES: { role: UserProfile['role']; titleAr: string; desc: string }[] = [
  { role: 'owner', titleAr: 'المالك (Owner)', desc: 'إشراف كامل وإدارة السياسات واعتماد العمليات الحساسة' },
  { role: 'general_manager', titleAr: 'المدير العام (General Manager)', desc: 'إدارة العمليات والفروع وأسعار الصرف والتقارير الشاملة' },
  { role: 'branch_manager', titleAr: 'مدير الفرع (Branch Manager)', desc: 'إدارة الصناديق والموظفين وإقفال الوردية والتوافقات' },
  { role: 'teller', titleAr: 'الكاشير / الصراف (Teller)', desc: 'تنفيذ عمليات القبض والصرف والحوالات وإصدار السندات' },
  { role: 'auditor', titleAr: 'المحاسب / المدقق (Auditor)', desc: 'مراجعة القيود والتصفيات والتقارير المالية دون تعديل' },
];

export const INITIAL_EXCHANGE_RATES: ExchangeRate[] = [
  // مقابل الريال اليمني القديم (صنعاء)
  { id: 'rate-1', fromCurrency: 'USD', toCurrency: 'YER_OLD', buyRate: 535, sellRate: 538, updatedAt: '2026-11-04 08:00', updatedBy: 'عمرو النماري' },
  { id: 'rate-2', fromCurrency: 'SAR', toCurrency: 'YER_OLD', buyRate: 140, sellRate: 141, updatedAt: '2026-11-04 08:00', updatedBy: 'عمرو النماري' },
  
  // مقابل الريال اليمني الجديد (عدن)
  { id: 'rate-3', fromCurrency: 'USD', toCurrency: 'YER_NEW', buyRate: 1910, sellRate: 1925, updatedAt: '2026-11-04 08:00', updatedBy: 'عمرو النماري' },
  { id: 'rate-4', fromCurrency: 'SAR', toCurrency: 'YER_NEW', buyRate: 501, sellRate: 504, updatedAt: '2026-11-04 08:00', updatedBy: 'عمرو النماري' },

  // التحويل بين العملتين اليمنيتين القديمة والجديدة
  { id: 'rate-5', fromCurrency: 'YER_OLD', toCurrency: 'YER_NEW', buyRate: 3.55, sellRate: 3.58, updatedAt: '2026-11-04 08:00', updatedBy: 'عمرو النماري' },

  // USD إلى SAR
  { id: 'rate-6', fromCurrency: 'USD', toCurrency: 'SAR', buyRate: 3.75, sellRate: 3.76, updatedAt: '2026-11-04 08:00', updatedBy: 'عمرو النماري' },
];

// سجلات تدقيق أسعار الصرف خالية تماماً عند البدء
export const INITIAL_EXCHANGE_AUDIT_LOGS: ExchangeRateAuditLog[] = [];

// دليل الحسابات الموحد (Chart of Accounts) - مهيأ بأرصدة صفرية نظيفة للعمليات الفعلية
export const INITIAL_ACCOUNTS: Account[] = [
  {
    id: 'acc-1101',
    code: '1101',
    nameAr: 'الخزينة المركزية (الصندوق الرئيسي)',
    type: 'asset',
    category: 'cash_box',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
  },
  {
    id: 'acc-1102',
    code: '1102',
    nameAr: 'صندوق كاشير الصراف 1 (عمرو النماري)',
    type: 'asset',
    category: 'cash_box',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
  },
  {
    id: 'acc-1201',
    code: '1201',
    nameAr: 'حساب بنك الكريمي الإسلامي',
    type: 'asset',
    category: 'bank',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
  },
  {
    id: 'acc-1301',
    code: '1301',
    nameAr: 'حساب شبكة النجم للحوالات',
    type: 'asset',
    category: 'network',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
  },
  {
    id: 'acc-1302',
    code: '1302',
    nameAr: 'حساب شبكة الامتياز للحوالات',
    type: 'asset',
    category: 'network',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
  },
  {
    id: 'acc-2101',
    code: '2101',
    nameAr: 'أمانات وحسابات العملاء الجارية',
    type: 'liability',
    category: 'customer',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
  },
  {
    id: 'acc-2201',
    code: '2201',
    nameAr: 'حوالات معلقة وقيد التسليم (أموال عابرة)',
    type: 'liability',
    category: 'customer',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
  },
  {
    id: 'acc-3101',
    code: '3101',
    nameAr: 'رأس مال المؤسسة وحقوق الملكية',
    type: 'equity',
    category: 'capital',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
  },
  {
    id: 'acc-4101',
    code: '4101',
    nameAr: 'إيرادات عمولات الحوالات المالية',
    type: 'revenue',
    category: 'commission',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
  },
  {
    id: 'acc-4102',
    code: '4102',
    nameAr: 'أرباح فروق أسعار الصرف (فوارق العملات)',
    type: 'revenue',
    category: 'exchange_profit',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
  },
  {
    id: 'acc-5101',
    code: '5101',
    nameAr: 'مصاريف التشغيل والإيجارات والخدمات',
    type: 'expense',
    category: 'operating_expense',
    balances: {
      YER_OLD: 0,
      YER_NEW: 0,
      SAR: 0,
      USD: 0,
    },
  },
];

// سجل الحوالات خالٍ تماماً عند البدء
export const INITIAL_REMITTANCES: Remittance[] = [];

// دفتر القيود اليومية المزدوجة خالٍ تماماً عند البدء
export const INITIAL_JOURNAL_ENTRIES: JournalEntry[] = [];

// الوردية النشطة الأولية - جاهزة برصيد نظيف
export const INITIAL_ACTIVE_SHIFT: CashBoxShift = {
  id: 'shift-01',
  boxId: 'acc-1102',
  boxNameAr: 'صندوق كاشير الصراف 1 (عمرو النماري)',
  tellerId: 'usr-001',
  tellerName: 'عمرو النماري',
  openedAt: '2026-11-04 08:00',
  status: 'open',
  openingBalances: {
    YER_OLD: 0,
    YER_NEW: 0,
    SAR: 0,
    USD: 0,
  },
  expectedBalances: {
    YER_OLD: 0,
    YER_NEW: 0,
    SAR: 0,
    USD: 0,
  },
  actualBalances: {
    YER_OLD: 0,
    YER_NEW: 0,
    SAR: 0,
    USD: 0,
  },
  discrepancies: {
    YER_OLD: 0,
    YER_NEW: 0,
    SAR: 0,
    USD: 0,
  },
  notes: 'الوردية مفتوحة - رصيد افتتاحي نظيف وجاهز لبدء العمليات الفعلية',
};

// إعدادات الحوالات الافتراضية للمؤسسة (الإصدار التلقائي المتسلسل الفريد)
export const INITIAL_REMITTANCE_SETTINGS: RemittanceSettings = {
  numberingMode: 'automatic',
  prefix: 'TR-',
  nextSequence: 931107,
  updatedAt: '2026-11-06 09:00',
  updatedBy: 'عمرو النماري',
  updatedByRole: 'owner',
  notes: 'التهيئة الافتراضية: الترقيم التلقائي المركزي المتسلسل لمنع التكرار وضمان سلامة الدورة المستندية.',
};

// سجل التدقيق المالي والإداري للعمليات الحساسة وتغيير السياسات
export const INITIAL_SYSTEM_AUDIT_LOGS: SystemAuditLog[] = [
  {
    id: 'audit-init-01',
    category: 'remittance_numbering',
    action: 'تهيئة سياسة ترقيم الحوالات',
    details: 'اعتماد سياسة الترقيم التلقائي المركزي (TR-) كسياسة رسمية معتمدة لمنع تكرار الأرقام بين الفروع',
    performedBy: 'عمرو النماري',
    userRole: 'owner',
    timestamp: '2026-11-06 09:00',
    oldValue: 'غير محدد',
    newValue: 'automatic (TR-)',
  },
];
