import React, { useRef, useState } from 'react';
import { offlineStorage } from '../services/offlineStorage';
import { Database, Download, Upload, HardDrive, WifiOff, CheckCircle2, AlertCircle, X, RefreshCw } from 'lucide-react';

interface OfflineBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataReload: () => void;
  isOnline: boolean;
  onToggleOnline: () => void;
  entriesCount: number;
  remittancesCount: number;
  accountsCount: number;
}

export const OfflineBackupModal: React.FC<OfflineBackupModalProps> = ({
  isOpen,
  onClose,
  onDataReload,
  isOnline,
  onToggleOnline,
  entriesCount,
  remittancesCount,
  accountsCount,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  if (!isOpen) return null;

  const handleExport = () => {
    try {
      const json = offlineStorage.exportFullBackup();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `alnamari_exchange_offline_backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusMsg({ text: 'تم تصدير النسخة الاحتياطية بنجاح إلى ملف محلي على جهازك.', type: 'success' });
    } catch (err: any) {
      setStatusMsg({ text: `فشل التصدير: ${err.message}`, type: 'error' });
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const success = offlineStorage.importFullBackup(content);
        if (success) {
          setStatusMsg({ text: 'تمت استعادة البيانات بنجاح من النسخة الاحتياطية!', type: 'success' });
          onDataReload();
        } else {
          setStatusMsg({ text: 'الملف غير صالح أو لا يحتوي على بنية بيانات صحيحة.', type: 'error' });
        }
      } catch (err: any) {
        setStatusMsg({ text: `خطأ في قراءة الملف: ${err.message}`, type: 'error' });
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const queue = offlineStorage.getOfflineQueue();

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto"
    >
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="p-4 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">إدارة العمل أوفلاين (بدون إنترنت)</h2>
              <p className="text-xs text-slate-400">حفظ واسترجاع كافة العمليات المالية محلياً على جهازك</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="w-10 h-10 min-w-[40px] text-slate-400 hover:text-white rounded-xl bg-slate-800/80 hover:bg-slate-700 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Status Message */}
          {statusMsg && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-950/60 border border-emerald-700/50 text-emerald-300'
                  : 'bg-rose-950/60 border border-rose-700/50 text-rose-300'
              }`}
            >
              {statusMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{statusMsg.text}</span>
            </div>
          )}

          {/* Mode toggle block */}
          <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  !isOnline ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'
                }`}
              >
                {!isOnline ? <WifiOff className="w-5 h-5" /> : <RefreshCw className="w-5 h-5" />}
              </div>
              <div>
                <div className="text-xs font-bold text-white">
                  {!isOnline ? 'وضع العمل بدون إنترنت (Offline Active)' : 'وضع الاتصال الشبكي (Online)'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {!isOnline
                    ? 'جميع العمليات تُسجل وتحفظ مباشرة في الذاكرة المحلية للجهاز'
                    : 'يمكنك التحويل إلى نمط أوفلاين في أي وقت بضغطة زر'}
                </div>
              </div>
            </div>

            <button
              onClick={onToggleOnline}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                !isOnline
                  ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600'
              }`}
            >
              {!isOnline ? 'أوفلاين (نشط)' : 'تفعيل الأوفلاين'}
            </button>
          </div>

          {/* Local Statistics Grid */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/60 text-center">
              <span className="text-[11px] text-slate-400 block mb-0.5">الحسابات والصناديق</span>
              <span className="text-base font-extrabold text-white font-mono">{accountsCount}</span>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/60 text-center">
              <span className="text-[11px] text-slate-400 block mb-0.5">القيود اليومية</span>
              <span className="text-base font-extrabold text-emerald-400 font-mono">{entriesCount}</span>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/60 text-center">
              <span className="text-[11px] text-slate-400 block mb-0.5">الحوالات المسجلة</span>
              <span className="text-base font-extrabold text-amber-400 font-mono">{remittancesCount}</span>
            </div>
          </div>

          {/* Offline WhatsApp Queue Box */}
          {queue.length > 0 && (
            <div className="p-3.5 bg-amber-950/30 border border-amber-700/40 rounded-xl text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-300">سندات بانتظار الإرسال بالواتساب:</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold text-[11px]">
                  {queue.length} سند
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                هذه السندات تم إنشاؤها وتوقيعها محلياً أثناء انقطاع النت، ومحفوظة على جهازك كصور معتمدة وجاهزة للطباعة أو الإرسال التلقائي فور توفر الاتصال.
              </p>
            </div>
          )}

          {/* Backup / Export / Import Actions */}
          <div className="space-y-2.5 pt-2">
            <h3 className="text-xs font-bold text-slate-300">إدارة الأرشيف والنسخ الاحتياطي:</h3>
            
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleExport}
                className="p-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                <Download className="w-4 h-4" />
                <span>تصدير نسخة احتياطية</span>
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
              >
                <Upload className="w-4 h-4 text-cyan-400" />
                <span>استيراد واستعادة</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImportFile}
                className="hidden"
              />
            </div>
          </div>

          {/* Offline Instructions */}
          <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-700/50 text-[11px] text-slate-400 space-y-1">
            <div className="font-bold text-slate-300">💡 مميزات العمل بدون نت:</div>
            <ul className="list-disc list-inside space-y-0.5 text-slate-400">
              <li>يقوم النظام بحفظ جميع السندات وطباعتها على الطابعات الحرارية أو A4 فوراً.</li>
              <li>لا يتوقف الكاشير أبداً في حال انقطاع خدمة الإنترنت أو شبكات الاتصال.</li>
              <li>جميع البيانات مشفرة ومخزنة على جهازك المحلي بأمان كامل.</li>
            </ul>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-850 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors"
          >
            إغلاق النافذة
          </button>
        </div>
      </div>
    </div>
  );
};
