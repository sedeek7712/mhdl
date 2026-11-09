/**
 * عميل واجهة البرمجة المعتمد والمحمى بالمصادقة المشفرة
 * Amro Alnamari Enterprise Authenticated API Client
 * يتولى إرفاق رمز المصادقة (Bearer Token) تلقائياً ومعالجة الصلاحيات
 */

const AUTH_TOKEN_KEY = 'alnamari_auth_bearer_token';
const AUTH_USER_KEY = 'alnamari_auth_user_data';

class ApiClient {
  private token: string | null = null;
  private currentUser: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        // M3: قصر قراءة التوكن على sessionStorage فقط ومنع حفظه أو قراءته من localStorage
        this.token = window.sessionStorage.getItem(AUTH_TOKEN_KEY);
        const storedUser = window.sessionStorage.getItem(AUTH_USER_KEY);
        if (storedUser) {
          this.currentUser = JSON.parse(storedUser);
        }
      } catch {
        // Fallback in case storage access is restricted
      }
    }
  }

  public setSession(token: string, user: any) {
    this.token = token;
    this.currentUser = user;
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(AUTH_TOKEN_KEY, token);
        window.sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
      } catch {
        // Ignore
      }
    }
  }

  public clearSession() {
    this.token = null;
    this.currentUser = null;
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
        window.sessionStorage.removeItem(AUTH_USER_KEY);
      } catch {
        // Ignore
      }
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  public getCurrentUser(): any {
    return this.currentUser;
  }

  /**
   * تسجيل دخول أو تحديث الدور واستلام رمز مصادقة رسمي موقّع من الخادم
   */
  public async login(roleOrUsername: string, pin?: string): Promise<{ success: boolean; user?: any; token?: string; error?: string }> {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roleOrUsername, pin }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.token) {
        this.setSession(data.token, data.user);
        return { success: true, user: data.user, token: data.token };
      }
      return { success: false, error: data.error || 'فشل تسجيل الدخول' };
    } catch (err: any) {
      return { success: false, error: err.message || 'خطأ في الاتصال بالخادم' };
    }
  }

  public async getSession(): Promise<{ success: boolean; user?: any; error?: string }> {
    if (!this.token) {
      return { success: false, error: 'لا توجد جلسة دخول محفوظة.' };
    }

    try {
      const res = await this.fetch('/api/auth/session');
      const data = await res.json();
      if (!res.ok || !data.success || !data.user) {
        this.clearSession();
        return { success: false, error: data.error || 'انتهت جلسة الدخول أو أصبحت غير صالحة.' };
      }
      this.currentUser = data.user;
      return { success: true, user: data.user };
    } catch (err: any) {
      return { success: false, error: err.message || 'تعذر التحقق من جلسة الدخول.' };
    }
  }

  /**
   * استدعاء آمن مع إرفاق رمز المصادقة (Bearer) تلقائياً
   */
  public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers || {});

    // Ensure authorization header is set if token exists
    if (this.token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const modifiedInit: RequestInit = {
      ...init,
      headers,
    };

    return fetch(input, modifiedInit);
  }

  /**
   * طلب صرف حوالة واردة عبر الخادم مع فحص منع الصرف المكرر والصلاحيات والتحقق الخادمي
   */
  public async payoutRemittance(payload: {
    transferId: string;
    transferNumber: string;
    recipientIdType: string;
    recipientIdNumber: string;
    amount: number;
    currency: string;
    clientAmount?: number;
    clientCurrency?: string;
    cashierDrawerBalance?: number;
    voucherNumber?: string;
    managerOverride?: boolean;
    managerOverrideReason?: string;
  }): Promise<{ success: boolean; isDuplicate?: boolean; record?: any; journalEntry?: any; accounts?: any[]; error?: string; message?: string }> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const res = await this.fetch('/api/remittances/payout', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      return data;
    } catch (err: any) {
      return { success: false, error: err.message || 'تعذر الاتصال بالخادم لصرف الحوالة' };
    }
  }

  /**
   * جلب الأرصدة وحسابات دفتر الأستاذ الرسمية من الخادم
   */
  public async getAccounts(): Promise<{ success: boolean; accounts?: any[]; error?: string }> {
    try {
      const res = await this.fetch('/api/accounting/accounts');
      const data = await res.json();
      return data;
    } catch (err: any) {
      return { success: false, error: err.message || 'تعذر جلب الحسابات من الخادم' };
    }
  }

  /**
   * جلب قيود اليومية المعتمدة من الخادم
   */
  public async getJournalEntries(): Promise<{ success: boolean; journalEntries?: any[]; error?: string }> {
    try {
      const res = await this.fetch('/api/accounting/journal-entries');
      const data = await res.json();
      return data;
    } catch (err: any) {
      return { success: false, error: err.message || 'تعذر جلب قيود اليومية من الخادم' };
    }
  }

  /**
   * تغذية صندوق الكاشير من الخزينة المركزية بقيد خادمي معتمد
   */
  public async fundCashierDrawer(payload: {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{
    success: boolean;
    journalEntry?: any;
    accounts?: any[];
    error?: string;
    message?: string;
    errorCode?: string;
    doNotRetry?: boolean;
    outcomeUncertain?: boolean;
  }> {
    try {
      const res = await this.fetch('/api/accounting/fund-drawer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      return {
        ...data,
        outcomeUncertain: Boolean(data.outcomeUncertain) || (!res.ok && res.status >= 500),
      };
    } catch (err: any) {
      // A lost HTTP response may occur after the server has already committed the transfer.
      // Preserve the caller's idempotency key and do not treat this as a definitive rejection.
      return {
        success: false,
        outcomeUncertain: true,
        error: err.message || 'تعذر الاتصال بالخادم لتغذية الصندوق؛ قد تكون نتيجة الطلب غير محسومة.',
      };
    }
  }

  public async executeOperatingExpense(payload: {
    expenseType: string;
    amount: number;
    currency: string;
    notes: string;
    idempotencyKey: string;
  }): Promise<{
    success: boolean;
    journalEntry?: any;
    accounts?: any[];
    error?: string;
    errorCode?: string;
    outcomeUncertain?: boolean;
    doNotRetry?: boolean;
    message?: string;
  }> {
    try {
      const response = await this.fetch('/api/accounting/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      return {
        ...data,
        outcomeUncertain: Boolean(data.outcomeUncertain) || (!response.ok && response.status >= 500),
      };
    } catch (error: any) {
      return {
        success: false,
        outcomeUncertain: true,
        error: error.message || 'انقطع الاتصال أثناء اعتماد المصروف؛ قد تكون النتيجة غير محسومة.',
      };
    }
  }

  public async executeInternalTransfer(payload: {
    fromAccountId: string;
    toAccountId: string;
    currency: string;
    amount: number;
    description: string;
    idempotencyKey: string;
  }): Promise<{
    success: boolean;
    journalEntry?: any;
    accounts?: any[];
    error?: string;
    errorCode?: string;
    outcomeUncertain?: boolean;
    doNotRetry?: boolean;
    message?: string;
  }> {
    try {
      const response = await this.fetch('/api/accounting/internal-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      return {
        ...data,
        outcomeUncertain: Boolean(data.outcomeUncertain) || (!response.ok && response.status >= 500),
      };
    } catch (error: any) {
      return {
        success: false,
        outcomeUncertain: true,
        error: error.message || 'انقطع الاتصال أثناء تنفيذ المناقلة؛ قد تكون نتيجة العملية غير محسومة.',
      };
    }
  }

  /**
   * الاستعلام عن تقرير المطابقة المالية للحوالات والصرف
   */
  public async getReconciliation(): Promise<{ success: boolean; report?: any; error?: string }> {
    try {
      const res = await this.fetch('/api/remittances/reconciliation');
      const data = await res.json();
      return data;
    } catch (err: any) {
      return { success: false, error: err.message || 'تعذر جلب تقرير المطابقة' };
    }
  }
}

export const apiClient = new ApiClient();
