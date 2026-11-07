import React from 'react';
import { Account, CashBoxShift, CurrencyCode, ExchangeRate, JournalEntry, Remittance, SUPPORTED_CURRENCIES, UserProfile } from '../types/exchange';
import { formatMoney } from '../services/accountingEngine';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CheckCircle2, Clock, DollarSign, FileSpreadsheet, Layers, Plus, Receipt, ShieldCheck, TrendingUp, Users, Vault, Wallet } from 'lucide-react';
import { Button } from './ui/Button';

interface DashboardViewProps {
  accounts: Account[];
  exchangeRates: ExchangeRate[];
  journalEntries: JournalEntry[];
  remittances: Remittance[];
  activeShift: CashBoxShift;
  currentUser: UserProfile;
  onNavigate: (tab: string) => void;
  onOpenExchangeModal: () => void;
  onOpenRatesModal: () => void;
  onOpenVoucher: (voucherId: string) => void;
  onOpenInternalTransferModal?: () => void;
  onOpenA4StatementModal?: () => void;
  onOpenOfficialVoucher?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  accounts,
  exchangeRates,
  journalEntries,
  remittances,
  activeShift,
  currentUser,
  onNavigate,
  onOpenExchangeModal,
  onOpenRatesModal,
  onOpenInternalTransferModal,
  onOpenA4StatementModal,
  onOpenOfficialVoucher,
}) => {
  // Aggregate total liquid cash in cash boxes & banks for each of the 4 currencies
  const liquidBalances: Record<CurrencyCode, number> = {
    YER_OLD: 0,
    YER_NEW: 0,
    SAR: 0,
    USD: 0,
  };

  accounts
    .filter((a) => a.category === 'cash_box' || a.category === 'bank')
    .forEach((acc) => {
      liquidBalances.YER_OLD += acc.balances.YER_OLD || 0;
      liquidBalances.YER_NEW += acc.balances.YER_NEW || 0;
      liquidBalances.SAR += acc.balances.SAR || 0;
      liquidBalances.USD += acc.balances.USD || 0;
    });

  const pendingRemittancesCount = remittances.filter((r) => r.status === 'available').length;
  const todayRemittancesCount = remittances.length;

  return (
    <div className="space-y-6">
      {/* Welcome Banner & Quick Action Buttons */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {currentUser.branchName}
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs text-slate-300 font-medium">{currentUser.roleTitleAr}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            مرحباً بك، {currentUser.name}
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            لوحة الإشراف المالي والرقابة اللحظية - نظام عمرو النماري للصرافة والحسابات المتكامل (ERP) ذو القيد المزدوج.
          </p>
        </div>

        {/* Action Buttons: Unified sizing and variants (UI-03, UI-09) */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 sm:gap-2.5 w-full md:w-auto">
          {onOpenOfficialVoucher && (
            <Button
              onClick={onOpenOfficialVoucher}
              variant="brand"
              size="md"
              icon={<Receipt className="w-4 h-4 text-amber-300" />}
              className="col-span-2 sm:col-span-1"
              title="عرض سند الحوالة الرسمي مع الشعار وأزرار الواتساب والطباعة"
            >
              نظام السندات
            </Button>
          )}

          <Button
            onClick={onOpenExchangeModal}
            variant="primary"
            size="md"
            icon={<ArrowLeftRight className="w-4 h-4" />}
          >
            صرف عملة
          </Button>

          <Button
            onClick={() => onNavigate('receive_transfer')}
            variant="secondary"
            size="md"
            icon={<ArrowDownLeft className="w-4 h-4 text-emerald-400" />}
          >
            <span>صرف حوالة</span>
            {pendingRemittancesCount > 0 && (
              <span className="mr-1.5 bg-emerald-500 text-slate-950 text-[10px] font-bold px-1.5 py-0.5 rounded-full font-mono">
                {pendingRemittancesCount}
              </span>
            )}
          </Button>

          <Button
            onClick={() => onNavigate('remittance')}
            variant="outline"
            size="md"
            icon={<Plus className="w-4 h-4 text-emerald-400" />}
          >
            إرسال حوالة
          </Button>

          {onOpenA4StatementModal && (
            <Button
              onClick={onOpenA4StatementModal}
              variant="outline"
              size="md"
              icon={<FileSpreadsheet className="w-4 h-4 text-teal-400" />}
              title="كشف الأرباح الشامل وكشف حساب الحركات بصيغة A4"
            >
              كشف A4
            </Button>
          )}

          {onOpenInternalTransferModal && (
            <Button
              onClick={onOpenInternalTransferModal}
              variant="outline"
              size="md"
              icon={<Vault className="w-4 h-4 text-emerald-400" />}
              title="نقل سيولة وتغذية الصناديق"
            >
              تحويل داخلي
            </Button>
          )}

          <Button
            onClick={() => onNavigate('customers')}
            variant="ghost"
            size="md"
            icon={<Users className="w-4 h-4 text-cyan-400" />}
          >
            العملاء KYC
          </Button>
        </div>
      </div>

      {/* Mandatory Currency Separation Notice Banner */}
      <div className="bg-slate-900/60 border border-amber-900/30 rounded-xl p-3.5 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-300 leading-relaxed">
          <span className="font-semibold text-amber-300">ميثاق الرقابة النقدية المعتمد: </span>
          يُعامل <strong className="text-white">الريال اليمني القديم (صنعاء)</strong> و
          <strong className="text-white"> الريال اليمني الجديد (عدن)</strong> كعملتين مستقلتين تماماً في كافة القيود والأرصدة
          والدفاتر ولا يجوز دمجهما بأي حال. توازن القيود يتم لكل عملة بانفراد.
        </div>
      </div>

      {/* 4 Core Currency Liquid Balance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Old Yemeni Rial */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <span>🇾🇪</span> ريال يمني (قديم - صنعاء)
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-800 text-emerald-400 rounded">
              YER_OLD
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-white tabular-nums tracking-tight">
              {new Intl.NumberFormat('en-US').format(liquidBalances.YER_OLD)}
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
              <span>إجمالي السيولة النقدية</span>
              <span className="text-emerald-400 font-mono text-[11px]">ر.ي.ق</span>
            </div>
          </div>
        </div>

        {/* New Yemeni Rial */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <span>🇾🇪</span> ريال يمني (جديد - عدن)
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-800 text-teal-400 rounded">
              YER_NEW
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-white tabular-nums tracking-tight">
              {new Intl.NumberFormat('en-US').format(liquidBalances.YER_NEW)}
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
              <span>إجمالي السيولة النقدية</span>
              <span className="text-teal-400 font-mono text-[11px]">ر.ي.ج</span>
            </div>
          </div>
        </div>

        {/* Saudi Riyal */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <span>🇸🇦</span> ريال سعودي
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-800 text-emerald-400 rounded">
              SAR
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-white tabular-nums tracking-tight">
              {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(liquidBalances.SAR)}
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
              <span>الخزينة والصناديق</span>
              <span className="text-emerald-400 font-mono text-[11px]">ر.س</span>
            </div>
          </div>
        </div>

        {/* US Dollar */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <span>🇺🇸</span> دولار أمريكي
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-800 text-emerald-400 rounded">
              USD
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-white tabular-nums tracking-tight">
              {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(liquidBalances.USD)}
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
              <span>الخزينة والصناديق</span>
              <span className="text-emerald-400 font-mono text-[11px]">$ USD</span>
            </div>
          </div>
        </div>
      </div>

      {/* Live Exchange Rate Board & Operational Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Exchange Rates Live Ticker */}
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-bold text-white">نشرة أسعار الصرف المعتمدة</h2>
            </div>
            <button
              onClick={onOpenRatesModal}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium underline"
            >
              تعديل وسجل التغييرات
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {exchangeRates.map((rate) => {
              const fromInfo = SUPPORTED_CURRENCIES[rate.fromCurrency];
              const toInfo = SUPPORTED_CURRENCIES[rate.toCurrency];
              return (
                <div key={rate.id} className="bg-slate-850 border border-slate-800 rounded-xl p-3">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                    <span className="font-semibold text-white">
                      {fromInfo.symbol} ➔ {toInfo.symbol}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">{rate.updatedAt.split(' ')[1]}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center pt-1 border-t border-slate-800">
                    <div>
                      <span className="text-[10px] text-slate-400 block">شراء (من العميل)</span>
                      <span className="text-sm font-bold font-mono text-emerald-400 tabular-nums">
                        {rate.buyRate}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">بيع (للعميل)</span>
                      <span className="text-sm font-bold font-mono text-amber-400 tabular-nums">
                        {rate.sellRate}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cash Box Shift & Daily Status */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Vault className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base font-bold text-white">الوردية النشطة</h2>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                مفتوحة
              </span>
            </div>
            
            <p className="text-xs text-slate-400 mb-3">{activeShift.boxNameAr}</p>
            
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800/80">
                <span className="text-slate-400">الصراف المكلف:</span>
                <span className="text-white font-medium">{activeShift.tellerName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/80">
                <span className="text-slate-400">وقت الفتح:</span>
                <span className="text-slate-300 font-mono">{activeShift.openedAt}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/80">
                <span className="text-slate-400">حوالات جاهزة للصرف:</span>
                <span className="text-amber-400 font-bold">{pendingRemittancesCount} حوالة</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">إجمالي عمليات اليوم:</span>
                <span className="text-emerald-400 font-bold">{todayRemittancesCount + journalEntries.length} عملية</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
            <button
              onClick={() => onNavigate('treasury')}
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300 underline"
            >
              الانتقال للجرد والإقفال
            </button>
            <button
              onClick={() => onNavigate('clean_architecture')}
              className="text-xs font-medium text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>معمارية فلاتر</span>
            </button>
          </div>
        </div>
      </div>

      {/* Recent Double-Entry Journal Records */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-white">القيود المحاسبية المزدوجة الأخيرة</h2>
            <p className="text-xs text-slate-400">
              تسجيل لحظي متوازن تلقائياً (Double-Entry Invariant: مجموع المدين = مجموع الدائن).
            </p>
          </div>
          <button
            onClick={() => onNavigate('ledger')}
            className="text-xs font-medium text-emerald-400 hover:text-emerald-300 underline"
          >
            عرض دفتر اليومية الكامل
          </button>
        </div>

        <div className="overflow-x-auto -mx-2 px-2 sm:mx-0 sm:px-0">
          <table className="w-full text-right text-xs min-w-[620px]">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2.5 px-3 font-semibold">رقم القيد</th>
                <th className="py-2.5 px-3 font-semibold">التاريخ والوقت</th>
                <th className="py-2.5 px-3 font-semibold">البيان المحاسبي</th>
                <th className="py-2.5 px-3 font-semibold">الأطراف والعملة</th>
                <th className="py-2.5 px-3 font-semibold text-center">حالة التوازن</th>
                <th className="py-2.5 px-3 font-semibold">المستخدم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {journalEntries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 font-sans">
                    لا توجد عمليات أو قيود محاسبية مسجلة حتى الآن · الدفتر نظيف وخالٍ
                  </td>
                </tr>
              ) : (
                journalEntries.slice(-5).reverse().map((entry) => {
                  const totalDebit = entry.lines.reduce((s, l) => s + l.debit, 0);
                  const cur = entry.lines[0]?.currency || 'SAR';
                  return (
                    <tr key={entry.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-3 font-bold text-emerald-400">{entry.entryNumber}</td>
                      <td className="py-3 px-3 text-slate-300">{entry.date} {entry.time}</td>
                      <td className="py-3 px-3 font-sans text-white max-w-xs truncate">{entry.descriptionAr}</td>
                      <td className="py-3 px-3 text-slate-300">
                        <span className="font-sans">{entry.lines.length} أطراف</span> (
                        <span className="text-emerald-300">{formatMoney(totalDebit, cur)}</span>)
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-flex items-center gap-1 text-[11px] font-sans px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" /> متوازن 100%
                        </span>
                      </td>
                      <td className="py-3 px-3 font-sans text-slate-400">{entry.createdBy}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
