import React from 'react';
import { OfficialVoucher, PaperSize, SUPPORTED_CURRENCIES } from '../../types/exchange';
import { formatMoney, tafqeetArabic } from '../../services/accountingEngine';

interface ThermalVoucherTemplateProps {
  voucher: OfficialVoucher;
  domRef?: React.RefObject<HTMLDivElement | null>;
  paperSize?: 'thermal_80mm' | 'thermal_58mm';
  isReprint?: boolean;
}

export const ThermalVoucherTemplate: React.FC<ThermalVoucherTemplateProps> = ({
  voucher,
  domRef,
  paperSize = 'thermal_80mm',
  isReprint = false,
}) => {
  const is58mm = paperSize === 'thermal_58mm';
  const showReprint = isReprint || (voucher.printCount && voucher.printCount > 1);

  const curInfo = SUPPORTED_CURRENCIES[voucher.currency] || {
    code: voucher.currency,
    nameAr: voucher.currency,
    symbol: voucher.currency,
  };

  // Determine template variant and title
  const isDeposit = voucher.templateType === 'deposit' || voucher.type === 'receipt';
  const isPayout = voucher.templateType === 'payout' || voucher.type === 'transfer_incoming';
  const isSend = voucher.templateType === 'send' || voucher.type === 'transfer_outgoing';
  const isExchange = voucher.type === 'exchange';

  let voucherTitle = 'سند مالي رسمي';
  let declarationText = 'أقر أنا الموقع أدناه بصحة البيانات وتسليم/استلام المبلغ كاملاً.';
  let partyLabel = 'العميل:';
  let partyName = voucher.partyName || '';

  if (isDeposit) {
    voucherTitle = 'سند إيداع حوالة';
    declarationText = 'أقر أنا الموقع أدناه بصحة بيانات الإيداع وتسليم المبلغ الموضح في هذا السند للمؤسسة.';
    partyLabel = 'المودع:';
    partyName = voucher.depositorName || voucher.senderName || voucher.partyName || '';
  } else if (isPayout) {
    voucherTitle = 'سند صرف حوالة';
    declarationText = 'أقر أنا الموقع أدناه باستلام مبلغ الحوالة الموضح في هذا السند كاملاً، وأتحمل مسؤولية صحة بيانات الاستلام.';
    partyLabel = 'المستلم:';
    partyName = voucher.recipientName || voucher.partyName || '';
  } else if (isSend) {
    voucherTitle = 'سند إرسال حوالة';
    declarationText = 'أقر أنا الموقع أدناه بتسليم المبلغ الموضح في هذا السند للمؤسسة، وأؤكد صحة بيانات المرسل والمستلم وبيانات الحوالة.';
    partyLabel = 'المرسل:';
    partyName = voucher.senderName || voucher.partyName || '';
  } else if (isExchange) {
    voucherTitle = 'سند صرف عملة';
    declarationText = 'أقر أنا الموقع أدناه بصحة بيانات واستلام مبالغ الصرافة الموضحة أعلاه كاملاً.';
    partyLabel = 'العميل:';
    partyName = voucher.partyName || '';
  }

  const transferNum = voucher.referenceNumber || voucher.voucherNumber;
  const tafqeetText = voucher.amountInWordsAr || tafqeetArabic(voucher.amount, voucher.currency);

  return (
    <div
      ref={domRef}
      className={`bg-white text-slate-950 font-mono mx-auto p-2 sm:p-3 border-2 border-dashed border-slate-400 select-none printable-voucher-card ${
        is58mm ? 'max-w-[58mm] text-[9.5px]' : 'max-w-[80mm] text-[11px]'
      }`}
      style={{ fontFamily: "'Cairo', 'Courier New', monospace" }}
      dir="rtl"
    >
      {/* Brand Header */}
      <div className="text-center border-b-2 border-slate-900 pb-1.5 mb-1.5 space-y-0.5">
        <div className={`font-black font-sans leading-tight ${is58mm ? 'text-[11px]' : 'text-xs sm:text-sm'}`}>
          مؤسسة عمرو النماري للصرافة
        </div>
        <div className="text-[8px] font-sans text-slate-700 tracking-wider">
          AMRO ALNAMARI EXCHANGE
        </div>
        <div className="text-[8px] text-slate-600 font-sans">
          {voucher.branchName || 'فرع تعز - مديرية خدير'}
        </div>
      </div>

      {/* Reprint Banner on Thermal */}
      {showReprint && (
        <div className="text-center font-black border border-black bg-slate-100 py-0.5 mb-1.5 text-[9px] font-sans">
          *** نسخة إعادة طباعة (رقم {voucher.printCount || 2}) ***
          {voucher.reprintReason && (
            <div className="text-[7.5px] font-normal">السبب: {voucher.reprintReason}</div>
          )}
        </div>
      )}

      {/* Voucher Title */}
      <div className="text-center font-black border-t border-b border-dashed border-slate-800 py-1 font-sans text-[11px]">
        {voucherTitle}
      </div>

      {/* Meta details */}
      <div className="py-1.5 space-y-0.5 border-b border-dashed border-slate-300 leading-tight">
        <div className="flex justify-between items-center">
          <span className="text-slate-600">رقم السند:</span>
          <span className="font-bold">{voucher.voucherNumber}</span>
        </div>
        {transferNum && (
          <div className="flex justify-between items-center">
            <span className="text-slate-600">رقم الحوالة:</span>
            <span className="font-bold font-mono">{transferNum}</span>
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="text-slate-600">التاريخ والوقت:</span>
          <span>{voucher.date} {voucher.time}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-slate-600">{partyLabel}</span>
          <span className="font-bold truncate max-w-[150px] font-sans">{partyName}</span>
        </div>
        {voucher.partyPhone && (
          <div className="flex justify-between items-center">
            <span className="text-slate-600">الهاتف:</span>
            <span>{voucher.partyPhone}</span>
          </div>
        )}
        {/* If Payout: show Recipient ID */}
        {isPayout && (
          <div className="flex justify-between items-center">
            <span className="text-slate-600">رقم الهوية:</span>
            <span className="font-bold">{voucher.recipientIdNumber || voucher.accountNumber || 'تم التحقق من الأصل'}</span>
          </div>
        )}
        {/* If Outgoing Send: show Recipient details */}
        {isSend && (
          <>
            <div className="flex justify-between items-center">
              <span className="text-slate-600">المستفيد:</span>
              <span className="font-bold truncate max-w-[150px] font-sans">{voucher.recipientName || '—'}</span>
            </div>
            {voucher.recipientPhone && (
              <div className="flex justify-between items-center">
                <span className="text-slate-600">هاتف المستفيد:</span>
                <span>{voucher.recipientPhone}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-slate-600">الشبكة:</span>
              <span className="font-sans font-bold">{voucher.networkName || 'شبكة النجم'}</span>
            </div>
          </>
        )}
        <div className="flex justify-between items-center">
          <span className="text-slate-600">الصراف:</span>
          <span className="font-sans">{voucher.tellerName || 'صراف الوردية'}</span>
        </div>
      </div>

      {/* Primary Financial Amount Box */}
      <div className="py-2 text-center border-b-2 border-slate-900 space-y-0.5">
        <div className="text-[9px] text-slate-600 font-sans">
          {isPayout ? 'المبلغ المصروف:' : isDeposit ? 'مبلغ الإيداع:' : 'مبلغ العملية:'}
        </div>
        <div className="text-sm sm:text-base font-black">
          {formatMoney(voucher.amount, voucher.currency)}
        </div>
        <div className="text-[8.5px] font-sans leading-tight text-slate-800">
          فقط {tafqeetText.endsWith('لا غير') ? tafqeetText : `${tafqeetText} لا غير`}
        </div>
        {voucher.commission && voucher.commission > 0 ? (
          <div className="text-[8.5px] text-slate-700 pt-0.5">
            العمولة: {formatMoney(voucher.commission, voucher.currency)} | الإجمالي: {formatMoney(voucher.totalPaid || voucher.amount + voucher.commission, voucher.currency)}
          </div>
        ) : null}
      </div>

      {/* Customer Declaration (إقرار العميل المعتمد) */}
      <div className="my-1.5 p-1 border border-slate-500 rounded bg-slate-50 text-[8px] sm:text-[8.5px] font-sans leading-tight text-slate-900 text-right">
        <strong>إقرار العميل: </strong>{declarationText}
      </div>

      {/* Signature Lines (مساحة عملية مخصصة للتوقيع اليدوي) */}
      <div className="space-y-2 pt-1 border-t border-dashed border-slate-400 font-sans">
        <div className="text-right">
          <div className="flex justify-between text-[8.5px]">
            <span>توقيع العميل:</span>
            <span className="font-bold truncate max-w-[120px]">{partyName}</span>
          </div>
          <div className="border-b border-black h-5 mb-1"></div>
        </div>

        <div className="text-right">
          <div className="flex justify-between text-[8.5px]">
            <span>توقيع الموظف المسؤول:</span>
            <span>{voucher.tellerName || 'الكاشير'}</span>
          </div>
          <div className="border-b border-black h-5"></div>
        </div>
      </div>

      {/* QR & Barcode Cut Notice */}
      <div className="text-center pt-2 mt-2 border-t border-dashed border-slate-400 space-y-1">
        <div className="text-[8px] text-slate-600 font-sans">
          خدمة العملاء: +967 771910197 · احتفظ بالإيصال
        </div>
        <div className="text-[7.5px] text-slate-400 font-mono">
          - - - - - - - قـطـع الإيـصـال - - - - - - -
        </div>
      </div>
    </div>
  );
};
