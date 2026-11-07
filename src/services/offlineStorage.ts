/**
 * محرك التخزين المحلي بدون إنترنت (Offline-First Storage Engine)
 * نظام عمرو النماري للصرافة والحسابات
 * يتيح حفظ كافة العمليات، القيود، الحوالات، الأرصدة، والصناديق محلياً على الجهاز
 * مع إمكانية التصدير والاستيراد، وطابور إرسال واتساب المؤجل
 */

import {
  Account,
  CashBoxShift,
  ExchangeRate,
  ExchangeRateAuditLog,
  JournalEntry,
  Remittance,
  RemittanceSettings,
  SystemAuditLog,
  PrintAuditLogEntry,
} from '../types/exchange';
import { CustomerKYC } from '../types/customer';

const STORAGE_KEYS = {
  ACCOUNTS: 'alnamari_offline_accounts_v1',
  CUSTOMERS: 'alnamari_offline_customers_v1',
  RATES: 'alnamari_offline_rates_v1',
  AUDIT_LOGS: 'alnamari_offline_audit_logs_v1',
  JOURNAL_ENTRIES: 'alnamari_offline_journal_entries_v1',
  REMITTANCES: 'alnamari_offline_remittances_v1',
  REMITTANCE_SETTINGS: 'alnamari_offline_remittance_settings_v1',
  SYSTEM_AUDIT_LOGS: 'alnamari_offline_system_audit_logs_v1',
  ACTIVE_SHIFT: 'alnamari_offline_active_shift_v1',
  OFFLINE_QUEUE: 'alnamari_offline_whatsapp_queue_v1',
  PRINT_AUDIT_LOGS: 'alnamari_offline_print_audit_logs_v1',
  LAST_SYNC: 'alnamari_offline_last_sync_v1',
};

export interface OfflineQueuedDispatch {
  id: string;
  voucherNumber: string;
  recipientPhone: string;
  caption: string;
  createdAt: string;
  status: 'QUEUED_OFFLINE' | 'SYNCED' | 'FAILED';
  imageData?: string;
  snapshot?: any;
}

export class OfflineStorageEngine {
  /**
   * حفظ مصفوفة في التخزين المحلي الآمن
   */
  public save<T>(key: string, data: T): boolean {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return false;
      const json = JSON.stringify(data);
      window.localStorage.setItem(key, json);
      window.localStorage.setItem(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
      return true;
    } catch (e) {
      console.warn(`[OfflineStorage] Failed to save key "${key}":`, e);
      return false;
    }
  }

