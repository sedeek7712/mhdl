export type VoucherCurrency = 'YER_OLD' | 'YER_NEW' | 'SAR' | 'USD';
export type VoucherType = 'exchange' | 'transfer_outgoing' | 'transfer_incoming' | 'payment';

export interface VoucherActor {
  id: string;
  name: string;
  role: string;
  branchId: string;
  branchName: string;
}

export interface VoucherJournalLine {
  accountId: string;
  accountNameAr: string;
  currency: string;
  debit: number;
  credit: number;
  note?: string;
}

export interface VoucherJournalEntry {
  id: string;
  entryNumber: string;
  date: string;
  time: string;
  descriptionAr: string;
  lines: VoucherJournalLine[];
  referenceType: string;
  referenceId: string;
  branchId: string;
  createdBy: string;
  createdById?: string;
  isBalanced: boolean;
  idempotencyKey?: string;
  exchangeRate?: number;
  grossTargetAmount?: number;
  targetAmount?: number;
  voucherNumber?: string;
  customerPhone?: string;
}

export interface VoucherMasterRecord {
  id: string;
  transferNumber: string;
  direction: 'outgoing' | 'incoming';
  status: string;
  senderName: string;
  senderPhone: string;
  recipientName: string;
  recipientPhone: string;
  networkName: string;
  amount: number;
  currency: string;
  feeAmount: number;
  totalPaid: number;
  branchName: string;
  branchId?: string;
  tellerId?: string;
  tellerName: string;
  voucherNumber?: string;
  journalEntryReference?: string;
  idempotencyKey?: string;
}

export interface VoucherPayoutRecord {
  transferNumber: string;
  tellerId: string;
  tellerName: string;
  amount: number;
  currency: string;
  recipientIdType: string;
  recipientIdNumber: string;
  voucherNumber: string;
  journalEntryReference: string;
}

export interface ClientVoucherSnapshot {
  [key: string]: unknown;
}

export interface AuthoritativeVoucherInput {
  voucherNumber: string;
  transactionId: string;
  voucherType?: string;
  recipientPhone: string;
  snapshot?: ClientVoucherSnapshot;
}

export interface AuthoritativeVoucherResult {
  voucherNumber: string;
  transactionId: string;
  type: VoucherType;
  date: string;
  time: string;
  branchName: string;
  tellerName: string;
  partyName: string;
  partyPhone: string;
  amount: number;
  currency: VoucherCurrency;
  amountInWordsAr: string;
  referenceNumber: string;
  senderName?: string;
  recipientName?: string;
  recipientPhone?: string;
  networkName?: string;
  commission?: number;
  totalPaid?: number;
  receivedAmount?: number;
  receivedCurrency?: VoucherCurrency;
  exchangeRate?: number;
  recipientIdType?: string;
  recipientIdNumber?: string;
  notes: string;
  sourceJournalEntryId: string;
}

const CURRENCIES = new Set<VoucherCurrency>(['YER_OLD', 'YER_NEW', 'SAR', 'USD']);
const TOLERANCE = 0.001;

function fail(message: string): never {
  throw new Error(message);
}

function money(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
    return fail(`قيمة مالية غير صالحة في ${label}.`);
  }
  return Math.round(value * 100) / 100;
}

function currency(value: unknown, label: string): VoucherCurrency {
  if (typeof value !== 'string' || !CURRENCIES.has(value as VoucherCurrency)) {
    return fail(`عملة غير معتمدة في ${label}.`);
  }
  return value as VoucherCurrency;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE;
}

