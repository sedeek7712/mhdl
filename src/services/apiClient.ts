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
        this.token = window.sessionStorage.getItem(AUTH_TOKEN_KEY) || window.localStorage.getItem(AUTH_TOKEN_KEY);
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
}

export const apiClient = new ApiClient();
