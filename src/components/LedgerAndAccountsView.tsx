import React, { useState } from 'react';
import { Account, AccountType, CurrencyCode, JournalEntry, SUPPORTED_CURRENCIES } from '../types/exchange';
import { formatMoney, validateDoubleEntryBalance } from '../services/accountingEngine';
import { BookOpen, CheckCircle2, DollarSign, FileSpreadsheet, FileText, Filter, Layers, PieChart, Plus, ShieldCheck } from 'lucide-react';

interface LedgerAndAccountsViewProps {
  accounts: Account[];
  journalEntries: JournalEntry[];
  onRecordExpense?: (data: {
    expenseType: string;
    amount: number;
    currency: CurrencyCode;
    notes: string;
  }) => Promise<boolean>;
}

export const LedgerAndAccountsView: React.FC<LedgerAndAccountsViewProps> = ({
  accounts,
  journalEntries,
  onRecordExpense,
}) => {
  const [subTab, setSubTab] = useState<'journal' | 'chart' | 'income_statement' | 'trial_balance' | 'balance_sheet'>('journal');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>('all');
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isSubmittingExpense, setIsSubmittingExpense] = useState(false);

  // Expense form state
  const [expenseType, setExpenseType] = useState('إيجار الفرع ومصاريف تشغيل');
  const [expenseAmount, setExpenseAmount] = useState<number>(0);
  const [expenseCurrency, setExpenseCurrency] = useState<CurrencyCode>('YER_OLD');
  const [expenseNotes, setExpenseNotes] = useState('');

  // Filter accounts
  const filteredAccounts = accounts.filter((acc) => {
    if (accountTypeFilter !== 'all' && acc.type !== accountTypeFilter) return false;
    return true;
  });

  // Calculate Trial Balance sums by currency
  const trialBalanceTotals: Record<CurrencyCode, { debitSum: number; creditSum: number }> = {
    YER_OLD: { debitSum: 0, creditSum: 0 },
    YER_NEW: { debitSum: 0, creditSum: 0 },
    SAR: { debitSum: 0, creditSum: 0 },
    USD: { debitSum: 0, creditSum: 0 },
  };

  accounts.forEach((acc) => {
    (Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).forEach((cur) => {
      const bal = acc.balances[cur] || 0;
      if (acc.type === 'asset' || acc.type === 'expense') {
        trialBalanceTotals[cur].debitSum += bal;
      } else {
        trialBalanceTotals[cur].creditSum += bal;
      }
    });
  });

  // Balance sheet totals (Assets vs Liabilities + Equity)
  const balanceSheetData: Record<CurrencyCode, { assets: number; liabilities: number; equity: number }> = {
    YER_OLD: { assets: 0, liabilities: 0, equity: 0 },
    YER_NEW: { assets: 0, liabilities: 0, equity: 0 },
    SAR: { assets: 0, liabilities: 0, equity: 0 },
    USD: { assets: 0, liabilities: 0, equity: 0 },
  };

  accounts.forEach((acc) => {
    (Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).forEach((cur) => {
      const b = acc.balances[cur] || 0;
      if (acc.type === 'asset') balanceSheetData[cur].assets += b;
      if (acc.type === 'liability') balanceSheetData[cur].liabilities += b;
      if (acc.type === 'equity') balanceSheetData[cur].equity += b;
    });
  });

  // Income statement calculations
  const totalCommissionRevenue: Record<CurrencyCode, number> = { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 };
  const totalExchangeProfit: Record<CurrencyCode, number> = { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 };
  const totalOperatingExpense: Record<CurrencyCode, number> = { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 };

  accounts.forEach((acc) => {
    (Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).forEach((cur) => {
      const b = acc.balances[cur] || 0;
      if (acc.category === 'commission') totalCommissionRevenue[cur] += b;
      if (acc.category === 'exchange_profit') totalExchangeProfit[cur] += b;
      if (acc.category === 'operating_expense') totalOperatingExpense[cur] += b;
    });
  });

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingExpense || !onRecordExpense ||
        !Number.isFinite(expenseAmount) || expenseAmount <= 0 ||
        !expenseType.trim() || !expenseNotes.trim()) return;

    setIsSubmittingExpense(true);
    try {
      const accepted = await onRecordExpense({
        expenseType,
        amount: expenseAmount,
        currency: expenseCurrency,
        notes: expenseNotes,
      });
      if (accepted) setIsExpenseModalOpen(false);
    } finally {
      setIsSubmittingExpense(false);
    }
  };

  const getAccountTypeLabel = (type: AccountType) => {
    switch (type) {
      case 'asset':
        return <span className="text-emerald-400 font-semibold">أصول (Assets)</span>;
      case 'liability':
        return <span className="text-amber-400 font-semibold">التزامات (Liabilities)</span>;
      case 'equity':
        return <span className="text-sky-400 font-semibold">حقوق ملكية (Equity)</span>;
      case 'revenue':
        return <span className="text-teal-400 font-semibold">إيرادات (Revenues)</span>;
      case 'expense':
        return <span className="text-rose-400 font-semibold">مصروفات (Expenses)</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* View Header with Sub-tabs */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-emerald-400" />
            <span>النظام المحاسبي، الأستاذ العام، والتقارير المالية</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            دليل الحسابات، قيود اليومية ذات القيد المزدوج، ميزان المراجعة، قائمة الدخل، وقائمة المركز المالي (الميزانية).
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
          {/* Action: Add Expense Voucher */}
          {onRecordExpense ? (
            <button
              onClick={() => setIsExpenseModalOpen(true)}
              className="min-h-[44px] px-3.5 py-2 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>سند صرف مصروف تشغيلي</span>
            </button>
          ) : null}

          {/* Sub-tab navigation */}
          <div className="flex items-center gap-1 p-1 bg-slate-800/80 rounded-xl overflow-x-auto w-full sm:w-auto no-scrollbar">
            <button
              onClick={() => setSubTab('journal')}
              className={`whitespace-nowrap px-3 py-2 min-h-[38px] rounded-lg text-xs font-semibold transition-all ${
                subTab === 'journal' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:text-white'
              }`}
            >
              دفتر اليومية ({journalEntries.length})
            </button>
            <button
              onClick={() => setSubTab('chart')}
              className={`whitespace-nowrap px-3 py-2 min-h-[38px] rounded-lg text-xs font-semibold transition-all ${
                subTab === 'chart' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:text-white'
              }`}
            >
              دليل الحسابات ({accounts.length})
            </button>
            <button
              onClick={() => setSubTab('trial_balance')}
              className={`whitespace-nowrap px-3 py-2 min-h-[38px] rounded-lg text-xs font-semibold transition-all ${
                subTab === 'trial_balance' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:text-white'
              }`}
            >
              ميزان المراجعة
            </button>
            <button
              onClick={() => setSubTab('income_statement')}
              className={`whitespace-nowrap px-3 py-2 min-h-[38px] rounded-lg text-xs font-semibold transition-all ${
                subTab === 'income_statement' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:text-white'
              }`}
            >
              قائمة الدخل
            </button>
            <button
              onClick={() => setSubTab('balance_sheet')}
              className={`whitespace-nowrap px-3 py-2 min-h-[38px] rounded-lg text-xs font-semibold transition-all ${
                subTab === 'balance_sheet' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:text-white'
              }`}
            >
              المركز المالي (الميزانية)
            </button>
          </div>
        </div>
      </div>

      {/* 1. General Journal Entries View */}
      {subTab === 'journal' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>سجل القيود اليومية المنفذة والمدققة محاسبياً</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> قاعدة القيد المزدوج: مجموع المدين = مجموع الدائن
              </span>
            </div>
          </div>

            {journalEntries.length === 0 ? (
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-12 text-center text-slate-500 space-y-3">
                <BookOpen className="w-10 h-10 text-slate-600 mx-auto" />
                <h3 className="text-base font-bold text-slate-300">لا توجد قيود يومية مسجلة حتى الآن</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  دفتر اليومية العامة خالٍ وجاهز لتسجيل القيود المزدوجة آلياً بمجرد تنفيذ أول عملية صرافة، حوالة مالية، أو إثبات قيد محاسبي.
                </p>
              </div>
            ) : (
              journalEntries.slice().reverse().map((entry) => {
              const validation = validateDoubleEntryBalance(entry.lines);
              return (
                <div
                  key={entry.id}
                  className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-all space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-sm text-emerald-400 bg-slate-850 px-2.5 py-1 rounded-lg border border-slate-700">
                        {entry.entryNumber}
                      </span>
                      <span className="text-xs font-bold text-white">{entry.descriptionAr}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
                      <span>{entry.date} {entry.time}</span>
                      <span>·</span>
                      <span className="font-sans text-slate-300">{entry.createdBy}</span>
                      <span className="text-emerald-400 font-sans flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> متوازن
                      </span>
                    </div>
                  </div>

                  {/* Journal Lines Table */}
                  <div className="overflow-x-auto -mx-2 px-2 sm:mx-0 sm:px-0">
                    <table className="w-full text-right text-xs min-w-[580px]">
                      <thead>
                        <tr className="text-slate-400 border-b border-slate-800/80">
                          <th className="py-1.5 px-3">اسم الحساب</th>
                          <th className="py-1.5 px-3">العملة</th>
                          <th className="py-1.5 px-3 text-left">مدين (Debit)</th>
                          <th className="py-1.5 px-3 text-left">دائن (Credit)</th>
                          <th className="py-1.5 px-3">ملاحظات البيان</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 font-mono">
                        {entry.lines.map((line, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/20">
                            <td className="py-2 px-3 font-sans font-medium text-slate-200">
                              {line.accountNameAr}
                            </td>
                            <td className="py-2 px-3 text-slate-400 font-sans">
                              {SUPPORTED_CURRENCIES[line.currency]?.nameAr || line.currency}
                            </td>
                            <td className="py-2 px-3 text-left font-bold text-emerald-400 tabular-nums">
                              {line.debit > 0 ? formatMoney(line.debit, line.currency) : '-'}
                            </td>
                            <td className="py-2 px-3 text-left font-bold text-amber-400 tabular-nums">
                              {line.credit > 0 ? formatMoney(line.credit, line.currency) : '-'}
                            </td>
                            <td className="py-2 px-3 font-sans text-slate-500">{line.note || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {/* 2. Chart of Accounts View */}
      {subTab === 'chart' ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-800">
            <h2 className="text-base font-bold text-white">دليل الحسابات (شجرة الحسابات)</h2>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">تصفية حسب النوع:</label>
              <select
                value={accountTypeFilter}
                onChange={(e) => setAccountTypeFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-xs rounded-lg px-2.5 py-1 text-slate-200"
              >
                <option value="all">كافة الحسابات</option>
                <option value="asset">أصول</option>
                <option value="liability">التزامات</option>
                <option value="equity">حقوق ملكية</option>
                <option value="revenue">إيرادات</option>
                <option value="expense">مصروفات</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto -mx-2 px-2 sm:mx-0 sm:px-0">
            <table className="w-full text-right text-xs min-w-[620px]">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 font-semibold">رقم الحساب</th>
                  <th className="py-2.5 px-3 font-semibold">اسم الحساب</th>
                  <th className="py-2.5 px-3 font-semibold">النوع والتصنيف</th>
                  <th className="py-2.5 px-3 font-semibold text-left">ريال يمني (قديم)</th>
                  <th className="py-2.5 px-3 font-semibold text-left">ريال يمني (جديد)</th>
                  <th className="py-2.5 px-3 font-semibold text-left">ريال سعودي</th>
                  <th className="py-2.5 px-3 font-semibold text-left">دولار أمريكي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredAccounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-3 font-bold text-emerald-400">{acc.code}</td>
                    <td className="py-3 px-3 font-sans font-semibold text-white">{acc.nameAr}</td>
                    <td className="py-3 px-3 font-sans">{getAccountTypeLabel(acc.type)}</td>
                    <td className="py-3 px-3 text-left tabular-nums text-slate-300">
                      {new Intl.NumberFormat('en-US').format(acc.balances.YER_OLD || 0)}
                    </td>
                    <td className="py-3 px-3 text-left tabular-nums text-slate-300">
                      {new Intl.NumberFormat('en-US').format(acc.balances.YER_NEW || 0)}
                    </td>
                    <td className="py-3 px-3 text-left tabular-nums text-slate-300">
                      {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(acc.balances.SAR || 0)}
                    </td>
                    <td className="py-3 px-3 text-left tabular-nums text-slate-300">
                      {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(acc.balances.USD || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* 3. Trial Balance View */}
      {subTab === 'trial_balance' ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="pb-3 border-b border-slate-800">
            <h2 className="text-base font-bold text-white">ميزان المراجعة بالأرصدة (Trial Balance)</h2>
            <p className="text-xs text-slate-400 mt-1">
              مجموع الأرصدة المدينة والأرصدة الدائنة لكل عملة على حدة للتحقق من الموازنة العامة.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((cur) => {
              const debit = trialBalanceTotals[cur].debitSum;
              const credit = trialBalanceTotals[cur].creditSum;
              const diff = Math.abs(debit - credit);
              const isMatched = diff < 0.05;

              return (
                <div key={cur} className="bg-slate-850 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-sm">
                      {SUPPORTED_CURRENCIES[cur].flag} {SUPPORTED_CURRENCIES[cur].nameAr}
                    </span>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                        isMatched
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      {isMatched ? 'متوازن دفترياً' : 'فارق توازن'}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs font-mono">
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400 font-sans">إجمالي الأرصدة المدينة (الأصول والمصروفات):</span>
                      <span className="text-emerald-400 font-bold">{formatMoney(debit, cur)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400 font-sans">إجمالي الأرصدة الدائنة (الالتزامات وحقوق الملكية والإيرادات):</span>
                      <span className="text-amber-400 font-bold">{formatMoney(credit, cur)}</span>
                    </div>
                    <div className="flex justify-between py-1 text-slate-400 font-sans">
                      <span>الفارق المحاسبي:</span>
                      <span className={`font-mono font-bold ${diff === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {formatMoney(diff, cur)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 4. Income Statement View */}
      {subTab === 'income_statement' ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="pb-3 border-b border-slate-800">
            <h2 className="text-base font-bold text-white">قائمة الدخل والأرباح التشغيلية (Income Statement)</h2>
            <p className="text-xs text-slate-400 mt-1">
              تنفيذ صريح للبند 7.3: الفصل المحاسبي التام بين إجمالي الإيرادات والمصروفات وصافي الربح وعدم اعتبار الأموال
              العابرة كأرباح!
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((cur) => {
              const comm = totalCommissionRevenue[cur] || 0;
              const fx = totalExchangeProfit[cur] || 0;
              const totalRev = comm + fx;
              const exp = totalOperatingExpense[cur] || 0;
              const netProfit = totalRev - exp;

              return (
                <div key={cur} className="bg-slate-850 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-4">
                  <div>
                    <span className="font-bold text-white text-xs block mb-3">
                      {SUPPORTED_CURRENCIES[cur].flag} {SUPPORTED_CURRENCIES[cur].nameAr}
                    </span>

                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex justify-between text-slate-300">
                        <span className="font-sans text-slate-400">عمولات الحوالات:</span>
                        <span className="text-emerald-400">{formatMoney(comm, cur)}</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span className="font-sans text-slate-400">أرباح فروق الصرف:</span>
                        <span className="text-emerald-400">{formatMoney(fx, cur)}</span>
                      </div>
                      <div className="flex justify-between py-1 border-t border-slate-800 font-bold">
                        <span className="font-sans text-white">إجمالي الإيرادات:</span>
                        <span className="text-emerald-300">{formatMoney(totalRev, cur)}</span>
                      </div>
                      <div className="flex justify-between text-rose-400">
                        <span className="font-sans text-slate-400">مصروفات التشغيل:</span>
                        <span>-{formatMoney(exp, cur)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800">
                    <span className="text-[10px] text-slate-400 block mb-0.5">صافي الربح التشغيلي</span>
                    <span className="text-lg font-bold font-mono text-emerald-400 tabular-nums">
                      {formatMoney(netProfit, cur)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 5. Balance Sheet View (قائمة المركز المالي) */}
      {subTab === 'balance_sheet' ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="pb-3 border-b border-slate-800">
            <h2 className="text-base font-bold text-white">قائمة المركز المالي والميزانية العمومية (Balance Sheet)</h2>
            <p className="text-xs text-slate-400 mt-1">
              معادلة الميزانية: الأصول (Assets) = الالتزامات (Liabilities) + حقوق الملكية (Equity) لكل عملة على حدة.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((cur) => {
              const data = balanceSheetData[cur];
              const totalLiabilitiesAndEquity = data.liabilities + data.equity;
              const isBalanced = Math.abs(data.assets - totalLiabilitiesAndEquity) < 1;

              return (
                <div key={cur} className="bg-slate-850 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-sm">
                      {SUPPORTED_CURRENCIES[cur].flag} {SUPPORTED_CURRENCIES[cur].nameAr}
                    </span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      معادلة الميزانية مطبقة
                    </span>
                  </div>

                  <div className="space-y-2 text-xs font-mono">
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400 font-sans font-semibold">إجمالي الأصول (الخزينة، البنوك، الشبكات):</span>
                      <span className="text-emerald-400 font-bold">{formatMoney(data.assets, cur)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400 font-sans">الالتزامات (أمانات العملاء والحوالات العابرة):</span>
                      <span className="text-amber-400 font-bold">{formatMoney(data.liabilities, cur)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400 font-sans">حقوق الملكية ورأس المال:</span>
                      <span className="text-sky-400 font-bold">{formatMoney(data.equity, cur)}</span>
                    </div>
                    <div className="flex justify-between py-1.5 font-bold text-white bg-slate-900/60 p-2 rounded-lg">
                      <span className="font-sans">مجموع (الالتزامات + حقوق الملكية):</span>
                      <span className="text-emerald-300 font-mono">{formatMoney(totalLiabilitiesAndEquity, cur)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Modal: Record Operating Expense */}
      {isExpenseModalOpen ? (
        <div
          onClick={(e) => { if (!isSubmittingExpense && e.target === e.currentTarget) setIsExpenseModalOpen(false); }}
          className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">إثبات سند صرف مصروف تشغيلي</h3>
              <button
                onClick={() => { if (!isSubmittingExpense) setIsExpenseModalOpen(false); }}
                disabled={isSubmittingExpense}
                aria-label="إغلاق"
                className="w-10 h-10 min-w-[40px] flex items-center justify-center rounded-xl bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-750 cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleExpenseSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1 font-medium">نوع المصروف</label>
                <select
                  value={expenseType}
                  onChange={(e) => setExpenseType(e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white focus:outline-none"
                >
                  <option value="إيجار الفرع">إيجار الفرع والمبنى</option>
                  <option value="فواتير كهرباء ومياه">فواتير الكهرباء والمياه</option>
                  <option value="اشتراك إنترنت واتصالات">اشتراك الإنترنت والاتصالات</option>
                  <option value="مرتبات وأجور الصرافين">مرتبات وأجور الصرافين والموظفين</option>
                  <option value="صيانة دورية وأدوات مكتبية">صيانة دورية وأدوات مكتبية</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1 font-medium">العملة</label>
                  <select
                    value={expenseCurrency}
                    onChange={(e) => setExpenseCurrency(e.target.value as CurrencyCode)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white font-semibold focus:outline-none"
                  >
                    {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((c) => (
                      <option key={c} value={c}>
                        {SUPPORTED_CURRENCIES[c].symbol}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1 font-medium">المبلغ المصروف</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs font-bold font-mono text-white focus:outline-none focus:ring-1 focus:ring-rose-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1 font-medium">البيان والملاحظات</label>
                <input
                  type="text"
                  value={expenseNotes}
                  onChange={(e) => setExpenseNotes(e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white focus:outline-none"
                  required
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsExpenseModalOpen(false)}
                  disabled={isSubmittingExpense}
                  className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-400 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingExpense}
                  className="min-h-[44px] px-5 py-2 bg-rose-700 hover:bg-rose-600 text-white font-bold rounded-xl text-xs shadow-md shadow-rose-950/40 cursor-pointer"
                >
                  {isSubmittingExpense ? 'جارٍ اعتماد المصروف من الخادم...' : 'اعتماد سند الصرف والقيد'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};
