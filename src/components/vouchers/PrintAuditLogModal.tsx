import React, { useState } from 'react';
import { PrintAuditLogEntry, UserProfile } from '../../types/exchange';
import { printAuditService } from '../../services/printAuditService';
import { CheckCircle2, Clock, FileText, Filter, History, Printer, Search, ShieldCheck, X } from 'lucide-react';

interface PrintAuditLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
}

export const PrintAuditLogModal: React.FC<PrintAuditLogModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const [logs, setLogs] = useState<PrintAuditLogEntry[]>(() => printAuditService.getLogs());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterPaper, setFilterPaper] = useState<string>('all');

  if (!isOpen) return null;

  const refreshLogs = () => {
    setLogs(printAuditService.getLogs());
  };

  const filteredLogs = logs.filter((log) => {
    if (filterType !== 'all') {
      if (filterType === 'reprints' && !log.isReprint) return false;
      if (filterType === 'signed' && log.signatureStatus !== 'signed_manually') return false;
      if (filterType === 'pending_sig' && log.signatureStatus === 'signed_manually') return false;
    }
    if (filterPaper !== 'all' && log.paperSize !== filterPaper) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return (
        log.voucherNumber.toLowerCase().includes(q) ||
        log.operationNumber.toLowerCase().includes(q) ||
        log.voucherTitleAr.toLowerCase().includes(q) ||
        log.printedBy.toLowerCase().includes(q) ||
        (log.reprintReason && log.reprintReason.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 no-print" dir="rtl">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-850">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#800000]/20 border border-[#800000]/40 flex items-center justify-center text-[#ff6b6b]">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>سجل تدقيق طباعة السندات والتوقيع اليدوي</span>
                <span className="bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 px-2 py-0.5 rounded-full text-xs font-mono">
                  {logs.length} سجل
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                توثيق كامل لكافة عمليات الطباعة، إعادة الطباعة، وأرشفة النسخ الموقعة يدوياً
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshLogs}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
            >
              تحديث السجل
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="p-3 sm:p-4 bg-slate-900 border-b border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث برقم السند، رقم العملية، اسم الموظف..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl pr-9 pl-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 shrink-0">الحالة:</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none"
            >
              <option value="all">كافة العمليات</option>
              <option value="reprints">عمليات إعادة الطباعة فقط</option>
              <option value="signed">تم استلام التوقيع اليدوي</option>
              <option value="pending_sig">بانتظار استلام التوقيع الورقي</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 shrink-0">المقاس:</label>
            <select
              value={filterPaper}
              onChange={(e) => setFilterPaper(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none"
            >
              <option value="all">كافة المقاسات</option>
              <option value="a4">ورق A4</option>
              <option value="a5">ورق A5</option>
              <option value="thermal_80mm">حراري 80mm</option>
              <option value="thermal_58mm">حراري 58mm</option>
            </select>
          </div>
        </div>

        {/* Table Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-slate-400 space-y-2">
              <Printer className="w-10 h-10 mx-auto text-slate-600" />
              <p className="text-sm">لا توجد سجلات طباعة مطابقة للفلاتر المحددة</p>
              <p className="text-xs text-slate-500">
                عند قيام الموظف بطباعة أي سند، سيتم توثيقه هنا تلقائياً دون التأثير على الحسابات.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-xl p-3 sm:p-4 transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-emerald-400 text-xs sm:text-sm">
                        {log.voucherNumber}
                      </span>
                      <span className="bg-slate-800 text-slate-200 px-2 py-0.5 rounded text-[11px] font-bold">
                        {log.voucherTitleAr}
                      </span>
                      {log.isReprint ? (
                        <span className="bg-amber-950/80 text-amber-300 border border-amber-800/60 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1">
                          <span>نسخة إعادة طباعة (رقم {log.printCount})</span>
                        </span>
                      ) : (
                        <span className="bg-blue-950/80 text-blue-300 border border-blue-800/60 px-2 py-0.5 rounded text-[10px] font-bold">
                          طباعة أولى
                        </span>
                      )}
                      <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px] font-mono uppercase">
                        {log.paperSize.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      {log.signatureStatus === 'signed_manually' ? (
                        <span className="text-emerald-400 bg-emerald-950/50 border border-emerald-800/50 px-2.5 py-0.5 rounded-full flex items-center gap-1 text-[11px] font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>تم التوقيع ورقياً وأرشفتها</span>
                        </span>
                      ) : (
                        <span className="text-amber-400 bg-amber-950/50 border border-amber-800/50 px-2.5 py-0.5 rounded-full flex items-center gap-1 text-[11px] font-bold">
                          <Clock className="w-3.5 h-3.5" />
                          <span>بانتظار توقيع واستلام العميل</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 text-xs text-slate-300">
                    <div>
                      <span className="text-slate-500">المستخدم الطابع: </span>
                      <strong className="text-white">{log.printedBy}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">تاريخ ووقت الطباعة: </span>
                      <span className="font-mono text-slate-200">{log.printedAt}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">رقم العملية / المرجع: </span>
                      <span className="font-mono text-slate-200">{log.operationNumber}</span>
                    </div>
                  </div>

                  {log.reprintReason && (
                    <div className="mt-2 p-2 rounded-lg bg-amber-950/30 border border-amber-900/40 text-[11px] text-amber-200">
                      <strong>مبرر إعادة الطباعة: </strong>{log.reprintReason}
                    </div>
                  )}

                  {log.signedReceiptBy && (
                    <div className="mt-2 p-2 rounded-lg bg-emerald-950/30 border border-emerald-900/40 text-[11px] text-emerald-200 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>تم توثيق استلام الأصل الموقع يدوياً بواسطة: <strong>{log.signedReceiptBy}</strong></span>
                      </div>
                      <span className="font-mono text-[10px] text-slate-400">{log.signedReceiptAt}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-slate-800 bg-slate-900 flex items-center justify-between text-xs text-slate-400">
          <span>سجل غير قابل للتعديل · يحافظ على النزاهة والامتثال المصرفي لمؤسسة عمرو النماري</span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
