import React, { ReactNode } from 'react';

export interface PageHeaderProps {
  badge?: string;
  badgeColor?: 'emerald' | 'amber' | 'cyan' | 'purple' | 'slate';
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  badge,
  badgeColor = 'emerald',
  title,
  subtitle,
  actions,
  icon,
}) => {
  const badgeClasses = {
    emerald: 'bg-emerald-950/80 text-emerald-400 border-emerald-700/60',
    amber: 'bg-amber-950/80 text-amber-400 border-amber-700/60',
    cyan: 'bg-cyan-950/80 text-cyan-400 border-cyan-700/60',
    purple: 'bg-purple-950/80 text-purple-400 border-purple-700/60',
    slate: 'bg-slate-800 text-slate-300 border-slate-700',
  }[badgeColor];

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 mb-6 border-b border-slate-800/80">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-emerald-400 shrink-0 shadow-sm mt-0.5">
            {icon}
          </div>
        )}
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">{title}</h1>
            {badge && (
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${badgeClasses}`}>
                {badge}
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-3xl">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  );
};
