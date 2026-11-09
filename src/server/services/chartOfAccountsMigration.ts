export type SupportedLedgerCurrency = 'YER_OLD' | 'YER_NEW' | 'SAR' | 'USD';

export interface ChartAccountDefinition {
  id: string;
  code: string;
  nameAr: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  category: string;
}

export interface ExistingLedgerAccount {
  id: string;
  code: string;
  name?: string;
  nameAr?: string;
  type: string;
  category: string;
  balances: Record<SupportedLedgerCurrency, number>;
  [key: string]: unknown;
}

export interface ChartReconciliationPlan {
  accounts: ExistingLedgerAccount[];
  added: ExistingLedgerAccount[];
}

/**
 * Builds a non-destructive chart reconciliation plan.
 * Existing account balances and metadata are preserved; missing chart accounts are added at zero.
 * Unknown or mismatched existing accounts are rejected for manual review.
 */
export function buildChartReconciliationPlan(
  existingAccounts: unknown,
  chartAccounts: ChartAccountDefinition[],
): ChartReconciliationPlan {
  const currencies: SupportedLedgerCurrency[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];

  if (!Array.isArray(existingAccounts) || !Array.isArray(chartAccounts) || chartAccounts.length === 0) {
    throw new Error('دفتر الحسابات أو دليل الحسابات المرجعي غير صالح.');
  }

  const chartById = new Map<string, ChartAccountDefinition>();
  for (const chartAccount of chartAccounts) {
    if (!chartAccount || typeof chartAccount.id !== 'string' || !chartAccount.id.trim() ||
        typeof chartAccount.code !== 'string' || !chartAccount.code.trim() ||
        typeof chartAccount.nameAr !== 'string' || !chartAccount.nameAr.trim() ||
        !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(chartAccount.type) ||
        typeof chartAccount.category !== 'string' || !chartAccount.category.trim()) {
      throw new Error('دليل الحسابات المرجعي يحتوي تعريف حساب غير صالح.');
    }
    if (chartById.has(chartAccount.id)) {
      throw new Error(`معرف حساب مكرر في دليل الحسابات المرجعي: ${chartAccount.id}`);
    }
    chartById.set(chartAccount.id, chartAccount);
  }

  const seen = new Set<string>();
  const preserved: ExistingLedgerAccount[] = [];

  for (const rawAccount of existingAccounts) {
    if (!rawAccount || typeof rawAccount !== 'object' || Array.isArray(rawAccount)) {
      throw new Error('دفتر الحسابات يحتوي سجلاً غير صالح؛ لم يتم إعداد أي ترحيل.');
    }

    const account = rawAccount as Record<string, unknown>;
    const id = typeof account.id === 'string' ? account.id : '';
    if (!id.trim() || seen.has(id)) {
      throw new Error(`معرف حساب مفقود أو مكرر في دفتر الخادم: ${id || 'غير معروف'}`);
    }
    seen.add(id);

    const chartAccount = chartById.get(id);
    if (!chartAccount) {
      throw new Error(`يوجد حساب في دفتر الخادم غير موجود في الدليل المرجعي (${id}). يلزم فحصه يدوياً قبل أي ترحيل.`);
    }

    const name = typeof account.nameAr === 'string' && account.nameAr.trim()
      ? account.nameAr
      : typeof account.name === 'string'
        ? account.name
        : '';
    if (account.code !== chartAccount.code ||
        account.type !== chartAccount.type ||
        account.category !== chartAccount.category ||
        name !== chartAccount.nameAr) {
      throw new Error(`بيانات الحساب (${id}) لا تطابق الدليل المرجعي. لم يتم تغيير الاسم أو النوع أو الفئة أو الرصيد.`);
    }

    const balances = account.balances;
    if (!balances || typeof balances !== 'object') {
      throw new Error(`أرصدة الحساب (${id}) غير صالحة.`);
    }
    for (const currency of currencies) {
      const balance = (balances as Record<string, unknown>)[currency];
      if (typeof balance !== 'number' || !Number.isFinite(balance)) {
        throw new Error(`رصيد الحساب (${id}) بالعملة (${currency}) غير صالح.`);
      }
    }

    preserved.push(rawAccount as ExistingLedgerAccount);
  }

  const added: ExistingLedgerAccount[] = chartAccounts
    .filter((account) => !seen.has(account.id))
    .map((account) => ({
      id: account.id,
      code: account.code,
      name: account.nameAr,
      type: account.type,
      category: account.category,
      balances: {
        YER_OLD: 0,
        YER_NEW: 0,
        SAR: 0,
        USD: 0,
      },
    }));

  return {
    accounts: [...preserved, ...added],
    added,
  };
}
