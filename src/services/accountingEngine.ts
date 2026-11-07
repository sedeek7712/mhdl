import { CurrencyCode, JournalEntry, JournalEntryLine, SUPPORTED_CURRENCIES } from '../types/exchange';

/**
 * دالة التفقيط باللغة العربية (تحويل الأرقام إلى نصوص بالريال والدولار)
 */
export function tafqeetArabic(amount: number, currency: CurrencyCode): string {
  if (isNaN(amount) || amount === 0) return 'صفر ' + getCurrencyLabel(currency) + ' فقط لا غير';

  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const integerPart = Math.floor(absAmount);
  const decimalPart = Math.round((absAmount - integerPart) * 100);

  const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
  const teens = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const hundreds = ['', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

  function convertGroup(n: number): string {
    let result = '';
    const h = Math.floor(n / 100);
    const remainder = n % 100;
    const t = Math.floor(remainder / 10);
    const o = remainder % 10;

    if (h > 0) {
      result += hundreds[h];
      if (remainder > 0) result += ' و ';
    }

    if (remainder >= 10 && remainder <= 19) {
      result += teens[remainder - 10];
    } else {
      if (o > 0) {
        result += ones[o];
        if (t > 0) result += ' و ';
      }
      if (t > 0) {
        result += tens[t];
      }
    }
    return result;
  }

  function numberToWords(num: number): string {
    if (num === 0) return 'صفر';
    const billions = Math.floor(num / 1000000000);
    num %= 1000000000;
    const millions = Math.floor(num / 1000000);
    num %= 1000000;
    const thousands = Math.floor(num / 1000);
    const remainder = num % 1000;

    const parts: string[] = [];

    if (billions > 0) {
      if (billions === 1) parts.push('مليار');
      else if (billions === 2) parts.push('ملياران');
      else if (billions >= 3 && billions <= 10) parts.push(convertGroup(billions) + ' مليارات');
      else parts.push(convertGroup(billions) + ' مليار');
    }

    if (millions > 0) {
      if (millions === 1) parts.push('مليون');
      else if (millions === 2) parts.push('مليونان');
      else if (millions >= 3 && millions <= 10) parts.push(convertGroup(millions) + ' ملايين');
      else parts.push(convertGroup(millions) + ' مليون');
    }

    if (thousands > 0) {
      if (thousands === 1) parts.push('ألف');
      else if (thousands === 2) parts.push('ألفان');
      else if (thousands >= 3 && thousands <= 10) parts.push(convertGroup(thousands) + ' آلاف');
      else parts.push(convertGroup(thousands) + ' ألف');
    }

    if (remainder > 0) {
      parts.push(convertGroup(remainder));
    }

    return parts.join(' و ');
  }

  let words = numberToWords(integerPart) + ' ' + getCurrencyLabel(currency);

  if (decimalPart > 0) {
    words += ' و ' + numberToWords(decimalPart) + ' ' + getFractionLabel(currency);
  }

  return (isNegative ? 'سالب ' : '') + words + ' فقط لا غير.';
}

function getCurrencyLabel(currency: CurrencyCode): string {
  switch (currency) {
    case 'YER_OLD':
      return 'ريال يمني (طبعة قديمة)';
    case 'YER_NEW':
      return 'ريال يمني (طبعة جديدة)';
    case 'SAR':
      return 'ريال سعودي';
    case 'USD':
      return 'دولار أمريكي';
    default:
      return '';
  }
}

function getFractionLabel(currency: CurrencyCode): string {
  switch (currency) {
    case 'SAR':
      return 'هللة';
    case 'USD':
      return 'سنت';
    default:
      return 'فلس';
  }
}

/**
 * فحص توازن القيد المحاسبي المزدوج
 * Double-Entry Invariant: For balanced ledger, sum of debits must match sum of credits per currency
 */
export function validateDoubleEntryBalance(lines: JournalEntryLine[]): {
  isBalanced: boolean;
  byCurrency: Record<CurrencyCode, { debit: number; credit: number; diff: number }>;
} {
  const byCurrency: Record<CurrencyCode, { debit: number; credit: number; diff: number }> = {
    YER_OLD: { debit: 0, credit: 0, diff: 0 },
    YER_NEW: { debit: 0, credit: 0, diff: 0 },
    SAR: { debit: 0, credit: 0, diff: 0 },
    USD: { debit: 0, credit: 0, diff: 0 },
  };

  for (const line of lines) {
    const cur = line.currency;
    if (!byCurrency[cur]) {
      byCurrency[cur] = { debit: 0, credit: 0, diff: 0 };
    }
    byCurrency[cur].debit += line.debit;
    byCurrency[cur].credit += line.credit;
  }

  let isBalanced = true;
  for (const cur of Object.keys(byCurrency) as CurrencyCode[]) {
    const d = Math.round(byCurrency[cur].debit * 100) / 100;
    const c = Math.round(byCurrency[cur].credit * 100) / 100;
    const diff = Math.round(Math.abs(d - c) * 100) / 100;
    byCurrency[cur].diff = diff;
    if (diff > 0.01) {
      isBalanced = false;
    }
  }

  return { isBalanced, byCurrency };
}

/**
 * تنسيق المبالغ المالية مع العملة وفواصل الآلاف
 */
export function formatMoney(amount: number, currency: CurrencyCode): string {
  const info = SUPPORTED_CURRENCIES[currency];
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: info.precision,
    maximumFractionDigits: info.precision,
  }).format(amount);
  return `${formatted} ${info.symbol}`;
}
