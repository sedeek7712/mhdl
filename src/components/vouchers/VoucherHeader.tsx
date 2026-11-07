import React from 'react';
import { OfficialVoucher, PaperSize } from '../../types/exchange';
import { ALNAMARI_LOGO_BASE64 } from '../../assets/logoBase64';

interface VoucherHeaderProps {
  voucher: OfficialVoucher;
  title: string;
  paperSize?: PaperSize;
  isReprint?: boolean;
}

export const VoucherHeader: React.FC<VoucherHeaderProps> = ({
  voucher,
  title,
  paperSize = 'a4',
  isReprint = false,
}) => {
  const isA5 = paperSize === 'a5';
  const showReprintBadge = isReprint || (voucher.printCount && voucher.printCount > 1);

  return (
    <div className="w-full relative mb-2 select-none" dir="rtl">
      {/* Reprint Watermark Banner */}
      {showReprintBadge && (
        <div className="mb-2 bg-amber-500/15 border-2 border-dashed border-amber-600 rounded-lg p-1.5 flex items-center justify-between text-amber-900 font-bold text-[10px] sm:text-xs">
          <div className="flex items-center gap-1.5">
            <span className="bg-amber-600 text-white px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-black tracking-wider uppercase">
              نسخة إعادة طباعة · REPRINT
            </span>
            <span>النسخة رقم: <strong>{voucher.printCount || 2}</strong></span>
            {voucher.reprintReason && (
              <span className="hidden sm:inline">| سبب الإعادة: <em>{voucher.reprintReason}</em></span>
            )}
          </div>
          <span className="font-mono text-[9px] text-slate-700">
            السند الأصلي: {voucher.voucherNumber}
          </span>
        </div>
      )}

      {/* Main Brand Header */}
      <div className={`flex items-center justify-between pb-2 border-b-2 border-[#800000] gap-2 ${isA5 ? 'pb-1.5 mb-1.5' : 'pb-2.5 mb-2'}`}>
        {/* Right Info: Branch & Teller */}
        <div className="text-right text-slate-800 space-y-0.5 min-w-[90px] sm:min-w-[130px]">
          <div className="text-[10px] sm:text-xs font-bold text-[#800000]">
            {voucher.branchName || 'فرع تعز - مديرية خدير'}
          </div>
          <div className="text-[9px] sm:text-[10.5px] text-slate-600 font-semibold">
            الموظف: <span className="text-slate-900 font-bold">{voucher.tellerName || 'الصراف المعتمد'}</span>
          </div>
          <div className="text-[8.5px] sm:text-[9.5px] text-slate-500 font-mono">
            {voucher.date} · {voucher.time}
          </div>
        </div>

        {/* Center: Official Typography & Shield Logo */}
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          <div className={`${isA5 ? 'w-10 h-10 sm:w-12 sm:h-12' : 'w-12 h-12 sm:w-16 sm:h-16'} shrink-0 flex items-center justify-center`}>
            <img
              src={ALNAMARI_LOGO_BASE64}
              alt="شعار مؤسسة عمرو النماري"
              className="w-full h-full object-contain filter drop-shadow-xs"
            />
          </div>
          <div className="text-center">
            <h1 className={`${isA5 ? 'text-xs sm:text-base font-black' : 'text-sm sm:text-xl font-black'} text-[#800000] tracking-tight leading-tight`}>
              عمرو النماري للصرافة والتحويلات
            </h1>
            <div className="text-[#8c331a] font-bold text-[8px] sm:text-[10px] tracking-wider uppercase font-sans mt-0.5">
              AMRO ALNAMARI EXCHANGE &amp; REMITTANCES
            </div>
            <div className="text-[8px] sm:text-[9.5px] font-semibold text-slate-600">
              ترخيص مصرفي رسمي وموثق · صرافة وخدمات مالية
            </div>
          </div>
        </div>

        {/* Left Info: Document & Voucher Number */}
        <div className="text-left text-slate-800 space-y-0.5 min-w-[90px] sm:min-w-[130px]" dir="ltr">
          <div className="text-[9px] sm:text-[10.5px] text-slate-600 font-bold">
            NO: <span className="font-mono font-black text-slate-900 text-xs sm:text-sm">{voucher.voucherNumber}</span>
          </div>
          {voucher.referenceNumber && (
            <div className="text-[8.5px] sm:text-[9.5px] text-slate-500 font-mono">
              REF: {voucher.referenceNumber}
            </div>
          )}
          <div className="text-[8px] sm:text-[9px] text-emerald-800 font-bold bg-emerald-50 border border-emerald-300 rounded px-1 inline-block">
            معتمد بالنظام
          </div>
        </div>
      </div>

      {/* Center Title Ribbon */}
      <div className="flex items-center justify-center my-1.5">
        <div className="bg-[#800000] text-white px-5 sm:px-8 py-1 rounded-md shadow-xs flex items-center justify-center gap-2">
          <span className={`${isA5 ? 'text-xs sm:text-sm font-black' : 'text-xs sm:text-base font-black'} tracking-wider text-center`}>
            {title}
          </span>
        </div>
      </div>
    </div>
  );
};
