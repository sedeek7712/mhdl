import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { safeAtomicWriteJson, safeReadJson, getYemenDateTimeString } from '../utils/atomicFileStorage.js';
import { resolveDataDirectory } from '../utils/dataDirectory.js';

type CurrencyCode = 'YER_OLD' | 'YER_NEW' | 'SAR' | 'USD';

export interface ServerExchangeRate {
  id: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  buyRate: number;
  sellRate: number;
  updatedAt: string;
  updatedBy: string;
}

export interface ServerExchangeRateAuditLog {
  id: string;
  currencyPair: string;
  oldBuyRate: number;
  newBuyRate: number;
  oldSellRate: number;
  newSellRate: number;
  changedAt: string;
  changedBy: string;
  changedById: string;
  note: string;
}

interface ExchangeRateState {
  schemaVersion: 1;
  rates: ServerExchangeRate[];
  auditLogs: ServerExchangeRateAuditLog[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = resolveDataDirectory(path.resolve(__dirname, '../../../data'));
const RATE_STATE_FILE = path.resolve(DATA_DIR, 'exchange_rate_state.json');

const createInitialState = (): ExchangeRateState => ({
  schemaVersion: 1,
  // Pair definitions only. Zero rates are deliberately unusable until an owner enters current market rates.
  rates: [
    { id: 'rate-1', fromCurrency: 'USD', toCurrency: 'YER_OLD', buyRate: 0, sellRate: 0, updatedAt: '', updatedBy: 'بانتظار اعتماد المالك' },
    { id: 'rate-2', fromCurrency: 'SAR', toCurrency: 'YER_OLD', buyRate: 0, sellRate: 0, updatedAt: '', updatedBy: 'بانتظار اعتماد المالك' },
    { id: 'rate-3', fromCurrency: 'USD', toCurrency: 'YER_NEW', buyRate: 0, sellRate: 0, updatedAt: '', updatedBy: 'بانتظار اعتماد المالك' },
    { id: 'rate-4', fromCurrency: 'SAR', toCurrency: 'YER_NEW', buyRate: 0, sellRate: 0, updatedAt: '', updatedBy: 'بانتظار اعتماد المالك' },
    { id: 'rate-5', fromCurrency: 'YER_OLD', toCurrency: 'YER_NEW', buyRate: 0, sellRate: 0, updatedAt: '', updatedBy: 'بانتظار اعتماد المالك' },
    { id: 'rate-6', fromCurrency: 'USD', toCurrency: 'SAR', buyRate: 0, sellRate: 0, updatedAt: '', updatedBy: 'بانتظار اعتماد المالك' },
  ],
  auditLogs: [],
});

class ServerExchangeRateRegistry {
  private state: ExchangeRateState;

  constructor() {
    const loaded = safeReadJson<ExchangeRateState>(RATE_STATE_FILE, createInitialState(), {
      failOnCorruption: true,
      failOnMissing: false,
    });
    if (!loaded || loaded.schemaVersion !== 1 ||
        !Array.isArray(loaded.rates) || !Array.isArray(loaded.auditLogs)) {
      throw new Error('توقف آمن: ملف أسعار الصرف لا يطابق البنية المعتمدة. لم يتم تحميل أسعار افتراضية.');
    }
    this.state = loaded;
  }

  public getRates(): ServerExchangeRate[] {
    return this.state.rates.map((rate) => ({ ...rate }));
  }

  public getAuditLogs(): ServerExchangeRateAuditLog[] {
    return this.state.auditLogs.map((log) => ({ ...log }));
  }

  public updateRate(params: {
    rateId: string;
    buyRate: number;
    sellRate: number;
    note: string;
    actorId: string;
    actorName: string;
  }): { success: boolean; rate?: ServerExchangeRate; rates?: ServerExchangeRate[]; auditLogs?: ServerExchangeRateAuditLog[]; error?: string } {
    if (typeof params.rateId !== 'string' || !params.rateId.trim()) {
      return { success: false, error: 'معرف سعر الصرف غير صالح.' };
    }
    if (typeof params.actorId !== 'string' || !params.actorId.trim() ||
        typeof params.actorName !== 'string' || !params.actorName.trim()) {
      return { success: false, error: 'تعذر تحديد هوية المسؤول الذي يعتمد السعر.' };
    }
    for (const value of [params.buyRate, params.sellRate]) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ||
          value > 1_000_000_000 ||
          Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) > 1e-7) {
        return { success: false, error: 'سعر الشراء والبيع يجب أن يكونا موجبين وصالحين حتى ست منازل عشرية.' };
      }
    }
    if (typeof params.note !== 'string' || !params.note.trim() || params.note.trim().length > 240) {
      return { success: false, error: 'سبب تعديل سعر الصرف إلزامي ولا يتجاوز 240 حرفاً.' };
    }

    const current = this.state.rates.find((rate) => rate.id === params.rateId);
    if (!current) {
      return { success: false, error: 'زوج العملات المطلوب غير موجود في قائمة أسعار الصرف المعتمدة.' };
    }

    const updatedAt = getYemenDateTimeString();
    const updatedRate: ServerExchangeRate = {
      ...current,
      buyRate: params.buyRate,
      sellRate: params.sellRate,
      updatedAt,
      updatedBy: params.actorName.trim(),
    };
    const auditLog: ServerExchangeRateAuditLog = {
      id: `rate-audit-${crypto.randomUUID()}`,
      currencyPair: `${current.fromCurrency} / ${current.toCurrency}`,
      oldBuyRate: current.buyRate,
      newBuyRate: params.buyRate,
      oldSellRate: current.sellRate,
      newSellRate: params.sellRate,
      changedAt: updatedAt,
      changedBy: params.actorName.trim(),
      changedById: params.actorId.trim(),
      note: params.note.trim(),
    };
    const nextState: ExchangeRateState = {
      schemaVersion: 1,
      rates: this.state.rates.map((rate) => rate.id === params.rateId ? updatedRate : rate),
      auditLogs: [auditLog, ...this.state.auditLogs].slice(0, 10000),
    };

    try {
      safeAtomicWriteJson(RATE_STATE_FILE, nextState);
    } catch (error: any) {
      return { success: false, error: error.message || 'تعذر حفظ أسعار الصرف وسجل التدقيق.' };
    }

    this.state = nextState;
    return {
      success: true,
      rate: { ...updatedRate },
      rates: this.getRates(),
      auditLogs: this.getAuditLogs(),
    };
  }
}

export const serverExchangeRateRegistry = new ServerExchangeRateRegistry();
