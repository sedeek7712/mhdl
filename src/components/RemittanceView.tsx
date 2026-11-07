import React, { useState, useEffect } from 'react';
import { Account, CurrencyCode, Remittance, RemittanceSettings, SUPPORTED_CURRENCIES, TransferStatus, UserProfile } from '../types/exchange';
import { formatMoney } from '../services/accountingEngine';
import { useToast } from './ui/Toast';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Filter,
  Hash,
  Info,
  MessageCircle,
  MessageSquare,
  PenTool,
  Printer,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-react';

interface RemittanceViewProps {
  remittances: Remittance[];
  accounts: Account[];
  currentUser: UserProfile;
  remittanceSettings: RemittanceSettings;
  onOpenSettings?: () => void;
  onCreateOutgoingRemittance: (data: {
    senderName: string;
    senderPhone: string;
    recipientName: string;
    recipientPhone: string;
    networkName: string;
    amount: number;
    currency: CurrencyCode;
    feeAmount: number;
    notes?: string;
    manualTransferNumber?: string;
  }) => void;
  onPayoutIncomingRemittance: (transferId: string, recipientIdType: 'national_id' | 'passport' | 'family_card', recipientIdNumber: string) => void;
  onCancelRemittance: (transferId: string, reason: string) => void;
  onOpenVoucher: (remittance: Remittance) => void;
}

const NETWORKS = ['شبكة النجم', 'شبكة الامتياز', 'شبكة يمن إكسبرس', 'شبكة الجزيرة', 'شبكة الحزمي', 'شبكة خاصة'];

