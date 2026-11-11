import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { safeAtomicWriteJson, safeReadJson, getYemenDateTimeString } from '../utils/atomicFileStorage.js';
import { resolveDataDirectory } from '../utils/dataDirectory.js';

export type ShiftCurrency = 'YER_OLD' | 'YER_NEW' | 'SAR' | 'USD';
export type ShiftBalances = Record<ShiftCurrency, number>;

export interface ServerCashBoxShift {
  id: string;
  boxId: string;
  boxNameAr: string;
  tellerId: string;
  tellerName: string;
  openedAt: string;
  closedAt?: string;
  status: 'open' | 'closed';
  openingBalances: ShiftBalances;
  expectedBalances: ShiftBalances;
  actualBalances: ShiftBalances;
  discrepancies: ShiftBalances;
  notes?: string;
  openedByRole: string;
  closedBy?: string;
  closedById?: string;
  openIdempotencyKey: string;
  closeIdempotencyKey?: string;
}

interface ShiftState {
  schemaVersion: 1;
  activeShift: ServerCashBoxShift | null;
  history: ServerCashBoxShift[];
}

const CURRENCIES: ShiftCurrency[] = ['YER_OLD', 'YER_NEW', 'SAR', 'USD'];
const ZERO: ShiftBalances = { YER_OLD: 0, YER_NEW: 0, SAR: 0, USD: 0 };
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = resolveDataDirectory(path.resolve(__dirname, '../../../data'));
const STATE_FILE = path.resolve(DATA_DIR, 'cash_box_shift_state.json');

function validKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
}

function normalizeBalances(value: unknown): ShiftBalances | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const result = {} as ShiftBalances;
  for (const currency of CURRENCIES) {
    const amount = source[currency];
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 ||
        Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) return null;
    result[currency] = amount;
  }
  return result;
}

function fingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function createEmptyState(): ShiftState {
  return { schemaVersion: 1, activeShift: null, history: [] };
}

class ServerCashBoxShiftRegistry {
  private state: ShiftState;

  constructor() {
    const loaded = safeReadJson<ShiftState>(STATE_FILE, createEmptyState(), {
      failOnCorruption: true,
      failOnMissing: false,
    });
    if (!loaded || loaded.schemaVersion !== 1 || !Array.isArray(loaded.history) ||
        !(loaded.activeShift === null || (loaded.activeShift && loaded.activeShift.status === 'open'))) {
      throw new Error('توقف آمن: ملف الورديات غير صالح؛ لم يتم إنشاء وردية افتراضية.');
    }
    this.state = loaded;
  }

  private persist(next: ShiftState): boolean {
    try {
      safeAtomicWriteJson(STATE_FILE, next);
      this.state = next;
      return true;
    } catch {
      return false;
    }
  }

  public getActiveShift(): ServerCashBoxShift | null {
    return this.state.activeShift ? structuredClone(this.state.activeShift) : null;
  }

  public getHistory(): ServerCashBoxShift[] {
    return this.state.history.map((shift) => structuredClone(shift));
  }

  public openShift(params: {
    idempotencyKey: string;
    balances: unknown;
    actorId: string;
    actorName: string;
    actorRole: string;
    boxId?: string;
    boxNameAr?: string;
  }): { success: boolean; shift?: ServerCashBoxShift; replayed?: boolean; error?: string; errorCode?: string } {
    if (!validKey(params.idempotencyKey)) return { success: false, error: 'مفتاح فتح الوردية غير صالح.' };
    if (!params.actorId?.trim() || !params.actorName?.trim() || !params.actorRole?.trim()) {
      return { success: false, error: 'تعذر تحديد هوية المسؤول عن فتح الوردية.' };
    }
    const balances = normalizeBalances(params.balances);
    if (!balances) return { success: false, error: 'أرصدة الصندوق الحالية غير صالحة؛ لا يمكن فتح الوردية.' };

    // The opening balance is a server snapshot, not client input. Exclude it from the replay
    // fingerprint so a lost HTTP response can be safely replayed even after later ledger activity.
    const requestFingerprint = fingerprint({
      actorId: params.actorId, boxId: params.boxId || 'acc-1102',
    });
    const prior = this.state.activeShift?.openIdempotencyKey === params.idempotencyKey
      ? this.state.activeShift
      : this.state.history.find((shift) => shift.openIdempotencyKey === params.idempotencyKey);
    if (prior) {
      const priorFingerprint = (prior as any).openRequestFingerprint;
      if (priorFingerprint !== requestFingerprint) {
        return { success: false, error: 'مفتاح فتح الوردية مستخدم مع بيانات مختلفة.' };
      }
      return { success: true, shift: structuredClone(prior), replayed: true };
    }
    if (this.state.activeShift) return { success: false, error: 'توجد وردية مفتوحة بالفعل؛ يجب إقفالها أولاً.' };

    const shift: ServerCashBoxShift = {
      id: `shift-${crypto.randomUUID()}`,
      boxId: params.boxId || 'acc-1102',
      boxNameAr: params.boxNameAr || 'صندوق كاشير الصراف 1',
      tellerId: params.actorId,
      tellerName: params.actorName,
      openedAt: getYemenDateTimeString(),
      status: 'open',
      openingBalances: { ...balances },
      expectedBalances: { ...balances },
      actualBalances: { ...balances },
      discrepancies: { ...ZERO },
      openedByRole: params.actorRole,
      openIdempotencyKey: params.idempotencyKey,
    };
    (shift as any).openRequestFingerprint = requestFingerprint;
    const next = { ...this.state, activeShift: shift };
    if (!this.persist(next)) return { success: false, errorCode: 'SHIFT_SAVE_FAILED', error: 'تعذر حفظ الوردية؛ لم يتم تأكيد فتحها.' };
    return { success: true, shift: structuredClone(shift), replayed: false };
  }

