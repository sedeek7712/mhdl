import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveAuthoritativeVoucher,
  type AuthoritativeVoucherInput,
  type VoucherActor,
  type VoucherJournalEntry,
  type VoucherMasterRecord,
  type VoucherPayoutRecord,
} from '../src/server/services/authoritativeVoucher.js';

const actor: VoucherActor = {
  id: 'user-teller-1',
  name: 'الصراف الأول',
  role: 'teller',
  branchId: 'branch-1',
  branchName: 'فرع الاختبار',
};

const accounts = [
  'acc-1102',
  'acc-2101',
  'acc-4101',
  'acc-2201',
  'acc-1301',
  'acc-5101',
  'acc-5102',
];

function exchangeEntry(): VoucherJournalEntry {
  return {
    id: 'journal-exchange-1',
    entryNumber: 'JV-EX-2026-0001',
    date: '2026-11-10',
    time: '08:30',
    descriptionAr: 'صرافة 100 USD مقابل 370 SAR بسعر 3.75',
    referenceType: 'exchange',
    referenceId: 'V-EX-001',
    voucherNumber: 'V-EX-001',
    branchId: 'branch-1',
    createdBy: actor.name,
    createdById: actor.id,
    isBalanced: true,
    exchangeRate: 3.75,
    grossTargetAmount: 375,
    targetAmount: 370,
    lines: [
      { accountId: 'acc-1102', accountNameAr: 'الصندوق', currency: 'USD', debit: 100, credit: 0, note: 'قبض نقدي من العميل سالم' },
      { accountId: 'acc-2101', accountNameAr: 'التسوية', currency: 'USD', debit: 0, credit: 100 },
      { accountId: 'acc-2101', accountNameAr: 'التسوية', currency: 'SAR', debit: 375, credit: 0 },
      { accountId: 'acc-1102', accountNameAr: 'الصندوق', currency: 'SAR', debit: 0, credit: 370, note: 'تسليم صافي العملة للعميل سالم' },
      { accountId: 'acc-4101', accountNameAr: 'العمولات', currency: 'SAR', debit: 0, credit: 5 },
    ],
  };
}

function outgoingEntry(): VoucherJournalEntry {
  return {
    id: 'journal-outgoing-1',
    entryNumber: 'JV-OUT-2026-0001',
    date: '2026-11-10',
    time: '09:10',
    descriptionAr: 'إرسال حوالة صادرة TR-001 للمستلم مريم عبر شبكة النجم',
    referenceType: 'transfer_send',
    referenceId: 'TR-001',
    voucherNumber: 'V-OUT-001',
    branchId: 'branch-1',
    createdBy: actor.name,
    createdById: actor.id,
    isBalanced: true,
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    lines: [
      { accountId: 'acc-1102', accountNameAr: 'الصندوق', currency: 'SAR', debit: 105, credit: 0 },
      { accountId: 'acc-2201', accountNameAr: 'التزام الشبكة', currency: 'SAR', debit: 0, credit: 100 },
      { accountId: 'acc-4101', accountNameAr: 'العمولات', currency: 'SAR', debit: 0, credit: 5 },
    ],
  };
}

function outgoingMaster(): VoucherMasterRecord {
  return {
    id: 'remittance-1',
    transferNumber: 'TR-001',
    direction: 'outgoing',
    status: 'approved',
    senderName: 'أحمد',
    senderPhone: '+967700000001',
    recipientName: 'مريم',
    recipientPhone: '+967700000002',
    networkName: 'شبكة النجم',
    amount: 100,
    currency: 'SAR',
    feeAmount: 5,
    totalPaid: 105,
    branchName: 'فرع الاختبار',
    branchId: actor.branchId,
    tellerId: actor.id,
    tellerName: actor.name,
    voucherNumber: 'V-OUT-001',
    journalEntryReference: 'JV-OUT-2026-0001',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  };
}

function resolve(input: AuthoritativeVoucherInput, entry: VoucherJournalEntry, extra: {
  masterRemittance?: VoucherMasterRecord;
  payoutRecord?: VoucherPayoutRecord;
} = {}) {
  return resolveAuthoritativeVoucher({
    input,
    actor,
    journalEntries: [entry],
    accountIds: accounts,
    ...extra,
  });
}