export const RemittanceView: React.FC<RemittanceViewProps> = ({
  remittances,
  accounts,
  currentUser,
  remittanceSettings,
  onOpenSettings,
  onCreateOutgoingRemittance,
  onPayoutIncomingRemittance,
  onCancelRemittance,
  onOpenVoucher,
}) => {
  const [activeTab, setActiveTab] = useState<'list' | 'new_outgoing'>('list');
  const [filterDirection, setFilterDirection] = useState<'all' | 'outgoing' | 'incoming'>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const toast = useToast();

  // Form states for new outgoing remittance
  const [senderName, setSenderName] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [networkName, setNetworkName] = useState('شبكة النجم');
  const [amount, setAmount] = useState<number>(0);
  const [currency, setCurrency] = useState<CurrencyCode>('SAR');
  const [feeAmount, setFeeAmount] = useState<number>(0);
  const [notes, setNotes] = useState('');

  // Manual numbering states & real-time uniqueness validation
  const [manualTransferNumber, setManualTransferNumber] = useState('');
  const [numberValidationStatus, setNumberValidationStatus] = useState<'idle' | 'valid' | 'duplicate' | 'empty'>('idle');
  const [numberValidationError, setNumberValidationError] = useState('');

  // Validate manual transfer number on change
  useEffect(() => {
    if (remittanceSettings.numberingMode !== 'manual') {
      setNumberValidationStatus('idle');
      setNumberValidationError('');
      return;
    }

    const trimmed = manualTransferNumber.trim();
    if (!trimmed) {
      setNumberValidationStatus('empty');
      setNumberValidationError('رقم الحوالة حقل إلزامي في وضع الترقيم اليدوي.');
      return;
    }

    const isDuplicate = remittances.some(
      (r) => r.transferNumber.trim().toUpperCase() === trimmed.toUpperCase()
    );

    if (isDuplicate) {
      setNumberValidationStatus('duplicate');
      setNumberValidationError(`⚠️ رقم الحوالة (${trimmed}) مستخدم مسبقاً في النظام ولا يمكن تكراره (قيد UNIQUE).`);
    } else {
      setNumberValidationStatus('valid');
      setNumberValidationError('');
    }
  }, [manualTransferNumber, remittances, remittanceSettings.numberingMode]);

  // Payout Modal state
  const [payoutModalTarget, setPayoutModalTarget] = useState<Remittance | null>(null);
  const [recipientIdType, setRecipientIdType] = useState<'national_id' | 'passport' | 'family_card'>('national_id');
  const [recipientIdNumber, setRecipientIdNumber] = useState('');

  // Cancel Modal state
  const [cancelModalTarget, setCancelModalTarget] = useState<Remittance | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  // Filter remittances
  const filteredRemittances = remittances.filter((rem) => {
    if (filterDirection !== 'all' && rem.direction !== filterDirection) return false;
    if (filterStatus !== 'all' && rem.status !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNum = rem.transferNumber.toLowerCase().includes(q);
      const matchSender = rem.senderName.toLowerCase().includes(q);
      const matchRecip = rem.recipientName.toLowerCase().includes(q);
      const matchPhone = rem.recipientPhone.includes(q) || rem.senderPhone.includes(q);
      if (!matchNum && !matchSender && !matchRecip && !matchPhone) return false;
    }
    return true;
  });

  const handleCreateOutgoing = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) {
      toast.warning('يرجى إدخال مبلغ الحوالة بشكل صحيح');
      return;
    }

    if (remittanceSettings.numberingMode === 'manual') {
      const trimmed = manualTransferNumber.trim();
      if (!trimmed) {
        toast.warning('يرجى إدخال رقم الحوالة (حقل إلزامي في وضع الترقيم اليدوي).');
        return;
      }
      const isDuplicate = remittances.some(
        (r) => r.transferNumber.trim().toUpperCase() === trimmed.toUpperCase()
      );
      if (isDuplicate) {
        toast.error('رقم الحوالة مستخدم مسبقاً', `رفض النظام: رقم الحوالة (${trimmed}) مستخدم مسبقاً لمنع التكرار.`);
        return;
      }
    }

    onCreateOutgoingRemittance({
      senderName,
      senderPhone,
      recipientName,
      recipientPhone,
      networkName,
      amount,
      currency,
      feeAmount,
      notes,
      manualTransferNumber: remittanceSettings.numberingMode === 'manual' ? manualTransferNumber.trim().toUpperCase() : undefined,
    });
    toast.success('تم إصدار الحوالة الصادرة بنجاح', 'تم قيد العملية في دفتر اليومية وفتح سند التحويل المعتمد.');
    setManualTransferNumber('');
    setActiveTab('list');
  };

  const handleConfirmPayout = () => {
    if (!payoutModalTarget) return;
    if (!recipientIdNumber.trim()) {
      toast.warning('الرجاء إدخال رقم هوية المستفيد للتحقق قبل الصرف.');
      return;
    }
    onPayoutIncomingRemittance(payoutModalTarget.id, recipientIdType, recipientIdNumber.trim());
    toast.success('تم صرف الحوالة بنجاح للمستفيد');
    setPayoutModalTarget(null);
    setRecipientIdNumber('');
  };

  const handleConfirmCancel = () => {
    if (!cancelModalTarget) return;
    if (!cancelReason.trim()) {
      toast.warning('الرجاء ذكر سبب الإلغاء لإنشاء القيد العكسي.');
      return;
    }
    onCancelRemittance(cancelModalTarget.id, cancelReason.trim());
    toast.info('تم إلغاء الحوالة وقيد العكس المحاسبي');
    setCancelModalTarget(null);
    setCancelReason('');
  };

  const getStatusBadge = (status: TransferStatus) => {
    switch (status) {
      case 'approved':
        return <span className="text-[11px] font-semibold text-sky-400">معتمدة للإرسال</span>;
      case 'available':
        return <span className="text-[11px] font-semibold text-emerald-400">متاحة للصرف</span>;
      case 'paid':
        return <span className="text-[11px] font-semibold text-teal-300">مستلمة / مدفوعة</span>;
      case 'cancelled':
        return <span className="text-[11px] font-semibold text-rose-400">ملغاة (قيد عكسي)</span>;
      case 'draft':
        return <span className="text-[11px] font-semibold text-slate-400">مسودة</span>;
      default:
        return <span className="text-[11px] font-semibold text-amber-400">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Tab Controls */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Send className="w-5 h-5 text-emerald-400" />
            <span>إدارة الحوالات والشبكات المالية</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            تسجيل الحوالات الصادرة والواردة، التحقق من هوية المستلم، دورة حياة الحوالة والقيود العكسية للاسترداد.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenSettings ? (
            <button
              onClick={onOpenSettings}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-all shadow-sm"
              title="الإعدادات ← إعدادات الحوالات ← طريقة إصدار رقم الحوالة"
            >
              <Settings className="w-3.5 h-3.5 text-amber-400" />
              <span>طريقة الترقيم:</span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  remittanceSettings.numberingMode === 'automatic'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                }`}
              >
                {remittanceSettings.numberingMode === 'automatic' ? 'تلقائي ⚡' : 'يدوي ✍️'}
              </span>
            </button>
          ) : null}

          <button
            onClick={() => setActiveTab('list')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'list' ? 'bg-slate-800 text-white border border-slate-700' : 'text-slate-400 hover:text-white'
            }`}
          >
            سجل الحوالات ({remittances.length})
          </button>
          <button
            onClick={() => setActiveTab('new_outgoing')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'new_outgoing'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                : 'bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30'
            }`}
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>إرسال حوالة صادرة جديدة</span>
          </button>
        </div>
      </div>

      {activeTab === 'new_outgoing' ? (
        /* Form: New Outgoing Remittance */
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h2 className="text-base font-bold text-white">بيانات الحوالة الصادرة</h2>
            <span className="text-xs text-slate-400">الفرع: {currentUser.branchName}</span>
          </div>

          <form onSubmit={handleCreateOutgoing} className="space-y-5">
            {/* Numbering Policy Indicator / Manual Transfer Number Input */}
            {remittanceSettings.numberingMode === 'manual' ? (
              <div className="bg-sky-950/25 border-2 border-sky-500/50 rounded-xl p-4 space-y-2.5 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
                    <PenTool className="w-4 h-4 text-sky-400" />
                    <span>رقم الحوالة (حقل إلزامي - الترقيم اليدوي مفعّل)</span>
                  </label>
                  <span className="text-[10px] text-sky-400 font-mono bg-sky-950/80 px-2 py-0.5 rounded border border-sky-800/60">
                    قيد عدم التكرار الصارم (UNIQUE)
                  </span>
                </div>

                <div className="relative">
                  <input
                    type="text"
                    value={manualTransferNumber}
                    onChange={(e) => setManualTransferNumber(e.target.value.toUpperCase())}
                    placeholder="أدخل رقم الحوالة يدوياً مثل: TR-931107 أو رقم الشبكة الورقي..."
                    className={`w-full bg-slate-900 border rounded-lg pr-3 pl-32 py-2.5 text-xs font-mono font-bold text-white focus:outline-none transition-all ${
                      numberValidationStatus === 'duplicate'
                        ? 'border-rose-500 focus:ring-2 focus:ring-rose-500 bg-rose-950/20'
                        : numberValidationStatus === 'valid'
                        ? 'border-emerald-500 focus:ring-2 focus:ring-emerald-500 bg-emerald-950/20'
                        : 'border-slate-700 focus:ring-1 focus:ring-sky-500'
                    }`}
                    required
                  />

                  {numberValidationStatus === 'valid' ? (
                    <span className="absolute left-3 top-2.5 flex items-center gap-1 text-[11px] font-sans font-bold text-emerald-400">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>رقم فريد ومتاح ✓</span>
                    </span>
                  ) : null}
                  {numberValidationStatus === 'duplicate' ? (
                    <span className="absolute left-3 top-2.5 flex items-center gap-1 text-[11px] font-sans font-bold text-rose-400">
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                      <span>رقم مكرر ✕</span>
                    </span>
                  ) : null}
                </div>

                {numberValidationError ? (
                  <div className="p-2.5 bg-rose-950/40 border border-rose-800/60 rounded-lg flex items-center gap-2 text-[11px] text-rose-300 font-semibold">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{numberValidationError}</span>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-400">
                    يتحقق النظام لحظياً من قاعدة البيانات لمنع استخدام هذا الرقم لأي حوالة أخرى عبر كافة الفروع.
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-xl p-3.5 flex items-center justify-between text-xs animate-in fade-in">
                <div className="flex items-center gap-2 text-emerald-300">
                  <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <span className="font-bold">نظام الترقيم التلقائي نشط:</span>
                    <span className="text-[11px] text-slate-300 mr-1.5">
                      النظام ينشئ رقماً فريداً ومتسلسلاً تلقائياً عند اعتماد الحوالة (حقل الإدخال مخفي لمنع الأخطاء).
                    </span>
                  </div>
                </div>
                <div className="text-[11px] font-mono text-emerald-400 hidden sm:block">
                  الرقم التالي: <strong>{remittanceSettings.prefix}{String(remittanceSettings.nextSequence).padStart(6, '0')}</strong>
                </div>
              </div>
            )}

            {/* Sender and Recipient */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Sender Box */}
              <div className="bg-slate-850 p-4 rounded-xl border border-slate-800 space-y-3">
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                  <ArrowUpRight className="w-3.5 h-3.5" /> بيانات المرسل
                </span>
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">اسم المرسل الكامل</label>
                  <input
                    type="text"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">رقم هاتف المرسل</label>
                  <input
                    type="text"
                    value={senderPhone}
                    onChange={(e) => setSenderPhone(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    required
                  />
                </div>
              </div>

              {/* Recipient Box */}
              <div className="bg-slate-850 p-4 rounded-xl border border-slate-800 space-y-3">
                <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
                  <ArrowDownLeft className="w-3.5 h-3.5" /> بيانات المستلم
                </span>
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">اسم المستلم الكامل</label>
                  <input
                    type="text"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">رقم هاتف المستلم</label>
                  <input
                    type="text"
                    value={recipientPhone}
                    onChange={(e) => setRecipientPhone(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Financials & Network */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 bg-slate-850 p-4 rounded-xl border border-slate-800">
              <div>
                <label className="block text-[11px] text-slate-300 mb-1">شبكة التحويل</label>
                <select
                  value={networkName}
                  onChange={(e) => setNetworkName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {NETWORKS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-300 mb-1">العملة</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((c) => (
                    <option key={c} value={c}>
                      {SUPPORTED_CURRENCIES[c].flag} {SUPPORTED_CURRENCIES[c].nameAr}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-300 mb-1">مبلغ الحوالة</label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-bold font-mono text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-300 mb-1">أجور التحويل (العمولة)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={feeAmount}
                  onChange={(e) => setFeeAmount(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-bold font-mono text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Total Paid Calculation */}
            <div className="flex items-center justify-between p-4 bg-emerald-950/40 border border-emerald-800/40 rounded-xl">
              <span className="text-xs text-slate-300">
                إجمالي المبلغ المقبوض من المرسل (الحوالة + العمولة):
              </span>
              <span className="text-lg font-bold font-mono text-emerald-400 tabular-nums">
                {formatMoney(amount + feeAmount, currency)}
              </span>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setActiveTab('list')}
                className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-700"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={remittanceSettings.numberingMode === 'manual' && (numberValidationStatus === 'duplicate' || !manualTransferNumber.trim())}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:border disabled:border-slate-700 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>إرسال وتوليد السند المالي فـوراً</span>
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* Remittance List & Filter Table */
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-800">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                placeholder="بحث برقم الحوالة، اسم المرسل أو المستلم، أو الهاتف..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pr-9 pl-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-500"
              />
            </div>

            {/* Segmented Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center p-1 bg-slate-800 rounded-lg">
                <button
                  onClick={() => setFilterDirection('all')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    filterDirection === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  الكل
                </button>
                <button
                  onClick={() => setFilterDirection('outgoing')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    filterDirection === 'outgoing' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  صادرة
                </button>
                <button
                  onClick={() => setFilterDirection('incoming')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    filterDirection === 'incoming' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  واردة
                </button>
              </div>

              {/* Status Filter */}
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none"
              >
                <option value="all">كافة الحالات</option>
                <option value="available">متاحة للصرف</option>
                <option value="paid">مستلمة / مدفوعة</option>
                <option value="approved">معتمدة</option>
                <option value="cancelled">ملغاة ومستردة</option>
              </select>
            </div>
          </div>

          {/* Mobile Cards View (Visible on screens < lg) */}
          <div className="block lg:hidden divide-y divide-slate-800/80">
            {filteredRemittances.length === 0 ? (
              <div className="py-12 text-center text-slate-500 font-sans">
                <span className="text-3xl block mb-2">📭</span>
                <span className="text-sm font-semibold text-slate-400 block mb-1">لا توجد حوالات مسجلة حتى الآن</span>
                <span className="text-xs text-slate-500">سجل الحوالات نظيف وخالٍ، ويمكنك إصدار أول حوالة بالنقر على زر "إرسال حوالة جديدة".</span>
              </div>
            ) : (
              filteredRemittances.map((rem) => {
                const isOutgoing = rem.direction === 'outgoing';
                return (
                  <div key={`mob-${rem.id}`} className="p-4 space-y-3 hover:bg-slate-800/30 transition-colors">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-white text-sm">{rem.transferNumber}</span>
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                            isOutgoing ? 'bg-sky-500/10 text-sky-400' : 'bg-teal-500/10 text-teal-400'
                          }`}
                        >
                          {isOutgoing ? 'صادرة 📤' : 'واردة 📥'}
                        </span>
                      </div>
                      <div className="font-sans">{getStatusBadge(rem.status)}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60">
                      <div>
                        <span className="text-slate-400 block text-[11px]">المرسل:</span>
                        <span className="text-white font-semibold block truncate">{rem.senderName}</span>
                        <span className="text-slate-500 font-mono text-[10px]">{rem.senderPhone}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">المستلم:</span>
                        <span className="text-white font-semibold block truncate">{rem.recipientName}</span>
                        <span className="text-slate-500 font-mono text-[10px]">{rem.recipientPhone}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div>
                        <span className="text-[10px] text-slate-400 block">المبلغ الصافي:</span>
                        <span className="font-mono font-bold text-emerald-400 text-base">
                          {formatMoney(rem.amount, rem.currency)}
                        </span>
                        {rem.feeAmount > 0 ? (
                          <span className="text-[10px] text-slate-500 block">
                            عمولة: {rem.feeAmount} {SUPPORTED_CURRENCIES[rem.currency].symbol}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-left text-[10px] text-slate-500">
                        <span>{rem.networkName}</span>
                        <span className="block font-mono">{rem.createdAt}</span>
                      </div>
                    </div>

                    {/* Touch-Friendly Action Cluster (min-h-[44px]) */}
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80 flex-wrap">
                      <button
                        onClick={() => onOpenVoucher(rem)}
                        className="flex-1 min-h-[44px] px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Printer className="w-4 h-4 text-emerald-400" />
                        <span>طباعة السند</span>
                      </button>

                      <button
                        onClick={() => onOpenVoucher(rem)}
                        className="flex-1 min-h-[44px] px-3 bg-[#00a884]/20 hover:bg-[#00a884]/30 border border-[#00a884]/40 text-[#25D366] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>واتساب</span>
                      </button>

                      {rem.direction === 'incoming' && rem.status === 'available' ? (
                        <button
                          onClick={() => setPayoutModalTarget(rem)}
                          className="w-full min-h-[44px] px-4 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-teal-900/30"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          <span>صرف وتسليم الحوالة للمستفيد</span>
                        </button>
                      ) : null}

                      {(rem.status === 'approved' || rem.status === 'available') ? (
                        <button
                          onClick={() => setCancelModalTarget(rem)}
                          className="min-h-[44px] px-3 bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 text-rose-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>إلغاء</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table View (Visible on lg and larger screens) */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-right text-xs min-w-[760px]">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 font-semibold">رقم الحوالة</th>
                  <th className="py-2.5 px-3 font-semibold">النوع والشبكة</th>
                  <th className="py-2.5 px-3 font-semibold">المرسل</th>
                  <th className="py-2.5 px-3 font-semibold">المستلم</th>
                  <th className="py-2.5 px-3 font-semibold">المبلغ والعملة</th>
                  <th className="py-2.5 px-3 font-semibold">الحالة</th>
                  <th className="py-2.5 px-3 font-semibold text-center">الإجراءات والعمليات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredRemittances.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-500 font-sans">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <span className="text-2xl">📭</span>
                        <span className="text-sm font-semibold text-slate-400">لا توجد حوالات مسجلة حتى الآن</span>
                        <span className="text-xs text-slate-500">سجل الحوالات نظيف وخالٍ، ويمكنك إصدار أول حوالة بالنقر على زر "إرسال حوالة جديدة".</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRemittances.map((rem) => {
                  const isOutgoing = rem.direction === 'outgoing';
                  return (
                    <tr key={rem.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-white block">{rem.transferNumber}</span>
                          {rem.numberingMode ? (
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-sans font-semibold ${
                                rem.numberingMode === 'automatic'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-sky-500/10 text-sky-400 border border-sky-500/30'
                              }`}
                              title={
                                rem.numberingMode === 'automatic'
                                  ? 'تم إصدار الرقم تلقائياً وفق التسلسل المركزي'
                                  : 'تم إدخال الرقم يدوياً مع فحص عدم التكرار'
                              }
                            >
                              {rem.numberingMode === 'automatic' ? 'تلقائي' : 'يدوي'}
                            </span>
                          ) : null}
                        </div>
                        <span className="text-[10px] text-slate-500 font-sans">{rem.createdAt}</span>
                      </td>

                      <td className="py-3 px-3 font-sans">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold mb-0.5 ${
                            isOutgoing ? 'bg-sky-500/10 text-sky-400' : 'bg-teal-500/10 text-teal-400'
                          }`}
                        >
                          {isOutgoing ? 'صادرة 📤' : 'واردة 📥'}
                        </span>
                        <div className="text-slate-300 text-[11px]">{rem.networkName}</div>
                      </td>

                      <td className="py-3 px-3 font-sans">
                        <div className="font-semibold text-white">{rem.senderName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{rem.senderPhone}</div>
                      </td>

                      <td className="py-3 px-3 font-sans">
                        <div className="font-semibold text-white">{rem.recipientName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{rem.recipientPhone}</div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-bold text-emerald-400 text-sm">
                          {formatMoney(rem.amount, rem.currency)}
                        </div>
                        {rem.feeAmount > 0 ? (
                          <div className="text-[10px] text-slate-500 font-sans">
                            عمولة: {rem.feeAmount} {SUPPORTED_CURRENCIES[rem.currency].symbol}
                          </div>
                        ) : null}
                      </td>

                      <td className="py-3 px-3 font-sans">{getStatusBadge(rem.status)}</td>

                      <td className="py-3 px-3 font-sans text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Payout Action for available incoming remittances */}
                          {rem.direction === 'incoming' && rem.status === 'available' ? (
                            <button
                              onClick={() => setPayoutModalTarget(rem)}
                              className="px-2.5 py-1 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                              title="صرف وتسليم الحوالة للمستفيد بعد التحقق من الهوية"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>صرف</span>
                            </button>
                          ) : null}

                          {/* Cancel / Refund Action (reverse double-entry) */}
                          {(rem.status === 'approved' || rem.status === 'available') ? (
                            <button
                              onClick={() => setCancelModalTarget(rem)}
                              className="px-2 py-1 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-lg text-xs font-semibold flex items-center gap-1"
                              title="إلغاء واسترداد مع قيد عكسي"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>إلغاء</span>
                            </button>
                          ) : null}

                          {/* Print / View Voucher */}
                          <button
                            onClick={() => onOpenVoucher(rem)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                            title="عرض وطباعة السند المالي الرسمي"
                          >
                            <Printer className="w-3.5 h-3.5 text-emerald-400" />
                          </button>

                          {/* Instant WhatsApp Dispatch */}
                          <button
                            onClick={() => onOpenVoucher(rem)}
                            className="p-1.5 bg-emerald-950/60 hover:bg-[#00a884] text-emerald-400 hover:text-white rounded-lg border border-emerald-800/40 transition-colors"
                            title="إرسال سند الحوالة عبر WhatsApp (السند + النص)"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Payout Incoming Remittance (KYC Verification) */}
      {payoutModalTarget ? (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setPayoutModalTarget(null); }}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-teal-400 shrink-0" />
                <span>التحقق من الهوية لصرف الحوالة</span>
              </h3>
              <button
                onClick={() => setPayoutModalTarget(null)}
                aria-label="إغلاق"
                className="w-10 h-10 min-w-[40px] flex items-center justify-center rounded-xl bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-850 p-3 rounded-xl border border-slate-800 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-400">رقم الحوالة:</span>
                <span className="text-white font-mono font-bold">{payoutModalTarget.transferNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">المستفيد:</span>
                <span className="text-emerald-400 font-bold">{payoutModalTarget.recipientName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">المبلغ المستحق:</span>
                <span className="text-amber-400 font-mono font-bold">
                  {formatMoney(payoutModalTarget.amount, payoutModalTarget.currency)}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1 font-medium">نوع إثبات الهوية</label>
                <select
                  value={recipientIdType}
                  onChange={(e) => setRecipientIdType(e.target.value as any)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white focus:outline-none"
                >
                  <option value="national_id">بطاقة شخصية ذكية</option>
                  <option value="passport">جواز سفر ساري المفعول</option>
                  <option value="family_card">بطاقة عائلية</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1 font-medium">رقم الهوية</label>
                <input
                  type="text"
                  value={recipientIdNumber}
                  onChange={(e) => setRecipientIdNumber(e.target.value)}
                  placeholder="أدخل الرقم الوطني أو رقم الجواز..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setPayoutModalTarget(null)}
                className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl text-xs font-semibold"
              >
                إلغاء
              </button>
              <button
                onClick={handleConfirmPayout}
                className="min-h-[44px] px-5 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-teal-900/30"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>تأكيد الصرف وتسليم النقدية</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal: Cancel & Reverse Remittance */}
      {cancelModalTarget ? (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setCancelModalTarget(null); }}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        >
          <div className="bg-slate-900 border border-rose-900/60 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                <span>طلب إلغاء واسترداد حوالة (قيد عكسي)</span>
              </h3>
              <button
                onClick={() => setCancelModalTarget(null)}
                aria-label="إغلاق"
                className="w-10 h-10 min-w-[40px] flex items-center justify-center rounded-xl bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              وفقاً للبند 4.1 من الوثيقة: <strong>لا تُحذف الحوالة المعتمدة</strong> بل يتم إنشاء قيد محاسبي عكسي وإعادة
              المبلغ لصندوق الكاشير مع تسجيل سبب الإلغاء في السجل غير القابل للتعديل.
            </p>

            <div className="bg-slate-850 p-3 rounded-xl border border-slate-800 text-xs">
              الحوالة: <strong className="font-mono text-white">{cancelModalTarget.transferNumber}</strong> بقيمة{' '}
              <strong className="text-emerald-400 font-mono">
                {formatMoney(cancelModalTarget.amount, cancelModalTarget.currency)}
              </strong>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1 font-medium">مبرر الإلغاء القانوني والمالي</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="اكتب سبب طلب الإلغاء بدقة..."
                rows={3}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setCancelModalTarget(null)}
                className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl text-xs font-semibold"
              >
                تراجع
              </button>
              <button
                onClick={handleConfirmCancel}
                className="min-h-[44px] px-5 py-2 bg-rose-700 hover:bg-rose-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-rose-950/40"
              >
                <RotateCcw className="w-4 h-4" />
                <span>اعتماد القيد العكسي وإلغاء الحوالة</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
