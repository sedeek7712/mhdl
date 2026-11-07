import React, { useState } from 'react';
import { Account, CurrencyCode, Remittance, SUPPORTED_CURRENCIES, UserProfile } from '../types/exchange';
import { formatMoney, tafqeetArabic } from '../services/accountingEngine';
import { ArrowDownLeft, CheckCircle2, DollarSign, IdCard, KeyRound, Loader2, MessageCircle, Phone, Plus, Printer, Receipt, RefreshCw, Search, ShieldAlert, ShieldCheck, Sparkles, UserCheck, Vault, X } from 'lucide-react';
import { useToast } from './ui/Toast';

interface ReceiveTransferDeskProps {
  remittances: Remittance[];
  accounts: Account[];
  currentUser: UserProfile;
  onPayout: (transferId: string, recipientIdType: 'national_id' | 'passport' | 'family_card', recipientIdNumber: string) => void;
  onOpenVoucher: (remittance: Remittance) => void;
  onCreateIncomingRemittance?: (data: {
    transferNumber: string;
    networkName: string;
    senderName: string;
    senderPhone: string;
    recipientName: string;
    recipientPhone: string;
    amount: number;
    currency: CurrencyCode;
    notes?: string;
  }) => Remittance;
  onFundDrawer?: (currency: CurrencyCode, amount: number) => void;
}

