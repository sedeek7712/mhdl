import React, { useState, useEffect } from 'react';
import { Account, CurrencyCode, JournalEntry, Remittance, SUPPORTED_CURRENCIES, UserProfile } from '../types/exchange';
import { CustomerKYC } from '../types/customer';
import { formatMoney, tafqeetArabic } from '../services/accountingEngine';
import { buildWhatsAppLink } from '../services/notificationEngine';
import { ALNAMARI_LOGO_BASE64 } from '../assets/logoBase64';
import {
  ArrowLeftRight,
  Check,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  IdCard,
  MessageCircle,
  Phone,
  Printer,
  Receipt,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { Button } from './ui/Button';

interface A4AccountStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  customers: CustomerKYC[];
  journalEntries: JournalEntry[];
  remittances?: Remittance[];
  currentUser: UserProfile;
  initialMode?: 'profits' | 'customer' | 'account';
  targetCustomerId?: string;
  targetAccountId?: string;
}

export const A4AccountStatementModal: React.FC<A4AccountStatementModalProps> = ({
  isOpen,
  onClose,
  accounts,
  customers,
  journalEntries,
  remittances = [],
  currentUser,
  initialMode = 'profits',
  targetCustomerId,
  targetAccountId,
}) => {
  const [statementType, setStatementType] = useState<'customer' | 'account' | 'profits'>(initialMode);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    targetCustomerId || customers[0]?.id || ''
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    targetAccountId || accounts[0]?.id || 'acc-1102'
  );
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>('SAR');
  const [printLayout, setPrintLayout] = useState<'a4' | 'thermal'>('a4');
  const [copied, setCopied] = useState(false);

  // Sync state whenever modal opens or props change
  useEffect(() => {
    if (isOpen) {
      if (targetCustomerId) {
        setStatementType('customer');
        setSelectedCustomerId(targetCustomerId);
      } else if (targetAccountId) {
        setStatementType('account');
        setSelectedAccountId(targetAccountId);
      } else if (initialMode) {
        setStatementType(initialMode);
      }
    }
  }, [isOpen, targetCustomerId, targetAccountId, initialMode]);

  if (!isOpen) return null;

  // Selected customer & account metadata
  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) || customers[0];
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || accounts[0];

  // 1. Customer Statement Calculation (Isolated from Cashier Drawers)
  const customerLines: {
    date: string;
    time: string;
    refNumber: string;
    description: string;
    type: 'outgoing' | 'incoming' | 'deposit' | 'withdrawal' | 'other';
    debit: number; // Customer owes / receives
    credit: number; // Customer pays / deposits
    balance: number;
  }[] = [];

  let customerRunningBalance = 0;
  if (selectedCustomer) {
    // Collect customer remittances
    const matchedRemittances = remittances.filter(
      (r) =>
        r.currency === selectedCurrency &&
        (r.senderPhone === selectedCustomer.phone ||
          r.recipientPhone === selectedCustomer.phone ||
          r.senderName.includes(selectedCustomer.fullName) ||
          r.recipientName.includes(selectedCustomer.fullName))
    );

    matchedRemittances.forEach((rem) => {
      const isSender =
        rem.senderPhone === selectedCustomer.phone || rem.senderName.includes(selectedCustomer.fullName);
      const isOutgoing = rem.direction === 'outgoing';

      // For customer account:
      // When customer sends remittance, they pay totalPaid (credit to their cash deposit) or debited to transfer.
      // When customer receives payout, they receive amount.
      let debit = 0;
      let credit = 0;
      let desc = '';

      if (isSender) {
        credit = rem.totalPaid;
        desc = `إرسال حوالة صادرة رقم ${rem.transferNumber} للمستلم ${rem.recipientName} (${rem.networkName})`;
      } else {
        debit = rem.amount;
        desc = `استلام حوالة واردة رقم ${rem.transferNumber} من المرسل ${rem.senderName} (${rem.networkName})`;
      }

      customerRunningBalance += credit - debit;

      customerLines.push({
        date: rem.createdAt.split(' ')[0],
        time: rem.createdAt.split(' ')[1] || '00:00',
        refNumber: rem.transferNumber,
        description: desc,
        type: isOutgoing ? 'outgoing' : 'incoming',
        debit,
        credit,
        balance: customerRunningBalance,
      });
    });
  }

  const customerTotalDebits = customerLines.reduce((s, l) => s + l.debit, 0);
  const customerTotalCredits = customerLines.reduce((s, l) => s + l.credit, 0);
  const customerFinalBalance = customerRunningBalance;

  // 2. GL Account Statement Calculation
  const ledgerLines: {
    date: string;
    time: string;
    entryNumber: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }[] = [];

  let runningBalance = 0;
  if (selectedAccount) {
    journalEntries.forEach((entry) => {
      entry.lines.forEach((line) => {
        if (line.accountId === selectedAccountId && line.currency === selectedCurrency) {
          const change =
            selectedAccount.type === 'asset' || selectedAccount.type === 'expense'
              ? line.debit - line.credit
              : line.credit - line.debit;
          runningBalance += change;

          ledgerLines.push({
            date: entry.date,
            time: entry.time,
            entryNumber: entry.entryNumber,
            description: entry.descriptionAr + (line.note ? ` - ${line.note}` : ''),
            debit: line.debit,
            credit: line.credit,
            balance: runningBalance,
          });
        }
      });
    });
  }

  const glTotalDebits = ledgerLines.reduce((s, l) => s + l.debit, 0);
  const glTotalCredits = ledgerLines.reduce((s, l) => s + l.credit, 0);
  const glFinalBalance = runningBalance;

  // 3. Profit Statement Calculations Across 4 Currencies
  const profitReport: Record<
    CurrencyCode,
    {
      commissionRevenue: number;
      exchangeProfit: number;
      totalRevenue: number;
      operatingExpenses: number;
      netProfit: number;
    }
  > = {
    YER_OLD: { commissionRevenue: 0, exchangeProfit: 0, totalRevenue: 0, operatingExpenses: 0, netProfit: 0 },
    YER_NEW: { commissionRevenue: 0, exchangeProfit: 0, totalRevenue: 0, operatingExpenses: 0, netProfit: 0 },
    SAR: { commissionRevenue: 0, exchangeProfit: 0, totalRevenue: 0, operatingExpenses: 0, netProfit: 0 },
    USD: { commissionRevenue: 0, exchangeProfit: 0, totalRevenue: 0, operatingExpenses: 0, netProfit: 0 },
  };

  accounts.forEach((acc) => {
    (Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).forEach((cur) => {
      const b = acc.balances[cur] || 0;
      if (acc.category === 'commission') profitReport[cur].commissionRevenue += b;
      if (acc.category === 'exchange_profit') profitReport[cur].exchangeProfit += b;
      if (acc.category === 'operating_expense') profitReport[cur].operatingExpenses += b;
    });
  });

  (Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).forEach((cur) => {
    profitReport[cur].totalRevenue = profitReport[cur].commissionRevenue + profitReport[cur].exchangeProfit;
    profitReport[cur].netProfit = profitReport[cur].totalRevenue - profitReport[cur].operatingExpenses;
  });

  const handlePrint = () => {
    window.print();
  };

  // WhatsApp text generation
  const generateWhatsAppStatementText = () => {
    const today = new Date().toISOString().split('T')[0];
    if (statementType === 'customer' && selectedCustomer) {
      return `━━━━━━━━━━━━━━━━━━━━━
🏢 *شركة عمرو النماري للصرافة*
📋 *كشف حساب عميل معتمد*
📅 التاريخ: ${today}
👤 العميل: ${selectedCustomer.fullName} (${selectedCustomer.code})
📞 الهاتف: ${selectedCustomer.phone}
💰 العملة: ${SUPPORTED_CURRENCIES[selectedCurrency].nameAr}
━━━━━━━━━━━━━━━━━━━━━
➕ إجمالي المقبوض: ${formatMoney(customerTotalCredits, selectedCurrency)}
➖ إجمالي المسلّم: ${formatMoney(customerTotalDebits, selectedCurrency)}
💵 *الرصيد النهائي الصافي:* ${formatMoney(customerFinalBalance, selectedCurrency)}
✍️ التفقيط: ${tafqeetArabic(customerFinalBalance, selectedCurrency)}
━━━━━━━━━━━━━━━━━━━━━
🔒 صادر ومعتمد من إدارة الحسابات والتدقيق - مؤسسة عمرو النماري`;
    } else if (statementType === 'account') {
      return `━━━━━━━━━━━━━━━━━━━━━
🏢 *شركة عمرو النماري للصرافة*
📋 *كشف حركة حساب دفتري (أستاذ عام)*
📅 التاريخ: ${today}
👤 الحساب: ${selectedAccount?.nameAr} (${selectedAccount?.code})
💰 العملة: ${SUPPORTED_CURRENCIES[selectedCurrency].nameAr}
━━━━━━━━━━━━━━━━━━━━━
➕ إجمالي المدين: ${formatMoney(glTotalDebits, selectedCurrency)}
➖ إجمالي الدائن: ${formatMoney(glTotalCredits, selectedCurrency)}
💵 *الرصيد الدفتري الحالي:* ${formatMoney(glFinalBalance, selectedCurrency)}
✍️ التفقيط: ${tafqeetArabic(glFinalBalance, selectedCurrency)}
━━━━━━━━━━━━━━━━━━━━━
🔒 مطابق وموثق دفترياً`;
    } else {
      return `━━━━━━━━━━━━━━━━━━━━━
🏢 *شركة عمرو النماري للصرافة*
📊 *كشف الأرباح الشامل المعتمد*
📅 التاريخ: ${today}
🏛️ الفرع: ${currentUser.branchName}
━━━━━━━━━━━━━━━━━━━━━
💰 *صافي الأرباح التشغيلية بالعملات الأربع:*
🇾🇪 ريال يمني (قديم): ${formatMoney(profitReport.YER_OLD.netProfit, 'YER_OLD')}
🇾🇪 ريال يمني (جديد): ${formatMoney(profitReport.YER_NEW.netProfit, 'YER_NEW')}
🇸🇦 ريال سعودي: ${formatMoney(profitReport.SAR.netProfit, 'SAR')}
🇺🇸 دولار أمريكي: ${formatMoney(profitReport.USD.netProfit, 'USD')}
━━━━━━━━━━━━━━━━━━━━━
🔒 صادر ومعتمد من الإدارة المالية`;
    }
  };

  const whatsappMessage = generateWhatsAppStatementText();
  const whatsappTargetPhone =
    statementType === 'customer' && selectedCustomer ? selectedCustomer.phone : '';
  const whatsappUrl = buildWhatsAppLink(whatsappTargetPhone, whatsappMessage);

  const handleCopyText = () => {
    navigator.clipboard.writeText(whatsappMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex flex-col justify-start sm:justify-center items-center p-2 sm:p-4 overflow-y-auto no-print"
      dir="rtl"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl max-w-4xl w-full my-auto shadow-2xl flex flex-col max-h-[96vh] sm:max-h-[94vh] overflow-hidden">
        {/* Sticky Action Header */}
        <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-3 sm:px-6 py-3 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={onClose}
              aria-label="إغلاق"
              className="w-10 h-10 min-w-[40px] text-slate-400 hover:text-white rounded-xl bg-slate-800/80 hover:bg-slate-750 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
              title="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="truncate">
              <span className="text-[10px] font-mono text-emerald-400 font-bold block">
                محرك التقارير المحاسبية وكشوفات الحساب الرسمية
              </span>
              <h2 className="text-xs sm:text-sm font-bold text-white truncate">
                {statementType === 'customer'
                  ? `كشف حساب العميل: ${selectedCustomer?.fullName || ''}`
                  : statementType === 'account'
                  ? `كشف حساب دفتري: ${selectedAccount?.nameAr || ''}`
                  : 'كشف الأرباح الشامل المعتمد (A4)'}
              </h2>
            </div>
          </div>

          {/* Action buttons & Print Format selector */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Format toggle: A4 vs POS Thermal */}
            <div className="flex items-center p-0.5 bg-slate-800 rounded-lg text-xs">
              <button
                onClick={() => setPrintLayout('a4')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                  printLayout === 'a4' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                ورق A4
              </button>
              <button
                onClick={() => setPrintLayout('thermal')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                  printLayout === 'thermal' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                رول حراري (POS)
              </button>
            </div>

            <Button
              variant="secondary"
              size="sm"
              icon={<Printer className="w-3.5 h-3.5 text-emerald-400" />}
              onClick={handlePrint}
            >
              <span className="hidden sm:inline">طباعة</span>
            </Button>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 sm:px-4 py-1.5 bg-[#00a884] hover:bg-[#02906f] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-950/40 transition-all hover:scale-[1.02]"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>إرسال واتساب</span>
            </a>
          </div>
        </div>

        {/* Filter bar for statements: Clean segmented mode picker */}
        <div className="bg-slate-850 px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium">نوع التقرير:</span>
            <div className="flex items-center p-0.5 bg-slate-900 rounded-lg">
              <button
                onClick={() => setStatementType('customer')}
                className={`px-3 py-1 rounded font-semibold transition-colors flex items-center gap-1.5 ${
                  statementType === 'customer'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>كشف حساب عميل</span>
              </button>
              <button
                onClick={() => setStatementType('account')}
                className={`px-3 py-1 rounded font-semibold transition-colors flex items-center gap-1.5 ${
                  statementType === 'account'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>حساب الأستاذ العام</span>
              </button>
              <button
                onClick={() => setStatementType('profits')}
                className={`px-3 py-1 rounded font-semibold transition-colors flex items-center gap-1.5 ${
                  statementType === 'profits'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>الأرباح الشاملة</span>
              </button>
            </div>
          </div>

          {/* Contextual Selector Based on Statement Type */}
          <div className="flex flex-wrap items-center gap-3">
            {statementType === 'customer' && (
              <div className="flex items-center gap-1.5">
                <label className="text-slate-400">العميل:</label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-white rounded-lg px-2.5 py-1 text-xs max-w-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName} ({c.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {statementType === 'account' && (
              <div className="flex items-center gap-1.5">
                <label className="text-slate-400">الحساب:</label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-white rounded-lg px-2.5 py-1 text-xs max-w-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.code} - {acc.nameAr}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Currency Filter (for Customer and Account modes) */}
            {statementType !== 'profits' && (
              <div className="flex items-center gap-1.5">
                <label className="text-slate-400">العملة:</label>
                <select
                  value={selectedCurrency}
                  onChange={(e) => setSelectedCurrency(e.target.value as CurrencyCode)}
                  className="bg-slate-900 border border-slate-700 text-white rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((c) => (
                    <option key={c} value={c}>
                      {SUPPORTED_CURRENCIES[c].flag} {SUPPORTED_CURRENCIES[c].nameAr}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Printable Statement Sheet Body */}
        <div className="p-3 sm:p-6 overflow-y-auto space-y-4 flex-1 bg-slate-900/60">
          {/* Printable Container: Either A4 Page or POS Thermal Strip */}
          <div
            className={`mx-auto bg-white text-slate-950 shadow-xl border-2 border-slate-300 printable-voucher ${
              printLayout === 'a4'
                ? 'max-w-3xl rounded-2xl p-6 sm:p-8 space-y-6'
                : 'max-w-xs rounded-xl p-4 space-y-4 font-mono text-xs'
            }`}
          >
            {/* Header: Corporate Logo & Legal Details */}
            <div className="border-b-2 border-[#b91c1c] pb-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-white p-0.5 border border-slate-200 shrink-0 shadow-sm">
                  <img
                    src={ALNAMARI_LOGO_BASE64}
                    alt="شعار شركة عمرو النماري للصرافة"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div>
                  <h1 className="text-base sm:text-xl font-black text-[#991b1b] tracking-tight">
                    شركة عَمْرُو النَّمَارِي لِلصِّرَافَة
                  </h1>
                  <p className="text-[10px] sm:text-xs font-mono font-bold text-amber-800 uppercase">
                    AMRO ALNAMARI FOR EXCHANGE & FINANCE
                  </p>
                  <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5">
                    ترخيص مصرفي معتمد · المركز الرئيسي - تعز · الفرع: {currentUser.branchName}
                  </p>
                </div>
              </div>

              <div className="text-left font-mono text-[10px] sm:text-[11px] shrink-0 border border-slate-300 rounded-xl p-2 bg-slate-50">
                <div className="font-bold text-[#991b1b] font-sans text-xs">
                  {statementType === 'customer'
                    ? 'كشف حساب عميل رسمي'
                    : statementType === 'account'
                    ? 'كشف حركة حساب دفتري'
                    : 'كشف الأرباح الشامل المعتمد'}
                </div>
                <div className="text-slate-600">التاريخ: {new Date().toISOString().split('T')[0]}</div>
                <div className="text-slate-600">الوقت: {new Date().toTimeString().split(' ')[0]}</div>
                <div className="text-slate-700 font-semibold font-sans">المشغل: {currentUser.name}</div>
              </div>
            </div>

            {/* 1. Mode: CUSTOMER STATEMENT (كشف حساب العميل المستقل) */}
            {statementType === 'customer' && selectedCustomer && (
              <div className="space-y-5">
                {/* Customer Profile Banner */}
                <div className="bg-slate-100 p-3.5 rounded-xl border border-slate-300 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px]">اسم العميل:</span>
                    <strong className="text-slate-900 text-sm">{selectedCustomer.fullName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">رقم الحساب / الكود:</span>
                    <strong className="font-mono text-slate-900 text-sm">{selectedCustomer.code}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">رقم الهاتف:</span>
                    <strong className="font-mono text-slate-900">{selectedCustomer.phone}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">إثبات الهوية (KYC):</span>
                    <strong className="text-slate-900">
                      {selectedCustomer.idTypeNameAr}: {selectedCustomer.idNumber}
                    </strong>
                  </div>
                </div>

                {/* Balances Strip Across All 4 Currencies */}
                <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/70">
                  <span className="text-[11px] font-bold text-slate-700 block mb-2">
                    أرصدة حساب العميل الحالية بكافة العملات:
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                    {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((cur) => (
                      <div
                        key={cur}
                        className={`p-2 rounded-lg border ${
                          cur === selectedCurrency
                            ? 'bg-emerald-50 border-emerald-400 text-emerald-900 font-bold'
                            : 'bg-white border-slate-200 text-slate-700'
                        }`}
                      >
                        <span className="text-[10px] text-slate-500 block">
                          {SUPPORTED_CURRENCIES[cur].symbol}
                        </span>
                        <span className="font-mono font-bold">
                          {formatMoney(selectedCustomer.balances[cur] || 0, cur)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Transactions Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs border border-slate-300">
                    <thead className="bg-slate-100 text-slate-700 border-b border-slate-300">
                      <tr>
                        <th className="py-2 px-2.5">التاريخ</th>
                        <th className="py-2 px-2.5">رقم المرجع / الحوالة</th>
                        <th className="py-2 px-2.5">البيان والحركة المالية</th>
                        <th className="py-2 px-2.5 text-left">مدين / استلام (-)</th>
                        <th className="py-2 px-2.5 text-left">دائن / إيداع (+)</th>
                        <th className="py-2 px-2.5 text-left">الرصيد التراكمي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
                      {customerLines.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-slate-500 font-sans">
                            لا توجد حركات مالية مسجلة لهذا العميل بعملة {SUPPORTED_CURRENCIES[selectedCurrency].nameAr}.
                          </td>
                        </tr>
                      ) : (
                        customerLines.map((row, idx) => (
                          <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                            <td className="py-2 px-2.5 text-slate-600">{row.date}</td>
                            <td className="py-2 px-2.5 font-bold text-slate-800">{row.refNumber}</td>
                            <td className="py-2 px-2.5 font-sans max-w-xs">{row.description}</td>
                            <td className="py-2 px-2.5 text-left font-bold text-rose-700">
                              {row.debit > 0 ? formatMoney(row.debit, selectedCurrency) : '-'}
                            </td>
                            <td className="py-2 px-2.5 text-left font-bold text-emerald-700">
                              {row.credit > 0 ? formatMoney(row.credit, selectedCurrency) : '-'}
                            </td>
                            <td className="py-2 px-2.5 text-left font-bold text-slate-900 bg-slate-100/60">
                              {formatMoney(row.balance, selectedCurrency)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot className="bg-slate-100 font-mono font-bold text-xs border-t-2 border-slate-400">
                      <tr>
                        <td colSpan={3} className="py-2.5 px-3 font-sans text-slate-900">
                          الإجماليات الكلية:
                        </td>
                        <td className="py-2.5 px-2.5 text-left text-rose-800">
                          {formatMoney(customerTotalDebits, selectedCurrency)}
                        </td>
                        <td className="py-2.5 px-2.5 text-left text-emerald-800">
                          {formatMoney(customerTotalCredits, selectedCurrency)}
                        </td>
                        <td className="py-2.5 px-2.5 text-left text-slate-950 font-black bg-slate-200">
                          {formatMoney(customerFinalBalance, selectedCurrency)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Arabic Tafqeet Box */}
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                  <span className="text-slate-500">الرصيد النهائي كتابة وتفقيطاً: </span>
                  <strong className="text-slate-900">{tafqeetArabic(customerFinalBalance, selectedCurrency)}</strong>
                </div>
              </div>
            )}

            {/* 2. Mode: DETAILED ACCOUNT LEDGER A4 */}
            {statementType === 'account' && selectedAccount && (
              <div className="space-y-5">
                {/* Account Header info */}
                <div className="bg-slate-100 p-3.5 rounded-xl border border-slate-300 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px]">اسم الحساب:</span>
                    <strong className="text-slate-900 text-sm">{selectedAccount.nameAr}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">رقم الحساب:</span>
                    <strong className="font-mono text-slate-900 text-sm">{selectedAccount.code}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">العملة المعروضة:</span>
                    <strong className="text-slate-900">{SUPPORTED_CURRENCIES[selectedCurrency].nameAr}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">الرصيد الدفتري الحالي:</span>
                    <strong className="font-mono text-emerald-700 text-sm">
                      {formatMoney(glFinalBalance, selectedCurrency)}
                    </strong>
                  </div>
                </div>

                {/* Ledger Transactions Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs border border-slate-300">
                    <thead className="bg-slate-100 text-slate-700 border-b border-slate-300">
                      <tr>
                        <th className="py-2 px-2.5">التاريخ</th>
                        <th className="py-2 px-2.5">رقم القيد</th>
                        <th className="py-2 px-2.5">البيان والحركة</th>
                        <th className="py-2 px-2.5 text-left">مدين (+)</th>
                        <th className="py-2 px-2.5 text-left">دائن (-)</th>
                        <th className="py-2 px-2.5 text-left">الرصيد التراكمي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
                      {ledgerLines.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-slate-500 font-sans">
                            لا توجد حركات مسجلة لهذا الحساب بهذه العملة خلال الفترة.
                          </td>
                        </tr>
                      ) : (
                        ledgerLines.map((row, idx) => (
                          <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                            <td className="py-2 px-2.5 text-slate-600">{row.date}</td>
                            <td className="py-2 px-2.5 font-bold text-slate-800">{row.entryNumber}</td>
                            <td className="py-2 px-2.5 font-sans max-w-xs">{row.description}</td>
                            <td className="py-2 px-2.5 text-left font-bold text-emerald-700">
                              {row.debit > 0 ? formatMoney(row.debit, selectedCurrency) : '-'}
                            </td>
                            <td className="py-2 px-2.5 text-left font-bold text-amber-700">
                              {row.credit > 0 ? formatMoney(row.credit, selectedCurrency) : '-'}
                            </td>
                            <td className="py-2 px-2.5 text-left font-bold text-slate-900 bg-slate-100/60">
                              {formatMoney(row.balance, selectedCurrency)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot className="bg-slate-100 font-mono font-bold text-xs border-t-2 border-slate-400">
                      <tr>
                        <td colSpan={3} className="py-2.5 px-3 font-sans text-slate-900">
                          الإجماليات الكلية:
                        </td>
                        <td className="py-2.5 px-2.5 text-left text-emerald-800">
                          {formatMoney(glTotalDebits, selectedCurrency)}
                        </td>
                        <td className="py-2.5 px-2.5 text-left text-amber-800">
                          {formatMoney(glTotalCredits, selectedCurrency)}
                        </td>
                        <td className="py-2.5 px-2.5 text-left text-slate-950 font-black bg-slate-200">
                          {formatMoney(glFinalBalance, selectedCurrency)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Arabic Tafqeet Box */}
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                  <span className="text-slate-500">الرصيد كتابة وتفقيطاً: </span>
                  <strong className="text-slate-900">{tafqeetArabic(glFinalBalance, selectedCurrency)}</strong>
                </div>
              </div>
            )}

            {/* 3. Mode: PROFIT STATEMENT A4 */}
            {statementType === 'profits' && (
              <div className="space-y-6">
                <div className="bg-slate-100 p-3.5 rounded-xl border border-slate-300">
                  <h2 className="text-sm font-bold text-slate-900 mb-1">
                    ملخص الأرباح التشغيلية وصافي الدخل المعتمد
                  </h2>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    يعرض هذا التقرير تفاصيل الأرباح الناتجة عن عمولات الحوالات وفروق أسعار صرف العملات بعد خصم
                    المصروفات التشغيلية، مع مراعاة الفصل المحاسبي التام للعملات الأربع.
                  </p>
                </div>

                {/* Grid for 4 currencies */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((cur) => {
                    const data = profitReport[cur];
                    return (
                      <div
                        key={cur}
                        className="border border-slate-300 rounded-xl p-4 bg-slate-50 space-y-2.5 font-sans"
                      >
                        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                          <span className="font-bold text-slate-900 text-sm">
                            {SUPPORTED_CURRENCIES[cur].flag} {SUPPORTED_CURRENCIES[cur].nameAr}
                          </span>
                          <span className="text-xs font-mono font-bold text-slate-600">
                            {SUPPORTED_CURRENCIES[cur].symbol}
                          </span>
                        </div>

                        <div className="space-y-1.5 text-xs font-mono">
                          <div className="flex justify-between text-slate-600">
                            <span className="font-sans">إيراد عمولات الحوالات:</span>
                            <span className="font-bold text-slate-900">
                              {formatMoney(data.commissionRevenue, cur)}
                            </span>
                          </div>
                          <div className="flex justify-between text-slate-600">
                            <span className="font-sans">أرباح فروق أسعار الصرف:</span>
                            <span className="font-bold text-slate-900">
                              {formatMoney(data.exchangeProfit, cur)}
                            </span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-slate-200 font-bold text-slate-800">
                            <span className="font-sans">إجمالي الإيرادات:</span>
                            <span>{formatMoney(data.totalRevenue, cur)}</span>
                          </div>
                          <div className="flex justify-between text-rose-700">
                            <span className="font-sans">المصروفات التشغيلية:</span>
                            <span>-{formatMoney(data.operatingExpenses, cur)}</span>
                          </div>
                          <div className="flex justify-between pt-1.5 border-t-2 border-slate-900 font-bold text-sm bg-emerald-50 p-1.5 rounded">
                            <span className="font-sans text-emerald-900">صافي الربح المعتمد:</span>
                            <span className="text-emerald-800">{formatMoney(data.netProfit, cur)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Official Signatures & Footer Notice */}
            <div className="pt-6 border-t-2 border-slate-300 grid grid-cols-3 gap-4 text-center text-xs">
              <div>
                <span className="text-slate-600 block mb-8 font-semibold">المحاسب المالي</span>
                <div className="border-t border-slate-400 pt-1 text-[11px] text-slate-600">
                  {currentUser.name}
                </div>
              </div>
              <div>
                <span className="text-slate-600 block mb-8 font-semibold">ختم الإدارة والاعتماد</span>
                <div className="border-t border-slate-400 pt-1 text-[11px] text-slate-600">
                  [ ختـم معتمـد ]
                </div>
              </div>
              <div>
                <span className="text-slate-600 block mb-8 font-semibold">المدير العام / المالك</span>
                <div className="border-t border-slate-400 pt-1 text-[11px] text-slate-600">
                  عمرو النماري
                </div>
              </div>
            </div>

            <div className="text-center text-[10px] text-slate-500 pt-2 border-t border-slate-100">
              وثيقة محاسبية رسمية صادرة من مؤسسة عمرو النماري للصرافة والحسابات · معتمدة وفق المعايير المالية المصرفية
            </div>
          </div>

          {/* Quick Copy Box */}
          <div className="bg-slate-850 border border-slate-800 rounded-xl p-3 sm:p-4 max-w-3xl mx-auto flex items-center justify-between text-xs">
            <span className="text-slate-300 flex items-center gap-1.5 font-medium">
              <MessageCircle className="w-4 h-4 text-emerald-400" />
              <span>جاهز للإرسال الفوري للعميل عبر WhatsApp</span>
            </span>
            <button
              onClick={handleCopyText}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-750 text-slate-200 rounded-lg border border-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'تم النسخ!' : 'نسخ نص الإشعار'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