function normalizeNumber(value: string): string {
  return value.trim().toUpperCase();
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function assertRecipientBinding(input: AuthoritativeVoucherInput, snapshot: AuthoritativeVoucherResult): void {
  const expected = snapshot.recipientPhone || snapshot.partyPhone;
  if (!expected || !normalizePhone(expected) ||
      normalizePhone(input.recipientPhone) !== normalizePhone(expected)) {
    fail('رقم واتساب المستلم لا يطابق رقم هاتف العميل أو المستفيد المسجل في العملية المالية.');
  }
}

function assertSnapshotValue(
  snapshot: ClientVoucherSnapshot | undefined,
  key: string,
  expected: unknown,
  comparator?: (actual: unknown, expected: unknown) => boolean
): void {
  if (!snapshot || snapshot[key] === undefined || snapshot[key] === null || snapshot[key] === '') return;
  const matches = comparator ? comparator(snapshot[key], expected) : snapshot[key] === expected;
  if (!matches) fail(`بيانات صورة السند المرسلة لا تطابق سجل الخادم في الحقل (${key}).`);
}

function assertSnapshotMatches(
  input: AuthoritativeVoucherInput,
  snapshot: AuthoritativeVoucherResult
): void {
  if (input.voucherType && input.voucherType !== snapshot.type) {
    fail('نوع السند المرسل لا يطابق نوع العملية المالية في دفتر الأستاذ.');
  }
  assertSnapshotValue(input.snapshot, 'voucherNumber', snapshot.voucherNumber);
  assertSnapshotValue(input.snapshot, 'transactionId', snapshot.transactionId);
  assertSnapshotValue(input.snapshot, 'type', snapshot.type);
  assertSnapshotValue(input.snapshot, 'branchName', snapshot.branchName);
  assertSnapshotValue(input.snapshot, 'tellerName', snapshot.tellerName);
  assertSnapshotValue(input.snapshot, 'referenceNumber', snapshot.referenceNumber);
  assertSnapshotValue(input.snapshot, 'amount', snapshot.amount,
    (actual, expected) => typeof actual === 'number' && near(actual, expected as number));
  assertSnapshotValue(input.snapshot, 'currency', snapshot.currency);
  assertSnapshotValue(input.snapshot, 'partyName', snapshot.partyName);
  assertSnapshotValue(input.snapshot, 'senderName', snapshot.senderName);
  assertSnapshotValue(input.snapshot, 'recipientName', snapshot.recipientName);
  assertSnapshotValue(input.snapshot, 'recipientPhone', snapshot.recipientPhone);
  assertSnapshotValue(input.snapshot, 'networkName', snapshot.networkName);
  assertSnapshotValue(input.snapshot, 'commission', snapshot.commission,
    (actual, expected) => typeof actual === 'number' && typeof expected === 'number' && near(actual, expected));
  assertSnapshotValue(input.snapshot, 'totalPaid', snapshot.totalPaid,
    (actual, expected) => typeof actual === 'number' && typeof expected === 'number' && near(actual, expected));
  assertSnapshotValue(input.snapshot, 'receivedAmount', snapshot.receivedAmount,
    (actual, expected) => typeof actual === 'number' && typeof expected === 'number' && near(actual, expected));
  assertSnapshotValue(input.snapshot, 'receivedCurrency', snapshot.receivedCurrency);
}

function validateJournal(entry: VoucherJournalEntry, accountIds: Set<string>): void {
  if (!entry.isBalanced || !Array.isArray(entry.lines) || entry.lines.length < 2) {
    fail('القيد المحاسبي غير معتمد أو لا يحتوي أسطر قيد كافية.');
  }
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const line of entry.lines) {
    if (!accountIds.has(line.accountId)) fail('القيد يحتوي حساباً غير موجود في دفتر الحسابات.');
    const code = currency(line.currency, 'القيد المحاسبي');
    const debit = money(line.debit, 'مدين القيد');
    const credit = money(line.credit, 'دائن القيد');
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      fail('يوجد سطر قيد غير صالح؛ يجب أن يحتوي إما مديناً أو دائناً.');
    }
    const total = totals.get(code) || { debit: 0, credit: 0 };
    total.debit += debit;
    total.credit += credit;
    totals.set(code, total);
  }
  if (Array.from(totals.values()).some((total) => !near(total.debit, total.credit))) {
    fail('القيد غير متوازن حسب العملة؛ تم رفض إرسال السند.');
  }
}