  /**
   * استرجاع البيانات المحفوظة محلياً مع قيمة افتراضية
   */
  public load<T>(key: string, fallback: T): T {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return fallback;
      const item = window.localStorage.getItem(key);
      if (!item) return fallback;
      return JSON.parse(item) as T;
    } catch (e) {
      console.warn(`[OfflineStorage] Failed to parse key "${key}":`, e);
      return fallback;
    }
  }

  // --- دوال مخصصة لكل قطاع مالي ---

  public saveAccounts(accounts: Account[]) {
    return this.save(STORAGE_KEYS.ACCOUNTS, accounts);
  }

  public loadAccounts(fallback: Account[]): Account[] {
    return this.load<Account[]>(STORAGE_KEYS.ACCOUNTS, fallback);
  }

  public saveCustomers(customers: CustomerKYC[]) {
    return this.save(STORAGE_KEYS.CUSTOMERS, customers);
  }

  public loadCustomers(fallback: CustomerKYC[]): CustomerKYC[] {
    return this.load<CustomerKYC[]>(STORAGE_KEYS.CUSTOMERS, fallback);
  }

  public saveRates(rates: ExchangeRate[]) {
    return this.save(STORAGE_KEYS.RATES, rates);
  }

  public loadRates(fallback: ExchangeRate[]): ExchangeRate[] {
    return this.load<ExchangeRate[]>(STORAGE_KEYS.RATES, fallback);
  }

  public saveAuditLogs(logs: ExchangeRateAuditLog[]) {
    return this.save(STORAGE_KEYS.AUDIT_LOGS, logs);
  }

  public loadAuditLogs(fallback: ExchangeRateAuditLog[]): ExchangeRateAuditLog[] {
    return this.load<ExchangeRateAuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, fallback);
  }

  public saveJournalEntries(entries: JournalEntry[]) {
    return this.save(STORAGE_KEYS.JOURNAL_ENTRIES, entries);
  }

  public loadJournalEntries(fallback: JournalEntry[]): JournalEntry[] {
    return this.load<JournalEntry[]>(STORAGE_KEYS.JOURNAL_ENTRIES, fallback);
  }

  public saveRemittances(remittances: Remittance[]) {
    return this.save(STORAGE_KEYS.REMITTANCES, remittances);
  }

  public loadRemittances(fallback: Remittance[]): Remittance[] {
    return this.load<Remittance[]>(STORAGE_KEYS.REMITTANCES, fallback);
  }

  public saveRemittanceSettings(settings: RemittanceSettings) {
    return this.save(STORAGE_KEYS.REMITTANCE_SETTINGS, settings);
  }

  public loadRemittanceSettings(fallback: RemittanceSettings): RemittanceSettings {
    return this.load<RemittanceSettings>(STORAGE_KEYS.REMITTANCE_SETTINGS, fallback);
  }

  public saveSystemAuditLogs(logs: SystemAuditLog[]) {
    return this.save(STORAGE_KEYS.SYSTEM_AUDIT_LOGS, logs);
  }

  public loadSystemAuditLogs(fallback: SystemAuditLog[]): SystemAuditLog[] {
    return this.load<SystemAuditLog[]>(STORAGE_KEYS.SYSTEM_AUDIT_LOGS, fallback);
  }

  public saveActiveShift(shift: CashBoxShift) {
    return this.save(STORAGE_KEYS.ACTIVE_SHIFT, shift);
  }

  public loadActiveShift(fallback: CashBoxShift): CashBoxShift {
    return this.load<CashBoxShift>(STORAGE_KEYS.ACTIVE_SHIFT, fallback);
  }

  // --- سجلات طباعة السندات وتوثيق التدقيق والتوقيع اليدوي ---

  public savePrintAuditLogs(logs: PrintAuditLogEntry[]) {
    return this.save(STORAGE_KEYS.PRINT_AUDIT_LOGS, logs);
  }

  public loadPrintAuditLogs(fallback: PrintAuditLogEntry[] = []): PrintAuditLogEntry[] {
    return this.load<PrintAuditLogEntry[]>(STORAGE_KEYS.PRINT_AUDIT_LOGS, fallback);
  }

  // --- طابور الإرسال بدون إنترنت (Offline WhatsApp Queue) ---

  public getOfflineQueue(): OfflineQueuedDispatch[] {
    return this.load<OfflineQueuedDispatch[]>(STORAGE_KEYS.OFFLINE_QUEUE, []);
  }

  public enqueueOfflineDispatch(item: Omit<OfflineQueuedDispatch, 'id' | 'createdAt' | 'status'>) {
    const queue = this.getOfflineQueue();
    const newItem: OfflineQueuedDispatch = {
      ...item,
      id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      createdAt: new Date().toISOString(),
      status: 'QUEUED_OFFLINE',
    };
    queue.push(newItem);
    this.save(STORAGE_KEYS.OFFLINE_QUEUE, queue);
    return newItem;
  }

  public clearQueueItem(id: string) {
    const queue = this.getOfflineQueue().filter((q) => q.id !== id);
    this.save(STORAGE_KEYS.OFFLINE_QUEUE, queue);
  }

  /**
   * إنشاء نسخة احتياطية كاملة لجميع بيانات النظام المحلي وتنزيلها كملف JSON
   */
  public exportFullBackup(): string {
    const backup = {
      app: 'Amro Alnamari Exchange ERP',
      exportedAt: new Date().toISOString(),
      version: '1.0.0-offline',
      data: {
        accounts: this.load(STORAGE_KEYS.ACCOUNTS, null),
        customers: this.load(STORAGE_KEYS.CUSTOMERS, null),
        rates: this.load(STORAGE_KEYS.RATES, null),
        auditLogs: this.load(STORAGE_KEYS.AUDIT_LOGS, null),
        journalEntries: this.load(STORAGE_KEYS.JOURNAL_ENTRIES, null),
        remittances: this.load(STORAGE_KEYS.REMITTANCES, null),
        remittanceSettings: this.load(STORAGE_KEYS.REMITTANCE_SETTINGS, null),
        systemAuditLogs: this.load(STORAGE_KEYS.SYSTEM_AUDIT_LOGS, null),
        activeShift: this.load(STORAGE_KEYS.ACTIVE_SHIFT, null),
        offlineQueue: this.load(STORAGE_KEYS.OFFLINE_QUEUE, null),
        printAuditLogs: this.load(STORAGE_KEYS.PRINT_AUDIT_LOGS, null),
      },
    };
    return JSON.stringify(backup, null, 2);
  }

  /**
   * استعادة نسخة احتياطية من ملف JSON
   */
  public importFullBackup(jsonContent: string): boolean {
    try {
      const parsed = JSON.parse(jsonContent);
      if (!parsed.data) return false;
      if (parsed.data.accounts) this.save(STORAGE_KEYS.ACCOUNTS, parsed.data.accounts);
      if (parsed.data.customers) this.save(STORAGE_KEYS.CUSTOMERS, parsed.data.customers);
      if (parsed.data.rates) this.save(STORAGE_KEYS.RATES, parsed.data.rates);
      if (parsed.data.auditLogs) this.save(STORAGE_KEYS.AUDIT_LOGS, parsed.data.auditLogs);
      if (parsed.data.journalEntries) this.save(STORAGE_KEYS.JOURNAL_ENTRIES, parsed.data.journalEntries);
      if (parsed.data.remittances) this.save(STORAGE_KEYS.REMITTANCES, parsed.data.remittances);
      if (parsed.data.remittanceSettings) this.save(STORAGE_KEYS.REMITTANCE_SETTINGS, parsed.data.remittanceSettings);
      if (parsed.data.systemAuditLogs) this.save(STORAGE_KEYS.SYSTEM_AUDIT_LOGS, parsed.data.systemAuditLogs);
      if (parsed.data.activeShift) this.save(STORAGE_KEYS.ACTIVE_SHIFT, parsed.data.activeShift);
      if (parsed.data.printAuditLogs) this.save(STORAGE_KEYS.PRINT_AUDIT_LOGS, parsed.data.printAuditLogs);
      return true;
    } catch (e) {
      console.error('[OfflineStorage] Error restoring backup:', e);
      return false;
    }
  }

  /**
   * تاريخ آخر حفظ محلي
   */
  public getLastSyncTime(): string {
    if (typeof window === 'undefined' || !window.localStorage) return 'غير متوفر';
    const t = window.localStorage.getItem(STORAGE_KEYS.LAST_SYNC);
    return t ? new Date(t).toLocaleTimeString('ar-YE') : 'الآن';
  }
}

export const offlineStorage = new OfflineStorageEngine();
