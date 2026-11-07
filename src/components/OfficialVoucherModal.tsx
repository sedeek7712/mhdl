import React, { useRef, useState, useEffect } from 'react';
import { OfficialVoucher, PaperSize, SUPPORTED_CURRENCIES, UserProfile, VoucherTemplateType } from '../types/exchange';
import { buildWhatsAppLink, formatWhatsAppMessageLikeScreenshot } from '../services/notificationEngine';
import { voucherEngine } from '../services/voucherEngine';
import { printAuditService } from '../services/printAuditService';
import { WhatsAppDispatchModal } from './WhatsAppDispatchModal';
import { VoucherDepositTemplate } from './vouchers/VoucherDepositTemplate';
import { VoucherPayoutTemplate } from './vouchers/VoucherPayoutTemplate';
import { VoucherSendTemplate } from './vouchers/VoucherSendTemplate';
import { ThermalVoucherTemplate } from './vouchers/ThermalVoucherTemplate';
import { PrintAuditLogModal } from './vouchers/PrintAuditLogModal';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  History,
  ImageIcon,
  MessageCircle,
  PenTool,
  Printer,
  Receipt,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';

interface OfficialVoucherModalProps {
  voucher: OfficialVoucher | null;
  onClose: () => void;
  currentUser?: UserProfile;
  initialOpenWhatsApp?: boolean;
  onUpdateVoucherStatus?: (
    voucherId: string,
    status: 'sent' | 'copied' | 'downloaded' | 'failed',
    time: string,
    extraDetails?: any
  ) => void;
  onVoucherChanged?: (updated: OfficialVoucher) => void;
}

