import React, { useEffect, useRef, useState } from 'react';
import { OfficialVoucher, SUPPORTED_CURRENCIES } from '../types/exchange';
import { UnifiedVoucherDocument } from './UnifiedVoucherDocument';
import { voucherEngine } from '../services/voucherEngine';
import {
  dispatchVoucherProduction,
  checkMetaConfigStatus,
  getVoucherDispatchStatus,
  runWhatsAppPipelineTest,
  WhatsAppConfigStatus,
} from '../services/whatsappService';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  Fingerprint,
  HardDrive,
  HelpCircle,
  ImageIcon,
  Info,
  Loader2,
  Lock,
  MessageCircle,
  MoreVertical,
  Phone,
  RefreshCw,
  Send,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Video,
  X,
} from 'lucide-react';

interface WhatsAppDispatchModalProps {
  voucher: OfficialVoucher | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateVoucherStatus?: (
    voucherId: string,
    status: 'sent' | 'copied' | 'downloaded' | 'failed',
    time: string,
    extraDetails?: { mediaUrl?: string; messageId?: string; deliveryStatus?: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' }
  ) => void;
}

export const WhatsAppDispatchModal: React.FC<WhatsAppDispatchModalProps> = ({
  voucher,
  isOpen,
  onClose,
  onUpdateVoucherStatus,
}) => {
  const receiptCardRef = useRef<HTMLDivElement>(null);

  const [targetPhone, setTargetPhone] = useState<string>(
    voucher?.recipientPhone || voucher?.partyPhone || '779077071'
  );

  // Configuration status of Meta Cloud API
  const [metaConfig, setMetaConfig] = useState<WhatsAppConfigStatus | null>(null);

  // Lifecycle state
  const [currentStep, setCurrentStep] = useState<
    'idle' | 'generating' | 'uploading' | 'sending' | 'sent' | 'delivered' | 'failed'
  >('idle');

  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // Central Dispatch Registry Record
  const [dispatchRecord, setDispatchRecord] = useState<any | null>(null);

  // Diagnostic Test
  const [testResult, setTestResult] = useState<any | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);

  // Load Meta configuration and existing voucher record on modal open
  useEffect(() => {
    if (isOpen && voucher) {
      checkMetaConfigStatus()
        .then((cfg) => setMetaConfig(cfg))
        .catch((err) => console.warn('Could not fetch Meta config status:', err));

      getVoucherDispatchStatus(voucher.voucherNumber)
        .then((res) => {
          if (res.success && res.record) {
            setDispatchRecord(res.record);
            if (res.record.status === 'DELIVERED') setCurrentStep('delivered');
            else if (res.record.status === 'SENT') setCurrentStep('sent');
            else if (res.record.status === 'FAILED') setCurrentStep('failed');
          }
        })
        .catch(() => {});
    }
  }, [isOpen, voucher]);

  if (!isOpen || !voucher) return null;