function assertActorScope(entry: VoucherJournalEntry, actor: VoucherActor): void {
  if (!actor.id || !actor.branchId || !entry.branchId || entry.branchId !== actor.branchId) {
    fail('لا يملك المستخدم صلاحية إرسال سند من فرع آخر.');
  }
  if (actor.role === 'teller') {
    if (entry.createdById && entry.createdById !== actor.id) {
      fail('الصراف لا يستطيع إرسال سند عملية نفذها مستخدم آخر.');
    }
    if (!entry.createdById && entry.createdBy !== actor.name) {
      fail('الصراف لا يستطيع إرسال سند عملية لا تخص جلسته.');
    }
  }
}

function baseSnapshot(
  input: AuthoritativeVoucherInput,
  entry: VoucherJournalEntry,
  actor: VoucherActor,
  values: Omit<AuthoritativeVoucherResult, 'voucherNumber' | 'transactionId' | 'date' | 'time' | 'branchName' | 'tellerName' | 'sourceJournalEntryId'>
): AuthoritativeVoucherResult {
  const expected: AuthoritativeVoucherResult = {
    ...values,
    voucherNumber: input.voucherNumber,
    transactionId: input.transactionId,
    date: entry.date,
    time: entry.time,
    branchName: actor.branchName,
    tellerName: entry.createdBy,
    sourceJournalEntryId: entry.id,
  };
  assertSnapshotMatches(input, expected);
  return expected;
}

function resolveExchange(
  input: AuthoritativeVoucherInput,
  actor: VoucherActor,
  entry: VoucherJournalEntry
): AuthoritativeVoucherResult {
  if (entry.referenceType !== 'exchange' || entry.entryNumber !== input.transactionId ||
      entry.voucherNumber !== input.voucherNumber) {
    return fail('رقم السند أو رقم القيد لا يطابق عملية الصرافة في دفتر الأستاذ.');
  }
  assertActorScope(entry, actor);
  const cashLines = entry.lines.filter((line) => line.accountId === 'acc-1102');
  const sourceLines = cashLines.filter((line) => line.debit > 0);
  const targetLines = cashLines.filter((line) => line.credit > 0);
  if (sourceLines.length !== 1 || targetLines.length !== 1) {
    return fail('قيد الصرافة لا يحتوي حركة قبض وتسليم نقدي محددة بشكل فريد.');
  }
  const source = sourceLines[0];
  const target = targetLines[0];
  const sourceCurrency = currency(source.currency, 'عملة المصدر');
  const targetCurrency = currency(target.currency, 'عملة الهدف');
  if (sourceCurrency === targetCurrency) fail('عملتا المصدر والهدف في قيد الصرافة متطابقتان.');
  const amount = money(source.debit, 'مبلغ المصدر');
  const receivedAmount = money(target.credit, 'المبلغ المسلم');
  const targetAmount = money(entry.targetAmount, 'صافي مبلغ الهدف');
  const grossTargetAmount = money(entry.grossTargetAmount, 'إجمالي مبلغ الهدف');
  const commission = money(grossTargetAmount - targetAmount, 'عمولة الصرافة');
  if (!near(receivedAmount, targetAmount) || grossTargetAmount + TOLERANCE < targetAmount ||
      typeof entry.exchangeRate !== 'number' || !Number.isFinite(entry.exchangeRate) || entry.exchangeRate <= 0) {
    fail('مبالغ أو سعر قيد الصرافة لا تتطابق.');
  }
  const customer = (source.note || '').match(/^قبض نقدي من العميل\s+(.+)$/)?.[1]?.trim() || '';
  if (!customer) fail('لا يحتوي قيد الصرافة على اسم العميل الموثق.');
  return baseSnapshot(input, entry, actor, {
    type: 'exchange',
    partyName: customer,
    partyPhone: entry.customerPhone || '',
    recipientPhone: entry.customerPhone,
    amount,
    currency: sourceCurrency,
    amountInWordsAr: '',
    referenceNumber: entry.entryNumber,
    senderName: customer,
    recipientName: customer,
    receivedAmount,
    receivedCurrency: targetCurrency,
    exchangeRate: entry.exchangeRate,
    commission,
    notes: entry.descriptionAr,
  });
}