export const ReceiveTransferDesk: React.FC<ReceiveTransferDeskProps> = ({
  remittances,
  accounts,
  currentUser,
  onPayout,
  onOpenVoucher,
  onCreateIncomingRemittance,
  onFundDrawer,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSecretPin, setSearchSecretPin] = useState('');
  const [selectedRemittance, setSelectedRemittance] = useState<Remittance | null>(null);

  // KYC Verification Form
  const [recipientIdType, setRecipientIdType] = useState<'national_id' | 'passport' | 'family_card'>('national_id');
  const [recipientIdNumber, setRecipientIdNumber] = useState('');
  const [recipientActualName, setRecipientActualName] = useState('');
  const [hasVerifiedOriginalId, setHasVerifiedOriginalId] = useState(false);
  const [isManagerOverride, setIsManagerOverride] = useState(false);
  const toast = useToast();

  // Incoming Remittance Quick Register Modal
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [regNetwork, setRegNetwork] = useState('شبكة النجم');
  const [regTransferNum, setRegTransferNum] = useState(`TR-${Math.floor(100000 + Math.random() * 900000)}`);
  const [regSenderName, setRegSenderName] = useState('محمد قاسم سالم النماري');
  const [regSenderPhone, setRegSenderPhone] = useState('771234567');
  const [regRecipientName, setRegRecipientName] = useState('صديق علي محمد الفتاحي');
  const [regRecipientPhone, setRegRecipientPhone] = useState('771280940');
  const [regAmount, setRegAmount] = useState(5000);
  const [regCurrency, setRegCurrency] = useState<CurrencyCode>('SAR');
  const [regNotes, setRegNotes] = useState('حوالة واردة للتسليم الفوري');

  // Cashier Drawer Account
  const cashierBox = accounts.find((a) => a.id === 'acc-1102') || accounts[1];

  // Quick Action: Load Sample Incoming Remittance for Instant Payout Testing
  const handleLoadSampleIncoming = () => {
    if (onCreateIncomingRemittance) {
      const rem = onCreateIncomingRemittance({
        transferNumber: 'TR-931106',
        networkName: 'شبكة النجم',
        senderName: 'محمد قاسم النماري',
        senderPhone: '770000111',
        recipientName: 'صديق علي محمد الفتاحي',
        recipientPhone: '771280940',
        amount: 5000,
        currency: 'SAR',
        notes: 'حوالة واردة من الفرع الرئيسي - تعز',
      });
      setSelectedRemittance(rem);
      setRecipientActualName(rem.recipientName);
      setRecipientIdNumber('04010029381');
      setHasVerifiedOriginalId(true);
    }
  };

  const handleRegisterIncoming = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreateIncomingRemittance) return;
    const newRem = onCreateIncomingRemittance({
      transferNumber: regTransferNum.trim() || `TR-${Math.floor(100000 + Math.random() * 900000)}`,
      networkName: regNetwork,
      senderName: regSenderName,
      senderPhone: regSenderPhone,
      recipientName: regRecipientName,
      recipientPhone: regRecipientPhone,
      amount: Number(regAmount),
      currency: regCurrency,
      notes: regNotes,
    });
    setSelectedRemittance(newRem);
    setRecipientActualName(newRem.recipientName);
    setIsRegisterModalOpen(false);
  };

  // Search logic: incoming remittances
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim().toLowerCase();
    if (!query) return;

    const match = remittances.find(
      (r) =>
        r.direction === 'incoming' &&
        (r.transferNumber.toLowerCase() === query ||
          r.recipientPhone.includes(query) ||
          r.transferNumber.toLowerCase().includes(query))
    );

    if (match) {
      setSelectedRemittance(match);
      setRecipientActualName(match.recipientName);
      toast.success('تم العثور على الحوالة بنجاح', `الحوالة رقم ${match.transferNumber} جاهزة للصرف.`);
    } else {
      toast.warning(
        'لم يتم العثور على حوالة مطابقة',
        'تأكد من رقم الحوالة أو هاتف المستفيد، أو انقر على «تسجيل وصول حوالة جديدة».'
      );
    }
  };

  const cashierBalance = selectedRemittance ? (cashierBox.balances[selectedRemittance.currency] || 0) : 0;
  const hasLiquidity = selectedRemittance
    ? cashierBalance >= selectedRemittance.amount || isManagerOverride
    : true;

  const [isSubmittingPayout, setIsSubmittingPayout] = useState(false);

  const handleConfirmPayout = async () => {
    if (!selectedRemittance || isSubmittingPayout) return;
    if (selectedRemittance.status !== 'available') {
      toast.error('الحوالة ليست متاحة للصرف', `حالة الحوالة الحالية: [${selectedRemittance.status === 'paid' ? 'تم صرفها مسبقاً' : 'ملغاة'}]. يمنع النظام التكرار.`);
      return;
    }
    if (!recipientIdNumber.trim()) {
      toast.warning('الرجاء إدخال رقم إثبات الهوية للمستفيد للتحقق قبل صرف الحوالة.');
      return;
    }
    if (!hasVerifiedOriginalId) {
      toast.warning('يرجى تأكيد الاطلاع ومطابقة أصل الهوية الشخصية للمستفيد.');
      return;
    }
    if (!hasLiquidity && !isManagerOverride) {
      toast.error('عذراً، رصيد الصندوق غير كافٍ', 'يمكنك تغذية الصندوق أو تفعيل خيار اعتماد المدير.');
      return;
    }

    setIsSubmittingPayout(true);
    try {
      await onPayout(selectedRemittance.id, recipientIdType, recipientIdNumber.trim());
      setSelectedRemittance((prev) => prev ? { ...prev, status: 'paid' } : null);
    } catch (err: any) {
      toast.error('فشل صرف الحوالة', err.message || 'حدث خطأ أثناء الاتصال بالخادم.');
    } finally {
      setIsSubmittingPayout(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-mono text-emerald-400 font-bold px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/40">
              نافذة الصرافين المصرفية المعتمدة
            </span>
          </div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ArrowDownLeft className="w-5 h-5 text-emerald-400" />
            <span>نافذة استلام وصرف الحوالات المصرفية (Payout Desk)</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            البحث الآلي عن الحوالات الواردة، التحقق الصارم من الهوية، تسليم النقدية، وإنشاء القيد المحاسبي المزدوج فوراً.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
          <button
            onClick={() => setIsRegisterModalOpen(true)}
            className="min-h-[44px] px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-emerald-900/30 transition-all cursor-pointer"
            title="تسجيل حوالة واردة من شبكة خارجية للصرف والتسليم"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>تسجيل حوالة واردة</span>
          </button>

          <button
            onClick={handleLoadSampleIncoming}
            className="min-h-[44px] px-3.5 py-2.5 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-amber-950/30 transition-all cursor-pointer"
            title="تحميل حوالة واردة نموذجية لاختبار دورة الصرف فوراً"
          >
            <Sparkles className="w-4 h-4 text-amber-200 shrink-0" />
            <span>⚡ حوالة تجريبية (5000 ريال)</span>
          </button>

          <div className="flex items-center justify-center gap-2 bg-slate-850 border border-slate-800 px-3.5 py-2 min-h-[44px] rounded-xl text-xs">
            <Vault className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-slate-400">الصندوق:</span>
            <span className="font-bold text-white truncate">{cashierBox.nameAr}</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Search Box & Remittance Verification Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Search & Quick Lookup (5 cols) */}
        <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Search className="w-4 h-4 text-emerald-400" />
              <span>البحث عن الحوالة الواردة</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              أدخل رقم الحوالة الصادرة من الشبكة أو رقم هاتف المستفيد.
            </p>
          </div>

          <form onSubmit={handleSearch} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-300 mb-1">رقم الحوالة أو هاتف المستفيد</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="مثال: TR-931106 أو 771280940"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1 flex items-center justify-between">
                <span>رمز التحقق السري للحوالة (PIN)</span>
                <span className="text-[10px] text-slate-500">(اختياري للشبكات الدولية)</span>
              </label>
              <div className="relative">
                <input
                  type="password"
                  placeholder="******"
                  value={searchSecretPin}
                  onChange={(e) => setSearchSecretPin(e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-500"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-600/25 transition-all cursor-pointer"
            >
              <Search className="w-4 h-4" />
              <span>استعلام وجلب بيانات الحوالة</span>
            </button>
          </form>

          {/* Quick list of available remittances ready to payout */}
          <div className="pt-3 border-t border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">
                حوالات واردة جاهزة للصرف ({remittances.filter((r) => r.direction === 'incoming' && r.status === 'available').length}):
              </span>
              <button
                type="button"
                onClick={() => setIsRegisterModalOpen(true)}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-0.5 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>إضافة حوالة</span>
              </button>
            </div>

            {remittances.filter((r) => r.direction === 'incoming' && r.status === 'available').length === 0 ? (
              <div className="p-4 bg-slate-850/60 border border-dashed border-slate-800 rounded-xl text-center space-y-2.5">
                <p className="text-[11px] text-slate-400">لا توجد حوالات واردة بانتظار الصرف حالياً.</p>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={handleLoadSampleIncoming}
                    className="w-full py-2 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>⚡ تحميل حوالة نموذجية (صرف فوري)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsRegisterModalOpen(true)}
                    className="w-full py-1.5 bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-400" />
                    <span>تسجيل حوالة واردة يدوياً</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {remittances
                  .filter((r) => r.direction === 'incoming' && r.status === 'available')
                  .map((rem) => (
                    <button
                      key={rem.id}
                      onClick={() => {
                        setSelectedRemittance(rem);
                        setRecipientActualName(rem.recipientName);
                      }}
                      className="w-full text-right p-2.5 bg-slate-850 hover:bg-slate-800 rounded-xl border border-slate-800 text-xs flex items-center justify-between transition-colors cursor-pointer"
                    >
                      <div>
                        <div className="font-bold text-white">{rem.recipientName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {rem.transferNumber} · {rem.networkName}
                        </div>
                      </div>
                      <div className="text-left font-mono font-bold text-emerald-400">
                        {formatMoney(rem.amount, rem.currency)}
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Remittance Details & KYC Payout Verification (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {selectedRemittance ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5">
              {/* Remittance Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold font-mono text-emerald-400 bg-slate-850 px-2.5 py-1 rounded-lg border border-slate-700">
                      {selectedRemittance.transferNumber}
                    </span>
                    <span className="text-xs font-bold text-white">{selectedRemittance.networkName}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 font-mono">
                    تاريخ الإرسال: {selectedRemittance.createdAt}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                      selectedRemittance.status === 'available'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : selectedRemittance.status === 'paid'
                        ? 'bg-teal-500/10 text-teal-300 border-teal-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {selectedRemittance.status === 'available'
                      ? 'متاحة للصرف والتسليم'
                      : selectedRemittance.status === 'paid'
                      ? 'تم الصرف والتسليم'
                      : selectedRemittance.status}
                  </span>
                </div>
              </div>

              {/* Amount Showcase */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center space-y-1">
                <span className="text-xs text-slate-400">المبلغ المستحق تسليمه نقداً للمستفيد:</span>
                <div className="text-2xl sm:text-3xl font-black font-mono text-emerald-400 tabular-nums">
                  {formatMoney(selectedRemittance.amount, selectedRemittance.currency)}
                </div>
                <div className="text-xs text-slate-300 pt-1">
                  فقط: <strong>{tafqeetArabic(selectedRemittance.amount, selectedRemittance.currency)}</strong>
                </div>
              </div>

              {/* Sender & Recipient Comparison */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-850 p-3 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-slate-400 block text-[10px]">المرسل:</span>
                  <div className="font-bold text-white text-sm">{selectedRemittance.senderName}</div>
                  <div className="font-mono text-slate-400 text-[11px]">{selectedRemittance.senderPhone}</div>
                </div>

                <div className="bg-slate-850 p-3 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-emerald-400 block text-[10px] font-semibold">المستفيد المسجل بالحوالة:</span>
                  <div className="font-bold text-white text-sm">{selectedRemittance.recipientName}</div>
                  <div className="font-mono text-slate-400 text-[11px]">{selectedRemittance.recipientPhone}</div>
                </div>
              </div>

              {/* Payout or Paid Status */}
              {selectedRemittance.status === 'paid' ? (
                <div className="bg-teal-950/40 border border-teal-800/60 rounded-xl p-4 text-center space-y-3">
                  <CheckCircle2 className="w-8 h-8 text-teal-400 mx-auto" />
                  <div>
                    <h3 className="text-sm font-bold text-teal-200">هذه الحوالة تم صرفها وتسليمها بنجاح</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      رقم الهوية المسجل: {selectedRemittance.recipientIdNumber || 'تم التحقق من أصل الهوية'}
                    </p>
                  </div>
                  <div className="flex items-center justify-center pt-1">
                    <button
                      onClick={() => onOpenVoucher(selectedRemittance)}
                      className="min-h-[44px] px-5 py-2.5 bg-slate-800 hover:bg-slate-750 text-white rounded-xl text-xs font-bold inline-flex items-center gap-2 border border-slate-700 shadow-sm cursor-pointer transition-colors"
                      title="عرض وطباعة سند الصرف الرسمي والإرسال عبر واتساب"
                    >
                      <Receipt className="w-4 h-4 text-emerald-400" />
                      <span>عرض وطباعة سند الصرف الرسمي (مع واتساب)</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* KYC Verification Box */
                <div className="bg-slate-850 p-4 rounded-xl border border-slate-800 space-y-4">
                  <h3 className="text-xs font-bold text-white flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>إجراءات التحقق الإلزامية من هوية المستلم (AML / KYC)</span>
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-slate-400 mb-1">نوع الهوية المبرزة</label>
                      <select
                        value={recipientIdType}
                        onChange={(e) => setRecipientIdType(e.target.value as any)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none"
                      >
                        <option value="national_id">بطاقة شخصية ذكية</option>
                        <option value="passport">جواز سفر ساري المفعول</option>
                        <option value="family_card">بطاقة عائلية</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-400 mb-1">رقم الهوية</label>
                      <input
                        type="text"
                        placeholder="أدخل الرقم الوطني أو رقم الجواز..."
                        value={recipientIdNumber}
                        onChange={(e) => setRecipientIdNumber(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="verifyOriginal"
                      checked={hasVerifiedOriginalId}
                      onChange={(e) => setHasVerifiedOriginalId(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded bg-slate-900 border-slate-700 focus:ring-emerald-500"
                    />
                    <label htmlFor="verifyOriginal" className="text-xs text-slate-300 cursor-pointer">
                      أقر بمطابقة أصل وثيقة الهوية ومطابقة الصورة والاسم الرباعي للمستلم الحاضر شخصياً.
                    </label>
                  </div>

                  {/* Liquidity alert & instant funding options */}
                  {!hasLiquidity && (
                    <div className="p-3 bg-rose-950/60 border border-rose-800 text-rose-300 text-xs rounded-xl space-y-2">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
                        <span>
                          رصيد الصندوق الحالي: <strong>{formatMoney(cashierBalance, selectedRemittance.currency)}</strong> (المطلوب صرفه: {formatMoney(selectedRemittance.amount, selectedRemittance.currency)})
                        </span>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {onFundDrawer && (
                          <button
                            type="button"
                            onClick={() => onFundDrawer(selectedRemittance.currency, selectedRemittance.amount + 5000)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm transition-all cursor-pointer"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                            <span>تغذية الصندوق بعهدة فورية ({formatMoney(selectedRemittance.amount + 5000, selectedRemittance.currency)})</span>
                          </button>
                        )}

                        <label className="flex items-center gap-1.5 text-[11px] text-amber-300 bg-amber-950/60 px-2 py-1 rounded-lg border border-amber-800/50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isManagerOverride}
                            onChange={(e) => setIsManagerOverride(e.target.checked)}
                            className="w-3.5 h-3.5 text-amber-600 rounded bg-slate-900 border-slate-700"
                          />
                          <span>اعتماد الصرف بصلاحية مدير الفرع (تجاوز الرصيد)</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Confirm Payout Button with In-Flight Lock */}
                  <div className="pt-2">
                    <button
                      onClick={handleConfirmPayout}
                      disabled={!recipientIdNumber.trim() || !hasVerifiedOriginalId || !hasLiquidity || isSubmittingPayout}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition-all hover:scale-[1.01] cursor-pointer"
                    >
                      {isSubmittingPayout ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin text-white" />
                          <span>جارٍ المصادقة وتوثيق القيد بالسيرفر...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-5 h-5" />
                          <span>تأكيد صرف الحوالة وتسليم النقدية وإصدار السند فوراً</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-10 text-center text-slate-400 space-y-3">
              <ArrowDownLeft className="w-10 h-10 text-emerald-400/60 mx-auto" />
              <div>
                <h3 className="text-base font-bold text-slate-200">نافذة صرف الحوالات المصرفية</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 leading-relaxed">
                  يمكنك الاستعلام برقم الحوالة من صندوق البحث، أو النقر على الزر التجريبي لتحميل حوالة جاهزة للصرف فوراً:
                </p>
              </div>
              <button
                type="button"
                onClick={handleLoadSampleIncoming}
                className="px-5 py-2.5 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white rounded-xl text-xs font-bold inline-flex items-center gap-2 shadow-md transition-all cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>⚡ تجربة صرف حوالة فورية (5,000 ريال سعودي)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quick Incoming Transfer Registration Modal */}
      {isRegisterModalOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setIsRegisterModalOpen(false); }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto"
        >
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="p-4 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowDownLeft className="w-5 h-5 text-emerald-400 shrink-0" />
                <h3 className="text-sm font-bold text-white">تسجيل وصول حوالة واردة جديدة للصرف</h3>
              </div>
              <button
                onClick={() => setIsRegisterModalOpen(false)}
                aria-label="إغلاق"
                className="w-10 h-10 min-w-[40px] flex items-center justify-center text-slate-400 hover:text-white rounded-xl bg-slate-800/80 hover:bg-slate-750 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRegisterIncoming} className="p-4 sm:p-5 space-y-3.5 text-xs overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">شبكة التحويل</label>
                  <select
                    value={regNetwork}
                    onChange={(e) => setRegNetwork(e.target.value)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-white"
                  >
                    <option value="شبكة النجم">شبكة النجم</option>
                    <option value="الكريمي إكسبرس">الكريمي إكسبرس</option>
                    <option value="العمقي للتحويلات">العمقي للتحويلات</option>
                    <option value="شبكة الامتياز">شبكة الامتياز</option>
                    <option value="شبكة يمن إكسبرس">شبكة يمن إكسبرس</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">رقم الحوالة</label>
                  <input
                    type="text"
                    value={regTransferNum}
                    onChange={(e) => setRegTransferNum(e.target.value)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-white font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">اسم المرسل</label>
                  <input
                    type="text"
                    value={regSenderName}
                    onChange={(e) => setRegSenderName(e.target.value)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">هاتف المرسل</label>
                  <input
                    type="text"
                    value={regSenderPhone}
                    onChange={(e) => setRegSenderPhone(e.target.value)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-emerald-400 font-bold mb-1">اسم المستفيد الحاضر</label>
                  <input
                    type="text"
                    value={regRecipientName}
                    onChange={(e) => setRegRecipientName(e.target.value)}
                    className="w-full bg-slate-850 border border-emerald-600/50 rounded-xl px-3 py-2.5 min-h-[44px] text-white font-bold"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">هاتف المستفيد</label>
                  <input
                    type="text"
                    value={regRecipientPhone}
                    onChange={(e) => setRegRecipientPhone(e.target.value)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-white font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">المبلغ المطلوب صرفه</label>
                  <input
                    type="number"
                    min="1"
                    value={regAmount}
                    onChange={(e) => setRegAmount(Number(e.target.value))}
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-white font-mono text-sm font-bold"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">العملة</label>
                  <select
                    value={regCurrency}
                    onChange={(e) => setRegCurrency(e.target.value as any)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-white"
                  >
                    <option value="SAR">ريال سعودي (SAR)</option>
                    <option value="YER_OLD">ريال يمني قديم (YER)</option>
                    <option value="YER_NEW">ريال يمني جديد (YER)</option>
                    <option value="USD">دولار أمريكي (USD)</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsRegisterModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/30 cursor-pointer"
                >
                  قيد الحوالة وجلبها للصرف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
