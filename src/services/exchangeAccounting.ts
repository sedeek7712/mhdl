import { CurrencyCode, JournalEntryLine } from '../types/exchange';

export interface ExchangePostingInput {
  sourceCurrency: CurrencyCode;
  sourceAmount: number;
  targetCurrency: CurrencyCode;
  targetAmount: number;
  commission: number;
}

/**
 * Builds a per-currency balanced exchange posting.
 * The commission is denominated in the target currency because the exchange desk
 * deducts it from the gross target amount before paying the customer.
 */
export function buildExchangeJournalLines(input: ExchangePostingInput): {
  lines: JournalEntryLine[];
  grossTargetAmount: number;
} {
  const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

  if (input.sourceCurrency === input.targetCurrency) {
    throw new Error('عملة المصدر والهدف يجب أن تكونا مختلفتين.');
  }
  for (const [label, value] of [
    ['مبلغ المصدر', input.sourceAmount],
    ['مبلغ الهدف', input.targetAmount],
    ['العمولة', input.commission],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 ||
        Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) {
      throw new Error(`${label} يجب أن يكون رقماً صالحاً حتى منزلتين عشريتين.`);
    }
  }
  if (input.sourceAmount <= 0 || input.targetAmount <= 0) {
    throw new Error('مبلغ الصرافة والمبلغ الصافي يجب أن يكونا أكبر من صفر.');
  }

  const grossTargetAmount = money(input.targetAmount + input.commission);
  if (grossTargetAmount <= input.commission) {
    throw new Error('العمولة يجب أن تكون أقل من إجمالي مبلغ الصرافة.');
  }

  const lines: JournalEntryLine[] = [
    {
      accountId: 'acc-1102',
      accountNameAr: 'صندوق كاشير الصراف 1',
      currency: input.sourceCurrency,
      debit: input.sourceAmount,
      credit: 0,
      note: 'قبض نقدي من العميل',
    },
    {
      accountId: 'acc-2101',
      accountNameAr: 'أمانات العملاء ووسيط التسوية',
      currency: input.sourceCurrency,
      debit: 0,
      credit: input.sourceAmount,
      note: 'إثبات العملة المقبوضة في حساب التسوية',
    },
    {
      accountId: 'acc-2101',
      accountNameAr: 'أمانات العملاء ووسيط التسوية',
      currency: input.targetCurrency,
      debit: grossTargetAmount,
      credit: 0,
      note: 'إقفال إجمالي التزام العملة المسلّمة',
    },
    {
      accountId: 'acc-1102',
      accountNameAr: 'صندوق كاشير الصراف 1',
      currency: input.targetCurrency,
      debit: 0,
      credit: input.targetAmount,
      note: 'تسليم صافي العملة للعميل',
    },
  ];

  if (input.commission > 0) {
    lines.push({
      accountId: 'acc-4101',
      accountNameAr: 'إيرادات عمولات الصرافة',
      currency: input.targetCurrency,
      debit: 0,
      credit: input.commission,
      note: 'إثبات عمولة الصرافة بعملة المبلغ المستهدف',
    });
  }

  return { lines, grossTargetAmount };
}
