import React, { useState, useEffect } from 'react';
import { Account, CurrencyCode, ExchangeRate, JournalEntry, OfficialVoucher, SUPPORTED_CURRENCIES, UserProfile } from '../types/exchange';
import { formatMoney, tafqeetArabic } from '../services/accountingEngine';
import { ArrowDownLeft, ArrowLeftRight, CheckCircle2, DollarSign, Printer, Send, ShieldAlert, Sparkles } from 'lucide-react';

interface ExchangeDeskViewProps {
  accounts: Account[];
  exchangeRates: ExchangeRate[];
  currentUser: UserProfile;
  onExecuteExchange: (data: {
    sourceCurrency: CurrencyCode;
    sourceAmount: number;
    targetCurrency: CurrencyCode;
    targetAmount: number;
    exchangeRate: number;
    commission: number;
    customerName: string;
    customerPhone: string;
    notes: string;
  }) => void;
  onOpenRatesModal: () => void;
}

export const ExchangeDeskView: React.FC<ExchangeDeskViewProps> = ({
  accounts,
  exchangeRates,
  currentUser,
  onExecuteExchange,
  onOpenRatesModal,
}) => {
  // Operation mode: buy (شراء من العميل), sell (بيع للعميل), custom (تبديل)
  const [opMode, setOpMode] = useState<'buy' | 'sell'>('buy');
  const [sourceCurrency, setSourceCurrency] = useState<CurrencyCode>('SAR');
  const [targetCurrency, setTargetCurrency] = useState<CurrencyCode>('YER_OLD');
  const [sourceAmount, setSourceAmount] = useState<number>(0);
  const [customRate, setCustomRate] = useState<number | null>(null);
  const [commission, setCommission] = useState<number>(0);
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Find cashier account for current teller
  const cashierAccount = accounts.find((a) => a.id === 'acc-1102') || accounts[0];

  // Resolve active exchange rate
  const activeRateObj = exchangeRates.find(
    (r) =>
      (r.fromCurrency === sourceCurrency && r.toCurrency === targetCurrency) ||
      (r.fromCurrency === targetCurrency && r.toCurrency === sourceCurrency)
  );

  let defaultRate = 1;
  if (activeRateObj) {
    if (activeRateObj.fromCurrency === sourceCurrency && activeRateObj.toCurrency === targetCurrency) {
      defaultRate = opMode === 'buy' ? activeRateObj.buyRate : activeRateObj.sellRate;
    } else {
      // Inverted rate
      const directRate = opMode === 'buy' ? activeRateObj.sellRate : activeRateObj.buyRate;
      defaultRate = directRate > 0 ? 1 / directRate : 1;
    }
  }

  const effectiveRate = customRate !== null ? customRate : defaultRate;

  // Calculation
  const isDirectMultiplier = activeRateObj?.fromCurrency === sourceCurrency;
  const rawTargetAmount = isDirectMultiplier
    ? sourceAmount * effectiveRate
    : sourceAmount / (effectiveRate > 0 ? effectiveRate : 1);
  const targetAmount = Math.max(0, Math.round((rawTargetAmount - commission) * 100) / 100);

  // Liquidity Check in Cashier Box
  const targetLiquidity = cashierAccount.balances[targetCurrency] || 0;
  const hasSufficientLiquidity = targetLiquidity >= targetAmount;

  // Arabic Tafqeet text
  const targetTafqeet = tafqeetArabic(targetAmount, targetCurrency);
  const sourceTafqeet = tafqeetArabic(sourceAmount, sourceCurrency);

  const handleSwapCurrencies = () => {
    const temp = sourceCurrency;
    setSourceCurrency(targetCurrency);
    setTargetCurrency(temp);
    setCustomRate(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (sourceAmount <= 0) return;
    if (!hasSufficientLiquidity) {
      alert(`عذراً، رصيد الصندوق غير كافٍ بالعملة المطلوبة (${formatMoney(targetLiquidity, targetCurrency)} متوفر فقط).`);
      return;
    }

    onExecuteExchange({
      sourceCurrency,
      sourceAmount,
      targetCurrency,
      targetAmount,
      exchangeRate: effectiveRate,
      commission,
      customerName: customerName.trim() || 'عميل نقدي',
      customerPhone: customerPhone.trim(),
      notes,
    });
  };

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-emerald-400" />
            <span>نافذة عمليات الصرافة والتبديل النقدي</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            تنفيذ فوري لبيع وشراء العملات، حساب الإجمالي تلقائياً، وإنشاء القيد المحاسبي المزدوج وإصدار السند فوراً.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">الصندوق النشط:</span>
          <span className="font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-3 py-1 rounded-lg">
            {cashierAccount.nameAr}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Col: The Exchange Form (7 cols) */}
        <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-6">
          {/* Operation Mode Selector: Responsive full-width on mobile */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => {
                  setOpMode('buy');
                  setCustomRate(null);
                }}
                className={`py-2 px-3 text-xs font-bold rounded-xl transition-all text-center min-h-[44px] flex flex-col justify-center items-center cursor-pointer ${
                  opMode === 'buy'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <span>شراء من العميل</span>
                <span className="text-[10px] opacity-80 font-normal hidden xs:inline">نقبض أجنبي ونعطيه يمني</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpMode('sell');
                  setCustomRate(null);
                }}
                className={`py-2 px-3 text-xs font-bold rounded-xl transition-all text-center min-h-[44px] flex flex-col justify-center items-center cursor-pointer ${
                  opMode === 'sell'
                    ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <span>بيع للعميل</span>
                <span className="text-[10px] opacity-80 font-normal hidden xs:inline">نقبض يمني ونعطيه أجنبي</span>
              </button>
            </div>
            <button
              type="button"
              onClick={onOpenRatesModal}
              className="text-xs text-emerald-400 hover:underline font-medium self-end sm:self-center py-1 cursor-pointer"
            >
              النشرة الرسمية ➔
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Currencies & Swap */}
            <div className="grid grid-cols-1 md:grid-cols-9 gap-3 items-center">
              {/* Source (المقبوض) */}
              <div className="md:col-span-4 bg-slate-850 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <label className="block text-[11px] font-semibold text-emerald-400">
                  العملة المقبوضة من العميل (الداخلة)
                </label>
                <select
                  value={sourceCurrency}
                  onChange={(e) => {
                    setSourceCurrency(e.target.value as CurrencyCode);
                    setCustomRate(null);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 min-h-[44px]"
                >
                  {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((c) => (
                    <option key={c} value={c} disabled={c === targetCurrency}>
                      {SUPPORTED_CURRENCIES[c].flag} {SUPPORTED_CURRENCIES[c].nameAr}
                    </option>
                  ))}
                </select>

                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">المبلغ المقبوض</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={sourceAmount || ''}
                    onChange={(e) => setSourceAmount(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-base font-bold font-mono text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500 min-h-[44px]"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              {/* Swap Button */}
              <div className="md:col-span-1 flex justify-center py-1 md:py-0">
                <button
                  type="button"
                  onClick={handleSwapCurrencies}
                  className="w-11 h-11 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center border border-slate-700 transition-all hover:rotate-180 cursor-pointer shadow-sm"
                  title="عكس العملات"
                  aria-label="عكس العملات"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                </button>
              </div>

              {/* Target (المسلم) */}
              <div className="md:col-span-4 bg-slate-850 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <label className="block text-[11px] font-semibold text-amber-400">
                  العملة المسلمة للعميل (الخارجة)
                </label>
                <select
                  value={targetCurrency}
                  onChange={(e) => {
                    setTargetCurrency(e.target.value as CurrencyCode);
                    setCustomRate(null);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((c) => (
                    <option key={c} value={c} disabled={c === sourceCurrency}>
                      {SUPPORTED_CURRENCIES[c].flag} {SUPPORTED_CURRENCIES[c].nameAr}
                    </option>
                  ))}
                </select>

                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">
                    المبلغ المستحق تسليمه (تلقائي)
                  </label>
                  <div className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-base font-bold font-mono text-emerald-400 tabular-nums">
                    {formatMoney(targetAmount, targetCurrency)}
                  </div>
                </div>
              </div>
            </div>

            {/* Rate & Commission Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-850 border border-slate-800 rounded-xl p-3.5">
              <div>
                <label className="block text-xs text-slate-300 mb-1 flex items-center justify-between">
                  <span>سعر الصرف المطبق</span>
                  <span className="text-[10px] text-slate-500 font-mono">سعر النظام: {defaultRate}</span>
                </label>
                <input
                  type="number"
                  step="any"
                  value={customRate !== null ? customRate : defaultRate}
                  onChange={(e) => setCustomRate(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-bold font-mono text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">عمولة الصرافة (إن وجدت)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={commission}
                  onChange={(e) => setCommission(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-bold font-mono text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Customer Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1">اسم العميل</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="الاسم الكامل للعميل"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">رقم الهاتف (لإشعار الواتساب)</label>
                <input
                  type="text"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="77XXXXXXX أو 9665XXXXXXX"
                />
              </div>
            </div>

            {/* Liquidity Check Notification */}
            {!hasSufficientLiquidity ? (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
                <span>
                  تنبيه سيولة: رصيد الصندوق المتوفر بـ {SUPPORTED_CURRENCIES[targetCurrency].nameAr} هو{' '}
                  <strong className="font-mono text-white">{formatMoney(targetLiquidity, targetCurrency)}</strong> وهو غير
                  كافٍ لتسليم المبلغ المطلوب.
                </span>
              </div>
            ) : null}

            {/* Submit Action Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={!hasSufficientLiquidity || sourceAmount <= 0}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 transition-all hover:scale-[1.01]"
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>اعتماد العملية، القيد المحاسبي، وإصدار السند فوراً</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Col: Instant Financial & Accounting Double-Entry Preview (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Tafqeet & Summary Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>معاينة السند وتفقيط المبالغ</span>
            </h2>

            <div className="p-3 rounded-xl bg-slate-850 border border-slate-800 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">المبلغ المقبوض:</span>
                <span className="font-bold text-emerald-400 font-mono">
                  {formatMoney(sourceAmount, sourceCurrency)}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed italic">
                ✍️ {sourceTafqeet}
              </p>
            </div>

            <div className="p-3 rounded-xl bg-slate-850 border border-slate-800 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">المبلغ المسلم للعميل:</span>
                <span className="font-bold text-amber-400 font-mono">
                  {formatMoney(targetAmount, targetCurrency)}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed italic">
                ✍️ {targetTafqeet}
              </p>
            </div>

            <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-800 space-y-1">
              <div className="flex justify-between">
                <span>الصراف المنفذ:</span>
                <span className="text-slate-200">{currentUser.name}</span>
              </div>
              <div className="flex justify-between">
                <span>الفرع:</span>
                <span className="text-slate-200">{currentUser.branchName}</span>
              </div>
            </div>
          </div>

          {/* Double-Entry Journal Preview */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>القيد المزدوج الآلي المتولد</span>
              <span className="text-[10px] text-emerald-400 font-normal">متوازن تلقائياً</span>
            </h2>
            <p className="text-[11px] text-slate-400 mb-3">
              يتم تثبيت سعر الصرف وقت العملية ولا يتأثر بأي تغيرات لاحقة.
            </p>

            <div className="bg-slate-950 rounded-xl p-3 border border-slate-800/80 font-mono text-[11px] space-y-2">
              <div className="flex justify-between text-emerald-400 border-b border-slate-800 pb-1">
                <span>من حـ/ {cashierAccount.nameAr} (مدين)</span>
                <span>+{formatMoney(sourceAmount, sourceCurrency)}</span>
              </div>
              <div className="flex justify-between text-slate-400 border-b border-slate-800 pb-1">
                <span>إلى حـ/ وسيط تسوية العملات (دائن)</span>
                <span>-{formatMoney(sourceAmount, sourceCurrency)}</span>
              </div>
              <div className="flex justify-between text-slate-400 border-b border-slate-800 pb-1">
                <span>من حـ/ وسيط تسوية العملات (مدين)</span>
                <span>+{formatMoney(targetAmount, targetCurrency)}</span>
              </div>
              <div className="flex justify-between text-amber-400">
                <span>إلى حـ/ {cashierAccount.nameAr} (دائن)</span>
                <span>-{formatMoney(targetAmount, targetCurrency)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