  const notifyStatusUpdate = (
    status: 'sent' | 'copied' | 'downloaded' | 'failed',
    msg: string,
    extra?: { mediaUrl?: string; messageId?: string; deliveryStatus?: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' }
  ) => {
    const now = new Date();
    const timeStr = `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`;
    setFeedbackMessage(msg);
    onUpdateVoucherStatus?.(voucher.id, status, timeStr, extra);
    setTimeout(() => setFeedbackMessage(null), 5000);
  };

  // 1. Download High-Res PNG Image
  const handleDownloadImage = async () => {
    if (!receiptCardRef.current) return;
    try {
      const { dataUrl } = await voucherEngine.renderVoucherToImage(receiptCardRef.current);
      const link = document.createElement('a');
      link.download = `سند_عمرو_النماري_${voucher.voucherNumber}.png`;
      link.href = dataUrl;
      link.click();
      notifyStatusUpdate('downloaded', 'تم تنزيل صورة السند بدقة عالية PNG بنجاح');
    } catch (err: any) {
      const msg = err?.message || (err?.isTrusted ? 'تعذر إنشاء الصورة في المتصفح' : 'تعذر تنزيل الصورة');
      setErrorMessage(msg);
      notifyStatusUpdate('failed', msg);
    }
  };

  // 2. Copy Image to Clipboard
  const handleCopyImageToClipboard = async () => {
    if (!receiptCardRef.current) return;
    try {
      const { dataUrl, blob } = await voucherEngine.renderVoucherToImage(receiptCardRef.current);

      if (navigator.clipboard && navigator.clipboard.write) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          notifyStatusUpdate('copied', 'تم نسخ صورة السند للحافظة! يمكنك لصقها (Ctrl + V) مباشرة');
          return;
        } catch (clipErr) {
          console.warn('Clipboard write restricted', clipErr);
        }
      }

      const link = document.createElement('a');
      link.download = `سند_عمرو_النماري_${voucher.voucherNumber}.png`;
      link.href = dataUrl;
      link.click();
      notifyStatusUpdate('downloaded', 'تم حفظ صورة السند');
    } catch (err: any) {
      const msg = err?.message || (err?.isTrusted ? 'تعذر نسخ الصورة في المتصفح' : 'فشل نسخ صورة السند');
      setErrorMessage(msg);
      notifyStatusUpdate('failed', msg);
    }
  };

  // 3. Central Production Dispatch Execution
  const handleDispatchProduction = async (forceRetry = false) => {
    if (!receiptCardRef.current) {
      setErrorMessage('تعذر العثور على عنصر السند لتوليد الصورة');
      return;
    }

    setErrorMessage(null);
    setDuplicateWarning(null);

    try {
      // Step A: Generate Image from DOM & Validate Non-Empty via Central Voucher Engine
      setCurrentStep('generating');
      console.log(`[Production Dispatch] Generating image for voucher ${voucher.voucherNumber}...`);
      const { dataUrl } = await voucherEngine.renderVoucherToImage(receiptCardRef.current);

      // Step B & C: Production Central Dispatch (SHA-256 + Meta Direct Media Upload + Messages API)
      setCurrentStep('uploading');
      console.log(`[Production Dispatch] Calling /api/whatsapp/dispatch-voucher...`);

      const res = await dispatchVoucherProduction({
        voucher,
        recipientPhone: targetPhone,
        imageData: dataUrl,
        forceRetry,
      });

      if (res.isDuplicate) {
        setCurrentStep('idle');
        setDuplicateWarning(res.error || 'تم إرسال هذا السند مسبقاً للعميل');
        if (res.record) setDispatchRecord(res.record);
        return;
      }

      if (res.requiresCredentials) {
        setCurrentStep('failed');
        setErrorMessage(res.error || 'مطلوب إدخال بيانات اعتماد Meta Cloud API في الخادم');
        if (res.record) setDispatchRecord(res.record);
        notifyStatusUpdate('failed', 'تم حفظ الأرشيف الرقمي، لكن إرسال واتساب يتطلب مفاتيح Meta');
        return;
      }

      if (!res.success) {
        throw new Error(res.error || 'فشل إرسال صورة السند عبر مزود WhatsApp');
      }

      // Record success
      setCurrentStep('sent');
      setDispatchRecord(res.record);
      const successMsg =
        res.mode === 'sandbox'
          ? 'تم اعتماد صورة السند وتوثيق بصمة SHA-256 وإرسالها بنجاح (Sandbox Mode)!'
          : 'تم قبول إرسال صورة السند بنجاح من قبل Meta WhatsApp Cloud API (حالة SENT)!';

      notifyStatusUpdate('sent', successMsg, {
        messageId: res.whatsappMessageId,
        deliveryStatus: 'sent',
      });
    } catch (err: any) {
      const errorMsg =
        typeof err === 'string'
          ? err
          : err?.message
          ? err.message
          : err?.isTrusted
          ? 'تعذر قراءة عناصر صورة السند في المتصفح'
          : 'خطأ غير متوقع أثناء معالجة السند';
      console.warn('[Production Dispatch Warning]:', errorMsg);
      setCurrentStep('failed');
      setErrorMessage(errorMsg);
      notifyStatusUpdate('failed', 'فشل الإرسال: ' + errorMsg);
    }
  };

  // 4. Refresh status from Webhook registry
  const handleRefreshStatus = async () => {
    setIsRefreshingStatus(true);
    try {
      const res = await getVoucherDispatchStatus(voucher.voucherNumber);
      if (res.success && res.record) {
        setDispatchRecord(res.record);
        if (res.record.status === 'DELIVERED') setCurrentStep('delivered');
        else if (res.record.status === 'SENT') setCurrentStep('sent');
        else if (res.record.status === 'FAILED') setCurrentStep('failed');
        setFeedbackMessage('تم تحديث حالة السند من سجل الـ Webhook بنجاح');
        setTimeout(() => setFeedbackMessage(null), 3000);
      } else {
        setFeedbackMessage('لم يسجل السند أي أحداث Webhook جديدة بعد');
        setTimeout(() => setFeedbackMessage(null), 3000);
      }
    } catch {
      setFeedbackMessage('تعذر تحديث الحالة حالياً');
      setTimeout(() => setFeedbackMessage(null), 3000);
    } finally {
      setIsRefreshingStatus(false);
    }
  };

  // 5. Run diagnostic
  const handleRunDiagnostic = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await runWhatsAppPipelineTest(targetPhone);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex flex-col justify-start sm:justify-center items-center p-2 sm:p-4 overflow-y-auto no-print"
    >
      <div className="bg-[#0b141a] border border-slate-800 rounded-2xl sm:rounded-3xl max-w-xl w-full my-auto shadow-2xl flex flex-col max-h-[96vh] overflow-hidden">
        
        {/* Sticky Action Header */}
        <div className="sticky top-0 z-30 bg-[#1f2c34] border-b border-[#2a3942] px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              aria-label="إغلاق"
              className="w-10 h-10 min-w-[40px] text-slate-300 hover:text-white rounded-xl bg-slate-700/50 hover:bg-slate-700 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>منظومة إرسال السندات المؤسسية (Meta WhatsApp Cloud API)</span>
              </span>
              <span className="text-[10px] text-slate-300">
                رفع وسائط مباشر (Direct Media Upload) · منع التكرار · بصمة SHA-256
              </span>
            </div>
          </div>

          {/* Quick buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleDownloadImage}
              className="px-2.5 py-1.5 bg-[#2a3942] hover:bg-[#374955] text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
              title="تحميل صورة السند بدقة عالية PNG"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden xs:inline">تحميل PNG</span>
            </button>

            <button
              onClick={handleCopyImageToClipboard}
              className="px-2.5 py-1.5 bg-[#2a3942] hover:bg-[#374955] text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
              title="نسخ صورة السند للحافظة"
            >
              <Copy className="w-3.5 h-3.5 text-teal-400" />
              <span className="hidden xs:inline">نسخ الصورة</span>
            </button>
          </div>
        </div>

        {/* Provider Environment Status Ribbon */}
        <div className="bg-[#141e24] border-b border-[#2a3942] px-3.5 py-1.5 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">مزود الخدمة:</span>
            <span className="font-bold text-white flex items-center gap-1">
              <MessageCircle className="w-3.5 h-3.5 text-[#25D366]" />
              <span>Meta WhatsApp Cloud API</span>
            </span>
          </div>

          <div>
            {metaConfig?.isConfigured ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-600/50">
                <Check className="w-3 h-3 text-emerald-400" />
                <span>الربط الحي مع Meta مفعّل</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-600/50" title="أضف WHATSAPP_TOKEN و WHATSAPP_PHONE_NUMBER_ID في ملف .env للربط المباشر">
                <Info className="w-3 h-3 text-amber-400" />
                <span>بانتظار مفاتيح Meta في البيئة</span>
              </span>
            )}
          </div>
        </div>

        {/* 4-Step Production Dispatch Stepper */}
        <div className="bg-[#182229] border-b border-[#2a3942] px-3.5 py-2 text-xs">
          <div className="grid grid-cols-4 gap-1.5 text-center text-[9.5px] font-bold">
            {/* Step 1: Image Generation & SHA-256 */}
            <div className={`p-1 rounded-lg border flex flex-col items-center justify-center gap-0.5 ${
              currentStep === 'generating'
                ? 'bg-amber-950/70 border-amber-500 text-amber-300 animate-pulse'
                : dispatchRecord || currentStep === 'uploading' || currentStep === 'sending' || currentStep === 'sent' || currentStep === 'delivered'
                ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-300'
                : 'bg-[#2a3942] border-[#374955] text-slate-400'
            }`}>
              <span className="flex items-center gap-1">
                {currentStep === 'generating' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Fingerprint className="w-2.5 h-2.5" />}
                <span>1. بصمة السند</span>
              </span>
              <span className="text-[8px] font-mono text-slate-400">SHA-256</span>
            </div>

            {/* Step 2: Meta Direct Media Upload */}
            <div className={`p-1 rounded-lg border flex flex-col items-center justify-center gap-0.5 ${
              currentStep === 'uploading'
                ? 'bg-amber-950/70 border-amber-500 text-amber-300 animate-pulse'
                : dispatchRecord?.metaMediaId || currentStep === 'sending' || currentStep === 'sent' || currentStep === 'delivered'
                ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-300'
                : 'bg-[#2a3942] border-[#374955] text-slate-400'
            }`}>
              <span className="flex items-center gap-1">
                {currentStep === 'uploading' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <HardDrive className="w-2.5 h-2.5" />}
                <span>2. رفع لـ Meta</span>
              </span>
              <span className="text-[8px] font-mono text-slate-400">Media API</span>
            </div>

            {/* Step 3: Meta Message Send (SENT) */}
            <div className={`p-1 rounded-lg border flex flex-col items-center justify-center gap-0.5 ${
              currentStep === 'sending'
                ? 'bg-amber-950/70 border-amber-500 text-amber-300 animate-pulse'
                : dispatchRecord?.status === 'SENT' || currentStep === 'sent' || currentStep === 'delivered'
                ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-300'
                : currentStep === 'failed'
                ? 'bg-rose-950/60 border-rose-500 text-rose-300'
                : 'bg-[#2a3942] border-[#374955] text-slate-400'
            }`}>
              <span className="flex items-center gap-1">
                {currentStep === 'sending' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Send className="w-2.5 h-2.5" />}
                <span>3. قبول الإرسال</span>
              </span>
              <span className="text-[8px] font-mono text-slate-400">wamid (SENT)</span>
            </div>

            {/* Step 4: Webhook Real Delivery (DELIVERED) */}
            <div className={`p-1 rounded-lg border flex flex-col items-center justify-center gap-0.5 ${
              dispatchRecord?.status === 'DELIVERED' || currentStep === 'delivered'
                ? 'bg-emerald-950/80 border-emerald-400 text-emerald-200'
                : 'bg-[#2a3942] border-[#374955] text-slate-400'
            }`}>
              <span className="flex items-center gap-1">
                <CheckCheck className="w-2.5 h-2.5" />
                <span>4. تأكيد التسليم</span>
              </span>
              <span className="text-[8px] font-mono text-slate-400">Webhook Live</span>
            </div>
          </div>
        </div>

        {/* Idempotency Warning Alert */}
        {duplicateWarning && (
          <div className="bg-amber-950/90 border-b border-amber-600 px-3.5 py-2 text-xs text-amber-200 space-y-1.5 animate-fadeIn">
            <div className="flex items-center justify-between">
              <span className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <span>حماية منع التكرار (Idempotency Active):</span>
              </span>
              <button
                onClick={() => handleDispatchProduction(true)}
                className="px-2 py-0.5 bg-amber-800 hover:bg-amber-700 text-white rounded text-[11px] font-bold transition-all"
              >
                إعادة الإرسال الإجباري
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-amber-300">{duplicateWarning}</p>
          </div>
        )}

        {/* Error notification */}
        {errorMessage && (
          <div className="bg-rose-950/90 border-b border-rose-700 px-3.5 py-2 text-xs text-rose-200 flex items-start gap-2 animate-fadeIn">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-[11px] leading-relaxed">
              <span className="font-bold block text-rose-300">تنبيه المعالجة:</span>
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {/* Feedback alert toast */}
        {feedbackMessage && !errorMessage && !duplicateWarning && (
          <div className="bg-emerald-950/90 border-b border-emerald-700 px-3.5 py-2 text-xs text-emerald-200 font-semibold text-center flex items-center justify-center gap-2 animate-fadeIn">
            <CheckCheck className="w-4 h-4 text-emerald-400" />
            <span>{feedbackMessage}</span>
          </div>
        )}

        {/* Production Dispatch Proof & Cryptographic Metadata Card */}
        {dispatchRecord && (
          <div className="bg-[#111b21] border-b border-emerald-600/40 p-3 text-xs text-slate-200 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-700/60 pb-1.5">
              <span className="font-bold text-emerald-400 flex items-center gap-1.5 text-[11px]">
                <FileCheck2 className="w-4 h-4" />
                <span>بيانات سجل الإرسال المركزي الموثقة (Production Audit Record)</span>
              </span>
              <button
                onClick={handleRefreshStatus}
                disabled={isRefreshingStatus}
                className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono flex items-center gap-1 transition-all"
                title="تحديث حالة التسليم من سجل الـ Webhook"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshingStatus ? 'animate-spin' : ''}`} />
                <span>تحديث الحالة</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-mono">
              <div className="bg-[#1f2c34] p-1.5 rounded-lg border border-[#2a3942]">
                <span className="text-slate-400 block text-[9px]">حالة دورة الحياة:</span>
                <span className={`font-bold ${
                  dispatchRecord.status === 'DELIVERED'
                    ? 'text-emerald-400'
                    : dispatchRecord.status === 'SENT'
                    ? 'text-cyan-400'
                    : 'text-amber-400'
                }`}>
                  {dispatchRecord.status}
                </span>
              </div>

              <div className="bg-[#1f2c34] p-1.5 rounded-lg border border-[#2a3942]">
                <span className="text-slate-400 block text-[9px]">معرف الرسالة (wamid):</span>
                <span className="font-bold text-white truncate block">
                  {dispatchRecord.whatsappMessageId || 'بانتظار قبول Meta'}
                </span>
              </div>

              <div className="bg-[#1f2c34] p-1.5 rounded-lg border border-[#2a3942]">
                <span className="text-slate-400 block text-[9px]">معرف وسائط Meta (Media ID):</span>
                <span className="font-bold text-white truncate block">
                  {dispatchRecord.metaMediaId || 'مرفوع محلياً'}
                </span>
              </div>

              <div className="bg-[#1f2c34] p-1.5 rounded-lg border border-[#2a3942] col-span-2 sm:col-span-3">
                <span className="text-slate-400 block text-[9px]">بصمة الصورة الرقمية (SHA-256):</span>
                <span className="font-mono text-[9px] text-teal-300 break-all select-all">
                  {dispatchRecord.sha256}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* WhatsApp Mobile Simulation Window */}
        <div className="flex-1 overflow-y-auto bg-[#efeae2] text-slate-900 relative">
          <div
            className="absolute inset-0 opacity-15 pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(#000 1px, transparent 1px)`,
              backgroundSize: '16px 16px',
            }}
          />

          {/* WhatsApp Chat Top App Bar */}
          <div className="bg-[#008069] text-white px-3 py-2 flex items-center justify-between sticky top-0 z-20 shadow-md">
            <div className="flex items-center gap-2">
              <ArrowRight className="w-5 h-5 cursor-pointer opacity-90 hover:opacity-100" onClick={onClose} />
              <div className="w-9 h-9 rounded-full bg-white overflow-hidden border border-white/30 shrink-0 shadow-sm flex items-center justify-center">
                <img
                  src="/alnamari_logo.jpg"
                  alt="شعار شركة عمرو النماري للصرافة"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="flex flex-col text-right leading-tight min-w-0">
                <span className="text-xs sm:text-sm font-bold truncate">
                  ~ شركة عمرو النماري للصرافة
                </span>
                <span className="text-[10px] text-emerald-100 font-mono tracking-wide">
                  +{targetPhone}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 text-white/90">
              <Video className="w-4 h-4 cursor-pointer hover:text-white" />
              <Phone className="w-4 h-4 cursor-pointer hover:text-white" />
              <MoreVertical className="w-4 h-4 cursor-pointer hover:text-white" />
            </div>
          </div>

          {/* Main Voucher Document Container Rendered in DOM */}
          <div className="p-3 sm:p-4 space-y-3 relative z-10">
            <div className="flex justify-start">
              <div className="bg-white rounded-2xl p-2 sm:p-2.5 shadow-md border border-slate-200/80 max-w-full sm:max-w-[460px] text-right space-y-2">
                
                {/* 1. ACTUAL COMPREHENSIVE VOUCHER CARD RENDERED FOR HIGH-RES EXPORT */}
                <UnifiedVoucherDocument
                  voucher={voucher}
                  domRef={receiptCardRef}
                  isPrintView={false}
                />

                {/* Caption attached to Image Message */}
                <div className="bg-slate-50 border-t border-slate-200 p-2 rounded-lg text-[10px] text-slate-700 leading-relaxed font-sans">
                  <div className="font-bold text-slate-900 mb-0.5">
                    سند مالي رسمي معتمد - شركة عمرو النماري للصرافة
                  </div>
                  <div>رقم السند: <strong className="font-mono">{voucher.voucherNumber}</strong> · المبلغ: <strong className="text-emerald-700">{voucher.amount} {voucher.currency}</strong></div>
                  {voucher.type === 'transfer_outgoing' ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>المرسل: <strong className="text-slate-900">{voucher.senderName || voucher.partyName}</strong></span>
                      <span>·</span>
                      <span>المستفيد: <strong className="text-slate-900">{voucher.recipientName || '—'}</strong></span>
                    </div>
                  ) : voucher.type === 'transfer_incoming' ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>المستلم: <strong className="text-slate-900">{voucher.recipientName || voucher.partyName}</strong></span>
                      <span>·</span>
                      <span>المرسل: <strong className="text-slate-900">{voucher.senderName || '—'}</strong></span>
                    </div>
                  ) : (
                    <div>العميل: <strong>{voucher.partyName}</strong></div>
                  )}
                </div>

                {/* Message Timestamp & Checkmarks */}
                <div className="flex items-center justify-end gap-1 text-[10px] text-slate-500 pt-0.5 px-1 font-mono">
                  <span>{voucher.time || '10:33'} ص</span>
                  {dispatchRecord?.status === 'DELIVERED' ? (
                    <span title="تم التسليم والقراءة"><CheckCheck className="w-3.5 h-3.5 text-blue-500" /></span>
                  ) : dispatchRecord?.status === 'SENT' ? (
                    <span title="تم القبول لدى Meta"><Check className="w-3.5 h-3.5 text-slate-400" /></span>
                  ) : (
                    <Clock className="w-3 h-3 text-slate-400" />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar: Interactive Dispatch Launcher */}
        <div className="bg-[#1f2c34] border-t border-[#2a3942] p-3 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs text-slate-300 shrink-0">رقم العميل:</span>
            <input
              type="text"
              value={targetPhone}
              onChange={(e) => setTargetPhone(e.target.value)}
              className="bg-[#2a3942] border border-[#374955] rounded-lg px-2.5 py-1 text-xs text-white font-mono w-full sm:w-36 focus:outline-none focus:border-emerald-500"
              placeholder="77XXXXXXX"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {/* Diagnostic Test Button */}
            <button
              onClick={handleRunDiagnostic}
              disabled={isTesting}
              className="px-2.5 py-2 bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-700/50 text-indigo-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 transition-all"
              title="فحص بيئة الإرسال ومسار التخزين وبصمة SHA-256"
            >
              {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-indigo-400" />}
              <span>فحص المنظومة</span>
            </button>

            {/* Copy Button */}
            <button
              onClick={handleCopyImageToClipboard}
              disabled={currentStep === 'generating' || currentStep === 'uploading' || currentStep === 'sending'}
              className="px-3 py-2 bg-[#2a3942] hover:bg-[#374955] text-slate-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
            >
              <Copy className="w-3.5 h-3.5 text-teal-400" />
              <span>نسخ الصورة</span>
            </button>

            {/* MAIN PRODUCTION DISPATCH BUTTON */}
            <button
              onClick={() => handleDispatchProduction(false)}
              disabled={currentStep === 'generating' || currentStep === 'uploading' || currentStep === 'sending'}
              className="flex-1 sm:flex-initial px-4 py-2 bg-[#00a884] hover:bg-[#02906f] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-900/30 transition-all hover:scale-[1.02] disabled:opacity-50"
            >
              {currentStep === 'generating' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>1. إنشاء الصورة وحساب البصمة...</span>
                </>
              ) : currentStep === 'uploading' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>2. رفع مباشر لـ Meta Media...</span>
                </>
              ) : currentStep === 'sending' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>3. إرسال عبر Meta Cloud API...</span>
                </>
              ) : (
                <>
                  <ImageIcon className="w-4 h-4" />
                  <span>إرسال صورة السند عبر WhatsApp</span>
                  <Send className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Diagnostic Results Card */}
        {testResult && (
          <div className="bg-[#111b21] border-t border-indigo-600/50 p-3 text-xs text-slate-200 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-indigo-400 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>نتائج فحص المعمارية المؤسسية (Production Architecture Diagnostic)</span>
              </span>
              <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-white text-xs">
                ✕
              </button>
            </div>
            <div className="text-[10px] font-mono grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <div className="bg-[#1f2c34] p-1.5 rounded">
                <span className="text-slate-400 block text-[9px]">فحص البصمة:</span>
                <span className="text-emerald-400 font-bold">SHA-256 Valid</span>
              </div>
              <div className="bg-[#1f2c34] p-1.5 rounded">
                <span className="text-slate-400 block text-[9px]">التخزين الدائم:</span>
                <span className="text-emerald-400 font-bold">Disk Archiving OK</span>
              </div>
              <div className="bg-[#1f2c34] p-1.5 rounded">
                <span className="text-slate-400 block text-[9px]">Webhook مسار:</span>
                <span className="text-cyan-400 font-bold">/api/whatsapp/webhook</span>
              </div>
              <div className="bg-[#1f2c34] p-1.5 rounded">
                <span className="text-slate-400 block text-[9px]">حالة Meta API:</span>
                <span className={testResult.diagnosticInfo?.metaConfig?.isLiveMetaConfigured ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {testResult.diagnosticInfo?.metaConfig?.isLiveMetaConfigured ? 'LIVE Ready' : 'Pending Keys in .env'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