function resolveOutgoing(
  input: AuthoritativeVoucherInput,
  actor: VoucherActor,
  master: VoucherMasterRecord,
  entry: VoucherJournalEntry
): AuthoritativeVoucherResult {
  const transferNumber = normalizeNumber(master.transferNumber);
  if (master.direction !== 'outgoing' || master.status !== 'approved' ||
      transferNumber !== normalizeNumber(input.transactionId) ||
      master.voucherNumber !== input.voucherNumber ||
      !master.journalEntryReference || entry.entryNumber !== master.journalEntryReference ||
      entry.referenceType !== 'transfer_send' ||
      normalizeNumber(entry.referenceId) !== transferNumber ||
      entry.voucherNumber !== input.voucherNumber ||
      entry.idempotencyKey !== master.idempotencyKey ||
      entry.createdById !== master.tellerId ||
      entry.branchId !== master.branchId || master.branchId !== actor.branchId) {
    fail('الحوالة الصادرة أو قيدها لا يطابق سجل الحوالات المعتمد.');
  }
  assertActorScope(entry, actor);
  const amount = money(master.amount, 'مبلغ الحوالة الصادرة');
  const fee = money(master.feeAmount, 'عمولة الحوالة الصادرة');
  const totalPaid = money(master.totalPaid, 'إجمالي المستلم من المرسل');
  const code = currency(master.currency, 'عملة الحوالة الصادرة');
  if (!near(totalPaid, amount + fee)) fail('إجمالي مبلغ الحوالة لا يساوي المبلغ والعمولة.');
  const cash = entry.lines.filter((line) => line.accountId === 'acc-1102' &&
    line.currency === code && near(line.debit, totalPaid) && line.credit === 0);
  const payable = entry.lines.filter((line) => line.accountId === 'acc-2201' &&
    line.currency === code && near(line.credit, amount) && line.debit === 0);
  const commission = fee > 0
    ? entry.lines.filter((line) => line.accountId === 'acc-4101' &&
      line.currency === code && near(line.credit, fee) && line.debit === 0)
    : [];
  if (cash.length !== 1 || payable.length !== 1 || (fee > 0 && commission.length !== 1)) {
    fail('تفاصيل الصندوق والالتزام والعمولة في قيد الحوالة لا تتطابق مع سجل الحوالة.');
  }
  if (actor.role === 'teller' && master.tellerId !== actor.id) {
    fail('الصراف لا يستطيع إرسال سند حوالة نفذها مستخدم آخر.');
  }
  return baseSnapshot(input, entry, actor, {
    type: 'transfer_outgoing',
    partyName: master.senderName,
    partyPhone: master.senderPhone,
    senderName: master.senderName,
    recipientName: master.recipientName,
    recipientPhone: master.recipientPhone,
    networkName: master.networkName,
    amount,
    currency: code,
    amountInWordsAr: '',
    referenceNumber: master.transferNumber,
    commission: fee,
    totalPaid,
    notes: entry.descriptionAr,
  });
}