test('builds an exchange voucher snapshot from the balanced server journal', () => {
  const entry = exchangeEntry();
  const input: AuthoritativeVoucherInput = {
    voucherNumber: entry.voucherNumber!,
    transactionId: entry.entryNumber,
    voucherType: 'exchange',
    recipientPhone: '+967700000003',
    snapshot: {
      voucherNumber: 'V-EX-001',
      transactionId: entry.entryNumber,
      type: 'exchange',
      amount: 100,
      currency: 'USD',
      partyName: 'سالم',
      referenceNumber: entry.entryNumber,
    },
  };
  const result = resolve(input, entry);
  assert.equal(result.amount, 100);
  assert.equal(result.currency, 'USD');
  assert.equal(result.receivedAmount, 370);
  assert.equal(result.receivedCurrency, 'SAR');
  assert.equal(result.commission, 5);
  assert.equal(result.partyName, 'سالم');
});

test('rejects a client voucher amount that differs from the journal', () => {
  const entry = exchangeEntry();
  assert.throws(() => resolve({
    voucherNumber: entry.voucherNumber!,
    transactionId: entry.entryNumber,
    voucherType: 'exchange',
    recipientPhone: '+967700000003',
    snapshot: { amount: 999, currency: 'USD' },
  }, entry), /amount/);
});

test('rejects an unbalanced journal even if the client marks the voucher as valid', () => {
  const entry = exchangeEntry();
  entry.lines[1].credit = 99;
  assert.throws(() => resolve({
    voucherNumber: entry.voucherNumber!,
    transactionId: entry.entryNumber,
    voucherType: 'exchange',
    recipientPhone: '+967700000003',
  }, entry), /غير متوازن/);
});

test('builds an outgoing remittance voucher from the master remittance and its journal', () => {
  const entry = outgoingEntry();
  const master = outgoingMaster();
  const result = resolve({
    voucherNumber: master.voucherNumber!,
    transactionId: master.transferNumber,
    voucherType: 'transfer_outgoing',
    recipientPhone: master.recipientPhone,
    snapshot: {
      voucherNumber: master.voucherNumber,
      transactionId: master.transferNumber,
      type: 'transfer_outgoing',
      referenceNumber: master.transferNumber,
      partyName: master.senderName,
      amount: master.amount,
      currency: master.currency,
      senderName: master.senderName,
      recipientName: master.recipientName,
      recipientPhone: master.recipientPhone,
      networkName: master.networkName,
      commission: master.feeAmount,
      totalPaid: master.totalPaid,
    },
  }, entry, { masterRemittance: master });
  assert.equal(result.amount, 100);
  assert.equal(result.commission, 5);
  assert.equal(result.totalPaid, 105);
  assert.equal(result.senderName, 'أحمد');
  assert.equal(result.recipientName, 'مريم');
});

test('rejects a teller attempting to send a voucher from another branch', () => {
  const entry = outgoingEntry();
  entry.branchId = 'branch-2';
  const master = outgoingMaster();
  master.branchId = 'branch-2';
  assert.throws(() => resolve({
    voucherNumber: master.voucherNumber!,
    transactionId: master.transferNumber,
    voucherType: 'transfer_outgoing',
    recipientPhone: master.recipientPhone,
  }, entry, { masterRemittance: master }), /سجل الحوالات المعتمد/);
});

