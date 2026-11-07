import { OfficialVoucher, Remittance, SUPPORTED_CURRENCIES } from '../types/exchange';
import { formatMoney } from './accountingEngine';

/**
 * محرك السندات والإشعارات المركزي (Notification & Receipt Engine)
 * لشركة عمرو النماري للصرافة
 */

export function generateVoucherQrString(voucher: OfficialVoucher): string {
  // ISO/ZATCA/Central Bank style verification payload
  return JSON.stringify({
    co: 'عمرو النماري للصرافة',
    vNo: voucher.voucherNumber,
    type: voucher.type,
    dt: `${voucher.date} ${voucher.time}`,
    amt: voucher.amount,
    cur: voucher.currency,
    party: voucher.partyName,
    ref: voucher.referenceNumber,
    hash: 'AN-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
  });
}

export function formatWhatsAppMessageLikeScreenshot(voucher: OfficialVoucher): string {
  const curInfo = SUPPORTED_CURRENCIES[voucher.currency];
  const now = new Date();
  const timeFormatted = `${voucher.time || '10:33:16'} ص`;
  const dateFormatted = voucher.date ? voucher.date.split('-').reverse().join('/') : '31/10/2026';
  const generalNumber = `${voucher.referenceNumber || voucher.voucherNumber}/1211005`;

  // Read sender and recipient strictly and independently from the voucher record
  let sender = '';
  let recipient = '';
  let network = voucher.networkName || voucher.branchName || 'شركة تحويل للصرافة';

  if (voucher.type === 'transfer_outgoing') {
    sender = voucher.senderName ?? voucher.partyName ?? '';
    recipient = voucher.recipientName !== undefined && voucher.recipientName !== null ? voucher.recipientName : '';
  } else if (voucher.type === 'transfer_incoming') {
    recipient = voucher.recipientName ?? voucher.partyName ?? '';
    sender = voucher.senderName !== undefined && voucher.senderName !== null ? voucher.senderName : '';
  } else {
    sender = voucher.senderName ?? voucher.partyName ?? '';
    recipient = voucher.recipientName ?? '';
  }

  // Fallback to parsing notes ONLY if the specific field was not provided in the voucher record
  if (voucher.notes) {
    if (!recipient && voucher.notes.includes('المستلم:')) {
      const parts = voucher.notes.split('-');
      for (const p of parts) {
        if (p.includes('المستلم:')) {
          recipient = p.replace('المستلم:', '').split('(')[0].trim();
          break;
        }
      }
    }
    if (!sender && voucher.notes.includes('المرسل:')) {
      const parts = voucher.notes.split('-');
      for (const p of parts) {
        if (p.includes('المرسل:')) {
          sender = p.replace('المرسل:', '').split('(')[0].trim();
          break;
        }
      }
    }
    if (!voucher.networkName && voucher.notes.includes('الشبكة:')) {
      const parts = voucher.notes.split('-');
      for (const p of parts) {
        if (p.includes('الشبكة:')) {
          network = p.replace('الشبكة:', '').trim();
          break;
        }
      }
    }
  }

  if (voucher.type === 'transfer_incoming') {
    return `(إستلام حوالة)
لكم حوالة ${new Intl.NumberFormat('en-US').format(voucher.amount)} ${curInfo.nameAr}

مقابل حوالة واردة عن طريق: ${network}
مبلغ الحوالة: ${new Intl.NumberFormat('en-US').format(voucher.amount)}
عملة الحوالة: ${curInfo.nameAr}
المستلم: ${recipient}
المرسل: ${sender}
رقم الحوالة: ${voucher.referenceNumber || voucher.voucherNumber}

${timeFormatted} ${dateFormatted}
/الرقم العام ${generalNumber}`;
  }

  if (voucher.type === 'transfer_outgoing') {
    return `(إرسال حوالة)
تم إرسال حوالة بمبلغ ${new Intl.NumberFormat('en-US').format(voucher.amount)} ${curInfo.nameAr}

عن طريق: ${network}
مبلغ الحوالة: ${new Intl.NumberFormat('en-US').format(voucher.amount)}
عملة الحوالة: ${curInfo.nameAr}
المرسل: ${sender}
المستلم: ${recipient}
رقم الحوالة: ${voucher.referenceNumber || voucher.voucherNumber}
العمولة: ${voucher.commission ? `${voucher.commission} ${curInfo.symbol}` : '0'}

${timeFormatted} ${dateFormatted}
/الرقم العام ${generalNumber}`;
  }

  if (voucher.type === 'exchange') {
    const targetCur = voucher.receivedCurrency ? SUPPORTED_CURRENCIES[voucher.receivedCurrency]?.nameAr : '';
    return `(صرافة عملات)
تمت عملية الصرف بنجاح

المبلغ المسلَّم: ${new Intl.NumberFormat('en-US').format(voucher.amount)} ${curInfo.nameAr}
المبلغ المقبوض: ${voucher.receivedAmount ? new Intl.NumberFormat('en-US').format(voucher.receivedAmount) : ''} ${targetCur}
سعر الصرف: ${voucher.exchangeRate || 1}
العميل: ${voucher.partyName}
رقم السند: ${voucher.voucherNumber}

${timeFormatted} ${dateFormatted}
/الرقم العام ${generalNumber}`;
  }

  return `(سند مالي معتمد)
سند رقم: ${voucher.voucherNumber}
المبلغ: ${new Intl.NumberFormat('en-US').format(voucher.amount)} ${curInfo.nameAr}
فقط وقدره: ${voucher.amountInWordsAr}
العميل: ${voucher.partyName}

${timeFormatted} ${dateFormatted}
/الرقم العام ${generalNumber}`;
}

export function formatWhatsAppMessageForVoucher(voucher: OfficialVoucher): string {
  // Use the screenshot-exact template as default
  return formatWhatsAppMessageLikeScreenshot(voucher);
}

export function buildWhatsAppLink(phone: string, text: string): string {
  // Normalize Yemeni or Saudi phone number
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
  if (cleanPhone.startsWith('0') && cleanPhone.length === 10) cleanPhone = '967' + cleanPhone.substring(1);
  if (cleanPhone.length === 9 && !cleanPhone.startsWith('967') && !cleanPhone.startsWith('966')) {
    cleanPhone = '967' + cleanPhone; // default Yemen
  }
  const encodedText = encodeURIComponent(text);
  return `https://wa.me/${cleanPhone}?text=${encodedText}`;
}
