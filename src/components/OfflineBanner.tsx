import React from 'react';
import { WifiOff, HardDrive, CheckCircle2 } from 'lucide-react';

interface OfflineBannerProps {
  isOnline: boolean;
  onOpenOfflineModal: () => void;
  pendingQueueCount: number;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({
  isOnline,
  onOpenOfflineModal,
  pendingQueueCount,
}) => {
  if (isOnline) return null;

  return (
    <aside
      aria-label="حالة العمل بدون إنترنت"
      className="bg-gradient-to-r from-amber-950/90 via-slate-900/90 to-amber-950/90 border-b border-amber-600/40 text-amber-200 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-3 shadow-md z-30 relative"
    >
      <div className="flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 animate-pulse">
          <WifiOff className="w-3.5 h-3.5" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-bold text-amber-300">وضع العمل بدون إنترنت (Offline Active):</span>
          <span className="text-slate-300 hidden sm:inline">
            النظام يعمل محلياً بكامل كفاءته، وجميع السندات والقيود محفوظة في جهازك.
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {pendingQueueCount > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[11px] border border-amber-500/30">
            {pendingQueueCount} سند بانتظار واتساب
          </span>
        )}
        <button
          onClick={onOpenOfflineModal}
          className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
        >
          <HardDrive className="w-3 h-3" />
          <span>إدارة النسخ المحلي</span>
        </button>
      </div>
    </aside>
  );
};