function resolvePayout(
  input: AuthoritativeVoucherInput,
  actor: VoucherActor,
  master: VoucherMasterRecord,
  payout: VoucherPayoutRecord,
  entry: VoucherJournalEntry
): AuthoritativeVoucherResult {
  const transferNumber = normalizeNumber(master.transferNumber);
  if (master.direction !== 'incoming' || master.status !== 'paid' ||
      transferNumber !== normalizeNumber(input.transactionId) ||
      payout.transferNumber.trim().toUpperCase() !== transferNumber ||
      payout.voucherNumber !== input.voucherNumber ||
      master.voucherNumber !== input.voucherNumber ||
      payout.journalEntryReference !== entry.entryNumber ||
      entry.referenceType !== 'transfer_payout' ||
      normalizeNumber(entry.referenceId) !== transferNumber ||
      entry.branchId !== actor.branchId) {
    fail('سند صرف الحوالة الواردة لا يطابق سجل الصرف والقيد المحاسبي.');
  }
  assertActorScope(entry, actor);
  if (actor.role === 'teller' && payout.tellerId !== actor.id) {
    fail('الصراف لا يستطيع إرسال سند صرف نفذه مستخدم آخر.');
  }
  const amount = money(master.amount, 'مبلغ الحوالة الواردة');
  const code = currency(master.currency, 'عملة الحوالة الواردة');
  if (!near(amount, money(payout.amount, 'مبلغ سجل الصرف')) || code !== currency(payout.currency, 'عملة سجل الصرف')) {
    fail('مبلغ أو عملة سجل الصرف لا يطابق الحوالة الواردة.');
  }
  const network = entry.lines.filter((line) => line.currency === code &&
    line.debit > 0 && line.accountId !== 'acc-1102' && near(line.debit, amount));
  const cash = entry.lines.filter((line) => line.accountId === 'acc-1102' &&
    line.currency === code && line.credit > 0 && near(line.credit, amount));
  if (network.length !== 1 || cash.length !== 1 || payout.journalEntryReference !== entry.entryNumber) {
    fail('قيد صرف الحوالة لا يطابق حساب الشبكة وصندوق الكاشير.');
  }
  return baseSnapshot(input, entry, actor, {
    type: 'transfer_incoming',
    partyName: master.recipientName,
    partyPhone: master.recipientPhone,
    senderName: master.senderName,
    recipientName: master.recipientName,
    recipientPhone: master.recipientPhone,
    networkName: master.networkName,
    amount,
    currency: code,
    amountInWordsAr: '',
    referenceNumber: master.transferNumber,
    commission: master.feeAmount,
    recipientIdType: payout.recipientIdType,
    recipientIdNumber: payout.recipientIdNumber,
    notes: entry.descriptionAr,
  });
}

function resolveInternalOrExpense(
  input: AuthoritativeVoucherInput,
  actor: VoucherActor,
  entry: VoucherJournalEntry
): AuthoritativeVoucherResult {
  if (entry.voucherNumber !== input.voucherNumber ||
      input.transactionId !== input.voucherNumber ||
      (entry.referenceType !== 'internal_transfer' && entry.referenceType !== 'expense')) {
    fail('السند لا يرتبط بقيد مناقلة داخلية أو مصروف معتمد.');
  }
  assertActorScope(entry, actor);
  if (actor.role === 'teller' && !entry.createdById && entry.createdBy !== actor.name) {
    fail('الصراف لا يستطيع إرسال سند عملية لا تخص جلسته.');
  }
  if (entry.referenceType === 'internal_transfer') {
    if (entry.lines.length !== 2) fail('قيد المناقلة الداخلية يجب أن يحتوي طرفين فقط.');
    const debit = entry.lines.find((line) => line.debit > 0);
    const credit = entry.lines.find((line) => line.credit > 0);
    if (!debit || !credit || debit.accountId === credit.accountId ||
        debit.currency !== credit.currency || !near(debit.debit, credit.credit)) {
      fail('قيد المناقلة الداخلية لا يطابق مبلغاً واحداً متوازناً.');
    }
    const code = currency(debit.currency, 'عملة المناقلة');
    const amount = money(debit.debit, 'مبلغ المناقلة');
    return baseSnapshot(input, entry, actor, {
      type: 'transfer_outgoing',
      partyName: debit.accountNameAr,
      partyPhone: '',
      senderName: credit.accountNameAr,
      recipientName: debit.accountNameAr,
      amount,
      currency: code,
      amountInWordsAr: '',
      referenceNumber: entry.voucherNumber,
      commission: 0,
      totalPaid: amount,
      notes: entry.descriptionAr,
    });
  }

  const expense = entry.lines.find((line) => line.accountId === 'acc-5101' && line.debit > 0);
  const cash = entry.lines.find((line) => line.accountId === 'acc-1102' && line.credit > 0);
  if (!expense || !cash || expense.currency !== cash.currency || !near(expense.debit, cash.credit)) {
    fail('قيد المصروف لا يطابق حساب المصروفات وصندوق الكاشير.');
  }
  const code = currency(expense.currency, 'عملة المصروف');
  const amount = money(expense.debit, 'مبلغ المصروف');
  return baseSnapshot(input, entry, actor, {
    type: 'payment',
    partyName: expense.accountNameAr,
    partyPhone: '',
    amount,
    currency: code,
    amountInWordsAr: '',
    referenceNumber: entry.voucherNumber!,
    notes: entry.descriptionAr,
  });
}

