import React from 'react';
import { OfficialVoucher, PaperSize, SUPPORTED_CURRENCIES } from '../../types/exchange';
import { formatMoney, tafqeetArabic } from '../../services/accountingEngine';
import { VoucherHeader } from './VoucherHeader';

interface VoucherPayoutTemplateProps {
  voucher: OfficialVoucher;
  domRef?: React.RefObject<HTMLDivElement | null>;
  paperSize?: PaperSize;
  isReprint?: boolean;
}

export const VoucherPayoutTemplate: React.FC<VoucherPayoutTemplateProps> = ({
  voucher,
  domRef,
  paperSize = 'a4',
  isReprint = false,
}) => {
  const isA5 = paperSize === 'a5';
  const curInfo = SUPPORTED_CURRENCIES[voucher.currency] || {
    code: voucher.currency,
    nameAr: voucher.currency,
    symbol: voucher.currency,
  };

  const senderName = voucher.senderName || 'غير مسجل';
  const recipientName = voucher.recipientName || voucher.partyName || 'المستلم';
  const recipientIdType = voucher.recipientIdType || 'بطاقة شخصية ذكية';
  const recipientIdNumber = voucher.recipientIdNumber || voucher.accountNumber || 'تم التحقق من أصل الهوية';
  const payoutMethod = voucher.payoutMethod || 'نقداً من صندوق الكاشير';
  const commissionOrDiscount = voucher.commission || 0;
  const netPaidOut = voucher.netAmount || voucher.amount;
  const transferNum = voucher.referenceNumber || voucher.voucherNumber || '—';

  const tafqeetText = voucher.amountInWordsAr || tafqeetArabic(netPaidOut, voucher.currency);
  const formattedDate = voucher.date ? voucher.date.split('-').reverse().join('-') : '31-10-2026';

  return (
    <div
      ref={domRef}
      className={`bg-white text-slate-900 border-2 border-[#800000] rounded-xl p-3 sm:p-5 text-right shadow-sm select-none mx-auto printable-voucher-card ${
        isA5 ? 'max-w-[148mm] text-[11px]' : 'max-w-[210mm] text-xs'
      }`}
      style={{ fontFamily: "'Cairo', 'Tajawal', sans-serif" }}
      dir="rtl"
    >
      {/* Official Header */}
      <VoucherHeader
        voucher={voucher}
        title="سند صرف حوالة"
        paperSize={paperSize}
        isReprint={isReprint}
      />

      {/* Primary Details Bar (رقم السند، رقم الحوالة، تاريخ ووقت الصرف) */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2 mb-2 font-semibold">
        <div className="border border-slate-700 rounded-lg p-1.5 bg-slate-50 flex items-center justify-between">
          <span className="text-slate-600 text-[10px] sm:text-xs">رقم السند:</span>
          <span className="font-mono font-black text-slate-950 text-xs sm:text-sm">{voucher.voucherNumber}</span>
        </div>
        <div className="border border-slate-700 rounded-lg p-1.5 bg-slate-50 flex items-center justify-between">
          <span className="text-slate-600 text-[10px] sm:text-xs">رقم الحوالة:</span>
          <span className="font-mono font-bold text-slate-950 text-xs sm:text-sm">{transferNum}</span>
        </div>
        <div className="border border-slate-700 rounded-lg p-1.5 bg-slate-50 flex items-center justify-between">
          <span className="text-slate-600 text-[10px] sm:text-xs">تاريخ ووقت الصرف:</span>
          <span className="font-mono font-bold text-slate-950 text-[10px] sm:text-xs">{formattedDate} {voucher.time}</span>
        </div>
      </div>

      {/* Parties & KYC Details Table */}
      <div className="border border-slate-700 rounded-lg overflow-hidden mb-2">
        <table className="w-full border-collapse text-right">
          <tbody>
            <tr className="border-b border-slate-300 bg-slate-100/70">
              <td className="w-1/4 p-1.5 font-bold text-[#800000] border-l border-slate-300">اسم المرسل:</td>
              <td className="w-3/4 p-1.5 font-bold text-slate-900">{senderName}</td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="w-1/4 p-1.5 font-bold text-[#800000] border-l border-slate-300">اسم المستلم (المستفيد):</td>
              <td className="w-3/4 p-1.5 font-black text-slate-950">{recipientName}</td>
            </tr>
            <tr className="border-b border-slate-300 bg-slate-50">
              <td className="w-1/4 p-1.5 font-bold text-[#800000] border-l border-slate-300">إثبات هوية المستلم:</td>
              <td className="w-3/4 p-1.5 font-semibold text-slate-900">
                <span className="font-bold text-slate-950">{recipientIdType}:</span>{' '}
                <span className="font-mono font-bold text-[#800000] px-1 bg-white border border-slate-300 rounded">
                  {recipientIdNumber}
                </span>
              </td>
            </tr>
            <tr>
              <td className="w-1/4 p-1.5 font-bold text-[#800000] border-l border-slate-300">طريقة الصرف والتسليم:</td>
              <td className="w-3/4 p-1.5 font-bold text-slate-900">{payoutMethod}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Financial Amounts Table (مبلغ الحوالة، العملة، خصومات/عمولات، المبلغ المصروف) */}
      <div className="border-2 border-slate-800 rounded-lg overflow-hidden mb-2">
        <table className="w-full border-collapse text-center">
          <thead>
            <tr className="bg-[#800000] text-white font-bold text-[10px] sm:text-xs">
              <th className="p-1 sm:p-1.5 border-l border-slate-700">مبلغ الحوالة الأصلي</th>
              <th className="p-1 sm:p-1.5 border-l border-slate-700">العملة</th>
              <th className="p-1 sm:p-1.5 border-l border-slate-700">عمولات أو خصومات</th>
              <th className="p-1 sm:p-1.5 bg-[#600000]">المبلغ المصروف والمسلَّم</th>
            </tr>
          </thead>
          <tbody>
            <tr className="font-mono text-xs sm:text-sm font-black bg-white">
              <td className="p-1.5 border-l border-slate-300 text-slate-950">
                {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(voucher.amount)}
              </td>
              <td className="p-1.5 border-l border-slate-300 font-sans font-bold text-slate-900">
                {curInfo.nameAr} ({curInfo.symbol})
              </td>
              <td className="p-1.5 border-l border-slate-300 text-slate-800">
                {commissionOrDiscount > 0
                  ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(commissionOrDiscount)
                  : '0.00 (لا توجد خصومات)'}
              </td>
              <td className="p-1.5 text-emerald-800 bg-emerald-50/60 text-sm sm:text-base font-black">
                {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(netPaidOut)} {curInfo.symbol}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tafqeet in Arabic Words */}
      <div className="w-full border border-slate-700 rounded-lg py-1.5 px-3 bg-slate-50 text-center mb-2.5">
        <span className="font-bold text-slate-700 text-[10px] sm:text-xs">المبلغ المصروف كتابة: </span>
        <span className="font-black text-slate-950 text-xs sm:text-sm">
          فقط {tafqeetText.endsWith('لا غير') ? tafqeetText : `${tafqeetText} لا غير`}
        </span>
      </div>

      {/* Recipient Declaration (إقرار المستلم المعتمد حرفياً) */}
      <div className="border border-emerald-900/60 bg-emerald-50/40 rounded-lg p-2 sm:p-2.5 mb-3 text-right">
        <div className="text-[10px] sm:text-xs font-black text-emerald-900 mb-0.5">
          إقرار واستلام المستفيد القانوني:
        </div>
        <p className="text-[10px] sm:text-xs text-slate-900 font-bold leading-relaxed">
          &quot;أقر أنا الموقع أدناه باستلام مبلغ الحوالة الموضح في هذا السند كاملاً، وأتحمل مسؤولية صحة بيانات الاستلام.&quot;
        </p>
      </div>

      {/* Signature & Seal Block (حقول التوقيع: اسم المستلم، رقم الهوية، توقيع المستلم، توقيع الموظف) */}
      <div className="grid grid-cols-3 gap-2 border-t-2 border-slate-700 pt-2 text-center">
        {/* Recipient Signature Box with ID */}
        <div className="border border-slate-400 rounded-lg p-2 bg-white flex flex-col justify-between min-h-[75px] sm:min-h-[85px]">
          <div className="text-[10px] sm:text-xs font-black text-[#800000]">
            اسم وتوقيع المستلم
          </div>
          <div className="text-[10px] sm:text-[11px] font-bold text-slate-800 truncate px-1">
            {recipientName}
          </div>
          <div className="text-[9px] text-slate-600 font-mono truncate">
            الهوية: {recipientIdNumber}
          </div>
          <div className="border-b border-dashed border-slate-400 my-1"></div>
          <div className="text-[9px] text-slate-400 font-mono">التوقيع اليدوي بالقلم: ________________</div>
        </div>

        {/* Teller Signature Box */}
        <div className="border border-slate-400 rounded-lg p-2 bg-white flex flex-col justify-between min-h-[75px] sm:min-h-[85px]">
          <div className="text-[10px] sm:text-xs font-black text-[#800000]">
            توقيع الموظف الصارف
          </div>
          <div className="text-[10px] sm:text-[11px] font-bold text-slate-800 truncate px-1">
            {voucher.tellerName || 'صراف الوردية'}
          </div>
          <div className="border-b border-dashed border-slate-400 my-1"></div>
          <div className="text-[9px] text-slate-400 font-mono">التوقيع والاعتماد: ________________</div>
        </div>

        {/* Official Branch Stamp */}
        <div className="border border-slate-400 rounded-lg p-2 bg-white flex flex-col items-center justify-center min-h-[75px] sm:min-h-[85px]">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 border-dashed border-[#800000]/60 flex items-center justify-center text-center p-1 text-[8.5px] sm:text-[9.5px] font-bold text-[#800000]/80">
            ختم الصرف المعتمد
          </div>
        </div>
      </div>

      {/* Footer Legal & Customer Care Bar */}
      <div className="mt-2.5 pt-1.5 border-t border-slate-200 text-center text-[8.5px] sm:text-[10px] text-slate-600 flex items-center justify-between">
        <span>مؤسسة عمرو النماري للصرافة والتحويلات · تعز - مديرية خدير</span>
        <span>خدمة العملاء المباشرة: <strong dir="ltr" className="font-mono text-slate-900">+967 771910197</strong></span>
      </div>
    </div>
  );
};
