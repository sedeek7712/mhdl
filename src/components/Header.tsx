import React, { useState } from 'react';
import { UserProfile, UserRole } from '../types/exchange';
import { AVAILABLE_ROLES } from '../data/initialData';
import { ArrowDownLeft, ArrowLeftRight, BookOpen, FileSpreadsheet, HardDrive, Home, Layers, Menu, Printer, Receipt, Send, Settings, TrendingUp, Users, Vault, Wifi, WifiOff, X } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: UserProfile;
  setCurrentUser: (user: UserProfile) => void;
  isOnline: boolean;
  setIsOnline: (online: boolean) => void;
  onOpenRatesModal: () => void;
  onOpenInternalTransferModal?: () => void;
  onOpenA4StatementModal?: () => void;
  onOpenOfflineModal?: () => void;
  onOpenOfficialVoucher?: () => void;
  onOpenPrintAudit?: () => void;
  onOpenSettings?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  setCurrentUser,
  isOnline,
  setIsOnline,
  onOpenRatesModal,
  onOpenInternalTransferModal,
  onOpenA4StatementModal,
  onOpenOfflineModal,
  onOpenOfficialVoucher,
  onOpenPrintAudit,
  onOpenSettings,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleRoleChange = (role: UserRole) => {
    const roleMeta = AVAILABLE_ROLES.find((r) => r.role === role);
    if (!roleMeta) return;
    setCurrentUser({
      ...currentUser,
      role,
      roleTitleAr: roleMeta.titleAr,
    });
  };

  return (
    <>
      <header className="border-b border-slate-800 bg-slate-900/95 backdrop-blur sticky top-0 z-40">
        {/* Top Bar Contract: 3 zones separated by gap-8 (Brand Wordmark — Nav Links — Primary Action) */}
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-6">
          
          {/* Zone 1: Brand Wordmark with Official Logo */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-white overflow-hidden p-0.5 border border-slate-700/60 flex items-center justify-center shadow-md shadow-emerald-500/10 shrink-0">
              <img
                src="/alnamari_logo.jpg"
                alt="شعار مؤسسة عمرو النماري للصرافة"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-xs sm:text-base font-bold tracking-tight text-white whitespace-nowrap">
                مؤسسة عَمْرُو النَّمَارِي للصرافة
              </span>
              <span className="text-[9px] sm:text-[11px] text-amber-400 font-mono tracking-wider whitespace-nowrap hidden xs:inline">
                AMRO ALNAMARI FOR EXCHANGE
              </span>
            </div>
          </div>

          {/* Zone 2: Desktop clean single-line navigation links */}
          <nav className="hidden xl:flex items-center gap-4 text-sm font-medium text-slate-300">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`whitespace-nowrap transition-colors hover:text-emerald-400 ${
                activeTab === 'dashboard' ? 'text-emerald-400 border-b-2 border-emerald-500 py-4 font-semibold' : ''
              }`}
            >
              الرئيسية
            </button>
            <button
              onClick={() => setActiveTab('exchange')}
              className={`whitespace-nowrap transition-colors hover:text-emerald-400 ${
                activeTab === 'exchange' ? 'text-emerald-400 border-b-2 border-emerald-500 py-4 font-semibold' : ''
              }`}
            >
              صرافة العملات
            </button>
            <button
              onClick={() => setActiveTab('remittance')}
              className={`whitespace-nowrap transition-colors hover:text-emerald-400 ${
                activeTab === 'remittance' ? 'text-emerald-400 border-b-2 border-emerald-500 py-4 font-semibold' : ''
              }`}
            >
              إرسال حوالة
            </button>
            <button
              onClick={() => setActiveTab('receive_transfer')}
              className={`whitespace-nowrap flex items-center gap-1 transition-colors hover:text-emerald-400 ${
                activeTab === 'receive_transfer' ? 'text-emerald-400 border-b-2 border-emerald-500 py-4 font-semibold' : 'text-slate-300'
              }`}
            >
              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" />
              <span>صرف واستلام حوالة</span>
            </button>
            <button
              onClick={() => setActiveTab('customers')}
              className={`whitespace-nowrap transition-colors hover:text-emerald-400 ${
                activeTab === 'customers' ? 'text-emerald-400 border-b-2 border-emerald-500 py-4 font-semibold' : ''
              }`}
            >
              العملاء (KYC)
            </button>
            <button
              onClick={() => setActiveTab('ledger')}
              className={`whitespace-nowrap transition-colors hover:text-emerald-400 ${
                activeTab === 'ledger' ? 'text-emerald-400 border-b-2 border-emerald-500 py-4 font-semibold' : ''
              }`}
            >
              القيود والتقارير
            </button>
            <button
              onClick={() => setActiveTab('treasury')}
              className={`whitespace-nowrap transition-colors hover:text-emerald-400 ${
                activeTab === 'treasury' ? 'text-emerald-400 border-b-2 border-emerald-500 py-4 font-semibold' : ''
              }`}
            >
              الصناديق
            </button>
            <button
              onClick={() => setActiveTab('clean_architecture')}
              className={`whitespace-nowrap flex items-center gap-1 transition-colors hover:text-cyan-400 ${
                activeTab === 'clean_architecture' ? 'text-cyan-400 border-b-2 border-cyan-500 py-4 font-semibold' : 'text-slate-400'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Dart</span>
            </button>
          </nav>

          {/* Zone 3: Primary Action & Status / Role Controls */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* PWA Install Button */}
            <PWAInstallButton />

            {/* Offline Backup & Data Manager Trigger */}
            {onOpenOfflineModal ? (
              <button
                onClick={onOpenOfflineModal}
                className={`hidden md:flex px-2 py-1.5 rounded-xl text-xs font-semibold items-center gap-1 border transition-all ${
                  !isOnline
                    ? 'bg-amber-950/70 border-amber-600/60 text-amber-300'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                }`}
                title="إدارة البيانات والنسخ الاحتياطي بدون إنترنت"
              >
                <HardDrive className={`w-3.5 h-3.5 ${!isOnline ? 'text-amber-400' : 'text-slate-300'}`} />
                <span className="hidden xl:inline">أوفلاين</span>
              </button>
            ) : null}

            {/* Quick Official Voucher Trigger (نظام السندات والطباعة) */}
            {onOpenOfficialVoucher ? (
              <button
                onClick={onOpenOfficialVoucher}
                className="px-2.5 py-1.5 bg-[#800000] hover:bg-[#660000] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm border border-amber-500/40 transition-all cursor-pointer"
                title="عرض نظام السندات والطباعة الرسمي متعدد المقاسات"
              >
                <Receipt className="w-3.5 h-3.5 text-amber-300" />
                <span className="hidden sm:inline">طباعة السندات</span>
              </button>
            ) : null}

            {/* Quick Print Audit Log Trigger */}
            {onOpenPrintAudit ? (
              <button
                onClick={onOpenPrintAudit}
                className="hidden lg:flex px-2 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold items-center gap-1 transition-colors"
                title="سجل تدقيق عمليات الطباعة والتوقيع اليدوي"
              >
                <Printer className="w-3.5 h-3.5 text-cyan-400" />
                <span>سجل الطباعة</span>
              </button>
            ) : null}

            {/* Quick A4 Statement Modal Trigger */}
            {onOpenA4StatementModal ? (
              <button
                onClick={onOpenA4StatementModal}
                className="hidden sm:flex px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold items-center gap-1 shadow-sm transition-all"
                title="كشف حساب الأرباح والحركات ورقة A4"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>كشف A4</span>
              </button>
            ) : null}

            {/* Quick Internal Transfer Button */}
            {onOpenInternalTransferModal ? (
              <button
                onClick={onOpenInternalTransferModal}
                className="hidden md:flex px-2.5 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold items-center gap-1 transition-colors"
                title="تحويل مالي داخلي بين الصناديق والبنوك (البند 3.3)"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-400" />
                <span>تحويل داخلي</span>
              </button>
            ) : null}

            {/* Offline / Online toggle */}
            <button
              onClick={() => setIsOnline(!isOnline)}
              title={isOnline ? 'النظام متصل مركزي (انقر للتحويل إلى وضع أوفلاين)' : 'النظام في وضع العمل بدون إنترنت'}
              className={`hidden sm:flex p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-medium items-center gap-1 border transition-all ${
                isOnline
                  ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-300'
                  : 'bg-amber-950/60 border-amber-700/50 text-amber-300'
              }`}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-amber-400" />}
              <span className="hidden lg:inline">{isOnline ? 'متصل' : 'بدون نت'}</span>
            </button>

            {/* Settings Button */}
            {onOpenSettings ? (
              <button
                onClick={onOpenSettings}
                className="hidden md:flex px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 items-center gap-1 transition-colors"
                title="الإعدادات ← إعدادات الحوالات وطريقة الترقيم"
              >
                <Settings className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden lg:inline">الإعدادات</span>
              </button>
            ) : null}

            {/* Rates Button */}
            <button
              onClick={onOpenRatesModal}
              className="px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center gap-1 transition-colors min-h-[36px]"
              title="عرض وتعديل أسعار الصرف"
            >
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden xs:inline">الأسعار</span>
            </button>

            {/* User Role Switcher */}
            <div className="relative flex items-center">
              <select
                value={currentUser.role}
                onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-[11px] sm:text-xs rounded-lg px-1.5 sm:px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer max-w-[85px] sm:max-w-none"
              >
                {AVAILABLE_ROLES.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.titleAr.split('(')[0]}
                  </option>
                ))}
              </select>
            </div>

            {/* Mobile Hamburger Menu Button (44x44px Touch Target) */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="xl:hidden min-w-[40px] min-h-[40px] sm:min-w-[44px] sm:min-h-[44px] flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-750 active:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 cursor-pointer transition-colors shadow-sm"
              title="القائمة الكاملة والأدوات"
              aria-label="فتح القائمة الرئيسية"
            >
              <Menu className="w-5 h-5 text-emerald-400" />
            </button>
          </div>
        </div>

        {/* Mobile horizontal scrollable tab strip */}
        <div className="xl:hidden flex items-center overflow-x-auto px-2.5 py-1.5 gap-1.5 border-t border-slate-800 bg-slate-900/90 text-xs no-scrollbar">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-semibold shrink-0 transition-colors ${
              activeTab === 'dashboard' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800/60'
            }`}
          >
            الرئيسية
          </button>
          <button
            onClick={() => setActiveTab('exchange')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-semibold shrink-0 transition-colors ${
              activeTab === 'exchange' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800/60'
            }`}
          >
            صرافة العملات
          </button>
          <button
            onClick={() => setActiveTab('receive_transfer')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-semibold shrink-0 transition-colors ${
              activeTab === 'receive_transfer' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800/60'
            }`}
          >
            صرف حوالة 📥
          </button>
          <button
            onClick={() => setActiveTab('remittance')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-semibold shrink-0 transition-colors ${
              activeTab === 'remittance' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800/60'
            }`}
          >
            إرسال حوالة 📤
          </button>
          <button
            onClick={() => setActiveTab('customers')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-semibold shrink-0 transition-colors ${
              activeTab === 'customers' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800/60'
            }`}
          >
            العملاء (KYC)
          </button>
          <button
            onClick={() => setActiveTab('ledger')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-semibold shrink-0 transition-colors ${
              activeTab === 'ledger' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800/60'
            }`}
          >
            القيود والتقارير
          </button>
          <button
            onClick={() => setActiveTab('treasury')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-semibold shrink-0 transition-colors ${
              activeTab === 'treasury' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800/60'
            }`}
          >
            الصناديق والإقفال
          </button>
          <button
            onClick={() => setActiveTab('clean_architecture')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-semibold shrink-0 transition-colors ${
              activeTab === 'clean_architecture' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800/60'
            }`}
          >
            معمارية Dart
          </button>
        </div>
      </header>

      {/* Mobile Drawer (قائمة الهاتف الاحترافية المتكاملة) */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm xl:hidden flex justify-end no-print"
          dir="rtl"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMobileMenuOpen(false);
          }}
        >
          <div className="w-[88%] max-w-sm h-full bg-slate-900 border-l border-slate-800 p-4 flex flex-col justify-between shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-200">
            <div className="space-y-4">
              {/* Drawer Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-white p-0.5 border border-slate-700 flex items-center justify-center shrink-0">
                    <img src="/alnamari_logo.jpg" alt="شعار النماري" className="w-full h-full object-contain" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">عمرو النماري للصرافة</h3>
                    <p className="text-[10px] text-amber-400 font-mono">AMRO ALNAMARI ERP</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="min-w-[42px] min-h-[42px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer border border-slate-700/60"
                  aria-label="إغلاق القائمة"
                >
                  <X className="w-5 h-5 text-rose-400" />
                </button>
              </div>

              {/* User Profile & Role Info */}
              <div className="bg-slate-850 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">المستخدم النشط:</span>
                  <span className="font-bold text-white">{currentUser.name}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">الفرع:</span>
                  <span className="text-slate-300">{currentUser.branchName}</span>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">تغيير الصلاحية / الوردية:</label>
                  <select
                    value={currentUser.role}
                    onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                    className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-2 focus:outline-none"
                  >
                    {AVAILABLE_ROLES.map((r) => (
                      <option key={r.role} value={r.role}>
                        {r.titleAr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Navigation Links */}
              <div className="space-y-1">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-2 py-0.5">
                  صفحات وأقسام النظام
                </div>
                {[
                  { id: 'dashboard', label: 'لوحة التحكم الرئيسية', icon: Home },
                  { id: 'exchange', label: 'صرافة العملات والتبديل', icon: ArrowLeftRight },
                  { id: 'receive_transfer', label: 'استلام وصرف الحوالات', icon: ArrowDownLeft },
                  { id: 'remittance', label: 'إرسال الحوالات والشبكات', icon: Send },
                  { id: 'customers', label: 'دليل العملاء (KYC)', icon: Users },
                  { id: 'ledger', label: 'الدفتر والقيود المحاسبية', icon: BookOpen },
                  { id: 'treasury', label: 'الصناديق وإقفال الوردية', icon: Vault },
                  { id: 'clean_architecture', label: 'معمارية Flutter / Dart', icon: Layers },
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        setIsMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-right min-h-[44px] cursor-pointer ${
                        isActive
                          ? 'bg-emerald-600 text-white shadow-md'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Quick Tools & Modals */}
              <div className="space-y-1.5 pt-2 border-t border-slate-800">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-2 py-0.5">
                  أدوات وإجراءات سريعة
                </div>
                {onOpenOfficialVoucher && (
                  <button
                    onClick={() => {
                      onOpenOfficialVoucher();
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#800000]/60 hover:bg-[#800000] border border-amber-600/40 text-white text-xs font-bold transition-all text-right min-h-[44px] cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-amber-300" />
                      <span>نظام السندات والطباعة</span>
                    </span>
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-mono">معتمد</span>
                  </button>
                )}

                {onOpenA4StatementModal && (
                  <button
                    onClick={() => {
                      onOpenA4StatementModal();
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 p-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-semibold text-right min-h-[44px] cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-teal-400" />
                    <span>كشف حساب الأرباح والحركات A4</span>
                  </button>
                )}

                {onOpenInternalTransferModal && (
                  <button
                    onClick={() => {
                      onOpenInternalTransferModal();
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 p-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-semibold text-right min-h-[44px] cursor-pointer"
                  >
                    <ArrowLeftRight className="w-4 h-4 text-emerald-400" />
                    <span>تحويل داخلي وتغذية الصناديق</span>
                  </button>
                )}

                {onOpenPrintAudit && (
                  <button
                    onClick={() => {
                      onOpenPrintAudit();
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 p-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-semibold text-right min-h-[44px] cursor-pointer"
                  >
                    <Printer className="w-4 h-4 text-cyan-400" />
                    <span>سجل تدقيق الطباعة والتوقيع</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    onOpenRatesModal();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 p-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-semibold text-right min-h-[44px] cursor-pointer"
                >
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span>نشرة أسعار الصرف الرسمية</span>
                </button>

                {onOpenSettings && (
                  <button
                    onClick={() => {
                      onOpenSettings();
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 p-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-semibold text-right min-h-[44px] cursor-pointer"
                  >
                    <Settings className="w-4 h-4 text-amber-400" />
                    <span>إعدادات الحوالات وطريقة الترقيم</span>
                  </button>
                )}

                {onOpenOfflineModal && (
                  <button
                    onClick={() => {
                      onOpenOfflineModal();
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 p-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-semibold text-right min-h-[44px] cursor-pointer"
                  >
                    <HardDrive className="w-4 h-4 text-amber-400" />
                    <span>النسخ الاحتياطي وإدارة أوفلاين</span>
                  </button>
                )}
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="pt-3 border-t border-slate-800 text-center text-[10px] text-slate-500">
              مؤسسة عمرو النماري للصرافة · الإصدار المعتمد 2026
            </div>
          </div>
        </div>
      )}

      {/* Mobile Floating Bottom Bar for quick one-thumb switching */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-slate-900/95 backdrop-blur border-t border-slate-800 px-2 py-1 flex items-center justify-around text-[10px] text-slate-400 no-print min-h-[56px]">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1 px-1 rounded-xl transition-colors min-h-[48px] cursor-pointer ${
            activeTab === 'dashboard' ? 'text-emerald-400 font-bold bg-slate-850/80' : 'hover:text-slate-200'
          }`}
        >
          <Home className="w-4 h-4" />
          <span className="truncate">الرئيسية</span>
        </button>

        <button
          onClick={() => setActiveTab('exchange')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1 px-1 rounded-xl transition-colors min-h-[48px] cursor-pointer ${
            activeTab === 'exchange' ? 'text-emerald-400 font-bold bg-slate-850/80' : 'hover:text-slate-200'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span className="truncate">صرافة</span>
        </button>

        <button
          onClick={() => setActiveTab('receive_transfer')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1 px-1 rounded-xl transition-colors min-h-[48px] cursor-pointer ${
            activeTab === 'receive_transfer' ? 'text-emerald-400 font-bold bg-slate-850/80' : 'hover:text-slate-200'
          }`}
        >
          <ArrowDownLeft className="w-4 h-4" />
          <span className="truncate">صرف</span>
        </button>

        <button
          onClick={() => setActiveTab('remittance')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1 px-1 rounded-xl transition-colors min-h-[48px] cursor-pointer ${
            activeTab === 'remittance' ? 'text-emerald-400 font-bold bg-slate-850/80' : 'hover:text-slate-200'
          }`}
        >
          <Send className="w-4 h-4" />
          <span className="truncate">إرسال</span>
        </button>

        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1 px-1 rounded-xl transition-colors min-h-[48px] text-amber-400 hover:text-amber-300 cursor-pointer"
        >
          <Menu className="w-4 h-4" />
          <span className="truncate font-bold">المزيد</span>
        </button>
      </div>
    </>
  );
};
