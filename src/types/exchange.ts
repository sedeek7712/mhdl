/**
 * نظام عمرو النماري للصرافة والحسابات (Amro Alnamari Exchange System)
 * تعريفات النماذج المحاسبية والمالية بناءً على وثيقة المتطلبات v1.0
 */

export type CurrencyCode = 'YER_OLD' | 'YER_NEW' | 'SAR' | 'USD';

export interface CurrencyInfo {
  code: CurrencyCode;
  nameAr: string;
  symbol: string;
  flag: string;
  precision: number;
}

export const SUPPORTED_CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  YER_OLD: {
    code: 'YER_OLD',
    nameAr: 'ريال يمني (قديم - صنعاء)',
    symbol: 'ر.ي.ق',
    flag: '🇾🇪',
    precision: 2,
  },
  YER_NEW: {
    code: 'YER_NEW',
    nameAr: 'ريال يمني (جديد - عدن)',
    symbol: 'ر.ي.ج',
    flag: '🇾🇪',
    precision: 2,
  },
  SAR: {
    code: 'SAR',
    nameAr: 'ريال سعودي',
    symbol: 'ر.س',
    flag: '🇸🇦',
    precision: 2,
  },
  USD: {
    code: 'USD',
    nameAr: 'دولار أمريكي',
    symbol: '$',
    flag: '🇺🇸',
    precision: 2,
  },
};

export type UserRole = 'owner' | 'general_manager' | 'branch_manager' | 'teller' | 'auditor';

export interface UserProfile {
  id: string;
  name: string;
  role: UserRole;
  roleTitleAr: string;
  branchId: string;
  branchName: string;
}

export interface ExchangeRate {
  id: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  buyRate: number;   // سعر الشراء من العميل
  sellRate: number;  // سعر البيع للعميل
  updatedAt: string;
  updatedBy: string;
}

export interface ExchangeRateAuditLog {
  id: string;
  currencyPair: string;
  oldBuyRate: number;
  newBuyRate: number;
  oldSellRate: number;
  newSellRate: number;
  changedAt: string;
  changedBy: string;
  note?: string;
}

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface Account {
  id: string;
  code: string;
  nameAr: string;
  type: AccountType;
  category: 'cash_box' | 'bank' | 'network' | 'customer' | 'capital' | 'exchange_profit' | 'commission' | 'operating_expense';
  balances: Record<CurrencyCode, number>; // أرصدة مستقلة لكل عملة دون دمج
  isLocked?: boolean;
}

export interface JournalEntryLine {
  accountId: string;
  accountNameAr: string;
  currency: CurrencyCode;
  debit: number;   // مدين
  credit: number;  // دائن
  note?: string;
}

export interface JournalEntry {
  id: string;
  entryNumber: string;
  date: string;
  time: string;
  descriptionAr: string;
  lines: JournalEntryLine[];
  referenceType: 'exchange' | 'transfer_send' | 'transfer_payout' | 'transfer_reverse' | 'expense' | 'opening' | 'internal_transfer';
  referenceId: string;
  branchId: string;
  createdBy: string;
  isBalanced: boolean;
}

export type TransferStatus = 'draft' | 'approved' | 'available' | 'paid' | 'cancelled' | 'refunded' | 'pending';

export type RemittanceNumberingMode = 'automatic' | 'manual';

export interface RemittanceSettings {
  numberingMode: RemittanceNumberingMode;
  prefix: string;
  nextSequence: number;
  updatedAt: string;
  updatedBy: string;
  updatedByRole: UserRole;
  notes?: string;
}

export interface SystemAuditLog {
  id: string;
  category: 'remittance_numbering' | 'security' | 'financial' | 'general';
  action: string;
  details: string;
  performedBy: string;
  userRole: UserRole;
  timestamp: string;
  oldValue?: string;
  newValue?: string;
}

