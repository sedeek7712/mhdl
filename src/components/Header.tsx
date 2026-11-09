import React, { useState, useRef, useEffect } from 'react';
import { UserProfile } from '../types/exchange';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ChevronDown,
  FileSpreadsheet,
  HardDrive,
  Layers,
  LayoutDashboard,
  Menu,
  Printer,
  Receipt,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  Vault,
  Wifi,
  WifiOff,
  X,
  BookOpen,
  Briefcase,
  Sliders,
  DollarSign,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import { useToast } from './ui/Toast';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: UserProfile;
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
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const navDropdownRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const isPrivilegedUser = currentUser.role === 'owner' || currentUser.role === 'general_manager';

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (navDropdownRef.current && !navDropdownRef.current.contains(event.target as Node)) {
        setActiveDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const roleConfigMap: Record<UserRole, { label: string; badgeClass: string; icon: React.ReactNode }> = {
    owner: {
      label: 'المالك والمشرف العام',
      badgeClass: 'bg-amber-950/80 text-amber-300 border-amber-600/60 ring-1 ring-amber-500/30',
      icon: <Sparkles className="w-3.5 h-3.5 text-amber-400" />,
    },
    general_manager: {
      label: 'المدير العام',
      badgeClass: 'bg-purple-950/80 text-purple-300 border-purple-600/60 ring-1 ring-purple-500/30',
      icon: <ShieldAlert className="w-3.5 h-3.5 text-purple-400" />,
    },
    branch_manager: {
      label: 'مدير الفرع',
      badgeClass: 'bg-blue-950/80 text-blue-300 border-blue-600/60 ring-1 ring-blue-500/30',
      icon: <Shield className="w-3.5 h-3.5 text-blue-400" />,
    },
    teller: {
      label: 'كاشير / صراف معتمد',
      badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-600/60',
      icon: <UserCheck className="w-3.5 h-3.5 text-emerald-400" />,
    },
    auditor: {
      label: 'مراجع ومدقق مالي',
      badgeClass: 'bg-cyan-950/80 text-cyan-300 border-cyan-600/60',
      icon: <Shield className="w-3.5 h-3.5 text-cyan-400" />,
    },
  };

  const roleConfig = roleConfigMap[currentUser.role] || {
    label: currentUser.roleTitleAr || 'مستخدم',
    badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
    icon: <UserCheck className="w-3.5 h-3.5 text-slate-400" />,
  };

  const isFinancialActive = ['exchange', 'remittance', 'receive_transfer', 'customers'].includes(activeTab);
  const isAccountingActive = ['treasury', 'ledger'].includes(activeTab);
  const isSettingsActive = ['clean_architecture'].includes(activeTab);

  return (
    <>
      <header className="border-b border-slate-800 bg-slate-900/95 backdrop-blur sticky top-0 z-40 select-none">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3 sm:gap-6">
          
          {/* Brand Identity & Mobile Menu Toggle */}
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            {/* Mobile Hamburger Button on the Right */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              aria-label="فتح القائمة الرئيسية"
              title="القائمة الرئيسية"
            >
              <Menu className="w-5 h-5 text-emerald-400" />
            </button>

            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white overflow-hidden p-0.5 border border-slate-700/80 flex items-center justify-center shadow-md shadow-emerald-500/10 shrink-0">
              <img
                src="/alnamari_logo.jpg"
                alt="شعار مؤسسة عمرو النماري للصرافة"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-sm sm:text-base font-bold tracking-tight text-white whitespace-nowrap">
                مؤسسة عَمْرُو النَّمَارِي للصرافة
              </span>
              <span className="text-[10px] sm:text-[11px] text-amber-400 font-mono tracking-wider whitespace-nowrap hidden xs:inline">
                AMRO ALNAMARI FOR EXCHANGE
              </span>
            </div>
          </div>

          {/* Desktop Unified Navigation Bar (Sections 1, 2, 3, 4) */}
          <nav ref={navDropdownRef} className="hidden lg:flex items-center gap-1.5 text-sm font-medium text-slate-300">
            {/* 1. الرئيسية */}
            <button
              onClick={() => {
                setActiveTab('dashboard');
                setActiveDropdown(null);
              }}
              className={`px-3 py-2 rounded-xl whitespace-nowrap flex items-center gap-1.5 transition-colors ${
                activeTab === 'dashboard'
                  ? 'text-emerald-400 bg-emerald-950/60 font-bold border border-emerald-800/60 shadow-sm'
                  : 'hover:text-emerald-400 hover:bg-slate-800/70'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>لوحة التحكم</span>
            </button>

            {/* 2. العمليات المالية Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setActiveDropdown(activeDropdown === 'operations' ? null : 'operations')}
                className={`px-3 py-2 rounded-xl whitespace-nowrap flex items-center gap-1.5 transition-colors ${
                  isFinancialActive
                    ? 'text-emerald-400 bg-emerald-950/60 font-bold border border-emerald-800/60'
                    : 'hover:text-emerald-400 hover:bg-slate-800/70'
                }`}
              >
                <Briefcase className="w-4 h-4 text-emerald-400" />
                <span>العمليات المالية</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${activeDropdown === 'operations' ? 'rotate-180' : ''}`} />
              </button>

              {activeDropdown === 'operations' && (
                <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    عمليات الصرافة والتحويلات
                  </div>
                  <button
                    onClick={() => {
                      setActiveTab('exchange');
                      setActiveDropdown(null);
                    }}
                    className={`w-full px-3.5 py-2.5 text-right text-xs font-semibold flex items-center gap-2.5 transition-colors ${
                      activeTab === 'exchange' ? 'bg-emerald-950/70 text-emerald-300' : 'text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <ArrowLeftRight className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div>
                      <div className="font-bold text-white">صرافة العملات</div>
                      <div className="text-[10px] text-slate-400">بيع وشراء العملات بالهامش والربح</div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab('remittance');
                      setActiveDropdown(null);
                    }}
                    className={`w-full px-3.5 py-2.5 text-right text-xs font-semibold flex items-center gap-2.5 transition-colors ${
                      activeTab === 'remittance' ? 'bg-emerald-950/70 text-emerald-300' : 'text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <ArrowDownLeft className="w-4 h-4 text-teal-400 shrink-0" />
                    <div>
                      <div className="font-bold text-white">إدارة الحوالات</div>
                      <div className="text-[10px] text-slate-400">إرسال، صرف، وتدقيق الحوالات المالية</div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab('customers');
                      setActiveDropdown(null);
                    }}
                    className={`w-full px-3.5 py-2.5 text-right text-xs font-semibold flex items-center gap-2.5 transition-colors ${
                      activeTab === 'customers' ? 'bg-emerald-950/70 text-emerald-300' : 'text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <Users className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div>
                      <div className="font-bold text-white">دليل العملاء (KYC)</div>
                      <div className="text-[10px] text-slate-400">سجل الهويات، كشوف الحسابات والامتثال</div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* 3. المحاسبة والإدارة Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setActiveDropdown(activeDropdown === 'accounting' ? null : 'accounting')}
                className={`px-3 py-2 rounded-xl whitespace-nowrap flex items-center gap-1.5 transition-colors ${
                  isAccountingActive
                    ? 'text-emerald-400 bg-emerald-950/60 font-bold border border-emerald-800/60'
                    : 'hover:text-emerald-400 hover:bg-slate-800/70'
                }`}
              >
                <Vault className="w-4 h-4 text-amber-400" />
                <span>المحاسبة والإدارة</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${activeDropdown === 'accounting' ? 'rotate-180' : ''}`} />
              </button>

              {activeDropdown === 'accounting' && (
                <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    الدفاتر والرقابة النقدية
                  </div>
                  <button
                    onClick={() => {
                      setActiveTab('treasury');
                      setActiveDropdown(null);
                    }}
                    className={`w-full px-3.5 py-2.5 text-right text-xs font-semibold flex items-center gap-2.5 transition-colors ${
                      activeTab === 'treasury' ? 'bg-emerald-950/70 text-emerald-300' : 'text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <Vault className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-bold text-white">الصناديق والورديات</div>
                      <div className="text-[10px] text-slate-400">السيولة النقدية، المطابقة وإقفال الوردية</div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab('ledger');
                      setActiveDropdown(null);
                    }}
                    className={`w-full px-3.5 py-2.5 text-right text-xs font-semibold flex items-center gap-2.5 transition-colors ${
                      activeTab === 'ledger' ? 'bg-emerald-950/70 text-emerald-300' : 'text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <BookOpen className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div>
                      <div className="font-bold text-white">الحسابات والقيود</div>
                      <div className="text-[10px] text-slate-400">دفتر اليومية العامة ودليل الحسابات المزدوج</div>
                    </div>
                  </button>

                  {onOpenA4StatementModal && (
                    <button
                      onClick={() => {
                        setActiveDropdown(null);
                        onOpenA4StatementModal();
                      }}
                      className="w-full px-3.5 py-2.5 text-right text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors border-t border-slate-800/80"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-teal-400 shrink-0" />
                      <div>
                        <div className="font-bold text-white">التقارير المالية المعتمدة</div>
                        <div className="text-[10px] text-slate-400">كشف حساب A4، أرباح الصرافة وميزان المراجعة</div>
                      </div>
                    </button>
                  )}

                  {onOpenInternalTransferModal && (
                    <button
                      onClick={() => {
                        setActiveDropdown(null);
                        onOpenInternalTransferModal();
                      }}
                      className="w-full px-3.5 py-2.5 text-right text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                    >
                      <ArrowLeftRight className="w-4 h-4 text-blue-400 shrink-0" />
                      <div>
                        <div className="font-bold text-white">مناقلة وتغذية السيولة</div>
                        <div className="text-[10px] text-slate-400">تحويل مالي داخلي بين الخزينة والصناديق</div>
                      </div>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 4. إعدادات النظام Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setActiveDropdown(activeDropdown === 'settings' ? null : 'settings')}
                className={`px-3 py-2 rounded-xl whitespace-nowrap flex items-center gap-1.5 transition-colors ${
                  isSettingsActive
                    ? 'text-emerald-400 bg-emerald-950/60 font-bold border border-emerald-800/60'
                    : 'hover:text-emerald-400 hover:bg-slate-800/70'
                }`}
              >
                <Sliders className="w-4 h-4 text-slate-400" />
                <span>إعدادات النظام</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${activeDropdown === 'settings' ? 'rotate-180' : ''}`} />
              </button>

              {activeDropdown === 'settings' && (
                <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    إدارة النظام والسياسات
                  </div>

                  {onOpenSettings && (
                    <button
                      onClick={() => {
                        setActiveDropdown(null);
                        onOpenSettings();
                      }}
                      className="w-full px-3.5 py-2 text-right text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                    >
                      <Settings className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <div className="font-bold text-white">إعدادات ترقيم الحوالات</div>
                        <div className="text-[10px] text-slate-400">تلقائي / يدوي مع ضوابط التدقيق</div>
                      </div>
                    </button>
                  )}

                  {onOpenOfficialVoucher && (
                    <button
                      onClick={() => {
                        setActiveDropdown(null);
                        onOpenOfficialVoucher();
                      }}
                      className="w-full px-3.5 py-2 text-right text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                    >
                      <Receipt className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div>
                        <div className="font-bold text-white">السندات والطباعة الرسمية</div>
                        <div className="text-[10px] text-slate-400">إشعار حراري وA4/A5 متعدد المقاسات</div>
                      </div>
                    </button>
                  )}

                  {onOpenPrintAudit && (
                    <button
                      onClick={() => {
                        setActiveDropdown(null);
                        onOpenPrintAudit();
                      }}
                      className="w-full px-3.5 py-2 text-right text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                    >
                      <Printer className="w-4 h-4 text-purple-400 shrink-0" />
                      <div>
                        <div className="font-bold text-white">سجل تدقيق الطباعة</div>
                        <div className="text-[10px] text-slate-400">تتبع السندات المعاد طباعتها</div>
                      </div>
                    </button>
                  )}

                  {onOpenOfflineModal && (
                    <button
                      onClick={() => {
                        setActiveDropdown(null);
                        onOpenOfflineModal();
                      }}
                      className="w-full px-3.5 py-2 text-right text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                    >
                      <HardDrive className="w-4 h-4 text-cyan-400 shrink-0" />
                      <div>
                        <div className="font-bold text-white">النسخ الاحتياطي والأوفلاين</div>
                        <div className="text-[10px] text-slate-400">تصدير، استيراد وحفظ البيانات</div>
                      </div>
                    </button>
                  )}

                  {/* Clean Architecture Flutter/Dart - visible ONLY for Developer / Owner / General Manager */}
                  {isPrivilegedUser && (
                    <button
                      onClick={() => {
                        setActiveTab('clean_architecture');
                        setActiveDropdown(null);
                      }}
                      className={`w-full px-3.5 py-2 text-right text-xs font-semibold flex items-center gap-2.5 transition-colors border-t border-slate-800/80 ${
                        activeTab === 'clean_architecture' ? 'bg-cyan-950/70 text-cyan-300' : 'text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
                      <div>
                        <div className="font-bold text-cyan-300">أدوات الإدارة (Flutter / Dart)</div>
                        <div className="text-[10px] text-slate-400">معمارية النظام النظيفة للمطورين</div>
                      </div>
                    </button>
                  )}
                </div>
              )}
            </div>
          </nav>

          {/* Right Action Bar */}
          <div className="flex items-center gap-2 shrink-0">
            {/* PWA Install Button */}
            <PWAInstallButton />

            {/* Offline / Online toggle */}
            <button
              onClick={() => setIsOnline(!isOnline)}
              title={isOnline ? 'النظام متصل مركزي (انقر للمحاكاة بدون إنترنت)' : 'النظام في وضع العمل بدون إنترنت'}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all ${
                isOnline
                  ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-300 hover:bg-emerald-900/60'
                  : 'bg-amber-950/60 border-amber-700/50 text-amber-300 hover:bg-amber-900/60'
              }`}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-amber-400" />}
              <span className="hidden sm:inline">{isOnline ? 'متصل' : 'أوفلاين'}</span>
            </button>

            {/* Exchange Rates Primary Button */}
            <button
              onClick={onOpenRatesModal}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors"
              title="عرض وتعديل أسعار الصرف المعتمدة"
            >
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">الأسعار</span>
            </button>

            {/* Role Badge and Secure Switcher */}
            <div className="flex items-center gap-1.5">
              <div
                className={`hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold border ${roleConfig.badgeClass}`}
                title={`الصلاحية الحالية: ${currentUser.roleTitleAr}`}
              >
                {roleConfig.icon}
                <span>{roleConfig.label}</span>
              </div>

              <span
                className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-xl px-2.5 py-1.5 font-medium"
                title="إصدار محلي مخصص لحساب مالك واحد"
              >
                مستخدم واحد
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* SINGLE Unified Mobile Drawer on the RIGHT side (RTL) */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" dir="rtl">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-hidden="true"
          />
          {/* Drawer: Pinned strictly to the RIGHT edge */}
          <div className="fixed inset-y-0 right-0 w-80 max-w-[85vw] h-full bg-slate-900 border-l border-slate-800 p-5 flex flex-col justify-between overflow-y-auto shadow-2xl z-10 animate-in slide-in-from-right duration-200">
            <div className="space-y-5">
              {/* Drawer Header */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-white overflow-hidden p-0.5 border border-slate-700">
                    <img src="/alnamari_logo.jpg" alt="Logo" className="w-full h-full object-contain" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm">مؤسسة عَمْرُو النَّمَارِي</h3>
                    <p className="text-[10px] text-amber-400">AMRO ALNAMARI FOR EXCHANGE</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Current Role Banner */}
              <div className={`p-2.5 rounded-xl border flex items-center gap-2 ${roleConfig.badgeClass}`}>
                {roleConfig.icon}
                <div className="text-xs">
                  <div className="font-bold text-white">{currentUser.name}</div>
                  <div className="text-[10px] opacity-80">{roleConfig.label}</div>
                </div>
              </div>

              {/* Section 1: الرئيسية */}
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-400 px-2 uppercase tracking-wider">الرئيسية</p>
                <button
                  onClick={() => {
                    setActiveTab('dashboard');
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full text-right px-3 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2.5 transition-colors ${
                    activeTab === 'dashboard'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4 shrink-0" />
                  <span>لوحة التحكم</span>
                </button>
              </div>

              {/* Section 2: العمليات المالية */}
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-400 px-2 uppercase tracking-wider">العمليات المالية</p>
                <button
                  onClick={() => {
                    setActiveTab('exchange');
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full text-right px-3 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2.5 transition-colors ${
                    activeTab === 'exchange'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <ArrowLeftRight className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>صرافة العملات</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('remittance');
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full text-right px-3 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2.5 transition-colors ${
                    activeTab === 'remittance' || activeTab === 'receive_transfer'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <ArrowDownLeft className="w-4 h-4 shrink-0 text-teal-400" />
                  <span>إدارة الحوالات المالية</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('customers');
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full text-right px-3 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2.5 transition-colors ${
                    activeTab === 'customers'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Users className="w-4 h-4 shrink-0 text-cyan-400" />
                  <span>سجل العملاء (KYC)</span>
                </button>
              </div>

              {/* Section 3: المحاسبة والإدارة */}
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-400 px-2 uppercase tracking-wider">المحاسبة والإدارة</p>
                <button
                  onClick={() => {
                    setActiveTab('treasury');
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full text-right px-3 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2.5 transition-colors ${
                    activeTab === 'treasury'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Vault className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>الصناديق والورديات</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('ledger');
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full text-right px-3 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2.5 transition-colors ${
                    activeTab === 'ledger'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <BookOpen className="w-4 h-4 shrink-0 text-cyan-400" />
                  <span>الحسابات والقيود</span>
                </button>

                {onOpenA4StatementModal && (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenA4StatementModal();
                    }}
                    className="w-full text-right px-3 py-2.5 rounded-xl font-semibold text-xs text-slate-300 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                  >
                    <FileSpreadsheet className="w-4 h-4 shrink-0 text-teal-400" />
                    <span>التقارير المالية المعتمدة (A4)</span>
                  </button>
                )}

                {onOpenInternalTransferModal && (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenInternalTransferModal();
                    }}
                    className="w-full text-right px-3 py-2.5 rounded-xl font-semibold text-xs text-slate-300 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                  >
                    <ArrowLeftRight className="w-4 h-4 shrink-0 text-blue-400" />
                    <span>مناقلة وتغذية السيولة</span>
                  </button>
                )}
              </div>

              {/* Section 4: إعدادات النظام */}
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-400 px-2 uppercase tracking-wider">إعدادات النظام</p>
                {onOpenSettings && (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenSettings();
                    }}
                    className="w-full text-right px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl flex items-center gap-2.5"
                  >
                    <Settings className="w-4 h-4 text-amber-400" />
                    <span>إعدادات النظام والترقيم</span>
                  </button>
                )}

                {onOpenOfficialVoucher && (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenOfficialVoucher();
                    }}
                    className="w-full text-right px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl flex items-center gap-2.5"
                  >
                    <Receipt className="w-4 h-4 text-emerald-400" />
                    <span>السندات والطباعة</span>
                  </button>
                )}

                {onOpenPrintAudit && (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenPrintAudit();
                    }}
                    className="w-full text-right px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl flex items-center gap-2.5"
                  >
                    <Printer className="w-4 h-4 text-purple-400" />
                    <span>سجل تدقيق الطباعة</span>
                  </button>
                )}

                {onOpenOfflineModal && (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenOfflineModal();
                    }}
                    className="w-full text-right px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl flex items-center gap-2.5"
                  >
                    <HardDrive className="w-4 h-4 text-cyan-400" />
                    <span>النسخ الاحتياطي وإدارة البيانات</span>
                  </button>
                )}

                {isPrivilegedUser && (
                  <button
                    onClick={() => {
                      setActiveTab('clean_architecture');
                      setIsMobileMenuOpen(false);
                    }}
                    className={`w-full text-right px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors border-t border-slate-800/80 ${
                      activeTab === 'clean_architecture' ? 'bg-cyan-950/70 text-cyan-300' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Layers className="w-4 h-4 text-cyan-400" />
                    <span>أدوات الإدارة (Flutter / Dart)</span>
                  </button>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 text-center text-[11px] text-slate-500 font-mono">
              نظام عمرو النماري للصرافة والحسابات v2.0
            </div>
          </div>
        </div>
      )}
    </>
  );
};
