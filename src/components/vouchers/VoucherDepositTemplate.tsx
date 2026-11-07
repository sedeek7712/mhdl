import React from 'react';
import { OfficialVoucher, PaperSize, SUPPORTED_CURRENCIES } from '../../types/exchange';
import { formatMoney, tafqeetArabic } from '../../services/accountingEngine';
import { VoucherHeader } from './VoucherHeader';

interface VoucherDepositTemplateProps {
  voucher: OfficialVoucher;
  domRef?: React.RefObject<HTMLDivElement | null>;
  paperSize?: PaperSize;
  isReprint?: boolean;
}

export const VoucherDepositTemplate: React.FC<VoucherDepositTemplateProps> = ({
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

  const depositorName = voucher.depositorName || voucher.senderName || voucher.partyName || 'العميل المودع';
  const beneficiaryName = voucher.recipientName || voucher.partyName || 'المستفيد';
  const feeAmount = voucher.commission || 0;
  const totalReceived = voucher.totalPaid || (voucher.amount + feeAmount);
  const depositMethod = voucher.depositMethod || 'نقداً عبر صندوق الصراف';
  const transferNum = voucher.referenceNumber || voucher.generalNumber || '—';

  const tafqeetText = voucher.amountInWordsAr || tafqeetArabic(voucher.amount, voucher.currency);
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
        title="سند إيداع حوالة"
        paperSize={paperSize}
        isReprint={isReprint}
      />

      {/* Primary Details Grid (رقم السند، رقم الحوالة، التاريخ والوقت) */}
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
          <span className="text-slate-600 text-[10px] sm:text-xs">التاريخ والوقت:</span>
          <span className="font-mono font-bold text-slate-950 text-[10px] sm:text-xs">{formattedDate} {voucher.time}</span>
        </div>
      </div>

      {/* Depositor & Beneficiary Table */}
      <div className="border border-slate-700 rounded-lg overflow-hidden mb-2">
        <table className="w-full border-collapse text-right">
          <tbody>
            <tr className="border-b border-slate-300 bg-slate-100/70">
              <td className="w-1/4 p-1.5 font-bold text-[#800000] border-l border-slate-300">اسم العميل المودع:</td>
              <td className="w-3/4 p-1.5 font-black text-slate-950">{depositorName}</td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="w-1/4 p-1.5 font-bold text-[#800000] border-l border-slate-300">اسم المستفيد:</td>
              <td className="w-3/4 p-1.5 font-black text-slate-950">{beneficiaryName}</td>
            </tr>
            <tr>
              <td className="w-1/4 p-1.5 font-bold text-[#800000] border-l border-slate-300">طريقة استلام المبلغ:</td>
              <td className="w-3/4 p-1.5 font-bold text-slate-900">{depositMethod}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Financial Amounts Table (مبلغ الإيداع، العملة، العمولة، إجمالي المستلم) */}
      <div className="border-2 border-slate-800 rounded-lg overflow-hidden mb-2">
        <table className="w-full border-collapse text-center">
          <thead>
            <tr className="bg-[#800000] text-white font-bold text-[10px] sm:text-xs">
              <th className="p-1 sm:p-1.5 border-l border-slate-700">مبلغ الإيداع</th>
              <th className="p-1 sm:p-1.5 border-l border-slate-700">العملة</th>
              <th className="p-1 sm:p-1.5 border-l border-slate-700">أجور / عمولة</th>
              <th className="p-1 sm:p-1.5 bg-[#600000]">إجمالي المبلغ المستلم</th>
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
                {feeAmount > 0 ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(feeAmount) : '0.00'}
              </td>
              <td className="p-1.5 text-[#800000] bg-rose-50/50 text-sm sm:text-base font-black">
                {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(totalReceived)} {curInfo.symbol}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tafqeet in Arabic Words */}
      <div className="w-full border border-slate-700 rounded-lg py-1.5 px-3 bg-slate-50 text-center mb-2.5">
        <span className="font-bold text-slate-700 text-[10px] sm:text-xs">المبلغ كتابة: </span>
        <span className="font-black text-slate-950 text-xs sm:text-sm">
          فقط {tafqeetText.endsWith('لا غير') ? tafqeetText : `${tafqeetText} لا غير`}
        </span>
      </div>

      {/* Customer Declaration (إقرار العميل المعتمد حرفياً) */}
      <div className="border border-rose-900/60 bg-rose-50/40 rounded-lg p-2 sm:p-2.5 mb-3 text-right">
        <div className="text-[10px] sm:text-xs font-black text-[#800000] mb-0.5">
          إقرار وتعهد العميل المودع:
        </div>
        <p className="text-[10px] sm:text-xs text-slate-900 font-bold leading-relaxed">
          &quot;أقر أنا الموقع أدناه بصحة بيانات الإيداع وتسليم المبلغ الموضح في هذا السند للمؤسسة.&quot;
        </p>
      </div>

      {/* Signature & Seal Block (مربعات توقيع واسعة للتوقيع اليدوي بالقلم) */}
      <div className="grid grid-cols-3 gap-2 border-t-2 border-slate-700 pt-2 text-center">
        {/* Depositor Signature Box */}
        <div className="border border-slate-400 rounded-lg p-2 bg-white flex flex-col justify-between min-h-[75px] sm:min-h-[85px]">
          <div className="text-[10px] sm:text-xs font-black text-[#800000]">
            اسم وتوقيع المودع
          </div>
          <div className="text-[10px] sm:text-[11px] font-bold text-slate-800 truncate px-1">
            {depositorName}
          </div>
          <div className="border-b border-dashed border-slate-400 my-1"></div>
          <div className="text-[9px] text-slate-400 font-mono">التوقيع اليدوي بالقلم: ________________</div>
        </div>

        {/* Teller Signature Box */}
        <div className="border border-slate-400 rounded-lg p-2 bg-white flex flex-col justify-between min-h-[75px] sm:min-h-[85px]">
          <div className="text-[10px] sm:text-xs font-black text-[#800000]">
            توقيع الموظف المسؤول
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
            ختم الفرع المعتمد
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