export interface Remittance {
  id: string;
  transferNumber: string;
  direction: 'outgoing' | 'incoming';
  status: TransferStatus;
  senderName: string;
  senderPhone: string;
  recipientName: string;
  recipientPhone: string;
  networkName: string;
  amount: number;
  currency: CurrencyCode;
  feeAmount: number;
  totalPaid: number;
  branchName: string;
  tellerName: string;
  createdAt: string;
  paidAt?: string;
  recipientIdType?: 'national_id' | 'passport' | 'family_card';
  recipientIdNumber?: string;
  cancelReason?: string;
  reverseEntryId?: string;
  voucherNumber: string;
  notes?: string;
  numberingMode?: RemittanceNumberingMode;
}

export interface CashBoxShift {
  id: string;
  boxId: string;
  boxNameAr: string;
  tellerId: string;
  tellerName: string;
  openedAt: string;
  closedAt?: string;
  status: 'open' | 'closed';
  openingBalances: Record<CurrencyCode, number>;
  expectedBalances: Record<CurrencyCode, number>;
  actualBalances: Record<CurrencyCode, number>;
  discrepancies: Record<CurrencyCode, number>; // عجز أو زيادة
  notes?: string;
}

export type PaperSize = 'a4' | 'a5' | 'thermal_80mm' | 'thermal_58mm';

export type VoucherTemplateType = 'deposit' | 'payout' | 'send' | 'exchange' | 'general';

export type SignatureStatus =
  | 'pending_print'
  | 'printed'
  | 'pending_customer_signature'
  | 'signed_manually'
  | 'reprinted';

export interface PrintAuditLogEntry {
  id: string;
  operationNumber: string;
  voucherNumber: string;
  voucherType: string;
  voucherTitleAr: string;
  printedBy: string;
  printedAt: string;
  paperSize: PaperSize;
  printCount: number;
  isReprint: boolean;
  reprintReason?: string;
  signatureStatus: SignatureStatus;
  signedReceiptBy?: string;
  signedReceiptAt?: string;
  notes?: string;
}

export interface OfficialVoucher {
  id: string;
  voucherNumber: string;
  type: 'exchange' | 'transfer_outgoing' | 'transfer_incoming' | 'receipt' | 'payment';
  templateType?: VoucherTemplateType;
  date: string;
  time: string;
  branchName: string;
  tellerName: string;
  partyName: string;
  partyPhone: string;
  amount: number;
  currency: CurrencyCode;
  amountInWordsAr: string;
  receivedAmount?: number;
  receivedCurrency?: CurrencyCode;
  exchangeRate?: number;
  exchangeType?: 'buy' | 'sell';
  commission?: number;
  netAmount?: number;
  totalPaid?: number;
  accountNumber?: string;
  generalNumber?: string;
  senderName?: string;
  recipientName?: string;
  recipientPhone?: string;
  networkName?: string;
  qrCodeData: string;
  notes?: string;
  referenceNumber: string;
  dispatchStatus?: 'not_sent' | 'sent' | 'copied' | 'downloaded' | 'failed';
  dispatchedAt?: string;
  mediaUrl?: string;
  messageId?: string;
  deliveryStatus?: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';
  lifecycleStatus?: WhatsAppLifecycleStatus;
  sha256?: string;
  dispatchDetails?: any;
  // Professional Printing & Signature Lifecycle extensions
  depositorName?: string;
  depositMethod?: string;
  payoutMethod?: string;
  destinationCity?: string;
  destinationBranch?: string;
  recipientIdType?: string;
  recipientIdNumber?: string;
  signatureStatus?: SignatureStatus;
  signedReceiptAt?: string;
  signedReceiptBy?: string;
  printCount?: number;
  lastPrintedAt?: string;
  lastPrintedBy?: string;
  lastPaperSize?: PaperSize;
  reprintReason?: string;
  isReprint?: boolean;
}

export type WhatsAppLifecycleStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'GENERATED'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'SIMULATED'
  | 'FAILED'
  | 'RETRY_PENDING';

export interface WhatsAppNotificationPayload {
  recipientPhone: string;
  recipientName: string;
  messageText: string;
  voucherNumber: string;
  status: 'pending' | 'sent' | 'failed';
  timestamp: string;
  directWhatsAppUrl: string;
}

