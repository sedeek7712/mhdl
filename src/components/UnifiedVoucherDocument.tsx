import React from 'react';
import { OfficialVoucher, SUPPORTED_CURRENCIES } from '../types/exchange';
import { formatMoney, tafqeetArabic } from '../services/accountingEngine';
import { ALNAMARI_LOGO_BASE64 } from '../assets/logoBase64';

interface UnifiedVoucherDocumentProps {
  voucher: OfficialVoucher;
  domRef?: React.RefObject<HTMLDivElement | null>;
  isPrintView?: boolean;
}

export const UnifiedVoucherDocument: React.FC<UnifiedVoucherDocumentProps> = ({
  voucher,
  domRef,
  isPrintView = false,
}) => {
  const curInfo = SUPPORTED_CURRENCIES[voucher.currency] || {
    code: voucher.currency,
    nameAr: voucher.currency,
    symbol: voucher.currency,
  };
  const targetCurInfo = voucher.receivedCurrency
    ? SUPPORTED_CURRENCIES[voucher.receivedCurrency] || {
        code: voucher.receivedCurrency,
        nameAr: voucher.receivedCurrency,
        symbol: voucher.receivedCurrency,
      }
    : null;

  // Determine specific voucher type
  const isIncoming = voucher.type === 'transfer_incoming';
  const isExchange = voucher.type === 'exchange';
  const isOutgoing = voucher.type === 'transfer_outgoing';

  // First-class structured fields directly from VoucherEngine
  const sender = voucher.senderName ?? (isOutgoing ? voucher.partyName : '') ?? '';
  const recipient = voucher.recipientName !== undefined && voucher.recipientName !== null
    ? voucher.recipientName
    : (isIncoming ? voucher.partyName : '');
  const network = voucher.networkName || voucher.branchName || 'شركة تحويل للصرافة';

  // Format numbers & identifiers
  const documentNumber = voucher.voucherNumber || '62022';
  const transferNumber = voucher.referenceNumber || voucher.voucherNumber || '5511405078';
  const generalNumber = voucher.generalNumber || `${transferNumber}/1211005`;
  const formattedDate = voucher.date
    ? voucher.date.split('-').reverse().join('-')
    : '31-10-2026';
  const accountNumber = voucher.accountNumber || '1236334';

  // 1. Title text for center red pill
  const getTitleText = () => {
    if (isIncoming) return 'سند استلام حوالة';
    if (isExchange) return 'سند صرف عملة';
    if (isOutgoing) return 'سند إصدار حوالة';
    return 'سند إشعار دائن';
  };

  // 2. Client label & value
  const getClientLabel = () => {
    return 'عميلنا';
  };

  const getClientName = () => {
    if (isOutgoing) return sender;
    if (isIncoming) return recipient;
    return voucher.partyName || 'عمرو محمد سالم محمد النماري';
  };

  const getAccountLabel = () => {
    if (isOutgoing) return 'رقم الهاتف :';
    return 'رقم الحساب :';
  };

  const getAccountValue = () => {
    if (isOutgoing) return voucher.partyPhone || voucher.recipientPhone || accountNumber;
    return accountNumber;
  };

  // 3. Sub-notice line
  const getSubNotice = () => {
    if (isIncoming) {
      return 'نود إشعاركم أننا قيدنا لحسابكم لدينا حسب التفاصيل التالية:';
    }
    if (isExchange) {
      return 'نود إشعاركم بأنه تم تنفيذ عملية صرافة عملات لحسابكم كالتالي:';
    }
    if (isOutgoing) {
      return 'نود إشعاركم بأنه تم إصدار وإرسال حوالتكم بنجاح حسب التفاصيل التالية:';
    }
    return 'نود إشعاركم أننا قيدنا لحسابكم لدينا حسب التفاصيل التالية:';
  };

  // 4. Row 4 Headers (amount & currency)
  const getAmountHeader = () => {
    if (isExchange) return 'المبلغ المسلَّم';
    if (isOutgoing) return 'مبلغ الحوالة';
    return 'مبلغ الحساب';
  };

  const getCurrencyHeader = () => {
    if (isExchange) return 'المبلغ المقبوض';
    if (isOutgoing) return 'عملة الحوالة';
    return 'عملة الحساب';
  };

  // 5. Row 5 Values (amount & currency)
  const getAmountValue = () => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: isExchange ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(voucher.amount);
  };

  const getCurrencyValue = () => {
    if (isExchange && voucher.receivedAmount && targetCurInfo) {
      return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(voucher.receivedAmount)} ${targetCurInfo.nameAr}`;
    }
    return curInfo.nameAr;
  };

  // 6. Tafqeet text
  const getTafqeetText = () => {
    const raw = voucher.amountInWordsAr || tafqeetArabic(voucher.amount, voucher.currency);
    return raw.endsWith('لا غير') ? raw : `${raw} لا غير`;
  };

  // 7. Statement Row 8 Details
  const getStatementCol1Line1Label = () => 'رقم الحوالة:';
  const getStatementCol1Line1Value = () => (isExchange ? voucher.referenceNumber || documentNumber : transferNumber);

  const getStatementCol1Line2Label = () => {
    if (isOutgoing) return 'المستفيد:';
    if (isIncoming) return 'المستلم:';
    return 'العميل:';
  };
  const getStatementCol1Line2Value = () => {
    if (isOutgoing) return recipient;
    if (isIncoming) return recipient;
    return voucher.partyName || '';
  };

  const getStatementCol2Line1Label = () => {
    if (isOutgoing) return 'شبكة التحويل:';
    if (isIncoming) return 'المصدر:';
    return 'سعر الصرف المعتمد:';
  };
  const getStatementCol2Line1Value = () => {
    if (isExchange) return `${voucher.exchangeRate || 1.0}`;
    return network;
  };

  const getStatementCol2Line2Label = () => {
    if (isExchange) return 'طريقة الدفع:';
    return 'المرسل:';
  };
  const getStatementCol2Line2Value = () => {
    if (isExchange) return 'نقداً من الصندوق';
    return sender;
  };

  return (
    <div
      ref={domRef}
      className={`bg-white text-slate-900 border-2 border-[#800000] rounded-2xl p-3 sm:p-4 text-right shadow-sm select-none ${
        isPrintView ? 'max-w-2xl w-full mx-auto' : 'max-w-xl w-full mx-auto'
      }`}
      style={{ fontFamily: "'Cairo', 'Tajawal', sans-serif" }}
      dir="rtl"
    >
      {/* ======================================================== */}
      {/* BRAND HEADER: شِعَار الدِّرْع وَالْهُوِيَّة الْبَصَرِيَّة الرَّسْمِيَّة لِعَمْرُو النَّمَارِي */}
      {/* ======================================================== */}
      <div className="flex items-center justify-center gap-3 sm:gap-4 pb-2.5 sm:pb-3 mb-2.5 border-b-2 border-[#800000]" dir="ltr">
        {/* 1. Official Shield Logo (Left) */}
        <div className="w-13 h-13 sm:w-16 sm:h-16 md:w-20 md:h-20 shrink-0 flex items-center justify-center">
          <img
            src={ALNAMARI_LOGO_BASE64}
            alt="شعار درع عمرو النماري"
            className="w-full h-full object-contain filter drop-shadow-xs"
          />
        </div>

        {/* 2. Vertical Divider Bar (Center) */}
        <div className="w-[2px] sm:w-[2.5px] h-11 sm:h-14 md:h-16 bg-[#800000] rounded-full shrink-0" />

        {/* 3. Typography Block (Right) */}
        <div className="flex flex-col text-center justify-center select-none" dir="rtl">
          <h1 className="text-base sm:text-xl md:text-2xl font-black text-[#800000] tracking-tight leading-tight">
            عَمرو النَّماري للصرافة والتحويلات
          </h1>
          <div className="text-[#8c331a] font-black tracking-wider sm:tracking-widest text-[9px] sm:text-xs md:text-sm leading-tight mt-0.5 sm:mt-1 uppercase font-sans">
            <div>AMRO ALNAMARI</div>
            <div>EXCHANGE &amp; REMITTANCES</div>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* VOUCHER TABLE: MATCHES REFERENCE IMAGE EXACTLY (8 ROWS) */}
      {/* ======================================================== */}
      <div className="space-y-1.5 sm:space-y-2">
        {/* ROW 1: [رقم المستند] | [عنوان السند الأحمر] | [التاريخ] */}
        <div className="flex items-stretch gap-1.5 sm:gap-2">
          {/* Right Box: رقم المستند */}
          <div className="w-[28%] sm:w-[26%] border border-slate-800 rounded-lg py-1 px-1.5 flex items-center justify-center gap-1 bg-white text-[10px] sm:text-xs">
            <span className="font-bold text-slate-800">رقم المستند :</span>
            <span className="font-bold font-mono text-slate-900">{documentNumber}</span>
          </div>

          {/* Center Box: عنوان السند الموحد بخلفية حمراء كاملة */}
          <div className="flex-1 bg-[#800000] text-white rounded-lg py-1 sm:py-1.5 px-2 flex items-center justify-center shadow-xs">
            <span className="font-black text-xs sm:text-base tracking-wide text-center">
              {getTitleText()}
            </span>
          </div>

          {/* Left Box: التاريخ */}
          <div className="w-[28%] sm:w-[26%] border border-slate-800 rounded-lg py-1 px-1.5 flex items-center justify-center gap-1 bg-white text-[10px] sm:text-xs">
            <span className="font-bold text-slate-800">التاريخ :</span>
            <span className="font-bold font-mono text-slate-900">{formattedDate}</span>
          </div>
        </div>

        {/* ROW 2: [عميلنا] | [اسم العميل] | [رقم الحساب / الهاتف] | [القيمة] */}
        <div className="flex items-stretch gap-1.5 sm:gap-2 text-[10px] sm:text-xs">
          {/* 1. Box Rightmost: عميلنا */}
          <div className="w-[14%] sm:w-[13%] border border-slate-800 rounded-lg py-1 px-1 flex items-center justify-center bg-white text-[#800000] font-black shrink-0">
            {getClientLabel()}
          </div>

          {/* 2. Box Center-Right: اسم العميل */}
          <div className="flex-1 border border-slate-800 rounded-lg py-1 px-2 flex items-center justify-center bg-white font-black text-slate-900 overflow-hidden">
            <span className="truncate max-w-full text-center leading-tight">
              {getClientName()}
            </span>
          </div>

          {/* 3. Box Center-Left: رقم الحساب : */}
          <div className="w-[20%] sm:w-[19%] border border-slate-800 rounded-lg py-1 px-1 flex items-center justify-center bg-white text-[#800000] font-bold shrink-0">
            {getAccountLabel()}
          </div>

          {/* 4. Box Leftmost: رقم الحساب */}
          <div className="w-[18%] sm:w-[17%] border border-slate-800 rounded-lg py-1 px-1 flex items-center justify-center bg-white font-black font-mono text-slate-900 shrink-0">
            {getAccountValue()}
          </div>
        </div>

        {/* ROW 3: نود إشعاركم أننا قيدنا لحسابكم لدينا حسب التفاصيل التالية */}
        <div className="w-full border border-slate-800 rounded-lg py-1 px-2 text-center bg-white font-black text-slate-900 text-[10px] sm:text-xs leading-tight">
          {getSubNotice()}
        </div>

        {/* ROW 4: رئيستا جدول المبالغ (مبلغ الحساب | عملة الحساب) */}
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
          {/* Right Header Box */}
          <div className="border border-slate-800 rounded-lg py-0.5 sm:py-1 px-2 text-center bg-white font-bold text-[#800000] text-[10px] sm:text-xs">
            {getAmountHeader()}
          </div>

          {/* Left Header Box */}
          <div className="border border-slate-800 rounded-lg py-0.5 sm:py-1 px-2 text-center bg-white font-bold text-[#800000] text-[10px] sm:text-xs">
            {getCurrencyHeader()}
          </div>
        </div>

        {/* ROW 5: قيم المبالغ والعملات (القيم المحددة) */}
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
          {/* Right Value Box */}
          <div className="border border-slate-800 rounded-lg py-1 sm:py-1.5 px-2 text-center bg-white font-black font-mono text-xs sm:text-base text-slate-950 flex items-center justify-center">
            {getAmountValue()}
          </div>

          {/* Left Value Box */}
          <div className="border border-slate-800 rounded-lg py-1 sm:py-1.5 px-2 text-center bg-white font-black text-xs sm:text-sm text-slate-900 flex items-center justify-center">
            {getCurrencyValue()}
          </div>
        </div>

        {/* ROW 6: التفقيط باللغة العربية */}
        <div className="w-full border border-slate-800 rounded-lg py-1 px-2 text-center bg-white font-black text-slate-900 text-[10px] sm:text-xs leading-tight">
          {getTafqeetText()}
        </div>

        {/* ROW 7: عنوان البيان */}
        <div className="w-full border border-slate-800 rounded-lg py-0.5 px-2 text-center bg-white font-black text-[#800000] text-[10px] sm:text-xs">
          البيان
        </div>

        {/* ROW 8: تفاصيل البيان (عمودان + الرقم العام في الأسفل) */}
        <div className="w-full border border-slate-800 rounded-lg p-2 sm:p-2.5 bg-white text-[9.5px] sm:text-[11px] leading-relaxed">
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {/* Right Column in RTL */}
            <div className="space-y-0.5">
              <div className="flex items-center gap-1 overflow-hidden">
                <span className="font-bold text-slate-900 shrink-0">
                  {getStatementCol1Line1Label()}
                </span>
                <span className="font-bold font-mono text-slate-900 truncate">
                  {getStatementCol1Line1Value()}
                </span>
              </div>
              <div className="flex items-center gap-1 overflow-hidden">
                <span className="font-bold text-slate-900 shrink-0">
                  {getStatementCol1Line2Label()}
                </span>
                <span className="font-bold text-slate-900 truncate">
                  {getStatementCol1Line2Value()}
                </span>
              </div>
            </div>

            {/* Left Column in RTL */}
            <div className="space-y-0.5">
              <div className="flex items-center gap-1 overflow-hidden">
                <span className="font-bold text-slate-900 shrink-0">
                  {getStatementCol2Line1Label()}
                </span>
                <span className="font-bold text-slate-900 truncate">
                  {getStatementCol2Line1Value()}
                </span>
              </div>
              <div className="flex items-center gap-1 overflow-hidden">
                <span className="font-bold text-slate-900 shrink-0">
                  {getStatementCol2Line2Label()}
                </span>
                <span className="font-bold text-slate-900 truncate">
                  {getStatementCol2Line2Value()}
                </span>
              </div>
            </div>
          </div>

          {/* Centered General Number at the bottom of Row 8 */}
          <div className="text-center font-bold font-mono text-slate-900 mt-1.5 pt-1 border-t border-slate-200/80 text-[9px] sm:text-[10px]">
            /الرقم العام {generalNumber}
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* VOUCHER FOOTER & NOTICE BADGE */}
      {/* ======================================================== */}
      <div className="flex justify-center mt-2.5">
        <span className="bg-[#800000] text-white text-[9px] sm:text-[10.5px] px-6 py-0.5 rounded-full font-bold shadow-xs">
          هذا الإشعار آلي ولا يحتاج ختم أو توقيع
        </span>
      </div>

      <div className="text-center font-bold text-slate-900 text-[8.5px] sm:text-[10.5px] mt-2 leading-tight select-none" dir="rtl">
        عمرو النماري للصرافة والتحويلات - تعز - مديرية خدير - خدمة العملاء: <span dir="ltr" className="font-mono font-bold">+967 771910197</span>
      </div>
    </div>
  );
};
