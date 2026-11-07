import React, { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'brand' | 'outline' | 'danger' | 'ghost' | 'amber';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  icon?: ReactNode;
  iconPosition?: 'start' | 'end';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'secondary',
      size = 'md',
      isLoading = false,
      icon,
      iconPosition = 'start',
      className = '',
      disabled,
      ...props
    },
    ref
  ) => {
    // Base styles
    const base =
      'inline-flex items-center justify-center font-bold rounded-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none whitespace-nowrap shadow-sm';

    // Variant styles
    const variantStyles: Record<ButtonVariant, string> = {
      primary: 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-emerald-500/20',
      secondary:
        'bg-slate-800 hover:bg-slate-700 active:bg-slate-750 text-slate-200 border border-slate-700/80 hover:border-slate-600',
      brand:
        'bg-[#800000] hover:bg-[#660000] active:bg-[#500000] text-white border border-amber-500/40 shadow-amber-500/10',
      outline:
        'bg-transparent hover:bg-slate-800/80 active:bg-slate-800 text-slate-200 border border-slate-700 hover:border-slate-500',
      danger: 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-rose-500/20',
      ghost: 'bg-transparent hover:bg-slate-800 active:bg-slate-700 text-slate-300 hover:text-white',
      amber: 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white shadow-amber-500/20',
    };

    // Size styles with touch target discipline (min-h >= 36px on sm, 40px on md, 48px on lg)
    const sizeStyles: Record<ButtonSize, string> = {
      sm: 'px-2.5 py-1.5 text-xs min-h-[36px] gap-1.5',
      md: 'px-3.5 py-2 text-sm min-h-[40px] sm:min-h-[44px] gap-2',
      lg: 'px-5 py-2.5 text-base min-h-[48px] gap-2.5',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${base} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0 text-current" />
        ) : (
          icon && iconPosition === 'start' && <span className="shrink-0">{icon}</span>
        )}
        {children && <span>{children}</span>}
        {!isLoading && icon && iconPosition === 'end' && <span className="shrink-0">{icon}</span>}
      </button>
    );
  }
);

Button.displayName = 'Button';
