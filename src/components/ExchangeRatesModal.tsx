import React, { useState } from 'react';
import { CurrencyCode, ExchangeRate, ExchangeRateAuditLog, SUPPORTED_CURRENCIES, UserProfile } from '../types/exchange';
import { ArrowLeftRight, Clock, History, Save, ShieldCheck, TrendingUp, X } from 'lucide-react';

interface ExchangeRatesModalProps {
  rates: ExchangeRate[];
  auditLogs: ExchangeRateAuditLog[];
  currentUser: UserProfile;
  isOpen: boolean;
  onClose: () => void;
  onUpdateRate: (rateId: string, newBuyRate: number, newSellRate: number, note?: string) => Promise<boolean> | boolean;
}

export const ExchangeRatesModal: React.FC<ExchangeRatesModalProps> = ({
  rates,
  auditLogs,
  currentUser,
  isOpen,
  onClose,
  onUpdateRate,
}) => {
  const [activeTab, setActiveTab] = useState<'rates' | 'logs'>('rates');
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [editBuy, setEditBuy] = useState<number>(0);
  const [editSell, setEditSell] = useState<number>(0);
  const [editNote, setEditNote] = useState<string>('');

  if (!isOpen) return null;

  const canEditRates = currentUser.role === 'owner' || currentUser.role === 'general_manager';

  const handleStartEdit = (rate: ExchangeRate) => {
    setEditingRateId(rate.id);
    setEditBuy(rate.buyRate);
    setEditSell(rate.sellRate);
    setEditNote('تعديل اعتيادي تماشياً مع حركة السوق المصرفي');
  };

  const handleSaveEdit = async (rateId: string) => {
    if (editBuy <= 0 || editSell <= 0) return;
    const saved = await onUpdateRate(rateId, editBuy, editSell, editNote);
    if (saved) setEditingRateId(null);
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex flex-col justify-start sm:justify-center items-center p-2 sm:p-4 overflow-y-auto no-print"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl max-w-3xl w-full my-auto shadow-2xl flex flex-col max-h-[96vh] sm:max-h-[92vh] overflow-hidden">
        
        {/* Sticky Header */}
        <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-3 sm:px-6 py-3 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={onClose}
              aria-label="إغلاق"
              className="w-10 h-10 min-w-[40px] flex items-center justify-center rounded-xl bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-750 transition-colors shrink-0 cursor-pointer"
              title="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="truncate">
              <h2 className="text-xs sm:text-base font-bold text-white flex items-center gap-1.5 truncate">
                <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>إدارة أسعار الصرف والسجل التدقيقي</span>
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setActiveTab('rates')}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${
                activeTab === 'rates' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800'
              }`}
            >
              الأسعار
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${
                activeTab === 'logs' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800'
              }`}
            >
              السجل ({auditLogs.length})
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-3 sm:p-6 overflow-y-auto space-y-4 flex-1">
          {/* Warning if teller or not authorized */}
          {!canEditRates ? (
            <div className="p-3 bg-amber-950/40 border border-amber-800 text-amber-300 text-xs rounded-xl flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 text-amber-400" />
              <span>
                صلاحية المشاهدة فقط: تحديث أسعار الصرف مقتصر على <strong>المالك</strong> و
                <strong>المدير العام</strong>.
              </span>
            </div>
          ) : null}

          {/* Tab 1: Current Rates */}
          {activeTab === 'rates' ? (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2 px-2.5 font-semibold">زوج العملة</th>
                      <th className="py-2 px-2.5 font-semibold text-center">شراء</th>
                      <th className="py-2 px-2.5 font-semibold text-center">بيع</th>
                      <th className="py-2 px-2.5 font-semibold hidden sm:table-cell">التحديث</th>
                      <th className="py-2 px-2.5 font-semibold text-center">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {rates.map((rate) => {
                      const isEditing = editingRateId === rate.id;
                      const fromInfo = SUPPORTED_CURRENCIES[rate.fromCurrency];
                      const toInfo = SUPPORTED_CURRENCIES[rate.toCurrency];

                      return (
                        <tr key={rate.id} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-2.5 font-sans font-semibold text-white">
                            <div className="flex items-center gap-1">
                              <span>{fromInfo.flag}</span>
                              <span className="text-xs">{fromInfo.symbol}</span>
                              <ArrowLeftRight className="w-3 h-3 text-slate-500" />
                              <span>{toInfo.flag}</span>
                              <span className="text-xs">{toInfo.symbol}</span>
                            </div>
                            <span className="text-[10px] text-slate-500 block truncate">
                              {fromInfo.nameAr.split('(')[0]} مقابل {toInfo.nameAr.split('(')[0]}
                            </span>
                          </td>

                          <td className="py-2.5 px-2.5 text-center">
                            {isEditing ? (
                              <input
                                type="number"
                                step="any"
                                value={editBuy}
                                onChange={(e) => setEditBuy(parseFloat(e.target.value) || 0)}
                                className="w-20 bg-slate-950 border border-slate-700 text-emerald-400 font-bold px-2 py-1 rounded text-center text-xs"
                              />
                            ) : (
                              <span className="font-bold text-emerald-400 text-xs sm:text-sm">{rate.buyRate}</span>
                            )}
                          </td>

                          <td className="py-2.5 px-2.5 text-center">
                            {isEditing ? (
                              <input
                                type="number"
                                step="any"
                                value={editSell}
                                onChange={(e) => setEditSell(parseFloat(e.target.value) || 0)}
                                className="w-20 bg-slate-950 border border-slate-700 text-amber-400 font-bold px-2 py-1 rounded text-center text-xs"
                              />
                            ) : (
                              <span className="font-bold text-amber-400 text-xs sm:text-sm">{rate.sellRate}</span>
                            )}
                          </td>

                          <td className="py-2.5 px-2.5 font-sans text-slate-400 text-[10px] hidden sm:table-cell">
                            <div>{rate.updatedAt.split(' ')[1]}</div>
                            <div className="text-slate-500 truncate max-w-[100px]">{rate.updatedBy}</div>
                          </td>

                          <td className="py-2.5 px-2.5 font-sans text-center">
                            {isEditing ? (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => handleSaveEdit(rate.id)}
                                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold flex items-center gap-1"
                                >
                                  <Save className="w-3 h-3" />
                                  <span>حفظ</span>
                                </button>
                                <button
                                  onClick={() => setEditingRateId(null)}
                                  className="px-2 py-1 bg-slate-800 text-slate-400 rounded text-xs"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <button
                                disabled={!canEditRates}
                                onClick={() => handleStartEdit(rate)}
                                className="px-2 py-1 bg-slate-800 hover:bg-slate-750 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 hover:text-white rounded text-[11px]"
                              >
                                تعديل
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* Tab 2: Audit Logs */
            <div className="space-y-2">
              <p className="text-[11px] text-slate-400 mb-2">
                سجل تدقيق غير قابل للتعديل يوثق كافة تغييرات أسعار الصرف:
              </p>

              <div className="space-y-2 font-mono text-xs">
                {auditLogs.map((log) => (
                  <div key={log.id} className="bg-slate-850 border border-slate-800 rounded-xl p-3 space-y-1">
                    <div className="flex items-center justify-between text-slate-300 text-xs">
                      <span className="font-bold text-emerald-400">{log.currencyPair}</span>
                      <span className="text-[10px] text-slate-400">{log.changedAt}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                      <div>
                        شراء: <span className="line-through text-slate-500">{log.oldBuyRate}</span> ➔{' '}
                        <span className="text-emerald-400 font-bold">{log.newBuyRate}</span>
                      </div>
                      <div>
                        بيع: <span className="line-through text-slate-500">{log.oldSellRate}</span> ➔{' '}
                        <span className="text-amber-400 font-bold">{log.newSellRate}</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-400 font-sans flex items-center justify-between pt-0.5">
                      <span className="truncate">المنفذ: {log.changedBy}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
