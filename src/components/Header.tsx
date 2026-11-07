import React, { useState, useRef, useEffect } from 'react';
import { UserProfile, UserRole } from '../types/exchange';
import { AVAILABLE_ROLES } from '../data/initialData';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ChevronDown,
  FileSpreadsheet,
  HardDrive,
  Layers,
  Menu,
  Printer,
  Receipt,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserCheck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import { useToast } from './ui/Toast';

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
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // Close tools dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(event.target as Node)) {
        setIsToolsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleRoleChange = (role: UserRole) => {
    const roleMeta = AVAILABLE_ROLES.find((r) => r.role === role);
    if (!roleMeta) return;

    setCurrentUser({
      ...currentUser,
      role,
      roleTitleAr: roleMeta.titleAr,
    });

    const isPrivileged = role === 'owner' || role === 'general_manager';
    toast.info(
      `تم تغيير صلاحيات الجلسة إلى [${roleMeta.titleAr.split('(')[0].trim()}]`,
      isPrivileged ? 'تم تفعيل الصلاحيات الإدارية الكاملة للمصادقة وتعديل السياسات' : 'وضع الصرافة والعمليات التشغيلية اليومية'
    );
  };

  // Role visual configuration for UI-06
  const roleConfigMap: Record<UserRole, { label: string; badgeClass: string; icon: React.ReactNode }> = {
    owner: {
      label: 'المالك',
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
      label: 'كاشير / صراف',
      badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-600/60',
      icon: <UserCheck className="w-3.5 h-3.5 text-emerald-400" />,
    },
    auditor: {
      label: 'مدقق ومراجع',
      badgeClass: 'bg-cyan-950/80 text-cyan-300 border-cyan-600/60',
      icon: <Shield className="w-3.5 h-3.5 text-cyan-400" />,
    },
  };

  const roleConfig = roleConfigMap[currentUser.role] || {
    label: currentUser.roleTitleAr || 'مستخدم',
    badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
    icon: <UserCheck className="w-3.5 h-3.5 text-slate-400" />,
  };

  return (
    <>
      <header className="border-b border-slate-800 bg-slate-900/95 backdrop-blur sticky top-0 z-40">
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
          <nav className="hidden xl:flex items-center gap-2 text-sm font-medium text-slate-300">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors hover:text-emerald-400 ${
                activeTab === 'dashboard' ? 'text-emerald-400 bg-emerald-950/40 font-semibold' : ''
              }`}
            >
              الرئيسية
            </button>
            <button
              onClick={() => setActiveTab('exchange')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors hover:text-emerald-400 ${
                activeTab === 'exchange' ? 'text-emerald-400 bg-emerald-950/40 font-semibold' : ''
              }`}
            >
              صرافة العملات
            </button>
            <button
              onClick={() => setActiveTab('remittance')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors hover:text-emerald-400 ${
                activeTab === 'remittance' ? 'text-emerald-400 bg-emerald-950/40 font-semibold' : ''
              }`}
            >
              إرسال حوالة
            </button>
            <button
              onClick={() => setActiveTab('receive_transfer')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap flex items-center gap-1 transition-colors hover:text-emerald-400 ${
                activeTab === 'receive_transfer' ? 'text-emerald-400 bg-emerald-950/40 font-semibold' : 'text-slate-300'
              }`}
            >
              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" />
              <span>صرف حوالة</span>
            </button>
            <button
              onClick={() => setActiveTab('customers')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors hover:text-emerald-400 ${
                activeTab === 'customers' ? 'text-emerald-400 bg-emerald-950/40 font-semibold' : ''
              }`}
            >
              العملاء (KYC)
            </button>
            <button
              onClick={() => setActiveTab('ledger')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors hover:text-emerald-400 ${
                activeTab === 'ledger' ? 'text-emerald-400 bg-emerald-950/40 font-semibold' : ''
              }`}
            >
              القيود والتقارير
            </button>
            <button
              onClick={() => setActiveTab('treasury')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors hover:text-emerald-400 ${
                activeTab === 'treasury' ? 'text-emerald-400 bg-emerald-950/40 font-semibold' : ''
              }`}
            >
              الصناديق
            </button>
            <button
              onClick={() => setActiveTab('clean_architecture')}
              className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap flex items-center gap-1 transition-colors hover:text-cyan-400 ${
                activeTab === 'clean_architecture' ? 'text-cyan-400 bg-cyan-950/40 font-semibold' : 'text-slate-400'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Dart</span>
            </button>
          </nav>

          {/* Zone 3: Consolidated Actions & Controls (UI-01, UI-02, UI-06, UI-09) */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* PWA Install Button */}
            <PWAInstallButton />

            {/* Offline / Online toggle */}
            <button
              onClick={() => setIsOnline(!isOnline)}
              title={isOnline ? 'النظام متصل مركزي (انقر للمحاكاة بدون إنترنت)' : 'النظام في وضع العمل بدون إنترنت'}
              className={`px-2 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                isOnline
                  ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-300'
                  : 'bg-amber-950/60 border-amber-700/50 text-amber-300'
              }`}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-amber-400" />}
              <span className="hidden md:inline">{isOnline ? 'متصل' : 'أوفلاين'}</span>
            </button>

            {/* Exchange Rates Primary Button */}
            <button
              onClick={onOpenRatesModal}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors"
              title="عرض وتعديل أسعار الصرف"
            >
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">الأسعار</span>
            </button>

            {/* UI-01 & UI-02: Consolidated Tools Dropdown Menu */}
            <div className="relative" ref={toolsMenuRef}>
              <button
                type="button"
                onClick={() => setIsToolsMenuOpen(!isToolsMenuOpen)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border transition-all ${
                  isToolsMenuOpen
                    ? 'bg-slate-700 border-slate-500 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                }`}
                title="أدوات النظام، التقارير والسندات"
              >
                <span>أدوات النظام</span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isToolsMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isToolsMenuOpen && (
                <div className="absolute left-0 mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 py-2 divide-y divide-slate-800/80 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    السندات والتقارير المالية
                  </div>
                  <div className="py-1">
                    {onOpenOfficialVoucher && (
                      <button
                        onClick={() => {
                          setIsToolsMenuOpen(false);
                          onOpenOfficialVoucher();
                        }}
                        className="w-full px-3.5 py-2 text-right text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                      >
                        <Receipt className="w-4 h-4 text-amber-400 shrink-0" />
                        <div>
                          <div className="text-white font-bold">طباعة السندات الرسمية</div>
                          <div className="text-[10px] text-slate-400">إشعار حراري وA4/A5 متعدد المقاسات</div>
                        </div>
                      </button>
                    )}

                    {onOpenA4StatementModal && (
                      <button
                        onClick={() => {
                          setIsToolsMenuOpen(false);
                          onOpenA4StatementModal();
                        }}
                        className="w-full px-3.5 py-2 text-right text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                      >
                        <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                        <div>
                          <div className="text-white font-bold">كشف حساب الأرباح (A4)</div>
                          <div className="text-[10px] text-slate-400">تقرير محاسبي معتمد بالعملات</div>
                        </div>
                      </button>
                    )}

                    {onOpenInternalTransferModal && (
                      <button
                        onClick={() => {
                          setIsToolsMenuOpen(false);
                          onOpenInternalTransferModal();
                        }}
                        className="w-full px-3.5 py-2 text-right text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                      >
                        <ArrowLeftRight className="w-4 h-4 text-cyan-400 shrink-0" />
                        <div>
                          <div className="text-white font-bold">تحويل مالي بين الصناديق</div>
                          <div className="text-[10px] text-slate-400">مناقلة وتغذية السيولة الداخلية</div>
                        </div>
                      </button>
                    )}

                    {onOpenPrintAudit && (
                      <button
                        onClick={() => {
                          setIsToolsMenuOpen(false);
                          onOpenPrintAudit();
                        }}
                        className="w-full px-3.5 py-2 text-right text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                      >
                        <Printer className="w-4 h-4 text-purple-400 shrink-0" />
                        <div>
                          <div className="text-white font-bold">سجل تدقيق الطباعة</div>
                          <div className="text-[10px] text-slate-400">تتبع السندات المعاد طباعتها</div>
                        </div>
                      </button>
                    )}
                  </div>

                  <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    إدارة النظام والأمان
                  </div>
                  <div className="py-1">
                    {onOpenSettings && (
                      <button
                        onClick={() => {
                          setIsToolsMenuOpen(false);
                          onOpenSettings();
                        }}
                        className="w-full px-3.5 py-2 text-right text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                      >
                        <Settings className="w-4 h-4 text-amber-400 shrink-0" />
                        <div>
                          <div className="text-white font-bold">إعدادات ترقيم الحوالات</div>
                          <div className="text-[10px] text-slate-400">تلقائي / يدوي مع ضوابط التدقيق</div>
                        </div>
                      </button>
                    )}

                    {onOpenOfflineModal && (
                      <button
                        onClick={() => {
                          setIsToolsMenuOpen(false);
                          onOpenOfflineModal();
                        }}
                        className="w-full px-3.5 py-2 text-right text-xs font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-2.5 transition-colors"
                      >
                        <HardDrive className="w-4 h-4 text-emerald-400 shrink-0" />
                        <div>
                          <div className="text-white font-bold">إدارة البيانات والأوفلاين</div>
                          <div className="text-[10px] text-slate-400">نسخ احتياطي وتفريغ البيانات</div>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* UI-06: Enhanced Visual Role Badge & Switcher */}
            <div className="flex items-center gap-1.5">
              <div
                className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border ${roleConfig.badgeClass}`}
                title={`الصلاحية الحالية في النظام: ${currentUser.roleTitleAr}`}
              >
                {roleConfig.icon}
                <span>{roleConfig.label}</span>
              </div>

              <select
                value={currentUser.role}
                onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                className="bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200 text-[11px] sm:text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                title="تبديل صلاحية المستخدم"
              >
                {AVAILABLE_ROLES.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.titleAr.split('(')[0].trim()}
                  </option>
                ))}
              </select>
            </div>

            {/* Mobile Hamburger Menu Button */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="xl:hidden p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 cursor-pointer transition-colors"
              aria-label="فتح القائمة الرئيسية"
            >
              <Menu className="w-5 h-5 text-emerald-400" />
            </button>
          </div>
        </div>

        {/* Mobile Horizontal Scrollable Tab Strip (Clean, Touch Target >= 40px) */}
        <div className="xl:hidden flex items-center overflow-x-auto px-2.5 py-1.5 gap-1.5 border-t border-slate-800/80 bg-slate-900/90 text-xs no-scrollbar">
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
            صرف حوالة
          </button>
          <button
            onClick={() => setActiveTab('remittance')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-semibold shrink-0 transition-colors ${
              activeTab === 'remittance' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800/60'
            }`}
          >
            إرسال حوالة
          </button>
          <button
            onClick={() => setActiveTab('customers')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-semibold shrink-0 transition-colors ${
              activeTab === 'customers' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800/60'
            }`}
          >
            العملاء
          </button>
          <button
            onClick={() => setActiveTab('ledger')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-semibold shrink-0 transition-colors ${
              activeTab === 'ledger' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800/60'
            }`}
          >
            القيود
          </button>
          <button
            onClick={() => setActiveTab('treasury')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap text-xs font-semibold shrink-0 transition-colors ${
              activeTab === 'treasury' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white bg-slate-800/60'
            }`}
          >
            الصناديق
          </button>
        </div>
      </header>

      {/* Mobile Drawer Menu Modal */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 xl:hidden flex">
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
          <div className="relative mr-auto w-80 max-w-[85vw] h-full bg-slate-900 border-l border-slate-800 p-5 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
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
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Navigation in Mobile Drawer */}
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-400 px-2 uppercase tracking-wider mb-2">أقسام النظام الرئيسية</p>
                {[
                  { id: 'dashboard', label: 'لوحة التحكم الرئيسية' },
                  { id: 'exchange', label: 'صرافة وبيع وشراء العملات' },
                  { id: 'remittance', label: 'إرسال الحوالات المالية' },
                  { id: 'receive_transfer', label: 'صرف واستلام الحوالات' },
                  { id: 'customers', label: 'إدارة العملاء (KYC)' },
                  { id: 'ledger', label: 'دفتر اليومية والحسابات' },
                  { id: 'treasury', label: 'حركة الصناديق والإقفال' },
                  { id: 'clean_architecture', label: 'معمارية Flutter / Dart' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id);
                      setIsMobileMenuOpen(false);
                    }}
                    className={`w-full text-right px-3 py-2.5 rounded-xl font-bold text-sm transition-colors ${
                      activeTab === item.id
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Quick Actions in Mobile Drawer */}
              <div className="space-y-1 pt-4 border-t border-slate-800">
                <p className="text-[11px] font-bold text-slate-400 px-2 uppercase tracking-wider mb-2">أدوات وتقارير سريعة</p>
                {onOpenOfficialVoucher && (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenOfficialVoucher();
                    }}
                    className="w-full text-right px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 rounded-lg flex items-center gap-2"
                  >
                    <Receipt className="w-4 h-4 text-amber-400" />
                    <span>طباعة السندات الرسمية</span>
                  </button>
                )}
                {onOpenA4StatementModal && (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenA4StatementModal();
                    }}
                    className="w-full text-right px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 rounded-lg flex items-center gap-2"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                    <span>كشف حساب الأرباح (A4)</span>
                  </button>
                )}
                {onOpenInternalTransferModal && (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenInternalTransferModal();
                    }}
                    className="w-full text-right px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 rounded-lg flex items-center gap-2"
                  >
                    <ArrowLeftRight className="w-4 h-4 text-cyan-400" />
                    <span>تحويل مالي بين الصناديق</span>
                  </button>
                )}
                {onOpenSettings && (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenSettings();
                    }}
                    className="w-full text-right px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 rounded-lg flex items-center gap-2"
                  >
                    <Settings className="w-4 h-4 text-amber-400" />
                    <span>إعدادات ترقيم الحوالات</span>
                  </button>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 text-center text-xs text-slate-500">
              نظام عمرو النماري للصرافة والحسابات v2.0
            </div>
          </div>
        </div>
      )}
    </>
  );
};
