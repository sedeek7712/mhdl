import React, { useState } from 'react';
import { KeyRound, Lock, Shield, ShieldAlert, Sparkles, UserCheck, X } from 'lucide-react';
import { UserProfile, UserRole } from '../../types/exchange';
import { apiClient } from '../../services/apiClient';
import { Button } from './Button';
import { useToast } from './Toast';

interface RoleAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetRole: UserRole;
  onSuccess: (authenticatedUser: UserProfile) => void;
  isRequired?: boolean;
}

export const RoleAuthModal: React.FC<RoleAuthModalProps> = ({
  isOpen,
  onClose,
  targetRole,
  onSuccess,
  isRequired = false,
}) => {
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const toast = useToast();

  if (!isOpen) return null;

  const roleMeta: Record<
    UserRole,
    { title: string; defaultUsername: string; description: string; isHighPrivilege: boolean }
  > = {
    owner: {
      title: 'المالك والمشرف العام (Owner)',
      defaultUsername: 'amro',
      description: 'يتطلب إدخال رمز التحقق السري (PIN) الخاص بالمالك للوصول إلى كامل الصلاحيات الإدارية والسياسات.',
      isHighPrivilege: true,
    },
    general_manager: {
      title: 'المدير العام (General Manager)',
      defaultUsername: 'abdullah',
      description: 'يتطلب إدخال رمز التحقق السري المعتمد للمدير العام لإدارة العمليات وتعديل السياسات.',
      isHighPrivilege: true,
    },
    branch_manager: {
      title: 'مدير الفرع (Branch Manager)',
      defaultUsername: 'branch_manager',
      description: 'صلاحيات إدارة الصناديق والمطابقة النقدية.',
      isHighPrivilege: false,
    },
    teller: {
      title: 'الكاشير / الصراف المعتمد (Teller)',
      defaultUsername: 'sedeek',
      description: 'وضع الصرافة والقبض والصرف اليومي.',
      isHighPrivilege: false,
    },
    auditor: {
      title: 'المحاسب المالي والمدقق (Auditor)',
      defaultUsername: 'mohammed',
      description: 'مراجعة القيود والتقارير المالية دون تعديل.',
      isHighPrivilege: false,
    },
  };

  const currentRoleInfo = roleMeta[targetRole] || {
    title: targetRole,
    defaultUsername: targetRole,
    description: 'تحقق من صلاحيات المستخدم.',
    isHighPrivilege: false,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin)) {
      setErrorMsg('أدخل رمز PIN مكوّناً من 6 أرقام بالضبط.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await apiClient.login(targetRole, pin);
      if (res.success && res.user) {
        const updatedUser: UserProfile = {
          id: res.user.id || `usr-${targetRole}`,
          name: res.user.name || currentRoleInfo.title,
          role: targetRole,
          roleTitleAr: currentRoleInfo.title,
          branchId: res.user.branchId || 'br-01',
          branchName: res.user.branchName || 'المركز الرئيسي',
        };

        toast.success(
          `تم توثيق الدخول بنجاح`,
          `أنت الآن تعمل بصلاحية [${currentRoleInfo.title.split('(')[0].trim()}] بمصادقة خادمية مشفرة (HMAC Token).`
        );
        onSuccess(updatedUser);
        onClose();
      } else {
        setErrorMsg(res.error || 'الرمز السري (PIN) غير صحيح أو الحساب غير مصرح له');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل الاتصال بخادم المصادقة');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (!isRequired && e.target === e.currentTarget && !isLoading) onClose();
      }}
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-55 flex items-center justify-center p-3 sm:p-4 overflow-y-auto no-print"
      dir="rtl"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                currentRoleInfo.isHighPrivilege
                  ? 'bg-amber-950/80 text-amber-400 border border-amber-800/60'
                  : 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
              }`}
            >
              {currentRoleInfo.isHighPrivilege ? <ShieldAlert className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white">{isRequired ? 'تسجيل الدخول الآمن' : 'التحقق الأمني من الصلاحيات'}</h3>
              <p className="text-[11px] text-slate-400 font-mono">التبديل إلى: {currentRoleInfo.title}</p>
            </div>
          </div>
          {!isRequired && (
            <button
              onClick={onClose}
              disabled={isLoading}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <p className="text-xs text-slate-300 leading-relaxed bg-slate-850 p-3 rounded-xl border border-slate-800">
          {currentRoleInfo.description}
        </p>

        {errorMsg && (
          <div className="p-3 bg-rose-950/70 border border-rose-800 text-rose-300 text-xs rounded-xl flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-300 mb-1.5 font-medium flex items-center justify-between">
              <span>رمز المرور السري (PIN):</span>
              <span className="text-[10px] text-slate-500 font-mono">6 أرقام · التحقق عبر الخادم</span>
            </label>
            <div className="relative">
              <input
                type="password"
                maxLength={6}
                minLength={6}
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="off"
                autoFocus
                placeholder="••••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full bg-slate-850 border border-slate-700 rounded-xl px-4 py-2.5 text-center text-lg tracking-widest font-mono text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                required
              />
              <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5 flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-slate-400 shrink-0" />
              <span>أدخل رمز المرور السري المخصص لحسابك لدى إدارة الرقابة والأنظمة المالية. العمليات تخضع للتدقيق الآلي.</span>
            </p>
          </div>

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2 border-t border-slate-800">
            {!isRequired && (
              <Button variant="secondary" size="md" onClick={onClose} disabled={isLoading} type="button">
                إلغاء
              </Button>
            )}
            <Button
              variant={currentRoleInfo.isHighPrivilege ? 'amber' : 'primary'}
              size="md"
              type="submit"
              isLoading={isLoading}
              icon={<UserCheck className="w-4 h-4" />}
            >
              {isRequired ? 'تسجيل الدخول والمتابعة' : 'تأكيد المصادقة وتغيير الدور'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