test('builds a received remittance voucher only from a paid payout journal', () => {
  const entry: VoucherJournalEntry = {
    id: 'journal-payout-1',
    entryNumber: 'JV-2026-0002',
    date: '2026-11-10',
    time: '10:20',
    descriptionAr: 'صرف حوالة واردة TR-IN-1 للمستفيد مريم',
    referenceType: 'transfer_payout',
    referenceId: 'TR-IN-1',
    branchId: actor.branchId,
    createdBy: actor.name,
    isBalanced: true,
    lines: [
      { accountId: 'acc-1301', accountNameAr: 'الشبكة', currency: 'USD', debit: 50, credit: 0 },
      { accountId: 'acc-1102', accountNameAr: 'الصندوق', currency: 'USD', debit: 0, credit: 50 },
    ],
  };
  const master: VoucherMasterRecord = {
    id: 'incoming-master-1',
    transferNumber: 'TR-IN-1',
    direction: 'incoming',
    status: 'paid',
    senderName: 'أحمد',
    senderPhone: '+967700000001',
    recipientName: 'مريم',
    recipientPhone: '+967700000002',
    networkName: 'شبكة النجم',
    amount: 50,
    currency: 'USD',
    feeAmount: 0,
    totalPaid: 50,
    branchName: 'مركز تسجيل الحوالات',
    tellerName: actor.name,
    voucherNumber: 'V-PAY-001',
  };
  const payout: VoucherPayoutRecord = {
    transferNumber: 'TR-IN-1',
    tellerId: actor.id,
    tellerName: actor.name,
    amount: 50,
    currency: 'USD',
    recipientIdType: 'national_id',
    recipientIdNumber: '123456789',
    voucherNumber: 'V-PAY-001',
    journalEntryReference: entry.entryNumber,
  };

  const result = resolve({
    voucherNumber: 'V-PAY-001',
    transactionId: 'TR-IN-1',
    voucherType: 'transfer_incoming',
    recipientPhone: master.recipientPhone,
    snapshot: {
      voucherNumber: 'V-PAY-001',
      transactionId: 'TR-IN-1',
      type: 'transfer_incoming',
      referenceNumber: 'TR-IN-1',
      amount: 50,
      currency: 'USD',
      partyName: 'مريم',
      senderName: 'أحمد',
      recipientName: 'مريم',
      recipientPhone: '+967700000002',
      networkName: 'شبكة النجم',
    },
  }, entry, { masterRemittance: master, payoutRecord: payout });

  assert.equal(result.amount, 50);
  assert.equal(result.type, 'transfer_incoming');
  assert.equal(result.recipientIdNumber, '123456789');
});

test('rejects an incoming remittance that has not actually been paid', () => {
  const entry = exchangeEntry();
  const master: VoucherMasterRecord = {
    id: 'incoming-master-2',
    transferNumber: 'TR-IN-2',
    direction: 'incoming',
    status: 'available',
    senderName: 'أحمد',
    senderPhone: '',
    recipientName: 'مريم',
    recipientPhone: '',
    networkName: 'شبكة النجم',
    amount: 50,
    currency: 'USD',
    feeAmount: 0,
    totalPaid: 50,
    branchName: actor.branchName,
    tellerName: actor.name,
    voucherNumber: 'V-INC-001',
  };
  assert.throws(() => resolve({
    voucherNumber: 'V-INC-001',
    transactionId: 'TR-IN-2',
    voucherType: 'transfer_incoming',
    recipientPhone: '+967700000002',
  }, entry, { masterRemittance: master }), /قبل تسجيل الصرف/);
});

test('builds internal-transfer vouchers only from the two balanced server account lines', () => {
  const voucherNumber = 'V-TRF-001';
  const entry: VoucherJournalEntry = {
    id: 'journal-internal-1',
    entryNumber: 'JV-TRF-2026-0001',
    date: '2026-11-10',
    time: '11:15',
    descriptionAr: 'مناقلة داخلية: تغذية صندوق الكاشير',
    referenceType: 'internal_transfer',
    referenceId: voucherNumber,
    voucherNumber,
    branchId: actor.branchId,
    createdBy: actor.name,
    isBalanced: true,
    lines: [
      { accountId: 'acc-1102', accountNameAr: 'صندوق الكاشير', currency: 'YER_OLD', debit: 25000, credit: 0 },
      { accountId: 'acc-1301', accountNameAr: 'الخزينة المركزية', currency: 'YER_OLD', debit: 0, credit: 25000 },
    ],
  };
  const result = resolve({
    voucherNumber,
    transactionId: voucherNumber,
    voucherType: 'transfer_outgoing',
    recipientPhone: '+967700000003',
    snapshot: {
      voucherNumber,
      transactionId: voucherNumber,
      type: 'transfer_outgoing',
      referenceNumber: voucherNumber,
      partyName: 'صندوق الكاشير',
      senderName: 'الخزينة المركزية',
      recipientName: 'صندوق الكاشير',
      amount: 25000,
      currency: 'YER_OLD',
    },
  }, entry);

  assert.equal(result.amount, 25000);
  assert.equal(result.senderName, 'الخزينة المركزية');
  assert.equal(result.recipientName, 'صندوق الكاشير');
});

test('rejects a voucher without a linked server journal entry', () => {
  assert.throws(() => resolve({
    voucherNumber: 'V-FAKE-001',
    transactionId: 'V-FAKE-001',
    voucherType: 'transfer_outgoing',
    recipientPhone: '+967700000003',
  }, exchangeEntry()), /لم يتم العثور على عملية مالية معتمدة/);
});