export const OfficialVoucherModal: React.FC<OfficialVoucherModalProps> = ({
  voucher: initialVoucher,
  onClose,
  currentUser = {
    id: 'user-teller',
    name: 'صراف الوردية المعتمد',
    role: 'teller',
    roleTitleAr: 'صراف كاشير',
    branchId: 'br-01',
    branchName: 'فرع تعز - مديرية خدير',
  },
  initialOpenWhatsApp = false,
  onUpdateVoucherStatus,
  onVoucherChanged,
}) => {
  const [voucher, setVoucher] = useState<OfficialVoucher | null>(initialVoucher);
  const [paperSize, setPaperSize] = useState<PaperSize>('a4');
  const [templateType, setTemplateType] = useState<VoucherTemplateType>('send');
  const [isReprintModalOpen, setIsReprintModalOpen] = useState(false);
  const [reprintReason, setReprintReason] = useState('تلف أو فقدان النسخة الورقية الأولى');
  const [customReprintReason, setCustomReprintReason] = useState('');
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isSignatureConfirmOpen, setIsSignatureConfirmOpen] = useState(false);
  const [signatureReceiptNotes, setSignatureReceiptNotes] = useState('');

  // WhatsApp states
  const [copied, setCopied] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [copyingImage, setCopyingImage] = useState(false);
  const [downloadingImage, setDownloadingImage] = useState(false);
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(initialOpenWhatsApp);

  // Print feedback state
  const [showPrintConfirmDialog, setShowPrintConfirmDialog] = useState(false);

  const voucherPrintRef = useRef<HTMLDivElement>(null);

  // Sync when initial voucher prop changes
  useEffect(() => {
    setVoucher(initialVoucher);
    if (initialVoucher) {
      // Auto-detect template type
      if (initialVoucher.templateType) {
        setTemplateType(initialVoucher.templateType);
      } else if (initialVoucher.type === 'transfer_outgoing') {
        setTemplateType('send');
      } else if (initialVoucher.type === 'transfer_incoming') {
        setTemplateType('payout');
      } else if (initialVoucher.type === 'receipt') {
        setTemplateType('deposit');
      } else if (initialVoucher.type === 'exchange') {
        setTemplateType('exchange');
      } else {
        setTemplateType('send');
      }

      if (initialVoucher.lastPaperSize) {
        setPaperSize(initialVoucher.lastPaperSize);
      }
    }
  }, [initialVoucher]);

  const handleClose = () => {
    setVoucher(null);
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!initialVoucher || !voucher) return null;

  // Handle printing
  const executeBrowserPrint = (isReprintFlag: boolean = false, reason?: string) => {
    if (!voucher) return;

    // Apply active paper size to body so @page rules in index.css kick in
    document.body.setAttribute('data-print-paper', paperSize);

    // Record action in central audit service
    const { updatedVoucher } = printAuditService.recordPrintAction({
      voucher,
      user: currentUser,
      paperSize,
      isReprint: isReprintFlag,
      reprintReason: reason,
    });

    setVoucher(updatedVoucher);
    if (onVoucherChanged) onVoucherChanged(updatedVoucher);

    // Trigger browser print
    window.print();

    // Show confirmation query in UI without making false claims
    setShowPrintConfirmDialog(true);
  };

  const handlePrintStandard = () => {
    const isReprint = (voucher.printCount || 0) >= 1;
    if (isReprint) {
      setIsReprintModalOpen(true);
    } else {
      executeBrowserPrint(false);
    }
  };

  const handleConfirmReprint = () => {
    const finalReason = customReprintReason.trim() || reprintReason;
    setIsReprintModalOpen(false);
    executeBrowserPrint(true, finalReason);
  };

  const handleConfirmSignatureReceipt = () => {
    if (!voucher) return;
    const { updatedVoucher } = printAuditService.recordManualSignatureReceipt({
      voucher,
      user: currentUser,
      notes: signatureReceiptNotes || 'تم استلام وتدقيق النسخة الأصلية الموقعة يدوياً وأرشفتها.',
    });
    setVoucher(updatedVoucher);
    if (onVoucherChanged) onVoucherChanged(updatedVoucher);
    setIsSignatureConfirmOpen(false);
  };

  // WhatsApp helpers
  const whatsappMessage = formatWhatsAppMessageLikeScreenshot(voucher);
  const whatsappLink = buildWhatsAppLink(voucher.partyPhone || '', whatsappMessage);

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(whatsappMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleCopyImage = async () => {
    try {
      setCopyingImage(true);
      const el = voucherPrintRef.current;
      if (!el) return;
      const { blob } = await voucherEngine.renderVoucherToImage(el);
      if (typeof window !== 'undefined' && 'clipboard' in navigator && (window as any).ClipboardItem) {
        await navigator.clipboard.write([
          new (window as any).ClipboardItem({ 'image/png': blob }),
        ]);
        setCopiedImage(true);
        setTimeout(() => setCopiedImage(false), 3500);
      } else {
        handleDownloadImage();
      }
    } catch (err) {
      console.warn('Copy image fallback:', err);
      handleDownloadImage();
    } finally {
      setCopyingImage(false);
    }
  };

  const handleDownloadImage = async () => {
    try {
      setDownloadingImage(true);
      const el = voucherPrintRef.current;
      if (!el) return;
      const { dataUrl } = await voucherEngine.renderVoucherToImage(el);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `سند_${voucher.voucherNumber}_${paperSize}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.warn('Download image error:', err);
    } finally {
      setDownloadingImage(false);
    }
  };

  // Render the selected template
  const renderSelectedVoucherTemplate = () => {
    if (paperSize === 'thermal_80mm' || paperSize === 'thermal_58mm') {
      return (
        <ThermalVoucherTemplate
          voucher={{ ...voucher, templateType }}
          domRef={voucherPrintRef}
          paperSize={paperSize}
          isReprint={Boolean(voucher.isReprint || (voucher.printCount && voucher.printCount > 1))}
        />
      );
    }

    if (templateType === 'deposit') {
      return (
        <VoucherDepositTemplate
          voucher={voucher}
          domRef={voucherPrintRef}
          paperSize={paperSize}
          isReprint={Boolean(voucher.isReprint || (voucher.printCount && voucher.printCount > 1))}
        />
      );
    }

    if (templateType === 'payout') {
      return (
        <VoucherPayoutTemplate
          voucher={voucher}
          domRef={voucherPrintRef}
          paperSize={paperSize}
          isReprint={Boolean(voucher.isReprint || (voucher.printCount && voucher.printCount > 1))}
        />
      );
    }

    // Default: 'send'
    return (
      <VoucherSendTemplate
        voucher={voucher}
        domRef={voucherPrintRef}
        paperSize={paperSize}
        isReprint={Boolean(voucher.isReprint || (voucher.printCount && voucher.printCount > 1))}
      />
    );
  };

  const isSigned = voucher.signatureStatus === 'signed_manually';
  const isPrinted = (voucher.printCount || 0) > 0;

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex flex-col justify-start sm:justify-center items-center p-2 sm:p-4 overflow-y-auto no-print cursor-pointer"
        dir="rtl"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            handleClose();
          }
        }}
      >
        <div
          className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl max-w-4xl w-full my-auto shadow-2xl flex flex-col max-h-[96vh] sm:max-h-[93vh] overflow-hidden cursor-default"
          onClick={(e) => e.stopPropagation()}
        >
          
          {/* Header Bar with Action Controls */}
          <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-3 sm:px-6 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-2 shrink-0">
            {/* Title & Metadata */}
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleClose();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleClose();
                }}
                className="text-white bg-slate-800 hover:bg-slate-700 active:bg-slate-600 p-2 sm:p-2.5 rounded-xl transition-all shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] border border-slate-700/80 shadow-md cursor-pointer z-30"
                title="إغلاق النافذة"
                aria-label="إغلاق النافذة"
              >
                <X className="w-5 h-5 text-rose-400 hover:text-rose-300" />
              </button>
              <div className="truncate">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-emerald-400 font-bold block truncate">
                    نظام السندات والطباعة الاحترافي
                  </span>
                  {voucher.printCount && voucher.printCount > 0 ? (
                    <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono">
                      طُبع {voucher.printCount} مرات
                    </span>
                  ) : null}
                </div>
                <h2 className="text-xs sm:text-sm font-bold text-white truncate">
                  سند رقم: <span className="font-mono text-emerald-400">{voucher.voucherNumber}</span>
                  {voucher.referenceNumber && (
                    <span className="text-slate-400 font-normal"> · حوالة: <span className="font-mono">{voucher.referenceNumber}</span></span>
                  )}
                </h2>
              </div>
            </div>

            {/* Print & Action Buttons */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
              {/* Audit Log Trigger */}
              <button
                onClick={() => setIsAuditModalOpen(true)}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                title="عرض سجل تدقيق طباعة هذا السند وكافة السندات"
              >
                <History className="w-3.5 h-3.5 text-slate-400" />
                <span className="hidden md:inline">سجل التدقيق</span>
              </button>

              {/* Print Button */}
              <button
                onClick={handlePrintStandard}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-950/40 transition-all hover:scale-[1.02] cursor-pointer"
                title="طباعة السند على الطابعة المختارة للتوقيع اليدوي"
              >
                <Printer className="w-4 h-4 text-white" />
                <span>{(voucher.printCount || 0) > 0 ? 'إعادة طباعة نسخة' : 'طباعة السند للتوقيع'}</span>
              </button>

              {/* Manual Signature Confirmation Trigger */}
              <button
                onClick={() => setIsSignatureConfirmOpen(true)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                  isSigned
                    ? 'bg-emerald-950/80 border border-emerald-600/80 text-emerald-300 cursor-default'
                    : 'bg-amber-600 hover:bg-amber-500 text-slate-950 cursor-pointer shadow-md'
                }`}
                title="تسجيل أن الموظف استلم النسخة الأصلية الموقعة ورقياً من العميل"
              >
                <PenTool className="w-3.5 h-3.5" />
                <span>{isSigned ? 'تم التوقيع ورقياً' : 'تسجيل استلام التوقيع'}</span>
              </button>
            </div>
          </div>

          {/* Secondary Control Bar: Paper Sizes & Template Type Selector */}
          <div className="bg-slate-850 border-b border-slate-800 px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            {/* Paper Size Tabs (A4, A5, 80mm, 58mm) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-400 font-bold shrink-0">حجم الورق:</span>
              <div className="flex items-center p-0.5 bg-slate-900 rounded-lg border border-slate-750">
                <button
                  onClick={() => setPaperSize('a4')}
                  className={`px-2 sm:px-2.5 py-1 rounded-md font-bold transition-all ${
                    paperSize === 'a4'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="ورق كامل قياسي A4 للمستندات الرسمية"
                >
                  ورق A4
                </button>
                <button
                  onClick={() => setPaperSize('a5')}
                  className={`px-2 sm:px-2.5 py-1 rounded-md font-bold transition-all ${
                    paperSize === 'a5'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="نصف ورقة A5 مدمج وموفر"
                >
                  ورق A5
                </button>
                <button
                  onClick={() => setPaperSize('thermal_80mm')}
                  className={`px-2 sm:px-2.5 py-1 rounded-md font-bold transition-all ${
                    paperSize === 'thermal_80mm'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="طابعة إيصالات حرارية 80mm POS"
                >
                  حراري 80mm
                </button>
                <button
                  onClick={() => setPaperSize('thermal_58mm')}
                  className={`px-2 sm:px-2.5 py-1 rounded-md font-bold transition-all ${
                    paperSize === 'thermal_58mm'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="طابعة إيصالات حرارية 58mm كاشير مصغر"
                >
                  حراري 58mm
                </button>
              </div>
            </div>

            {/* Template Variant Tabs (إيداع / صرف / إرسال) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-400 font-bold shrink-0">قالب السند:</span>
              <div className="flex items-center p-0.5 bg-slate-900 rounded-lg border border-slate-750">
                <button
                  onClick={() => setTemplateType('deposit')}
                  className={`px-2 sm:px-2.5 py-1 rounded-md font-bold transition-all ${
                    templateType === 'deposit'
                      ? 'bg-[#800000] text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  سند إيداع
                </button>
                <button
                  onClick={() => setTemplateType('payout')}
                  className={`px-2 sm:px-2.5 py-1 rounded-md font-bold transition-all ${
                    templateType === 'payout'
                      ? 'bg-[#800000] text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  سند صرف
                </button>
                <button
                  onClick={() => setTemplateType('send')}
                  className={`px-2 sm:px-2.5 py-1 rounded-md font-bold transition-all ${
                    templateType === 'send'
                      ? 'bg-[#800000] text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  سند إرسال
                </button>
              </div>
            </div>
          </div>

          {/* Status Banners Bar */}
          <div className="px-3 sm:px-6 pt-2 pb-1 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-[11px]">حالة السند والتوقيع:</span>
              {isSigned ? (
                <span className="bg-emerald-950 text-emerald-300 border border-emerald-700/60 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 text-[11px]">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>تم التوقيع ورقياً وأرشفته ({voucher.signedReceiptBy || currentUser.name})</span>
                </span>
              ) : isPrinted ? (
                <span className="bg-blue-950 text-blue-300 border border-blue-700/60 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 text-[11px]">
                  <Clock className="w-3.5 h-3.5 text-blue-400" />
                  <span>تمت الطباعة · بانتظار توقيع العميل يدوياً</span>
                </span>
              ) : (
                <span className="bg-amber-950 text-amber-300 border border-amber-700/60 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 text-[11px]">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>بانتظار الطباعة</span>
                </span>
              )}
            </div>

            <div className="text-[11px] text-slate-400">
              المقاس الحالي للطباعة: <strong className="text-white uppercase font-mono">{paperSize.replace('_', ' ')}</strong>
            </div>
          </div>

          {/* Scrollable Document Preview Body */}
          <div className="p-3 sm:p-6 overflow-y-auto space-y-4 flex-1 bg-slate-925">
            {/* The Live Document Component */}
            <div className="printable-voucher-container flex justify-center">
              {renderSelectedVoucherTemplate()}
            </div>

            {/* Quick Actions & WhatsApp Section */}
            <div className="bg-slate-850 border border-slate-800 rounded-2xl p-4 space-y-3 max-w-2xl mx-auto">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[#25D366]/20 flex items-center justify-center text-[#25D366] shrink-0">
                    <MessageCircle className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">إشعار العميل عبر واتساب والنسخ الرقمي</h4>
                    <p className="text-[11px] text-slate-400">مشاركة نسخة السند المعتمد مع العميل فوراً</p>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-800/40">
                  {voucher.partyPhone || voucher.recipientPhone || 'غير مسجل هاتفياً'}
                </span>
              </div>

              {/* Feedback messages */}
              {copiedImage && (
                <div className="p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-600/60 text-emerald-200 text-xs flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>تم نسخ صورة السند للحافظة بنجاح! الصقها مباشرة في واتساب (Ctrl + V).</span>
                </div>
              )}
              {copied && (
                <div className="p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-600/60 text-emerald-200 text-xs flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>تم نسخ نص السند الكامل إلى الحافظة.</span>
                </div>
              )}

              {/* 1-Click Action Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
                <a
                  href={whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 bg-[#00a884] hover:bg-[#02906f] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all text-center"
                >
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  <span>فتح واتساب</span>
                </a>

                <button
                  onClick={handleCopyImage}
                  disabled={copyingImage}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-750 text-slate-100 border border-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Copy className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{copyingImage ? 'جاري النسخ...' : 'نسخ الصورة'}</span>
                </button>

                <button
                  onClick={handleDownloadImage}
                  disabled={downloadingImage}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-750 text-slate-100 border border-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>{downloadingImage ? 'جاري التحميل...' : 'تنزيل صورة'}</span>
                </button>

                <button
                  onClick={handleCopyMessage}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>نسخ النص</span>
                </button>
              </div>
            </div>
          </div>

          {/* Bottom Sticky Action Bar with Prominent Mobile-Friendly Close & Print Buttons */}
          <div className="sticky bottom-0 z-20 bg-slate-900/95 backdrop-blur border-t border-slate-800 p-2.5 sm:p-3 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={handleClose}
              onTouchEnd={(e) => {
                e.preventDefault();
                handleClose();
              }}
              className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 border border-slate-700 shadow-sm cursor-pointer transition-all"
            >
              <X className="w-4 h-4 text-rose-400" />
              <span>إغلاق النافذة (خروج)</span>
            </button>
            <button
              type="button"
              onClick={handlePrintStandard}
              className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-md cursor-pointer transition-all"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة السند</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Confirm Reprint Reason */}
      {isReprintModalOpen && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-55 flex items-center justify-center p-4 no-print" dir="rtl">
          <div className="bg-slate-900 border border-amber-700/60 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <RotateCcw className="w-5 h-5" />
                <span>إعادة طباعة نسخة سند (Reprint Copy)</span>
              </div>
              <button
                onClick={() => setIsReprintModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              وفقاً للممارسات المصرفية والرقابية: ستظهر على النسخة المطبوعة عبارة <strong>&quot;نسخة إعادة طباعة&quot;</strong> مع الاحتفاظ برقم السند ورقم العملية الأصليين دون إنشاء أي قيد مالي مكرر.
            </p>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                سبب إعادة الطباعة (إلزامي للتدقيق):
              </label>
              <select
                value={reprintReason}
                onChange={(e) => setReprintReason(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value="تلف أو فقدان النسخة الورقية الأولى">تلف أو فقدان النسخة الورقية الأولى</option>
                <option value="طلب العميل نسخة إضافية">طلب العميل نسخة إضافية</option>
                <option value="انقطاع ورق الطابعة أثناء الطباعة">انقطاع ورق الطابعة أثناء الطباعة</option>
                <option value="أرشفة إدارية إضافية للفرع">أرشفة إدارية إضافية للفرع</option>
                <option value="custom">سبب مخصص آخر...</option>
              </select>
            </div>

            {reprintReason === 'custom' && (
              <div>
                <label className="block text-xs text-slate-300 mb-1">اكتب سبب الإعادة بدقة:</label>
                <input
                  type="text"
                  value={customReprintReason}
                  onChange={(e) => setCustomReprintReason(e.target.value)}
                  placeholder="أدخل مبرر إعادة الطباعة..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setIsReprintModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
              >
                إلغاء
              </button>
              <button
                onClick={handleConfirmReprint}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md"
              >
                <Printer className="w-4 h-4" />
                <span>المتابعة وطباعة النسخة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Receipt of Manual Signature */}
      {isSignatureConfirmOpen && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-55 flex items-center justify-center p-4 no-print" dir="rtl">
          <div className="bg-slate-900 border border-emerald-700/60 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <FileCheck2 className="w-5 h-5" />
                <span>تسجيل استلام النسخة الموقعة يدوياً من العميل</span>
              </div>
              <button
                onClick={() => setIsSignatureConfirmOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-850 border border-slate-800 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">السند:</span>
                <span className="font-mono font-bold text-white">{voucher.voucherNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">الموظف المستلم:</span>
                <span className="font-bold text-emerald-400">{currentUser.name} ({currentUser.roleTitleAr})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">الوقت:</span>
                <span className="font-mono text-slate-300">{new Date().toLocaleTimeString('ar-YE')}</span>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              تأكيد استلامك للنسخة الأصلية الموقعة يدوياً بقلم العميل بعد مطابقة البيانات وإيداعها في الأرشيف الورقي للمؤسسة. (هذا ليس توقيعاً إلكترونياً بل إثبات استلام ورقي).
            </p>

            <div>
              <label className="block text-xs text-slate-300 mb-1">ملاحظات الأرشفة (اختياري):</label>
              <input
                type="text"
                value={signatureReceiptNotes}
                onChange={(e) => setSignatureReceiptNotes(e.target.value)}
                placeholder="رقم الملف أو موقع الحفظ بالأرشيف..."
                className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setIsSignatureConfirmOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl text-xs font-semibold"
              >
                إلغاء
              </button>
              <button
                onClick={handleConfirmSignatureReceipt}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md shadow-emerald-950/40"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>تأكيد استلام وتدقيق النسخة الموقعة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Post-Print Confirmation Query */}
      {showPrintConfirmDialog && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs z-55 flex items-center justify-center p-4 no-print" dir="rtl">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-4 space-y-3 text-center shadow-xl">
            <Printer className="w-8 h-8 text-emerald-400 mx-auto" />
            <h3 className="text-sm font-bold text-white">تأكيد إرسال أمر الطباعة</h3>
            <p className="text-xs text-slate-300">
              تم إرسال السند لنافذة الطباعة بحجم (<span className="uppercase font-mono">{paperSize.replace('_', ' ')}</span>). هل خرجت النسخة بنجاح من طابعتك؟
            </p>
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                onClick={() => setShowPrintConfirmDialog(false)}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs"
              >
                نعم، تمت بنجاح
              </button>
              <button
                onClick={() => {
                  setShowPrintConfirmDialog(false);
                  setIsReprintModalOpen(true);
                }}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl text-xs"
              >
                تعذر / إعادة المحاولة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit Log Modal */}
      <PrintAuditLogModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        currentUser={currentUser}
      />

      {/* WhatsApp Dispatch Simulation Modal */}
      <WhatsAppDispatchModal
        voucher={voucher}
        isOpen={isWhatsAppOpen}
        onClose={() => setIsWhatsAppOpen(false)}
        currentUser={currentUser}
        onUpdateVoucherStatus={onUpdateVoucherStatus}
      />
    </>
  );
};
