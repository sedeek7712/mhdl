import React, { useState } from 'react';
import { Account, CurrencyCode, JournalEntry, SUPPORTED_CURRENCIES, UserProfile } from '../types/exchange';
import { CustomerKYC } from '../types/customer';
import { formatMoney, tafqeetArabic } from '../services/accountingEngine';
import { buildWhatsAppLink } from '../services/notificationEngine';
import { ALNAMARI_LOGO_BASE64 } from '../assets/logoBase64';
import { ArrowLeftRight, Check, Copy, ExternalLink, FileSpreadsheet, FileText, MessageCircle, Printer, ShieldCheck, X } from 'lucide-react';

interface A4AccountStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  customers: CustomerKYC[];
  journalEntries: JournalEntry[];
  currentUser: UserProfile;
  initialMode?: 'profits' | 'customer' | 'account';
  targetId?: string; // customerId or accountId
}

export const A4AccountStatementModal: React.FC<A4AccountStatementModalProps> = ({
  isOpen,
  onClose,
  accounts,
  customers,
  journalEntries,
  currentUser,
  initialMode = 'profits',
  targetId,
}) => {
  const [statementType, setStatementType] = useState<'profits' | 'account'>(
    initialMode === 'profits' ? 'profits' : 'account'
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    targetId || accounts[0]?.id || 'acc-1102'
  );
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>('SAR');
  const [printLayout, setPrintLayout] = useState<'a4' | 'thermal'>('a4');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // Selected account / customer metadata
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  // Filter journal lines for the selected account and currency
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
          // In standard asset accounts, debit increases, credit decreases
          const change = selectedAccount.type === 'asset' || selectedAccount.type === 'expense'
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

  const totalDebits = ledgerLines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = ledgerLines.reduce((s, l) => s + l.credit, 0);
  const finalBalance = runningBalance;

  // Profit statement calculations across the 4 currencies
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

  // Generate WhatsApp formatted text
  const generateWhatsAppStatementText = () => {
    if (statementType === 'profits') {
      return `━━━━━━━━━━━━━━━━━━━━━
🏢 *عمرو النماري للصرافة - كشف الأرباح الشامل*
📅 التاريخ: ${new Date().toISOString().split('T')[0]}
🏛️ الفرع: ${currentUser.branchName}
━━━━━━━━━━━━━━━━━━━━━
💰 *صافي الأرباح التشغيلية حسب العملات:*
🇾🇪 ريال يمني (قديم): ${formatMoney(profitReport.YER_OLD.netProfit, 'YER_OLD')}
🇾🇪 ريال يمني (جديد): ${formatMoney(profitReport.YER_NEW.netProfit, 'YER_NEW')}
🇸🇦 ريال سعودي: ${formatMoney(profitReport.SAR.netProfit, 'SAR')}
🇺🇸 دولار أمريكي: ${formatMoney(profitReport.USD.netProfit, 'USD')}
━━━━━━━━━━━━━━━━━━━━━
🔒 صادر ومعتمد من الإدارة المالية لشركة عمرو النماري للصرافة`;
    } else {
      return `━━━━━━━━━━━━━━━━━━━━━
🏢 *عمرو النماري للصرافة - كشف حساب رسمي*
📅 التاريخ: ${new Date().toISOString().split('T')[0]}
👤 الحساب: ${selectedAccount?.nameAr} (${selectedAccount?.code})
💰 العملة: ${SUPPORTED_CURRENCIES[selectedCurrency].nameAr}
━━━━━━━━━━━━━━━━━━━━━
➕ إجمالي المدين: ${formatMoney(totalDebits, selectedCurrency)}
➖ إجمالي الدائن: ${formatMoney(totalCredits, selectedCurrency)}
💵 *الرصيد النهائي الحالي:* ${formatMoney(finalBalance, selectedCurrency)}
✍️ التفقيط: ${tafqeetArabic(finalBalance, selectedCurrency)}
━━━━━━━━━━━━━━━━━━━━━
🔒 كشف حساب معتمد ومطابق دفترياً`;
    }
  };

  const whatsappMessage = generateWhatsAppStatementText();
  const whatsappUrl = buildWhatsAppLink('', whatsappMessage);

  const handleCopyText = () => {
    navigator.clipboard.writeText(whatsappMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex flex-col justify-start sm:justify-center items-center p-2 sm:p-4 overflow-y-auto no-print"
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
                محرك التقارير وكشوفات الحساب الرسمية (A4)
              </span>
              <h2 className="text-xs sm:text-sm font-bold text-white truncate">
                {statementType === 'profits' ? 'كشف الأرباح الشامل المعتمد (A4)' : 'كشف حساب الحركات التفصيلي (A4)'}
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

            <button
              onClick={handlePrint}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Printer className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">طباعة الآن</span>
            </button>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 sm:px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/30 transition-all hover:scale-[1.02]"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>إرسال واتساب</span>
            </a>
          </div>
        </div>

        {/* Filter bar for statements */}
        <div className="bg-slate-850 px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <label className="text-slate-400">نوع الكشف:</label>
            <div className="flex items-center p-0.5 bg-slate-900 rounded-lg">
              <button
                onClick={() => setStatementType('profits')}
                className={`px-3 py-1 rounded font-semibold transition-colors ${
                  statementType === 'profits' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                كشف الأرباح الشامل
              </button>
              <button
                onClick={() => setStatementType('account')}
                className={`px-3 py-1 rounded font-semibold transition-colors ${
                  statementType === 'account' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                كشف حركات الحساب
              </button>
            </div>
          </div>

          {statementType === 'account' && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <label className="text-slate-400">الحساب:</label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-white rounded-lg px-2.5 py-1 text-xs"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.code} - {acc.nameAr}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <label className="text-slate-400">العملة:</label>
                <select
                  value={selectedCurrency}
                  onChange={(e) => setSelectedCurrency(e.target.value as CurrencyCode)}
                  className="bg-slate-900 border border-slate-700 text-white rounded-lg px-2.5 py-1 text-xs"
                >
                  {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((c) => (
                    <option key={c} value={c}>
                      {SUPPORTED_CURRENCIES[c].flag} {SUPPORTED_CURRENCIES[c].nameAr}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
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
                    AMRO ALNAMARI EXCHANGE CO.
                  </p>
                  <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5">
                    ترخيص مصرفي رقم 89/ص · ص.ب 1204 صنعاء - عدن · الفرع: {currentUser.branchName}
                  </p>
                </div>
              </div>

              <div className="text-left font-mono text-[10px] sm:text-[11px] shrink-0 border border-slate-300 rounded-xl p-2 bg-slate-50">
                <div className="font-bold text-[#991b1b] font-sans text-xs">
                  {statementType === 'profits' ? 'كشف الأرباح الشامل المعتمد' : 'كشف حساب رسمي تفصيلي'}
                </div>
                <div className="text-slate-600">التاريخ: {new Date().toISOString().split('T')[0]}</div>
                <div className="text-slate-600">الوقت: {new Date().toTimeString().split(' ')[0]}</div>
                <div className="text-slate-700 font-semibold font-sans">الموظف: {currentUser.name}</div>
              </div>
            </div>

            {/* 1. Mode: PROFIT STATEMENT A4 */}
            {statementType === 'profits' ? (
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
                            <span className="font-bold text-slate-900">{formatMoney(data.commissionRevenue, cur)}</span>
                          </div>
                          <div className="flex justify-between text-slate-600">
                            <span className="font-sans">أرباح فروق أسعار الصرف:</span>
                            <span className="font-bold text-slate-900">{formatMoney(data.exchangeProfit, cur)}</span>
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
            ) : (
              /* 2. Mode: DETAILED ACCOUNT LEDGER A4 */
              <div className="space-y-5">
                {/* Account Header info */}
                <div className="bg-slate-100 p-3.5 rounded-xl border border-slate-300 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px]">اسم الحساب:</span>
                    <strong className="text-slate-900 text-sm">{selectedAccount?.nameAr}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">رقم الحساب:</span>
                    <strong className="font-mono text-slate-900 text-sm">{selectedAccount?.code}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">العملة المعروضة:</span>
                    <strong className="text-slate-900">{SUPPORTED_CURRENCIES[selectedCurrency].nameAr}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">الرصيد الدفتري الحالي:</span>
                    <strong className="font-mono text-emerald-700 text-sm">{formatMoney(finalBalance, selectedCurrency)}</strong>
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
                          {formatMoney(totalDebits, selectedCurrency)}
                        </td>
                        <td className="py-2.5 px-2.5 text-left text-amber-800">
                          {formatMoney(totalCredits, selectedCurrency)}
                        </td>
                        <td className="py-2.5 px-2.5 text-left text-slate-950 font-black bg-slate-200">
                          {formatMoney(finalBalance, selectedCurrency)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Arabic Tafqeet Box */}
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                  <span className="text-slate-500">الرصيد كتابة وتفقيطاً: </span>
                  <strong className="text-slate-900">{tafqeetArabic(finalBalance, selectedCurrency)}</strong>
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
              وثيقة محاسبية رسمية صادرة من نظام عمرو النماري للصرافة والحسابات · جميع الحقوق محفوظة 2026
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
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 flex items-center gap-1 transition-colors"
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
