import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Smartphone, X, CheckCircle2 } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already installed in standalone mode, display subtle installed badge
  if (isInstalled) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/40 border border-emerald-700/40 rounded-xl text-[11px] text-emerald-300 font-medium">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        <span>تطبيق مثبت</span>
      </div>
    );
  }

  // Chromium / Android / Edge / Windows / Mac direct install flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="px-2.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-emerald-500/20 transition-all cursor-pointer animate-pulse"
        title="تثبيت نظام النماري كتطبيق محلي على جهازك للعمل بدون إنترنت (PWA)"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">تثبيت التطبيق (بدون نت)</span>
        <span className="sm:hidden">تثبيت</span>
      </button>
    );
  }

  // iOS Safari flow (WebKit beforeinstallprompt requires Add to Home Screen manual flow)
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          title="تثبيت النظام على آيفون / آيباد للعمل بدون إنترنت"
        >
          <Smartphone className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">تثبيت على iOS</span>
          <span className="sm:hidden">تثبيت</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl text-slate-100">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-amber-400" />
                  <h3 className="text-base font-bold text-white">تثبيت النظام على آيفون / آيباد</h3>
                </div>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                <p>للعمل بكامل كفاءة النظام بدون اتصال بالإنترنت:</p>
                <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-600/30 text-emerald-400 flex items-center justify-center font-bold text-[11px] shrink-0">1</span>
                    <span>اضغط على أيقونة <strong>المشاركة (Share ⎋)</strong> في شريط متصفح سفاري السفلي.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-600/30 text-emerald-400 flex items-center justify-center font-bold text-[11px] shrink-0">2</span>
                    <span>مرر لأسفل واختر <strong>«إضافة إلى الشاشة الرئيسية» (Add to Home Screen ⊞)</strong>.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-600/30 text-emerald-400 flex items-center justify-center font-bold text-[11px] shrink-0">3</span>
                    <span>اضغط <strong>«إضافة» (Add)</strong> بالأعلى لتشغيله كبرنامج مستقل بدون إنترنت.</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors"
              >
                فهمت ذلك، إغلاق
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
