import React, { useState } from 'react';
import { Account, CurrencyCode, SUPPORTED_CURRENCIES, UserProfile } from '../types/exchange';
import { formatMoney } from '../services/accountingEngine';
import { ArrowLeftRight, CheckCircle2, DollarSign, Landmark, Vault, X } from 'lucide-react';

interface InternalTransferModalProps {
  accounts: Account[];
  currentUser: UserProfile;
  isOpen: boolean;
  onClose: () => void;
  onExecuteTransfer: (data: {
    fromAccountId: string;
    toAccountId: string;
    currency: CurrencyCode;
    amount: number;
    description: string;
  }) => Promise<boolean>;
}

export const InternalTransferModal: React.FC<InternalTransferModalProps> = ({
  accounts,
  currentUser,
  isOpen,
  onClose,
  onExecuteTransfer,
}) => {
  const [fromAccountId, setFromAccountId] = useState('acc-1101'); // الخزينة الرئيسية
  const [toAccountId, setToAccountId] = useState('acc-1102'); // صندوق الكاشير
  const [currency, setCurrency] = useState<CurrencyCode>('SAR');
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const fromAcc = accounts.find((a) => a.id === fromAccountId) || accounts[0];
  const toAcc = accounts.find((a) => a.id === toAccountId) || accounts[1];
  const availableInFrom = fromAcc.balances[currency] || 0;
  const isLiquiditySufficient = availableInFrom >= amount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || amount <= 0 || !Number.isFinite(amount) ||
        !isLiquiditySufficient || fromAccountId === toAccountId) return;

    setIsSubmitting(true);
    try {
      const accepted = await onExecuteTransfer({
        fromAccountId,
        toAccountId,
        currency,
        amount,
        description: description.trim() || 'تحويل مالي داخلي بين الحسابات',
      });
      if (accepted) onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <h3 className="text-base font-bold text-white">التحويلات المالية الداخلية وتغذية الصناديق</h3>
              <span className="text-[10px] text-slate-400 font-mono">البند 3.3 من وثيقة المتطلبات</span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="w-10 h-10 min-w-[40px] flex items-center justify-center rounded-xl bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-750 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* From Account & To Account */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-300 mb-1 font-medium">من حساب (المُحَوِّل منه / دائن)</label>
              <select
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
                className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {accounts
                  .filter((a) => a.type === 'asset')
                  .map((acc) => (
                    <option key={acc.id} value={acc.id} disabled={acc.id === toAccountId}>
                      {acc.code} - {acc.nameAr}
                    </option>
                  ))}
              </select>
              <div className="text-[11px] text-slate-400 mt-1 flex justify-between">
                <span>الرصيد المتوفر بالعملة المحددة:</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {formatMoney(availableInFrom, currency)}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1 font-medium">إلى حساب (المُحَوَّل إليه / مدين)</label>
              <select
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {accounts
                  .filter((a) => a.type === 'asset' || a.category === 'bank')
                  .map((acc) => (
                    <option key={acc.id} value={acc.id} disabled={acc.id === fromAccountId}>
                      {acc.code} - {acc.nameAr}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Currency & Amount */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-300 mb-1 font-medium">العملة المحولة</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white font-semibold focus:outline-none"
              >
                {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((c) => (
                  <option key={c} value={c}>
                    {SUPPORTED_CURRENCIES[c].flag} {SUPPORTED_CURRENCIES[c].nameAr}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1 font-medium">المبلغ المحول</label>
              <input
                type="number"
                min="1"
                step="any"
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs font-bold font-mono text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1 font-medium">البيان / سبب التحويل</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white focus:outline-none"
              required
            />
          </div>

          {!isLiquiditySufficient ? (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
              تنبيه: الرصيد غير كافٍ في الحساب المحول منه لتنفيذ هذا التحويل.
            </div>
          ) : null}

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-400 rounded-xl text-xs font-semibold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !isLiquiditySufficient || amount <= 0 || fromAccountId === toAccountId}
              className="min-h-[44px] px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/40 cursor-pointer"
            >
              {isSubmitting ? <span className="animate-spin border-2 border-white/30 border-t-white rounded-full w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>{isSubmitting ? 'جارٍ اعتماد المناقلة من الخادم...' : 'تنفيذ المناقلة والقيد المزدوج'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