export function resolveAuthoritativeVoucher(params: {
  input: AuthoritativeVoucherInput;
  actor: VoucherActor;
  journalEntries: VoucherJournalEntry[];
  accountIds: string[];
  masterRemittance?: VoucherMasterRecord;
  payoutRecord?: VoucherPayoutRecord;
}): AuthoritativeVoucherResult {
  const { input, actor } = params;
  if (!input.voucherNumber?.trim() || !input.transactionId?.trim() ||
      !input.recipientPhone?.trim() || !Array.isArray(params.journalEntries)) {
    fail('رقم السند ورقم العملية ورقم هاتف المستلم مطلوبة.');
  }
  const accountIds = new Set(params.accountIds);
  const master = params.masterRemittance;
  const payout = params.payoutRecord;

  if (master?.direction === 'outgoing' &&
      normalizeNumber(master.transferNumber) === normalizeNumber(input.transactionId)) {
    const entry = params.journalEntries.find((item) =>
      item.entryNumber === master.journalEntryReference);
    if (!entry) fail('لم يتم العثور على القيد المرتبط بالحوالة الصادرة.');
    validateJournal(entry, accountIds);
    const resolved = resolveOutgoing(input, actor, master, entry);
    assertRecipientBinding(input, resolved);
    return resolved;
  }

  if (master?.direction === 'incoming' &&
      normalizeNumber(master.transferNumber) === normalizeNumber(input.transactionId)) {
    if (!payout) fail('لا يمكن إصدار سند صرف للحوالة قبل تسجيل الصرف الفعلي في دفتر الأستاذ.');
    const entry = params.journalEntries.find((item) => item.entryNumber === payout.journalEntryReference);
    if (!entry) fail('لم يتم العثور على القيد المرتبط بصرف الحوالة الواردة.');
    validateJournal(entry, accountIds);
    const resolved = resolvePayout(input, actor, master, payout, entry);
    assertRecipientBinding(input, resolved);
    return resolved;
  }

  const entry = params.journalEntries.find((item) =>
    item.voucherNumber === input.voucherNumber &&
    (item.entryNumber === input.transactionId || item.referenceId === input.transactionId ||
     item.voucherNumber === input.transactionId));
  if (!entry) fail('لم يتم العثور على عملية مالية معتمدة تطابق رقم السند والعملية.');
  validateJournal(entry, accountIds);

  const resolved = entry.referenceType === 'exchange'
    ? resolveExchange(input, actor, entry)
    : resolveInternalOrExpense(input, actor, entry);
  assertRecipientBinding(input, resolved);
  return resolved;
}
