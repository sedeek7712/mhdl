/**
 * محرك وسجل طباعة السندات وتوثيق التدقيق والتوقيع اليدوي
 * مؤسسة عمرو النماري للصرافة والتحويلات - Amro Alnamari Exchange
 * 
 * مسؤول عن:
 * 1. تسجيل كل عملية طباعة بدقة مع المستخدم، الوقت، حجم الورق، وعدد المرات.
 * 2. إدارة منطق إعادة الطباعة مع إثبات أسباب الإعادة وظهور علامة "نسخة إعادة طباعة".
 * 3. إدارة دورة حياة التوقيع اليدوي للعميل وتوثيق استلام النسخة الأصلية بواسطة الموظف.
 * 4. الحفاظ الكامل على الأرقام المحاسبية والمرجعية دون تكرار أو مساس بالقيود المالية.
 */

import { OfficialVoucher, PaperSize, PrintAuditLogEntry, SignatureStatus, UserProfile } from '../types/exchange';
import { offlineStorage } from './offlineStorage';

export class PrintAuditService {
  private static instance: PrintAuditService;

  private constructor() {}

  public static getInstance(): PrintAuditService {
    if (!PrintAuditService.instance) {
      PrintAuditService.instance = new PrintAuditService();
    }
    return PrintAuditService.instance;
  }

  /**
   * جلب السجلات المحفوظة
   */
  public getLogs(): PrintAuditLogEntry[] {
    return offlineStorage.loadPrintAuditLogs([]);
  }

  /**
   * حفظ سجل جديد لعملية طباعة
   */
  public recordPrintAction(params: {
    voucher: OfficialVoucher;
    user: UserProfile;
    paperSize: PaperSize;
    isReprint: boolean;
    reprintReason?: string;
  }): { updatedVoucher: OfficialVoucher; logEntry: PrintAuditLogEntry } {
    const now = new Date();
    const timestampStr = now.toISOString().replace('T', ' ').substring(0, 19);

    const currentCount = (params.voucher.printCount || 0) + 1;
    const isReprintActual = params.isReprint || currentCount > 1;

    // حالة التوقيع بعد الطباعة: تمت الطباعة / بانتظار توقيع العميل
    const nextStatus: SignatureStatus =
      params.voucher.signatureStatus === 'signed_manually'
        ? 'signed_manually'
        : isReprintActual
        ? 'reprinted'
        : 'printed';

    const logEntry: PrintAuditLogEntry = {
      id: `print-log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      operationNumber: params.voucher.referenceNumber || params.voucher.voucherNumber,
      voucherNumber: params.voucher.voucherNumber,
      voucherType: params.voucher.type,
      voucherTitleAr: this.getVoucherTitle(params.voucher),
      printedBy: `${params.user.name} (${params.user.roleTitleAr})`,
      printedAt: timestampStr,
      paperSize: params.paperSize,
      printCount: currentCount,
      isReprint: isReprintActual,
      reprintReason: isReprintActual ? (params.reprintReason || 'إعادة طباعة نسخة ورقية رسمية') : undefined,
      signatureStatus: nextStatus,
      signedReceiptBy: params.voucher.signedReceiptBy,
      signedReceiptAt: params.voucher.signedReceiptAt,
      notes: isReprintActual
        ? `أعيدت الطباعة للمرة رقم ${currentCount} بحجم (${params.paperSize.toUpperCase()}). مبرر الإعادة: ${params.reprintReason || 'طلب نسخة بديلة'}`
        : `تمت الطباعة لأول مرة بحجم (${params.paperSize.toUpperCase()}) لتسليمها للعميل للتوقيع اليدوي.`,
    };

    // حفظ في السجل المحلي
    const existingLogs = this.getLogs();
    offlineStorage.savePrintAuditLogs([logEntry, ...existingLogs]);

    // تحديث كائن السند مع الاحتفاظ الكامل ببياناته الأصلية
    const updatedVoucher: OfficialVoucher = {
      ...params.voucher,
      printCount: currentCount,
      isReprint: isReprintActual,
      reprintReason: isReprintActual ? (params.reprintReason || params.voucher.reprintReason) : undefined,
      lastPrintedAt: timestampStr,
      lastPrintedBy: `${params.user.name} (${params.user.roleTitleAr})`,
      lastPaperSize: params.paperSize,
      signatureStatus: nextStatus,
    };

    return { updatedVoucher, logEntry };
  }

  /**
   * تسجيل استلام النسخة الأصلية الموقعة يدوياً من قبل الموظف
   */
  public recordManualSignatureReceipt(params: {
    voucher: OfficialVoucher;
    user: UserProfile;
    notes?: string;
  }): { updatedVoucher: OfficialVoucher; logEntry: PrintAuditLogEntry } {
    const now = new Date();
    const timestampStr = now.toISOString().replace('T', ' ').substring(0, 19);

    const logEntry: PrintAuditLogEntry = {
      id: `sig-receipt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      operationNumber: params.voucher.referenceNumber || params.voucher.voucherNumber,
      voucherNumber: params.voucher.voucherNumber,
      voucherType: params.voucher.type,
      voucherTitleAr: this.getVoucherTitle(params.voucher),
      printedBy: `${params.user.name} (${params.user.roleTitleAr})`,
      printedAt: timestampStr,
      paperSize: params.voucher.lastPaperSize || 'a4',
      printCount: params.voucher.printCount || 1,
      isReprint: Boolean(params.voucher.isReprint),
      signatureStatus: 'signed_manually',
      signedReceiptBy: `${params.user.name} (${params.user.roleTitleAr})`,
      signedReceiptAt: timestampStr,
      notes: params.notes || `تم استلام النسخة الأصلية الموقعة يدوياً من العميل واعتمادها وإيداعها في الأرشيف الورقي للمؤسسة.`,
    };

    const existingLogs = this.getLogs();
    offlineStorage.savePrintAuditLogs([logEntry, ...existingLogs]);

    const updatedVoucher: OfficialVoucher = {
      ...params.voucher,
      signatureStatus: 'signed_manually',
      signedReceiptAt: timestampStr,
      signedReceiptBy: `${params.user.name} (${params.user.roleTitleAr})`,
    };

    return { updatedVoucher, logEntry };
  }

  /**
   * المسمى العربي لنوع السند
   */
  public getVoucherTitle(voucher: OfficialVoucher): string {
    if (voucher.templateType === 'deposit') return 'سند إيداع حوالة';
    if (voucher.templateType === 'payout') return 'سند صرف حوالة';
    if (voucher.templateType === 'send') return 'سند إرسال حوالة';

    switch (voucher.type) {
      case 'transfer_outgoing':
        return 'سند إرسال حوالة';
      case 'transfer_incoming':
        return 'سند صرف حوالة';
      case 'exchange':
        return 'سند صرف عملة';
      case 'receipt':
        return 'سند إيداع حوالة';
      case 'payment':
        return 'سند صرف مالي';
      default:
        return 'سند مالي رسمي';
    }
  }
}

export const printAuditService = PrintAuditService.getInstance();