  public closeShift(params: {
    idempotencyKey: string;
    shiftId: string;
    expectedBalances: unknown;
    actualBalances: unknown;
    notes: string;
    actorId: string;
    actorName: string;
  }): { success: boolean; shift?: ServerCashBoxShift; replayed?: boolean; error?: string; errorCode?: string } {
    if (!validKey(params.idempotencyKey)) return { success: false, error: 'مفتاح إقفال الوردية غير صالح.' };
    if (!params.actorId?.trim() || !params.actorName?.trim()) return { success: false, error: 'تعذر تحديد هوية منفذ الإقفال.' };
    const priorClosed = this.state.history.find((shift) => shift.closeIdempotencyKey === params.idempotencyKey);
    const expected = normalizeBalances(params.expectedBalances);
    const actual = normalizeBalances(params.actualBalances);
    if (!expected || !actual) return { success: false, error: 'أرصدة الجرد الفعلي أو الأرصدة الدفترية غير صالحة.' };
    const cleanNotes = typeof params.notes === 'string' ? params.notes.trim() : '';
    const diffs = {} as ShiftBalances;
    for (const currency of CURRENCIES) diffs[currency] = Math.round((actual[currency] - expected[currency]) * 100) / 100;
    const hasVariance = CURRENCIES.some((currency) => Math.abs(diffs[currency]) >= 0.01);
    if (hasVariance && cleanNotes.length < 10) {
      return { success: false, error: 'يوجد عجز أو فائض؛ اكتب سبباً موثقاً لا يقل عن 10 أحرف قبل الإقفال.' };
    }
    const requestFingerprint = fingerprint({
      shiftId: params.shiftId, expected, actual, notes: cleanNotes, actorId: params.actorId,
    });
    if (priorClosed) {
      if ((priorClosed as any).closeRequestFingerprint !== requestFingerprint) {
        return { success: false, error: 'مفتاح إقفال الوردية مستخدم مع بيانات مختلفة.' };
      }
      return { success: true, shift: structuredClone(priorClosed), replayed: true };
    }
    const active = this.state.activeShift;
    if (!active || active.id !== params.shiftId) return { success: false, error: 'لا توجد وردية مفتوحة مطابقة لطلب الإقفال.' };
    const closedAt = getYemenDateTimeString();
    const closed: ServerCashBoxShift = {
      ...active,
      status: 'closed',
      closedAt,
      expectedBalances: { ...expected },
      actualBalances: { ...actual },
      discrepancies: diffs,
      notes: cleanNotes,
      closedBy: params.actorName,
      closedById: params.actorId,
      closeIdempotencyKey: params.idempotencyKey,
    };
    (closed as any).closeRequestFingerprint = requestFingerprint;
    const next: ShiftState = {
      schemaVersion: 1,
      activeShift: null,
      history: [closed, ...this.state.history].slice(0, 5000),
    };
    if (!this.persist(next)) return { success: false, errorCode: 'SHIFT_SAVE_FAILED', error: 'تعذر حفظ محضر الإقفال؛ لم يتم تأكيد إقفال الوردية.' };
    return { success: true, shift: structuredClone(closed), replayed: false };
  }
}

export const serverCashBoxShiftRegistry = new ServerCashBoxShiftRegistry();
