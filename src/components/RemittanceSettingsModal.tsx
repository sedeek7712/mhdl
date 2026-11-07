import React, { useState } from 'react';
import { RemittanceNumberingMode, RemittanceSettings, SystemAuditLog, UserProfile } from '../types/exchange';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Hash,
  History,
  Lock,
  PenTool,
  Save,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  User,
  X,
  Zap,
} from 'lucide-react';

interface RemittanceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: RemittanceSettings;
  auditLogs: SystemAuditLog[];
  currentUser: UserProfile;
  onSaveSettings: (newSettings: Partial<RemittanceSettings>, reason: string) => void;
}

export const RemittanceSettingsModal: React.FC<RemittanceSettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  auditLogs,
  currentUser,
  onSaveSettings,
}) => {
  if (!isOpen) return null;

  // Check if current user is Owner or General Manager
  const isAuthorized = currentUser.role === 'owner' || currentUser.role === 'general_manager';

  const [selectedMode, setSelectedMode] = useState<RemittanceNumberingMode>(settings.numberingMode);
  const [prefix, setPrefix] = useState<string>(settings.prefix || 'TR-');
  const [nextSequence, setNextSequence] = useState<number>(settings.nextSequence || 931107);
  const [reason, setReason] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'settings' | 'audit_log'>('settings');
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthorized) {
      alert('عذراً، هذا الإجراء يتطلب صلاحية المالك أو المدير العام.');
      return;
    }

    if (!reason.trim()) {
      alert('يرجى كتابة سبب أو ملاحظة إدارية لاعتماد التغيير في سجل التدقيق المحاسبي.');
      return;
    }

    onSaveSettings(
      {
        numberingMode: selectedMode,
        prefix: prefix.trim().toUpperCase() || 'TR-',
        nextSequence: Number(nextSequence) || 1,
      },
      reason.trim()
    );

    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1200);
  };

  const filteredLogs = auditLogs.filter((log) => log.category === 'remittance_numbering');

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto"
    >
      <div
        className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl shadow-black/80 flex flex-col max-h-[92vh]"
        dir="rtl"
      >
        {/* Header Contract */}
        <div className="px-4 sm:px-6 py-4 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-emerald-400">الإعدادات ← إعدادات الحوالات</span>
                <span className="text-slate-500">/</span>
                <span className="text-xs text-amber-400 font-semibold">طريقة إصدار رقم الحوالة</span>
              </div>
              <h2 className="text-sm sm:text-base font-bold text-white mt-0.5">
                ضبط سياسة ترقيم الحوالات المالية وإجراءات الأمان
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="w-10 h-10 min-w-[40px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Permission Banner if not authorized */}
        {!isAuthorized ? (
          <div className="bg-amber-950/60 border-b border-amber-800/40 px-6 py-2.5 flex items-center gap-2 text-xs text-amber-300">
            <Lock className="w-4 h-4 shrink-0 text-amber-400" />
            <span>
              <strong>وضع القراءة فقط:</strong> هذا الإعداد متاح للمالك أو المدير العام فقط. دورك الحالي هو (
              {currentUser.roleTitleAr})، لذلك يمكنك الاطلاع على السياسة المعتمدة دون تعديل.
            </span>
          </div>
        ) : null}

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-slate-800 bg-slate-900/50">
          <button
            onClick={() => setActiveTab('settings')}
            className={`pb-2.5 px-3 text-xs font-semibold flex items-center gap-1.5 transition-colors border-b-2 ${
              activeTab === 'settings'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>خيارات الترقيم والسياسة المعتمدة</span>
          </button>
          <button
            onClick={() => setActiveTab('audit_log')}
            className={`pb-2.5 px-3 text-xs font-semibold flex items-center gap-1.5 transition-colors border-b-2 ${
              activeTab === 'audit_log'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>سجل التدقيق المحاسبي ({filteredLogs.length})</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-200 text-xs">
          {activeTab === 'settings' ? (
            <form onSubmit={handleSave} className="space-y-6">
              {/* Current Status Badge */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-850 border border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <div>
                    <span className="text-slate-400 text-[11px] block">السياسة النشطة حالياً في النظام:</span>
                    <strong className="text-white text-xs">
                      {settings.numberingMode === 'automatic'
                        ? 'الترقيم التلقائي المتسلسل المركزي (Automatic)'
                        : 'الترقيم اليدوي مع فحص عدم التكرار (Manual)'}
                    </strong>
                  </div>
                </div>
                <div className="text-left font-mono text-[11px] text-slate-400">
                  <span>آخر تحديث: {settings.updatedAt}</span>
                  <span className="block text-slate-500">بواسطة: {settings.updatedBy}</span>
                </div>
              </div>

              {/* Numbering Modes Selection Cards */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-300">
                  اختر طريقة إصدار أرقام الحوالات:
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Option 1: Automatic */}
                  <label
                    className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                      selectedMode === 'automatic'
                        ? 'bg-emerald-950/20 border-emerald-500 shadow-md shadow-emerald-950/40'
                        : 'bg-slate-850/60 border-slate-800 hover:border-slate-700'
                    } ${!isAuthorized ? 'pointer-events-none opacity-80' : ''}`}
                  >
                    <input
                      type="radio"
                      name="numberingMode"
                      value="automatic"
                      checked={selectedMode === 'automatic'}
                      onChange={() => setSelectedMode('automatic')}
                      disabled={!isAuthorized}
                      className="sr-only"
                    />
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-white text-sm flex items-center gap-2">
                          <Zap className="w-4 h-4 text-emerald-400" />
                          <span>1. الترقيم التلقائي (Automatic)</span>
                        </span>
                        {selectedMode === 'automatic' ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            مُعتمد
                          </span>
                        ) : null}
                      </div>

                      <p className="text-[11px] text-slate-300 leading-relaxed mb-3">
                        يقوم النظام بإنشاء رقم حوالة فريد ومتسلسل تلقائياً فور اعتماد الحوالة في الخادم، دون
                        الحاجة لتدخل الموظف.
                      </p>

                      <ul className="space-y-1.5 text-[10px] text-slate-400">
                        <li className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>يستمر التسلسل دون أي انقطاع أو تكرار عبر كافة الفروع.</span>
                        </li>
                        <li className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>لا يعتمد على عدد الحوالات الظاهرة أو العد المحلي في الواجهة.</span>
                        </li>
                        <li className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>يخفي حقل رقم الحوالة في شاشة الإرسال لمنع الأخطاء المطبعية.</span>
                        </li>
                      </ul>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-emerald-400">
                      <span>النمط المتسلسل:</span>
                      <span>{prefix}{String(nextSequence).padStart(6, '0')}</span>
                    </div>
                  </label>

                  {/* Option 2: Manual */}
                  <label
                    className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                      selectedMode === 'manual'
                        ? 'bg-sky-950/20 border-sky-500 shadow-md shadow-sky-950/40'
                        : 'bg-slate-850/60 border-slate-800 hover:border-slate-700'
                    } ${!isAuthorized ? 'pointer-events-none opacity-80' : ''}`}
                  >
                    <input
                      type="radio"
                      name="numberingMode"
                      value="manual"
                      checked={selectedMode === 'manual'}
                      onChange={() => setSelectedMode('manual')}
                      disabled={!isAuthorized}
                      className="sr-only"
                    />
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-white text-sm flex items-center gap-2">
                          <PenTool className="w-4 h-4 text-sky-400" />
                          <span>2. الترقيم اليدوي (Manual)</span>
                        </span>
                        {selectedMode === 'manual' ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">
                            مُعتمد
                          </span>
                        ) : null}
                      </div>

                      <p className="text-[11px] text-slate-300 leading-relaxed mb-3">
                        يظهر حقل إلزامي لإدخال رقم الحوالة في شاشة الإرسال، حيث يقوم الموظف أو الكاشير بإدخال
                        الرقم الورقي أو رقم الشبكة يدوياً.
                      </p>

                      <ul className="space-y-1.5 text-[10px] text-slate-400">
                        <li className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <span>حقل إلزامي صريح في شاشة إرسال الحوالة.</span>
                        </li>
                        <li className="flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <span>تحقق لحظي فوري من عدم استخدام الرقم مسبقاً.</span>
                        </li>
                        <li className="flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span>يرفض النظام الحفظ بصورة قاطعة في حال كان الرقم مكرراً.</span>
                        </li>
                      </ul>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-sky-400">
                      <span>قيد الأمان:</span>
                      <span>UNIQUE Constraint مفعل</span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Automatic Sequence Configuration (if automatic selected) */}
              {selectedMode === 'automatic' ? (
                <div className="bg-slate-850 p-4 rounded-xl border border-slate-800 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Hash className="w-4 h-4 text-emerald-400" />
                      <span>معلمات التسلسل الآلي للحوالات</span>
                    </span>
                    <span className="text-[10px] text-slate-400">خاصة بالخادم المركزي</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        بادئة رقم الحوالة (Prefix)
                      </label>
                      <input
                        type="text"
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                        disabled={!isAuthorized}
                        placeholder="TR-"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono font-bold text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        الرقم التسلسلي التالي (Next Sequence)
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={nextSequence}
                        onChange={(e) => setNextSequence(parseInt(e.target.value) || 1)}
                        disabled={!isAuthorized}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
                        required
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    ملاحظة أمان: تغيير الرقم التسلسلي التالي لا يؤثر على أرقام الحوالات السابقة ويضمن عدم تكرار الأرقام القديمة.
                  </p>
                </div>
              ) : null}

              {/* Reason / Administrative Note (Mandatory for Audit Trail) */}
              {isAuthorized ? (
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                    <span>سبب أو مبرر التعديل (إلزامي للتوثيق في سجل التدقيق Audit Log)</span>
                  </label>
                  <textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="مثال: اعتماد الترقيم اليدوي لمطابقة السندات الورقية الخاصة بشبكة النجم، أو التبديل للترقيم التلقائي لتسريع الإدخال في الفرع..."
                    className="w-full bg-slate-850 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-500"
                    required
                  />
                </div>
              ) : null}

              {/* Footer Actions */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <span>المستخدم الحالي:</span>
                  <strong className="text-white">{currentUser.name}</strong>
                  <span className="text-slate-500">({currentUser.roleTitleAr})</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors"
                  >
                    إغلاق
                  </button>

                  {isAuthorized ? (
                    <button
                      type="submit"
                      disabled={savedSuccess}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
                    >
                      {savedSuccess ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-white" />
                          <span>تم الحفظ والتوثيق بنجاح!</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          <span>حفظ التعديلات في سجل التدقيق</span>
                        </>
                      )}
                    </button>
                  ) : null}
                </div>
              </div>
            </form>
          ) : (
            /* Audit Log View */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  سجل التعديلات والقرارات الإدارية الخاصة بسياسة ترقيم الحوالات (غير قابل للحذف):
                </span>
                <span className="text-[11px] text-slate-500 font-mono">
                  إجمالي السجلات: {filteredLogs.length}
                </span>
              </div>

              {filteredLogs.length === 0 ? (
                <div className="text-center py-10 bg-slate-850 rounded-xl border border-slate-800">
                  <History className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">لا توجد سجلات تدقيق سابقة بعد.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3.5 bg-slate-850 rounded-xl border border-slate-800 space-y-1.5 text-xs hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            {log.action}
                          </span>
                          <span className="text-white font-semibold">{log.performedBy}</span>
                          <span className="text-[10px] text-slate-500">({log.userRole})</span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {log.timestamp}
                        </span>
                      </div>

                      <p className="text-slate-300 text-[11px] leading-relaxed">{log.details}</p>

                      {log.oldValue || log.newValue ? (
                        <div className="flex items-center gap-4 text-[10px] font-mono pt-1 text-slate-400 border-t border-slate-800/60">
                          {log.oldValue ? (
                            <span>
                              القيمة السابقة: <strong className="text-rose-400">{log.oldValue}</strong>
                            </span>
                          ) : null}
                          {log.newValue ? (
                            <span>
                              القيمة الجديدة: <strong className="text-emerald-400">{log.newValue}</strong>
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
