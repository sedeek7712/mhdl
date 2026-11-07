import React, { useState } from 'react';
import { CustomerKYC } from '../types/customer';
import { CurrencyCode, Remittance, SUPPORTED_CURRENCIES, UserProfile } from '../types/exchange';
import { formatMoney } from '../services/accountingEngine';
import { FileText, Filter, IdCard, MessageCircle, Phone, Plus, Printer, Search, ShieldCheck, UserCheck, Users, X } from 'lucide-react';

interface CustomersViewProps {
  customers: CustomerKYC[];
  remittances: Remittance[];
  currentUser: UserProfile;
  onAddCustomer: (customer: CustomerKYC) => void;
  onOpenA4Statement?: () => void;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  customers,
  remittances,
  currentUser,
  onAddCustomer,
  onOpenA4Statement,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerKYC | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New Customer Form State
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [idType, setIdType] = useState<CustomerKYC['idType']>('national_id');
  const [idNumber, setIdNumber] = useState('');
  const [idIssueDate, setIdIssueDate] = useState('2024-01-01');
  const [idExpiryDate, setIdExpiryDate] = useState('2034-01-01');
  const [notes, setNotes] = useState('');

  const filteredCustomers = customers.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.fullName.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.idNumber.includes(q) ||
      c.code.toLowerCase().includes(q)
    );
  });

  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !idNumber.trim()) return;

    const newCust: CustomerKYC = {
      id: `cust-${Date.now()}`,
      code: `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
      fullName: fullName.trim(),
      phone: phone.trim(),
      address: address.trim(),
      idType,
      idTypeNameAr: idType === 'national_id' ? 'بطاقة شخصية ذكية' : idType === 'passport' ? 'جواز سفر' : 'بطاقة عائلية',
      idNumber: idNumber.trim(),
      idIssueDate,
      idExpiryDate,
      balances: { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 },
      totalTransfersCount: 0,
      totalTransfersVolume: { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 },
      createdAt: new Date().toISOString().split('T')[0],
      status: 'active',
      notes,
    };

    onAddCustomer(newCust);
    setIsAddModalOpen(false);
    // Reset
    setFullName('');
    setPhone('');
    setAddress('');
    setIdNumber('');
    setNotes('');
  };

  // Get remittance history for selected customer
  const customerRemittances = selectedCustomer
    ? remittances.filter(
        (r) =>
          r.senderPhone === selectedCustomer.phone ||
          r.recipientPhone === selectedCustomer.phone ||
          r.senderName.includes(selectedCustomer.fullName) ||
          r.recipientName.includes(selectedCustomer.fullName)
      )
    : [];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-mono text-emerald-400 font-bold px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/40">
              البند 6: إدارة العملاء والتحقق من الهوية (KYC)
            </span>
          </div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" />
            <span>سجل العملاء، التحقق من الهوية، وكشوفات الحساب</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            تسجيل بيانات الهوية المعتمدة، استخراج كشف حساب تفصيلي لكل عميل، ومراقبة أرصدة العملات وحماية البيانات.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="min-h-[44px] px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة عميل جديد (KYC)</span>
        </button>
      </div>

      {/* Main Grid: Customer List & Customer Detailed Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Customer Directory (5 cols) */}
        <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              <span>دليل العملاء ({filteredCustomers.length})</span>
            </h2>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              placeholder="بحث بالاسم، رقم الهاتف، أو رقم الهوية..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl pr-9 pl-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-500"
            />
          </div>

          {/* Customer Cards List */}
          <div className="space-y-2.5 max-h-[560px] overflow-y-auto pr-1">
            {filteredCustomers.length === 0 ? (
              <div className="p-8 text-center bg-slate-850/50 rounded-xl border border-slate-800 text-slate-500 space-y-2">
                <Users className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs font-semibold text-slate-400">لا يوجد عملاء مسجلون حتى الآن</p>
                <p className="text-[11px] text-slate-500">اضغط على زر "إضافة عميل جديد" لبدء فتح الحسابات وتوثيق الهويات.</p>
              </div>
            ) : (
              filteredCustomers.map((cust) => {
                const isSelected = selectedCustomer?.id === cust.id;
                return (
                  <div
                    key={cust.id}
                    onClick={() => setSelectedCustomer(cust)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all space-y-2 ${
                      isSelected
                        ? 'bg-emerald-950/40 border-emerald-500/50 shadow-md'
                        : 'bg-slate-850/70 border-slate-800 hover:bg-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-bold text-white text-xs sm:text-sm">{cust.fullName}</h3>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-0.5">
                          <Phone className="w-3 h-3 text-emerald-400" />
                          <span>{cust.phone}</span>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        {cust.code}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
                      <span className="flex items-center gap-1">
                        <IdCard className="w-3 h-3 text-slate-500" />
                        <span>{cust.idTypeNameAr}: {cust.idNumber}</span>
                      </span>
                      <span className="text-emerald-400 font-semibold">{cust.totalTransfersCount} حوالة</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Detailed Customer Statement & KYC Profile (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {selectedCustomer ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5">
              {/* Profile Top Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-white">{selectedCustomer.fullName}</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      حساب نشط وموثق
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    كود: <span className="font-mono text-slate-300">{selectedCustomer.code}</span> · العنوان: {selectedCustomer.address}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {onOpenA4Statement && (
                    <button
                      onClick={onOpenA4Statement}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>كشف حساب A4 رسمي</span>
                    </button>
                  )}
                  <button
                    onClick={() => window.print()}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Printer className="w-3.5 h-3.5 text-emerald-400" />
                    <span>طباعة سريعة</span>
                  </button>
                </div>
              </div>

              {/* KYC Information Box */}
              <div className="bg-slate-850 rounded-xl p-4 border border-slate-800 space-y-3">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>بيانات إثبات الهوية والتحقق القانوني (AML/KYC):</span>
                </span>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px]">نوع الهوية:</span>
                    <span className="font-bold text-white">{selectedCustomer.idTypeNameAr}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">رقم الهوية:</span>
                    <span className="font-mono font-bold text-emerald-400">{selectedCustomer.idNumber}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">تاريخ الإصدار:</span>
                    <span className="font-mono text-slate-300">{selectedCustomer.idIssueDate}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">تاريخ الانتهاء:</span>
                    <span className="font-mono text-slate-300">{selectedCustomer.idExpiryDate}</span>
                  </div>
                </div>
              </div>

              {/* Balances by Independent Currencies */}
              <div>
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  أرصدة حساب العميل الحالية بالعملات الأربع (مستقلة):
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[]).map((cur) => (
                    <div key={cur} className="bg-slate-850 p-3 rounded-xl border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-400 block mb-1">
                        {SUPPORTED_CURRENCIES[cur].symbol}
                      </span>
                      <span className="text-sm font-bold font-mono text-white tabular-nums">
                        {formatMoney(selectedCustomer.balances[cur] || 0, cur)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Remittance & Operations History for this customer */}
              <div className="space-y-3 pt-2">
                <h3 className="text-xs font-bold text-slate-300 flex items-center justify-between">
                  <span>سجل الحوالات والعمليات المنفذة للعميل:</span>
                  <span className="text-[11px] font-normal text-slate-400">
                    {customerRemittances.length} عمليات مسجلة
                  </span>
                </h3>

                {customerRemittances.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 bg-slate-850/50 rounded-xl border border-dashed border-slate-800">
                    لا توجد حوالات سابقة مسجلة لهذا العميل حتى الآن.
                  </div>
                ) : (
                  <div className="overflow-x-auto -mx-2 px-2 sm:mx-0 sm:px-0">
                    <table className="w-full text-right text-xs min-w-[560px]">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-2 px-2.5">رقم الحوالة</th>
                          <th className="py-2 px-2.5">النوع</th>
                          <th className="py-2 px-2.5">المبلغ</th>
                          <th className="py-2 px-2.5">الشبكة</th>
                          <th className="py-2 px-2.5">التاريخ</th>
                          <th className="py-2 px-2.5">الحالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {customerRemittances.map((rem) => (
                          <tr key={rem.id} className="hover:bg-slate-800/40">
                            <td className="py-2.5 px-2.5 font-bold text-emerald-400">{rem.transferNumber}</td>
                            <td className="py-2.5 px-2.5 font-sans">
                              {rem.direction === 'outgoing' ? 'صادرة 📤' : 'واردة 📥'}
                            </td>
                            <td className="py-2.5 px-2.5 font-bold text-white">
                              {formatMoney(rem.amount, rem.currency)}
                            </td>
                            <td className="py-2.5 px-2.5 font-sans text-slate-300">{rem.networkName}</td>
                            <td className="py-2.5 px-2.5 text-slate-400 text-[10px]">{rem.createdAt}</td>
                            <td className="py-2.5 px-2.5 font-sans text-[11px] text-teal-400">{rem.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-2">
              <Users className="w-10 h-10 text-slate-600 mx-auto mb-2" />
              <h3 className="text-base font-bold text-slate-300">
                {customers.length === 0 ? 'لا توجد بيانات عملاء مسجلة' : 'اختر عميلاً من القائمة'}
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {customers.length === 0
                  ? 'قاعدة بيانات العملاء خالية وجاهزة لاستقبال العملاء الحقيقيين للمؤسسة وتوثيق هوياتهم.'
                  : 'انقر على أي عميل في القائمة المقابلة لعرض كشف حسابه التفصيلي، بيانات الهوية KYC، وأرصدة العملات.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Add New Customer KYC */}
      {isAddModalOpen ? (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setIsAddModalOpen(false); }}
          className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <IdCard className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>إضافة عميل جديد وتوثيق الهوية (KYC)</span>
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                aria-label="إغلاق"
                className="w-10 h-10 min-w-[40px] flex items-center justify-center rounded-xl bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-750 cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1 font-medium">اسم العميل الكامل</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="الاسم الرباعي واللقب..."
                  className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1 font-medium">رقم الهاتف</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="77XXXXXXX"
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1 font-medium">العنوان / المدينة</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="صنعاء / تعز / عدن..."
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1 font-medium">نوع إثبات الهوية</label>
                  <select
                    value={idType}
                    onChange={(e) => setIdType(e.target.value as any)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white focus:outline-none"
                  >
                    <option value="national_id">بطاقة شخصية ذكية</option>
                    <option value="passport">جواز سفر</option>
                    <option value="family_card">بطاقة عائلية</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1 font-medium">رقم الهوية</label>
                  <input
                    type="text"
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    placeholder="الرقم الوطني أو رقم الجواز..."
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1 font-medium">تاريخ الإصدار</label>
                  <input
                    type="date"
                    value={idIssueDate}
                    onChange={(e) => setIdIssueDate(e.target.value)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1 font-medium">تاريخ الانتهاء</label>
                  <input
                    type="date"
                    value={idExpiryDate}
                    onChange={(e) => setIdExpiryDate(e.target.value)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white font-mono focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1 font-medium">ملاحظات إضافية</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="نشاط العميل، صفته، إلخ..."
                  className="w-full bg-slate-850 border border-slate-700 rounded-xl px-3 py-2.5 min-h-[44px] text-xs text-white focus:outline-none"
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-400 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/40 cursor-pointer"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>حفظ وتوثيق العميل</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};
