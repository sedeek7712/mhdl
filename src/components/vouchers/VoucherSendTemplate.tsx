import React from 'react';
import { OfficialVoucher, PaperSize, SUPPORTED_CURRENCIES } from '../../types/exchange';
import { formatMoney, tafqeetArabic } from '../../services/accountingEngine';
import { VoucherHeader } from './VoucherHeader';

interface VoucherSendTemplateProps {
  voucher: OfficialVoucher;
  domRef?: React.RefObject<HTMLDivElement | null>;
  paperSize?: PaperSize;
  isReprint?: boolean;
}

export const VoucherSendTemplate: React.FC<VoucherSendTemplateProps> = ({
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

  const senderName = voucher.senderName || voucher.partyName || 'المرسل';
  const senderPhone = voucher.partyPhone || '—';
  const recipientName = voucher.recipientName || 'المستلم';
  const recipientPhone = voucher.recipientPhone || '—';
  const networkName = voucher.networkName || 'شبكة النجم للحوالات';
  const destination = voucher.destinationCity || voucher.destinationBranch || 'الجمهورية اليمنية وكافة المحافظات';
  const commission = voucher.commission || 0;
  const totalPaid = voucher.totalPaid || (voucher.amount + commission);
  const transferNum = voucher.referenceNumber || voucher.voucherNumber || '—';

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
        title="سند إرسال حوالة"
        paperSize={paperSize}
        isReprint={isReprint}
      />

      {/* Primary Details Bar (رقم السند، رقم الحوالة، تاريخ ووقت الإرسال) */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2 mb-2 font-semibold">
        <div className="border border-slate-700 rounded-lg p-1.5 bg-slate-50 flex items-center justify-between">
          <span className="text-slate-600 text-[10px] sm:text-xs">رقم السند:</span>
          <span className="font-mono font-black text-slate-950 text-xs sm:text-sm">{voucher.voucherNumber}</span>
        </div>
        <div className="border border-slate-700 rounded-lg p-1.5 bg-slate-50 flex items-center justify-between">
          <span className="text-slate-600 text-[10px] sm:text-xs">رقم الحوالة:</span>
          <span className="font-mono font-black text-[#800000] text-xs sm:text-sm">{transferNum}</span>
        </div>
        <div className="border border-slate-700 rounded-lg p-1.5 bg-slate-50 flex items-center justify-between">
          <span className="text-slate-600 text-[10px] sm:text-xs">تاريخ ووقت الإرسال:</span>
          <span className="font-mono font-bold text-slate-950 text-[10px] sm:text-xs">{formattedDate} {voucher.time}</span>
        </div>
      </div>

      {/* Sender, Recipient & Route Grid */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        {/* Sender Box */}
        <div className="border border-slate-700 rounded-lg p-2 bg-slate-50/70 space-y-1">
          <div className="text-[10px] sm:text-xs font-black text-[#800000] border-b border-slate-300 pb-0.5">
            بيانات المرسل
          </div>
          <div className="flex justify-between items-center text-slate-900">
            <span className="text-slate-600 text-[10px]">الاسم:</span>
            <span className="font-black text-slate-950 truncate max-w-[170px]">{senderName}</span>
          </div>
          <div className="flex justify-between items-center text-slate-900">
            <span className="text-slate-600 text-[10px]">الهاتف:</span>
            <span className="font-mono font-bold text-slate-900">{senderPhone}</span>
          </div>
        </div>

        {/* Recipient Box */}
        <div className="border border-slate-700 rounded-lg p-2 bg-slate-50/70 space-y-1">
          <div className="text-[10px] sm:text-xs font-black text-[#800000] border-b border-slate-300 pb-0.5">
            بيانات المستلم (المستفيد)
          </div>
          <div className="flex justify-between items-center text-slate-900">
            <span className="text-slate-600 text-[10px]">الاسم:</span>
            <span className="font-black text-slate-950 truncate max-w-[170px]">{recipientName}</span>
          </div>
          <div className="flex justify-between items-center text-slate-900">
            <span className="text-slate-600 text-[10px]">الهاتف:</span>
            <span className="font-mono font-bold text-slate-900">{recipientPhone}</span>
          </div>
        </div>
      </div>

      {/* Network & Destination Strip */}
      <div className="border border-slate-700 rounded-lg p-1.5 bg-slate-100 flex items-center justify-between mb-2 text-[10.5px] sm:text-xs">
        <div>
          <span className="text-slate-600 font-bold">جهة أو شبكة التحويل: </span>
          <span className="font-black text-slate-900">{networkName}</span>
        </div>
        <div>
          <span className="text-slate-600 font-bold">بيانات الوجهة: </span>
          <span className="font-bold text-[#800000]">{destination}</span>
        </div>
      </div>

      {/* Financial Amounts Table (مبلغ الحوالة، عملة الحوالة، العمولة، إجمالي المدفوع) */}
      <div className="border-2 border-slate-800 rounded-lg overflow-hidden mb-2">
        <table className="w-full border-collapse text-center">
          <thead>
            <tr className="bg-[#800000] text-white font-bold text-[10px] sm:text-xs">
              <th className="p-1 sm:p-1.5 border-l border-slate-700">مبلغ الحوالة</th>
              <th className="p-1 sm:p-1.5 border-l border-slate-700">عملة الحوالة</th>
              <th className="p-1 sm:p-1.5 border-l border-slate-700">العمولة وأجور التحويل</th>
              <th className="p-1 sm:p-1.5 bg-[#600000]">إجمالي المبلغ المدفوع</th>
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
                {commission > 0
                  ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(commission)
                  : '0.00'}
              </td>
              <td className="p-1.5 text-[#800000] bg-rose-50/50 text-sm sm:text-base font-black">
                {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(totalPaid)} {curInfo.symbol}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tafqeet in Arabic Words */}
      <div className="w-full border border-slate-700 rounded-lg py-1.5 px-3 bg-slate-50 text-center mb-2.5">
        <span className="font-bold text-slate-700 text-[10px] sm:text-xs">مبلغ الحوالة كتابة: </span>
        <span className="font-black text-slate-950 text-xs sm:text-sm">
          فقط {tafqeetText.endsWith('لا غير') ? tafqeetText : `${tafqeetText} لا غير`}
        </span>
      </div>

      {/* Sender Declaration (إقرار المرسل المعتمد حرفياً) */}
      <div className="border border-rose-900/60 bg-rose-50/40 rounded-lg p-2 sm:p-2.5 mb-3 text-right">
        <div className="text-[10px] sm:text-xs font-black text-[#800000] mb-0.5">
          إقرار وتأكيد المرسل:
        </div>
        <p className="text-[10px] sm:text-xs text-slate-900 font-bold leading-relaxed">
          &quot;أقر أنا الموقع أدناه بتسليم المبلغ الموضح في هذا السند للمؤسسة، وأؤكد صحة بيانات المرسل والمستلم وبيانات الحوالة.&quot;
        </p>
      </div>

      {/* Signature & Seal Block (حقول التوقيع: اسم المرسل، توقيع المرسل، توقيع الموظف) */}
      <div className="grid grid-cols-3 gap-2 border-t-2 border-slate-700 pt-2 text-center">
        {/* Sender Signature Box */}
        <div className="border border-slate-400 rounded-lg p-2 bg-white flex flex-col justify-between min-h-[75px] sm:min-h-[85px]">
          <div className="text-[10px] sm:text-xs font-black text-[#800000]">
            اسم وتوقيع المرسل
          </div>
          <div className="text-[10px] sm:text-[11px] font-bold text-slate-800 truncate px-1">
            {senderName}
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
            ختم الإرسال المعتمد
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
