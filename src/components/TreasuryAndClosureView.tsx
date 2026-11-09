import React, { useEffect, useState } from 'react';
import { Account, CashBoxShift, CurrencyCode, SUPPORTED_CURRENCIES, UserProfile } from '../types/exchange';
import { formatMoney } from '../services/accountingEngine';
import { AlertCircle, CheckCircle2, Clock, FileSpreadsheet, Lock, RefreshCw, ShieldCheck, Vault } from 'lucide-react';

interface TreasuryAndClosureViewProps {
  accounts: Account[];
  activeShift: CashBoxShift;
  currentUser: UserProfile;
  onCloseShift: (actualBalances: Record<CurrencyCode, number>, notes: string) => Promise<boolean>;
  onOpenNewShift: () => Promise<boolean>;
}

export const TreasuryAndClosureView: React.FC<TreasuryAndClosureViewProps> = ({
  accounts,
  activeShift,
  currentUser,
  onCloseShift,
  onOpenNewShift,
}) => {
  const [actualInput, setActualInput] = useState<Record<CurrencyCode, number>>({
    YER_OLD: activeShift.actualBalances.YER_OLD,
    YER_NEW: activeShift.actualBalances.YER_NEW,
    SAR: activeShift.actualBalances.SAR,
    USD: activeShift.actualBalances.USD,
  });
  const [closureNotes, setClosureNotes] = useState('');
  const [closureSuccessMessage, setClosureSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setActualInput({ ...activeShift.actualBalances });
    setClosureSuccessMessage(null);
  }, [activeShift.id, activeShift.status]);

  const cashierBox = accounts.find((a) => a.id === activeShift.boxId) || accounts[1];

  // Compute live expected balances from cashier box account
  const expectedBalances: Record<CurrencyCode, number> = {
    YER_OLD: cashierBox.balances.YER_OLD || 0,
    YER_NEW: cashierBox.balances.YER_NEW || 0,
    SAR: cashierBox.balances.SAR || 0,
    USD: cashierBox.balances.USD || 0,
  };

  const handleInputChange = (cur: CurrencyCode, val: number) => {
    setActualInput((prev) => ({ ...prev, [cur]: val }));
  };

  const handleExecuteClosure = async () => {
    const saved = await onCloseShift(actualInput, closureNotes);
    if (!saved) return;
    setClosureSuccessMessage('تم حفظ محضر الجرد وإقفال الوردية بنجاح على الخادم.');
    setTimeout(() => setClosureSuccessMessage(null), 5000);
  };

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Vault className="w-5 h-5 text-emerald-400" />
            <span>إدارة الصناديق، الجرد الفعلي، وإقفال الورديات</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            البند 10.1: مطابقة الفعلي بالدفتري، إظهار العجز أو الزيادة، إقفال الصناديق واعتماد اليوم المالي.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeShift.status === 'open' ? (
            <span className="px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              الوردية مفتوحة ومباشرة
            </span>
          ) : (
            <button
              onClick={onOpenNewShift}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
            >
              <RefreshCw className="w-4 h-4" />
              <span>فتح وردية جديدة للعمل</span>
            </button>
          )}
        </div>
      </div>

      {closureSuccessMessage ? (
        <div className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-600 text-emerald-300 text-xs flex items-center gap-2 shadow-lg">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <span>{closureSuccessMessage}</span>
        </div>
      ) : null}

      {/* Active Shift Details & Physical Count Workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Shift Meta */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span>بيانات الوردية الحالية</span>
            </h2>
            <span className="text-[11px] font-mono text-slate-400">{activeShift.id}</span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <span className="text-slate-400 block mb-0.5">الصندوق:</span>
              <span className="text-white font-semibold">{activeShift.boxNameAr}</span>
            </div>
            <div>
              <span className="text-slate-400 block mb-0.5">الصراف المسؤول:</span>
              <span className="text-white font-semibold">{activeShift.tellerName}</span>
            </div>
            <div>
              <span className="text-slate-400 block mb-0.5">وقت الافتتاح:</span>
              <span className="text-slate-300 font-mono">{activeShift.openedAt}</span>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800">
            <h3 className="text-xs font-bold text-slate-300 mb-2">الرصيد الافتتاحي للوردية:</h3>
            <div className="space-y-1.5 font-mono text-xs">
              <div className="flex justify-between text-slate-400">
                <span className="font-sans">ريال قديم:</span>
                <span className="text-white">{formatMoney(activeShift.openingBalances.YER_OLD, 'YER_OLD')}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span className="font-sans">ريال جديد:</span>
                <span className="text-white">{formatMoney(activeShift.openingBalances.YER_NEW, 'YER_NEW')}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span className="font-sans">ريال سعودي:</span>
                <span className="text-white">{formatMoney(activeShift.openingBalances.SAR, 'SAR')}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span className="font-sans">دولار أمريكي:</span>
                <span className="text-white">{formatMoney(activeShift.openingBalances.USD, 'USD')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Center & Right: Physical Cash Count & Variance Table (2 cols) */}
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-base font-bold text-white">الجرد الفعلي والمطابقة الدفترية للعملات</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                أدخل المبالغ النقدية المعدودة في الصندوق لحساب العجز أو الزيادة تلقائياً.
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-800 text-slate-300">
              4 عملات مستقلة
            </span>
          </div>

          <div className="overflow-x-auto -mx-2 px-2 sm:mx-0 sm:px-0">
            <table className="w-full text-right text-xs min-w-[580px]">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 font-semibold">العملة</th>
                  <th className="py-2.5 px-3 font-semibold text-left">الرصيد الدفتري المتوقع</th>
                  <th className="py-2.5 px-3 font-semibold text-left">الجرد الفعلي في الصندوق</th>
                  <th className="py-2.5 px-3 font-semibold text-left">الفارق (عجز / زيادة)</th>
                  <th className="py-2.5 px-3 font-semibold text-center">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((cur) => {
                  const expected = expectedBalances[cur] || 0;
                  const actual = actualInput[cur] ?? expected;
                  const diff = actual - expected;
                  const isPerfect = Math.abs(diff) < 0.01;

                  return (
                    <tr key={cur} className="hover:bg-slate-800/40">
                      <td className="py-3 px-3 font-sans font-bold text-white flex items-center gap-1.5">
                        <span>{SUPPORTED_CURRENCIES[cur].flag}</span>
                        <span>{SUPPORTED_CURRENCIES[cur].nameAr}</span>
                      </td>

                      <td className="py-3 px-3 text-left font-bold text-slate-300 tabular-nums">
                        {formatMoney(expected, cur)}
                      </td>

                      <td className="py-3 px-3 text-left">
                        <input
                          type="number"
                          step="any"
                          value={actual}
                          onChange={(e) => handleInputChange(cur, parseFloat(e.target.value) || 0)}
                          className="w-32 sm:w-36 min-h-[38px] bg-slate-850 border border-slate-700 rounded-xl px-2.5 py-1 text-xs font-bold font-mono text-emerald-400 text-left focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </td>

                      <td
                        className={`py-3 px-3 text-left font-bold tabular-nums ${
                          isPerfect ? 'text-emerald-400' : diff > 0 ? 'text-teal-400' : 'text-rose-400'
                        }`}
                      >
                        {diff > 0 ? `+${formatMoney(diff, cur)}` : formatMoney(diff, cur)}
                      </td>

                      <td className="py-3 px-3 text-center font-sans">
                        {isPerfect ? (
                          <span className="text-[11px] text-emerald-400 font-semibold">مطابق تماماً</span>
                        ) : diff > 0 ? (
                          <span className="text-[11px] text-teal-400 font-semibold">فائض / زيادة</span>
                        ) : (
                          <span className="text-[11px] text-rose-400 font-semibold">عجز نقدي</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Closure Notes */}
          <div>
            <label className="block text-xs text-slate-300 mb-1 font-medium">ملاحظات محضر الجرد والإقفال</label>
            <textarea
              rows={2}
              value={closureNotes}
              onChange={(e) => setClosureNotes(e.target.value)}
              className="w-full bg-slate-850 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-slate-800">
            <span className="text-xs text-slate-400">
              المشرف المعتمد: <strong className="text-white">{currentUser.name}</strong> ({currentUser.roleTitleAr})
            </span>

            {activeShift.status === 'open' ? (
              <button
                onClick={handleExecuteClosure}
                className="min-h-[44px] px-6 py-2.5 bg-rose-700 hover:bg-rose-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-rose-950/40 transition-all cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                <span>إقفال الوردية وترحيل التقرير</span>
              </button>
            ) : (
              <span className="text-xs text-amber-300">لا توجد وردية مفتوحة؛ افتح وردية جديدة قبل تنفيذ العمليات المالية.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
