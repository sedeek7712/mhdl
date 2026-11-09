/**
 * نظام عمرو النماري للصرافة والحسابات (Amro Alnamari Exchange System)
 * إطار عمل متكامل: صرافة، تحويلات، قيود مزدوجة، سندات رسمية، إشعارات واتساب، ومعمارية دارت/فلاتر
 */

import React, { useEffect, useState } from 'react';
import {
  Account,
  CashBoxShift,
  CurrencyCode,
  ExchangeRate,
  ExchangeRateAuditLog,
  JournalEntry,
  OfficialVoucher,
  Remittance,
  RemittanceSettings,
  SystemAuditLog,
  UserProfile,
} from './types/exchange';
import { CustomerKYC, INITIAL_CUSTOMERS } from './types/customer';
import {
  CURRENT_USER,
  INITIAL_ACCOUNTS,
  INITIAL_ACTIVE_SHIFT,
  INITIAL_EXCHANGE_AUDIT_LOGS,
  INITIAL_EXCHANGE_RATES,
  INITIAL_JOURNAL_ENTRIES,
  INITIAL_REMITTANCES,
  INITIAL_REMITTANCE_SETTINGS,
  INITIAL_SYSTEM_AUDIT_LOGS,
} from './data/initialData';
import { formatMoney, tafqeetArabic, validateDoubleEntryBalance } from './services/accountingEngine';
import { voucherEngine } from './services/voucherEngine';
import { offlineStorage } from './services/offlineStorage';
import { apiClient } from './services/apiClient';
import { ToastProvider, useToast } from './components/ui/Toast';
import { Header } from './components/Header';
import { OfflineBanner } from './components/OfflineBanner';
import { OfflineBackupModal } from './components/OfflineBackupModal';
import { DashboardView } from './components/DashboardView';
import { ExchangeDeskView } from './components/ExchangeDeskView';
import { RemittanceView } from './components/RemittanceView';
import { RemittanceSettingsModal } from './components/RemittanceSettingsModal';
import { CustomersView } from './components/CustomersView';
import { LedgerAndAccountsView } from './components/LedgerAndAccountsView';
import { TreasuryAndClosureView } from './components/TreasuryAndClosureView';
import { CleanArchitectureFlutterView } from './components/CleanArchitectureFlutterView';
import { OfficialVoucherModal } from './components/OfficialVoucherModal';
import { ExchangeRatesModal } from './components/ExchangeRatesModal';
import { InternalTransferModal } from './components/InternalTransferModal';
import { A4AccountStatementModal } from './components/A4AccountStatementModal';
import { ReceiveTransferDesk } from './components/ReceiveTransferDesk';
import { PrintAuditLogModal } from './components/vouchers/PrintAuditLogModal';
import { RoleAuthModal } from './components/ui/RoleAuthModal';

function AppContent() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [currentUser, setCurrentUser] = useState<UserProfile>(CURRENT_USER);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isA4StatementOpen, setIsA4StatementOpen] = useState<boolean>(false);
  const [statementCustomerId, setStatementCustomerId] = useState<string | undefined>(undefined);
  const [statementType, setStatementType] = useState<'customer' | 'account' | 'profits'>('account');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isProcessingPayout, setIsProcessingPayout] = useState<boolean>(false);
  const [isOfflineModalOpen, setIsOfflineModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isPrintAuditOpen, setIsPrintAuditOpen] = useState<boolean>(false);

  // Core Financial State loaded from Offline Persistent Storage with initial fallbacks
  const [accounts, setAccounts] = useState<Account[]>(() => offlineStorage.loadAccounts(INITIAL_ACCOUNTS));
  const [customers, setCustomers] = useState<CustomerKYC[]>(() => offlineStorage.loadCustomers(INITIAL_CUSTOMERS));
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>(() => offlineStorage.loadRates(INITIAL_EXCHANGE_RATES));
  const [auditLogs, setAuditLogs] = useState<ExchangeRateAuditLog[]>(() => offlineStorage.loadAuditLogs(INITIAL_EXCHANGE_AUDIT_LOGS));
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(() => offlineStorage.loadJournalEntries(INITIAL_JOURNAL_ENTRIES));
  const [remittances, setRemittances] = useState<Remittance[]>(() => offlineStorage.loadRemittances(INITIAL_REMITTANCES));
  const [remittanceSettings, setRemittanceSettings] = useState<RemittanceSettings>(() =>
    offlineStorage.loadRemittanceSettings(INITIAL_REMITTANCE_SETTINGS)
  );
  const [systemAuditLogs, setSystemAuditLogs] = useState<SystemAuditLog[]>(() =>
    offlineStorage.loadSystemAuditLogs(INITIAL_SYSTEM_AUDIT_LOGS)
  );
  const [activeShift, setActiveShift] = useState<CashBoxShift>(() => offlineStorage.loadActiveShift(INITIAL_ACTIVE_SHIFT));

  // Sync to local persistent storage automatically on change
  useEffect(() => {
    if (!isAuthenticated) return;
    offlineStorage.saveAccounts(accounts);
  }, [accounts, isAuthenticated]);

  // C3: مزامنة الحسابات وقيود اليومية المعتمدة من الخادم كمرجع وحيد للحقيقة
  useEffect(() => {
    if (!isAuthenticated) return;
    async function syncAuthoritativeLedger() {
      try {
        const [accRes, jvRes] = await Promise.all([
          apiClient.getAccounts(),
          apiClient.getJournalEntries(),
        ]);
        if (accRes.success && accRes.accounts && accRes.accounts.length > 0) {
          setAccounts(accRes.accounts as Account[]);
        }
        if (jvRes.success && jvRes.journalEntries && jvRes.journalEntries.length > 0) {
          setJournalEntries(jvRes.journalEntries as JournalEntry[]);
        }
      } catch (err) {
        // Fallback to local storage if offline
      }
    }
    syncAuthoritativeLedger();
  }, [currentUser, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    offlineStorage.saveCustomers(customers);
  }, [customers, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    offlineStorage.saveRates(exchangeRates);
  }, [exchangeRates, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    offlineStorage.saveAuditLogs(auditLogs);
  }, [auditLogs, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    offlineStorage.saveJournalEntries(journalEntries);
  }, [journalEntries, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    offlineStorage.saveRemittances(remittances);
  }, [remittances, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    offlineStorage.saveRemittanceSettings(remittanceSettings);
  }, [remittanceSettings, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    offlineStorage.saveSystemAuditLogs(systemAuditLogs);
  }, [systemAuditLogs, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    offlineStorage.saveActiveShift(activeShift);
  }, [activeShift, isAuthenticated]);

  // Restore a previously authenticated owner session; never auto-login with a role or default PIN.
  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      const session = await apiClient.getSession();
      if (cancelled) return;

      if (session.success && session.user?.role === 'owner') {
        setCurrentUser({
          id: session.user.id,
          name: session.user.name,
          role: 'owner',
          roleTitleAr: 'المالك والمشرف العام',
          branchId: session.user.branchId,
          branchName: session.user.branchName,
        });
        setIsAuthenticated(true);
      } else {
        apiClient.clearSession();
        setIsAuthenticated(false);
      }

      setIsAuthChecking(false);
    };

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load server-owned settings only after the owner session has been verified.
  useEffect(() => {
    if (!isAuthenticated) return;

    apiClient.fetch('/api/remittances/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.success && data.settings) {
          setRemittanceSettings((prev) => ({
            ...prev,
            ...data.settings,
          }));
        }
      })
      .catch(() => {
        // Keep the last locally saved values when the local server is unavailable.
      });

    apiClient.fetch('/api/remittances/audit-logs')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.success && Array.isArray(data.logs)) {
          setSystemAuditLogs(data.logs);
        }
      })
      .catch(() => {
        // Keep the last locally saved values when the local server is unavailable.
      });
  }, [isAuthenticated]);

  // Listen to browser network connectivity events
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleReloadData = () => {
    setAccounts(offlineStorage.loadAccounts(INITIAL_ACCOUNTS));
    setCustomers(offlineStorage.loadCustomers(INITIAL_CUSTOMERS));
    setExchangeRates(offlineStorage.loadRates(INITIAL_EXCHANGE_RATES));
    setAuditLogs(offlineStorage.loadAuditLogs(INITIAL_EXCHANGE_AUDIT_LOGS));
    setJournalEntries(offlineStorage.loadJournalEntries(INITIAL_JOURNAL_ENTRIES));
    setRemittances(offlineStorage.loadRemittances(INITIAL_REMITTANCES));
    setRemittanceSettings(offlineStorage.loadRemittanceSettings(INITIAL_REMITTANCE_SETTINGS));
    setSystemAuditLogs(offlineStorage.loadSystemAuditLogs(INITIAL_SYSTEM_AUDIT_LOGS));
    setActiveShift(offlineStorage.loadActiveShift(INITIAL_ACTIVE_SHIFT));
  };

  // Official Sample Voucher Helper matching reference voucher
  const handleOpenOfficialSampleVoucher = () => {
    const voucher = voucherEngine.createOutgoingTransferVoucher({
      voucherNumber: '7-2026-0001',
      transferNumber: 'TR-931106',
      senderName: 'صديق علي محمد الفتاحي',
      senderPhone: '771280940',
      recipientName: 'صديق',
      recipientPhone: '771280940',
      networkName: 'شبكة النجم',
      amount: 5000,
      currency: 'SAR',
      feeAmount: 0,
      branchName: 'تعز - مديرية خدير',
      tellerName: 'الكاشير المعتمد',
      notes: 'سند إشعار حوالة مالية معتمدة',
    });
    setActiveVoucher(voucher);
  };

  // Modals state - initialized to null to prevent disruptive auto-popup on page refresh
  const [activeVoucher, setActiveVoucher] = useState<OfficialVoucher | null>(null);
  const [isRatesModalOpen, setIsRatesModalOpen] = useState<boolean>(false);
  const [isInternalTransferModalOpen, setIsInternalTransferModalOpen] = useState<boolean>(false);

  // 1. Execute Currency Exchange (صرافة العملات)
  const handleExecuteExchange = (data: {
    sourceCurrency: CurrencyCode;
    sourceAmount: number;
    targetCurrency: CurrencyCode;
    targetAmount: number;
    exchangeRate: number;
    commission: number;
    customerName: string;
    customerPhone: string;
    notes: string;
  }) => {
    const entryId = `jv-ex-${Date.now()}`;
    const entryNum = `JV-${new Date().getFullYear()}-${String(journalEntries.length + 1).padStart(4, '0')}`;
    const voucherNum = `V-${new Date().getFullYear()}-${String(journalEntries.length + 1).padStart(4, '0')}`;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);

    // Update balances: Cashier box receives source currency and dispenses target currency
    setAccounts((prevAccounts) =>
      prevAccounts.map((acc) => {
        if (acc.id === 'acc-1102') {
          return {
            ...acc,
            balances: {
              ...acc.balances,
              [data.sourceCurrency]: (acc.balances[data.sourceCurrency] || 0) + data.sourceAmount,
              [data.targetCurrency]: (acc.balances[data.targetCurrency] || 0) - data.targetAmount,
            },
          };
        }
        // If commission, credit commission revenue account
        if (data.commission > 0 && acc.id === 'acc-4101') {
          return {
            ...acc,
            balances: {
              ...acc.balances,
              [data.sourceCurrency]: (acc.balances[data.sourceCurrency] || 0) + data.commission,
            },
          };
        }
        return acc;
      })
    );

    // Balanced Journal Entry
    const lines = [
      {
        accountId: 'acc-1102',
        accountNameAr: 'صندوق كاشير الصراف 1',
        currency: data.sourceCurrency,
        debit: data.sourceAmount,
        credit: 0,
        note: `قبض نقدي من العميل ${data.customerName}`,
      },
      {
        accountId: 'acc-2101',
        accountNameAr: 'أمانات العملاء ووسيط التسوية',
        currency: data.sourceCurrency,
        debit: 0,
        credit: data.sourceAmount,
        note: 'تسوية عملة مقبوضة',
      },
      {
        accountId: 'acc-2101',
        accountNameAr: 'أمانات العملاء ووسيط التسوية',
        currency: data.targetCurrency,
        debit: data.targetAmount,
        credit: 0,
        note: 'تسوية عملة مسلمة',
      },
      {
        accountId: 'acc-1102',
        accountNameAr: 'صندوق كاشير الصراف 1',
        currency: data.targetCurrency,
        debit: 0,
        credit: data.targetAmount,
        note: `تسليم نقدي للعميل ${data.customerName}`,
      },
    ];

    const newJournalEntry: JournalEntry = {
      id: entryId,
      entryNumber: entryNum,
      date: dateStr,
      time: timeStr,
      descriptionAr: `صرافة ${formatMoney(data.sourceAmount, data.sourceCurrency)} مقابل ${formatMoney(data.targetAmount, data.targetCurrency)} بسعر ${data.exchangeRate}`,
      lines,
      referenceType: 'exchange',
      referenceId: voucherNum,
      branchId: currentUser.branchId,
      createdBy: currentUser.name,
      isBalanced: true,
    };

    setJournalEntries((prev) => [...prev, newJournalEntry]);

    // Create Official Voucher via Central Voucher Engine
    const newVoucher = voucherEngine.createExchangeVoucher({
      voucherNumber: voucherNum,
      transactionNumber: entryNum,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      sourceCurrency: data.sourceCurrency,
      sourceAmount: data.sourceAmount,
      targetCurrency: data.targetCurrency,
      targetAmount: data.targetAmount,
      exchangeRate: data.exchangeRate,
      commission: data.commission,
      branchName: currentUser.branchName,
      tellerName: currentUser.name,
      notes: data.notes,
    });

    setActiveVoucher(newVoucher);
  };

  // 2. Create Outgoing Remittance (إرسال حوالة صادرة)
  const handleCreateOutgoingRemittance = (data: {
    senderName: string;
    senderPhone: string;
    recipientName: string;
    recipientPhone: string;
    networkName: string;
    amount: number;
    currency: CurrencyCode;
    feeAmount: number;
    notes?: string;
    manualTransferNumber?: string;
  }) => {
    const totalPaid = data.amount + data.feeAmount;

    // Numbering Mode Policy Execution (Automatic vs Manual with UNIQUE constraint)
    let transferNum = '';
    const mode = remittanceSettings.numberingMode;

    if (mode === 'manual') {
      if (!data.manualTransferNumber || !data.manualTransferNumber.trim()) {
        toast.warning('رقم الحوالة إلزامي في وضع الترقيم اليدوي.');
        return;
      }
      const cleanManualNum = data.manualTransferNumber.trim().toUpperCase();

      // Check Unique constraint locally
      const isDuplicate = remittances.some(
        (r) => r.transferNumber.trim().toUpperCase() === cleanManualNum
      );
      if (isDuplicate) {
        toast.error(
          'رقم الحوالة مستخدم مسبقاً',
          `رفض النظام: رقم الحوالة (${cleanManualNum}) مستخدم مسبقاً في النظام ولا يمكن تكراره (UNIQUE Constraint).`
        );
        return;
      }

      transferNum = cleanManualNum;
    } else {
      // Automatic Mode: sequential atomic unique generation
      let currentSeq = remittanceSettings.nextSequence;
      transferNum = `${remittanceSettings.prefix}${String(currentSeq).padStart(6, '0')}`;

      // Prevent collision with any existing remittances
      while (
        remittances.some((r) => r.transferNumber.trim().toUpperCase() === transferNum.toUpperCase())
      ) {
        currentSeq += 1;
        transferNum = `${remittanceSettings.prefix}${String(currentSeq).padStart(6, '0')}`;
      }

      // Update next sequence
      setRemittanceSettings((prev) => ({
        ...prev,
        nextSequence: currentSeq + 1,
      }));
    }

    // Register with backend server if online
    if (isOnline) {
      apiClient.fetch('/api/remittances/register-number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferNumber: transferNum,
          mode,
        }),
      }).catch((err) => console.warn('Could not register number with central server:', err));
    }

    const voucherNum = `V-${new Date().getFullYear()}-${String(remittances.length + 1).padStart(4, '0')}`;
    const entryNum = `JV-${new Date().getFullYear()}-${String(journalEntries.length + 1).padStart(4, '0')}`;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);

    // Update balances: Cashier box gets totalPaid, Network account owed the amount, Commission account gets fee
    setAccounts((prevAccounts) =>
      prevAccounts.map((acc) => {
        if (acc.id === 'acc-1102') {
          return {
            ...acc,
            balances: {
              ...acc.balances,
              [data.currency]: (acc.balances[data.currency] || 0) + totalPaid,
            },
          };
        }
        if (acc.id === 'acc-1301') {
          // Network account (liability to pay recipient network)
          return {
            ...acc,
            balances: {
              ...acc.balances,
              [data.currency]: (acc.balances[data.currency] || 0) - data.amount,
            },
          };
        }
        if (acc.id === 'acc-4101' && data.feeAmount > 0) {
          // Commission revenue
          return {
            ...acc,
            balances: {
              ...acc.balances,
              [data.currency]: (acc.balances[data.currency] || 0) + data.feeAmount,
            },
          };
        }
        return acc;
      })
    );

    // Remittance object with numberingMode tracking
    const newRemittance: Remittance = {
      id: `rem-${Date.now()}`,
      transferNumber: transferNum,
      direction: 'outgoing',
      status: 'approved',
      senderName: data.senderName,
      senderPhone: data.senderPhone,
      recipientName: data.recipientName,
      recipientPhone: data.recipientPhone,
      networkName: data.networkName,
      amount: data.amount,
      currency: data.currency,
      feeAmount: data.feeAmount,
      totalPaid,
      branchName: currentUser.branchName,
      tellerName: currentUser.name,
      createdAt: `${dateStr} ${timeStr}`,
      voucherNumber: voucherNum,
      notes: data.notes,
      numberingMode: mode,
    };

    setRemittances((prev) => [newRemittance, ...prev]);

    // Balanced Journal Entry
    const newJournalEntry: JournalEntry = {
      id: `jv-rem-${Date.now()}`,
      entryNumber: entryNum,
      date: dateStr,
      time: timeStr,
      descriptionAr: `إرسال حوالة صادرة ${transferNum} للمستلم ${data.recipientName} عبر ${data.networkName}`,
      lines: [
        {
          accountId: 'acc-1102',
          accountNameAr: 'صندوق كاشير الصراف 1',
          currency: data.currency,
          debit: totalPaid,
          credit: 0,
          note: 'قبض من المرسل مع العمولة',
        },
        {
          accountId: 'acc-1301',
          accountNameAr: `حساب ${data.networkName}`,
          currency: data.currency,
          debit: 0,
          credit: data.amount,
          note: 'مستحق للشبكة',
        },
        ...(data.feeAmount > 0
          ? [
              {
                accountId: 'acc-4101',
                accountNameAr: 'إيرادات عمولات الحوالات',
                currency: data.currency,
                debit: 0,
                credit: data.feeAmount,
                note: 'أجور تحويل مستحقة',
              },
            ]
          : []),
      ],
      referenceType: 'transfer_send',
      referenceId: transferNum,
      branchId: currentUser.branchId,
      createdBy: currentUser.name,
      isBalanced: true,
    };

    setJournalEntries((prev) => [...prev, newJournalEntry]);

    // Create Official Voucher via Central Voucher Engine
    const newVoucher = voucherEngine.createOutgoingTransferVoucher({
      voucherNumber: voucherNum,
      transferNumber: transferNum,
      senderName: data.senderName,
      senderPhone: data.senderPhone,
      recipientName: data.recipientName,
      recipientPhone: data.recipientPhone,
      networkName: data.networkName,
      amount: data.amount,
      currency: data.currency,
      feeAmount: data.feeAmount,
      branchName: currentUser.branchName,
      tellerName: currentUser.name,
      notes: data.notes,
    });

    setActiveVoucher(newVoucher);
  };

  // 2.1 Save Remittance Settings (التحكم في طريقة إصدار أرقام الحوالات وتوثيق التدقيق)
  const handleSaveRemittanceSettings = (newSettings: Partial<RemittanceSettings>, reason: string) => {
    if (currentUser.role !== 'owner' && currentUser.role !== 'general_manager') {
      toast.error('صلاحية غير كافية', 'عذراً، هذا الإجراء يتطلب صلاحية المالك أو المدير العام.');
      return;
    }

    const oldMode = remittanceSettings.numberingMode;
    const updated: RemittanceSettings = {
      ...remittanceSettings,
      ...newSettings,
      updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      updatedBy: currentUser.name,
      updatedByRole: currentUser.role,
      notes: reason,
    };

    setRemittanceSettings(updated);
    offlineStorage.saveRemittanceSettings(updated);

    const auditEntry: SystemAuditLog = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      category: 'remittance_numbering',
      action: 'تعديل طريقة إصدار أرقام الحوالات',
      details: `تم تعديل سياسة الترقيم من [${oldMode === 'automatic' ? 'تلقائي' : 'يدوي'}] إلى [${
        updated.numberingMode === 'automatic' ? 'تلقائي' : 'يدوي'
      }]. المبرر الإداري: ${reason}`,
      performedBy: currentUser.name,
      userRole: currentUser.role,
      timestamp: updated.updatedAt,
      oldValue: `${oldMode} (Sequence: ${remittanceSettings.prefix}${remittanceSettings.nextSequence})`,
      newValue: `${updated.numberingMode} (Sequence: ${updated.prefix}${updated.nextSequence})`,
    };

    setSystemAuditLogs((prev) => [auditEntry, ...prev]);
    offlineStorage.saveSystemAuditLogs([auditEntry, ...systemAuditLogs]);

    if (isOnline) {
      apiClient.fetch('/api/remittances/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numberingMode: updated.numberingMode,
          prefix: updated.prefix,
          nextSequence: updated.nextSequence,
        }),
      }).catch((err) => console.warn('Could not sync settings to backend:', err));
    }
  };

  // 3. Payout Incoming Remittance (صرف حوالة واردة بمصادقة أمنية، تدقيق السيولة، ومنع التكرار)
  const handlePayoutIncomingRemittance = async (
    transferId: string,
    recipientIdType: 'national_id' | 'passport' | 'family_card',
    recipientIdNumber: string
  ) => {
    if (isProcessingPayout) {
      toast.warning('عملية الصرف قيد المعالجة، يرجى الانتظار لحين اكتمال القيد.');
      return;
    }

    const targetRem = remittances.find((r) => r.id === transferId);
    if (!targetRem) {
      toast.error('خطأ في العملية', 'لم يتم العثور على الحوالة المطلوبة.');
      return;
    }

    if (targetRem.status !== 'available') {
      toast.error(
        'لا يمكن صرف الحوالة',
        `الحوالة رقم (${targetRem.transferNumber}) حالتها [${targetRem.status === 'paid' ? 'مصروفة مسبقاً' : 'ملغاة'}]. يمنع النظام تكرار الصرف منعاً باتاً.`
      );
      return;
    }

    if (!recipientIdNumber.trim()) {
      toast.warning('يرجى إدخال رقم إثبات الهوية للمستفيد للتحقق والامتثال لضوابط KYC.');
      return;
    }

    // Check Cashier Drawer liquidity
    const cashierBox = accounts.find((a) => a.id === 'acc-1102');
    const cashierBalance = cashierBox ? (cashierBox.balances[targetRem.currency] || 0) : 0;
    if (cashierBalance < targetRem.amount) {
      toast.error(
        'رصيد صندوق الكاشير غير كافٍ',
        `الرصيد المتاح في الصندوق (${formatMoney(cashierBalance, targetRem.currency)}) أقل من مبلغ الحوالة المطلوب صرفه (${formatMoney(targetRem.amount, targetRem.currency)}). يرجى تغذية الصندوق أولاً.`
      );
      return;
    }

    setIsProcessingPayout(true);

    try {
      // 1. Call the server; it derives a stable idempotency key from the authenticated teller and transfer.
      const serverResult = await apiClient.payoutRemittance({
        transferId: targetRem.id,
        transferNumber: targetRem.transferNumber,
        recipientIdType,
        recipientIdNumber: recipientIdNumber.trim(),
        amount: targetRem.amount,
        currency: targetRem.currency,
        clientAmount: targetRem.amount,
        clientCurrency: targetRem.currency,
      });

      if (!serverResult.success) {
        toast.error('رفض الخادم عملية الصرف', serverResult.error || 'فشلت مصادقة صرف الحوالة على الخادم المركزي.');
        setIsProcessingPayout(false);
        return;
      }

      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);
      
      // C3: استخدام القيد المحاسبي والأرصدة الرسمية الصادرة من الخادم
      const officialJv = serverResult.journalEntry;
      const entryNum = officialJv?.entryNumber || serverResult.record?.journalEntryReference || `JV-${new Date().getFullYear()}-0001`;

      if (serverResult.accounts && serverResult.accounts.length > 0) {
        setAccounts(serverResult.accounts as Account[]);
      }

      if (officialJv) {
        setJournalEntries((prev) => [
          officialJv as JournalEntry,
          ...prev.filter((j) => j.id !== officialJv.id && j.entryNumber !== officialJv.entryNumber),
        ]);
      }

      // 3. Update Remittance state
      setRemittances((prev) =>
        prev.map((r) =>
          r.id === transferId
            ? {
                ...r,
                status: 'paid',
                paidAt: serverResult.record?.paidAt || `${dateStr} ${timeStr}`,
                recipientIdType,
                recipientIdNumber: recipientIdNumber.trim(),
              }
            : r
        )
      );

      // 4. System audit log
      const payoutAuditLog: SystemAuditLog = {
        id: `sys-payout-${Date.now()}`,
        category: 'financial',
        timestamp: `${dateStr} ${timeStr}`,
        action: 'صرف حوالة مالية واردة (قيد خادمي معتمد)',
        details: `صرف الحوالة رقم ${targetRem.transferNumber} بمبلغ ${formatMoney(targetRem.amount, targetRem.currency)} للمستفيد ${targetRem.recipientName} (هوية: ${recipientIdNumber.trim()}) بقيد معتمد ${entryNum}`,
        performedBy: currentUser.name,
        userRole: currentUser.role,
      };
      setSystemAuditLogs((prev) => [payoutAuditLog, ...prev]);

      // 5. Generate Official Voucher via Central Voucher Engine
      const payoutVoucher = voucherEngine.createIncomingTransferPayoutVoucher({
        remittance: {
          ...targetRem,
          status: 'paid',
          paidAt: serverResult.record?.paidAt || `${dateStr} ${timeStr}`,
          recipientIdType,
          recipientIdNumber: recipientIdNumber.trim(),
        },
        recipientIdType,
        recipientIdNumber: recipientIdNumber.trim(),
        branchName: currentUser.branchName,
        tellerName: currentUser.name,
      });

      setActiveVoucher(payoutVoucher);

      toast.success(
        'تم صرف الحوالة بنجاح',
        `تم تسليم مبلغ ${formatMoney(targetRem.amount, targetRem.currency)} للمستفيد وتوثيق القيد المحاسبي (${entryNum}) في دفاتر الخادم المركزية.`
      );
    } catch (err: any) {
      toast.error('حدث خطأ أثناء صرف الحوالة', err.message || 'يرجى المحاولة مرة أخرى.');
    } finally {
      setIsProcessingPayout(false);
    }
  };

  // 4. Cancel Remittance with Reverse Journal Entry (إلغاء واسترداد بقيد عكسي)
  const handleCancelRemittance = (transferId: string, reason: string) => {
    const targetRem = remittances.find((r) => r.id === transferId);
    if (!targetRem) return;

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);
    const reverseEntryNum = `JV-REV-${Date.now().toString().slice(-4)}`;

    setRemittances((prev) =>
      prev.map((r) =>
        r.id === transferId
          ? {
              ...r,
              status: 'cancelled',
              cancelReason: reason,
              reverseEntryId: reverseEntryNum,
            }
          : r
      )
    );

    // Balanced Reverse Journal Entry
    const reverseEntry: JournalEntry = {
      id: `jv-rev-${Date.now()}`,
      entryNumber: reverseEntryNum,
      date: dateStr,
      time: timeStr,
      descriptionAr: `قيد عكسي لإلغاء الحوالة ${targetRem.transferNumber} - السبب: ${reason}`,
      lines: [
        {
          accountId: 'acc-1301',
          accountNameAr: `حساب ${targetRem.networkName}`,
          currency: targetRem.currency,
          debit: targetRem.amount,
          credit: 0,
          note: 'إلغاء المطالبة والتسوية',
        },
        {
          accountId: 'acc-1102',
          accountNameAr: 'صندوق كاشير الصراف 1',
          currency: targetRem.currency,
          debit: 0,
          credit: targetRem.amount,
          note: 'استرداد المبلغ للمرسل',
        },
      ],
      referenceType: 'transfer_reverse',
      referenceId: targetRem.transferNumber,
      branchId: currentUser.branchId,
      createdBy: currentUser.name,
      isBalanced: true,
    };

    setJournalEntries((prev) => [...prev, reverseEntry]);
  };

  // Helper: Create Incoming Remittance from networks for Cash-out
  const handleCreateIncomingRemittance = (data: {
    transferNumber: string;
    networkName: string;
    senderName: string;
    senderPhone: string;
    recipientName: string;
    recipientPhone: string;
    amount: number;
    currency: CurrencyCode;
    notes?: string;
  }): Remittance => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);

    const newRem: Remittance = {
      id: `rem-${Date.now()}`,
      transferNumber: data.transferNumber,
      voucherNumber: `V-INC-${Date.now().toString().slice(-4)}`,
      direction: 'incoming',
      senderName: data.senderName,
      senderPhone: data.senderPhone,
      recipientName: data.recipientName,
      recipientPhone: data.recipientPhone,
      amount: data.amount,
      currency: data.currency,
      feeAmount: 0,
      totalPaid: data.amount,
      networkName: data.networkName,
      status: 'pending',
      createdAt: `${dateStr} ${timeStr}`,
      branchName: currentUser.branchName,
      tellerName: currentUser.name,
      notes: data.notes || 'حوالة واردة للتسليم الفوري',
    };

    setRemittances((prev) => [newRem, ...prev]);
    return newRem;
  };

  // Fund drawer through the authoritative server ledger. Never update financial balances locally.
  const handleFundDrawer = async (currency: CurrencyCode, amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.warning('يرجى إدخال مبلغ صحيح لتغذية الصندوق.');
      return;
    }

    const fromAccountId = 'acc-1101';
    const toAccountId = 'acc-1102';
    const pendingStorageKey = 'alnamari_pending_fund_drawer_v1';

    let idempotencyKey: string;
    try {
      const rawPending = window.localStorage.getItem(pendingStorageKey);
      if (rawPending) {
        const pending = JSON.parse(rawPending) as {
          idempotencyKey?: string;
          fromAccountId?: string;
          toAccountId?: string;
          amount?: number;
          currency?: string;
        };

        if (!pending.idempotencyKey || pending.fromAccountId !== fromAccountId ||
            pending.toAccountId !== toAccountId ||
            pending.amount !== amount || pending.currency !== currency) {
          toast.warning(
            'توجد تغذية سابقة لم تُحسم',
            'لا تنفذ مبلغاً جديداً. أعد طلب العملية السابقة بنفس المبلغ والعملة لاسترجاع نتيجتها، أو اطلب مطابقة الدفتر من المسؤول.'
          );
          return;
        }
        idempotencyKey = pending.idempotencyKey;
      } else {
        idempotencyKey = window.crypto.randomUUID();
        window.localStorage.setItem(pendingStorageKey, JSON.stringify({
          idempotencyKey,
          fromAccountId,
          toAccountId,
          amount,
          currency,
          createdAt: new Date().toISOString(),
        }));
      }
    } catch {
      toast.error('تعذر حفظ رقم حماية العملية', 'أوقِف طلب التغذية؛ لا يمكن ضمان منع التكرار دون حفظ معرف العملية محلياً.');
      return;
    }

    const result = await apiClient.fundCashierDrawer({
      fromAccountId,
      toAccountId,
      amount,
      currency,
      idempotencyKey,
    });

    if (!result.success) {
      if (result.errorCode === 'COMMIT_PENDING_RECOVERY' || result.doNotRetry) {
        toast.error(
          'تغذية الصندوق غير محسومة',
          result.error || 'أوقف النظام ولا تعاود التغذية. يلزم فحص علامة الاسترداد ومطابقة الدفاتر.'
        );
        return;
      }

      if (result.outcomeUncertain) {
        toast.warning(
          'لم يصل تأكيد الخادم',
          'لم نغيّر الأرصدة في الواجهة. أعد نفس طلب التغذية بالمبلغ والعملة نفسيهما لاسترجاع النتيجة باستخدام معرف العملية نفسه.'
        );
        return;
      }

      try {
        window.localStorage.removeItem(pendingStorageKey);
      } catch {
        // The server rejected the request definitively; a stale local key will be detected on next attempt.
      }
      toast.error('رفض الخادم تغذية الصندوق', result.error || 'لم يتم تنفيذ العملية.');
      return;
    }

    if (!Array.isArray(result.accounts) || !result.journalEntry ||
        typeof result.journalEntry.entryNumber !== 'string' ||
        !result.journalEntry.idempotencyKey ||
        result.journalEntry.idempotencyKey !== idempotencyKey) {
      toast.error(
        'نتيجة التغذية غير مكتملة',
        'لم يتم تحديث الشاشة. لا تنشئ عملية جديدة؛ تحقق من دفتر الخادم باستخدام معرف العملية نفسه.'
      );
      return;
    }

    setAccounts(result.accounts as Account[]);
    setJournalEntries((previous) => {
      const alreadyPresent = previous.some(
        (entry) => entry.id === result.journalEntry.id ||
          entry.entryNumber === result.journalEntry.entryNumber
      );
      return alreadyPresent ? previous : [result.journalEntry as JournalEntry, ...previous];
    });

    try {
      window.localStorage.removeItem(pendingStorageKey);
    } catch {
      // Keeping a stale key is safe: a retry replays the committed journal entry without another debit.
    }

    const entry = result.journalEntry;
    const voucherNum = entry.voucherNumber || entry.referenceId;
    const auditRecord: SystemAuditLog = {
      id: `sys-log-${entry.id}`,
      category: 'financial',
      timestamp: `${entry.date} ${entry.time}`,
      action: 'تغذية صندوق الصراف',
      details: `اعتمد الخادم تغذية صندوق الكاشير بمبلغ ${formatMoney(amount, currency)} بالقيد ${entry.entryNumber}`,
      performedBy: currentUser.name,
      userRole: currentUser.role,
    };
    setSystemAuditLogs((previous) => [auditRecord, ...previous]);

    const voucher = voucherEngine.createInternalTransferVoucher({
      voucherNumber: voucherNum,
      fromAccountName: 'الخزينة الرئيسية المركزية',
      toAccountName: 'صندوق كاشير الصراف 1',
      amount,
      currency,
      tellerName: currentUser.name,
      branchName: currentUser.branchName,
      reason: 'تغذية صندوق الصراف لتغطية صرف الحوالات والعمليات اليومية',
    });
    setActiveVoucher(voucher);

    toast.success(
      'تم اعتماد تغذية الصندوق من الخادم',
      `تم اعتماد ${formatMoney(amount, currency)} بالقيد ${entry.entryNumber}. تم تحديث الأرصدة من دفتر الخادم.`
    );
  };

  // 5. Internal Financial Transfers (البند 3.3: التحويلات المالية الداخلية وتغذية الصناديق)
  const handleExecuteInternalTransfer = async (data: {
    fromAccountId: string;
    toAccountId: string;
    currency: CurrencyCode;
    amount: number;
    description: string;
  }): Promise<boolean> => {
    if (!Number.isFinite(data.amount) || data.amount <= 0 ||
        data.fromAccountId === data.toAccountId || !data.description.trim()) {
      toast.warning('بيانات المناقلة غير مكتملة أو غير صالحة.');
      return false;
    }

    const pendingStorageKey = 'alnamari_pending_internal_transfer_v1';
    let idempotencyKey: string;

    try {
      const rawPending = window.localStorage.getItem(pendingStorageKey);
      if (rawPending) {
        const pending = JSON.parse(rawPending) as {
          idempotencyKey?: string;
          fromAccountId?: string;
          toAccountId?: string;
          currency?: string;
          amount?: number;
          description?: string;
        };

        if (!pending.idempotencyKey ||
            pending.fromAccountId !== data.fromAccountId ||
            pending.toAccountId !== data.toAccountId ||
            pending.currency !== data.currency ||
            pending.amount !== data.amount ||
            pending.description !== data.description.trim()) {
          toast.warning(
            'توجد مناقلة سابقة لم تُحسم',
            'لا تنفذ مناقلة مختلفة الآن. أعد نفس المناقلة السابقة بالبيانات نفسها لاسترجاع نتيجتها أو اطلب مطابقة الدفتر.'
          );
          return false;
        }
        idempotencyKey = pending.idempotencyKey;
      } else {
        idempotencyKey = window.crypto.randomUUID();
        window.localStorage.setItem(pendingStorageKey, JSON.stringify({
          idempotencyKey,
          fromAccountId: data.fromAccountId,
          toAccountId: data.toAccountId,
          currency: data.currency,
          amount: data.amount,
          description: data.description.trim(),
          createdAt: new Date().toISOString(),
        }));
      }
    } catch {
      toast.error(
        'تعذر حفظ معرف المناقلة',
        'أوقِف العملية؛ لا يمكن ضمان منع التكرار دون حفظ معرف ثابت محلياً قبل إرسال الطلب.'
      );
      return false;
    }

    const result = await apiClient.executeInternalTransfer({
      fromAccountId: data.fromAccountId,
      toAccountId: data.toAccountId,
      currency: data.currency,
      amount: data.amount,
      description: data.description.trim(),
      idempotencyKey,
    });

    if (!result.success) {
      if (result.errorCode === 'COMMIT_PENDING_RECOVERY' || result.doNotRetry) {
        toast.error(
          'المناقلة غير محسومة محاسبياً',
          result.error || 'أوقف النظام ولا تعاود المناقلة. يلزم فحص علامة الاسترداد ومطابقة الدفاتر.'
        );
        return false;
      }

      if (result.outcomeUncertain) {
        toast.warning(
          'لم يصل تأكيد الخادم',
          'لم نغيّر الأرصدة في الواجهة. أعد نفس المناقلة بالبيانات نفسها لاسترجاع النتيجة باستخدام معرفها السابق.'
        );
        return false;
      }

      try {
        window.localStorage.removeItem(pendingStorageKey);
      } catch {
        // A stale key is harmless; a different request remains blocked until it is resolved.
      }
      toast.error('رفض الخادم المناقلة', result.error || 'لم يتم تنفيذ العملية.');
      return false;
    }

    const journalEntry = result.journalEntry;
    if (!Array.isArray(result.accounts) || !journalEntry ||
        journalEntry.referenceType !== 'internal_transfer' ||
        journalEntry.idempotencyKey !== idempotencyKey ||
        typeof journalEntry.entryNumber !== 'string' ||
        typeof journalEntry.voucherNumber !== 'string' ||
        !Array.isArray(journalEntry.lines) || journalEntry.lines.length !== 2) {
      toast.error(
        'استجابة المناقلة غير مكتملة',
        'لم يتم تحديث الشاشة أو إزالة معرف العملية. لا تبدأ مناقلة جديدة حتى تتم مطابقة دفتر الخادم.'
      );
      return false;
    }

    setAccounts(result.accounts as Account[]);
    setJournalEntries((previous) => {
      const exists = previous.some((entry) =>
        entry.id === journalEntry.id || entry.entryNumber === journalEntry.entryNumber
      );
      return exists ? previous : [journalEntry as JournalEntry, ...previous];
    });

    try {
      window.localStorage.removeItem(pendingStorageKey);
    } catch {
      // A repeated request remains safe because the server stores the idempotency key in the journal.
    }

    const fromAccount = (result.accounts as Account[]).find((account) => account.id === data.fromAccountId);
    const toAccount = (result.accounts as Account[]).find((account) => account.id === data.toAccountId);
    const auditRecord: SystemAuditLog = {
      id: `sys-log-${journalEntry.id}`,
      category: 'financial',
      timestamp: `${journalEntry.date} ${journalEntry.time}`,
      action: 'مناقلة مالية داخلية',
      details: `اعتمد الخادم مناقلة ${formatMoney(data.amount, data.currency)} من ${fromAccount?.nameAr || data.fromAccountId} إلى ${toAccount?.nameAr || data.toAccountId} بالقيد ${journalEntry.entryNumber}`,
      performedBy: currentUser.name,
      userRole: currentUser.role,
    };
    setSystemAuditLogs((previous) => [auditRecord, ...previous]);

    const voucher = voucherEngine.createInternalTransferVoucher({
      voucherNumber: journalEntry.voucherNumber,
      fromAccountName: fromAccount?.nameAr || 'الحساب المحول',
      toAccountName: toAccount?.nameAr || 'الحساب المستلم',
      amount: data.amount,
      currency: data.currency,
      tellerName: currentUser.name,
      branchName: currentUser.branchName,
      reason: data.description.trim(),
    });
    setActiveVoucher(voucher);

    toast.success(
      'تم اعتماد المناقلة من الخادم',
      `تم اعتماد ${formatMoney(data.amount, data.currency)} بالقيد ${journalEntry.entryNumber}. الأرصدة المعروضة من دفتر الخادم.`
    );
    return true;
  };

  // 6. Record Operating Expense (البند 7.3: إثبات سند صرف مصروف تشغيلي)
  const handleRecordExpense = async (data: {
    expenseType: string;
    amount: number;
    currency: CurrencyCode;
    notes: string;
  }): Promise<boolean> => {
    if (!Number.isFinite(data.amount) || data.amount <= 0 ||
        !data.expenseType.trim() || !data.notes.trim()) {
      toast.warning('بيانات المصروف غير مكتملة أو غير صالحة.');
      return false;
    }

    const pendingStorageKey = 'alnamari_pending_expense_v1';
    let idempotencyKey: string;

    try {
      const rawPending = window.localStorage.getItem(pendingStorageKey);
      if (rawPending) {
        const pending = JSON.parse(rawPending) as {
          idempotencyKey?: string;
          expenseType?: string;
          amount?: number;
          currency?: string;
          notes?: string;
        };

        if (!pending.idempotencyKey ||
            pending.expenseType !== data.expenseType.trim() ||
            pending.amount !== data.amount ||
            pending.currency !== data.currency ||
            pending.notes !== data.notes.trim()) {
          toast.warning(
            'يوجد سند مصروف سابق لم تُحسم نتيجته',
            'لا تسجل مصروفاً مختلفاً الآن. أعد نفس المصروف السابق بالبيانات ذاتها لاسترجاع نتيجته، أو اطلب مطابقة الدفتر.'
          );
          return false;
        }
        idempotencyKey = pending.idempotencyKey;
      } else {
        idempotencyKey = window.crypto.randomUUID();
        window.localStorage.setItem(pendingStorageKey, JSON.stringify({
          idempotencyKey,
          expenseType: data.expenseType.trim(),
          amount: data.amount,
          currency: data.currency,
          notes: data.notes.trim(),
          createdAt: new Date().toISOString(),
        }));
      }
    } catch {
      toast.error(
        'تعذر حفظ معرف سند المصروف',
        'أوقف العملية؛ لا يمكن ضمان منع تكرار سند الصرف دون حفظ معرف ثابت قبل إرسال الطلب.'
      );
      return false;
    }

    const result = await apiClient.executeOperatingExpense({
      expenseType: data.expenseType.trim(),
      amount: data.amount,
      currency: data.currency,
      notes: data.notes.trim(),
      idempotencyKey,
    });

    if (!result.success) {
      if (result.errorCode === 'COMMIT_PENDING_RECOVERY' || result.doNotRetry) {
        toast.error(
          'سند المصروف غير محسوم محاسبياً',
          result.error || 'أوقف النظام ولا تعاود تسجيل المصروف. يلزم فحص علامة الاسترداد ومطابقة الدفاتر.'
        );
        return false;
      }

      if (result.outcomeUncertain) {
        toast.warning(
          'لم يصل تأكيد الخادم',
          'لم نغيّر الأرصدة في الواجهة. أعد نفس سند المصروف بالبيانات نفسها لاسترجاع النتيجة باستخدام معرفه السابق.'
        );
        return false;
      }

      try {
        window.localStorage.removeItem(pendingStorageKey);
      } catch {
        // Definitive server rejection; no local financial changes were made.
      }
      toast.error('رفض الخادم سند المصروف', result.error || 'لم يتم تنفيذ المصروف.');
      return false;
    }

    const journalEntry = result.journalEntry;
    const expenseLine = journalEntry?.lines?.find((line: any) =>
      line.accountId === 'acc-5101' &&
      line.currency === data.currency &&
      Math.abs(line.debit - data.amount) <= 0.0000001 &&
      line.credit === 0
    );
    const cashierLine = journalEntry?.lines?.find((line: any) =>
      line.accountId === 'acc-1102' &&
      line.currency === data.currency &&
      Math.abs(line.credit - data.amount) <= 0.0000001 &&
      line.debit === 0
    );

    if (!Array.isArray(result.accounts) || !journalEntry ||
        journalEntry.referenceType !== 'expense' ||
        journalEntry.idempotencyKey !== idempotencyKey ||
        typeof journalEntry.entryNumber !== 'string' ||
        typeof journalEntry.voucherNumber !== 'string' ||
        !expenseLine || !cashierLine) {
      toast.error(
        'استجابة سند المصروف غير مكتملة',
        'لم يتم تحديث الشاشة أو إزالة معرف العملية. لا تنشئ سنداً جديداً حتى تتم مطابقة دفتر الخادم.'
      );
      return false;
    }

    setAccounts(result.accounts as Account[]);
    setJournalEntries((previous) => {
      const exists = previous.some((entry) =>
        entry.id === journalEntry.id || entry.entryNumber === journalEntry.entryNumber
      );
      return exists ? previous : [journalEntry as JournalEntry, ...previous];
    });

    try {
      window.localStorage.removeItem(pendingStorageKey);
    } catch {
      // The journal stores the idempotency key, so a repeated request is still safe.
    }

    const auditRecord: SystemAuditLog = {
      id: `sys-log-${journalEntry.id}`,
      category: 'financial',
      timestamp: `${journalEntry.date} ${journalEntry.time}`,
      action: 'اعتماد سند صرف مصروف تشغيلي',
      details: `اعتمد الخادم مصروف ${data.expenseType.trim()} بمبلغ ${formatMoney(data.amount, data.currency)} بالقيد ${journalEntry.entryNumber}`,
      performedBy: currentUser.name,
      userRole: currentUser.role,
    };
    setSystemAuditLogs((previous) => [auditRecord, ...previous]);

    const expenseVoucher: OfficialVoucher = {
      id: journalEntry.id,
      voucherNumber: journalEntry.voucherNumber,
      type: 'payment',
      date: journalEntry.date,
      time: journalEntry.time,
      branchName: currentUser.branchName,
      tellerName: currentUser.name,
      partyName: data.expenseType.trim(),
      partyPhone: '',
      amount: data.amount,
      currency: data.currency,
      amountInWordsAr: tafqeetArabic(data.amount, data.currency),
      referenceNumber: journalEntry.entryNumber,
      qrCodeData: journalEntry.voucherNumber,
      notes: data.notes.trim(),
    };
    setActiveVoucher(expenseVoucher);

    toast.success(
      'تم اعتماد سند المصروف من الخادم',
      `تم اعتماد ${formatMoney(data.amount, data.currency)} بالقيد ${journalEntry.entryNumber}. الأرصدة من دفتر الخادم.`
    );
    return true;
  };

  // 7. Update Exchange Rates with Audit Trail
  const handleUpdateExchangeRate = (rateId: string, newBuyRate: number, newSellRate: number, note?: string) => {
    const targetRate = exchangeRates.find((r) => r.id === rateId);
    if (!targetRate) return;

    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').substring(0, 16);

    const newLog: ExchangeRateAuditLog = {
      id: `audit-${Date.now()}`,
      currencyPair: `${targetRate.fromCurrency} / ${targetRate.toCurrency}`,
      oldBuyRate: targetRate.buyRate,
      newBuyRate,
      oldSellRate: targetRate.sellRate,
      newSellRate,
      changedAt: timeStr,
      changedBy: `${currentUser.name} (${currentUser.roleTitleAr})`,
      note: note || 'تعديل أسعار الصرف المعتمدة',
    };

    setAuditLogs((prev) => [newLog, ...prev]);

    setExchangeRates((prev) =>
      prev.map((r) =>
        r.id === rateId
          ? {
              ...r,
              buyRate: newBuyRate,
              sellRate: newSellRate,
              updatedAt: timeStr,
              updatedBy: currentUser.name,
            }
          : r
      )
    );
  };

  // 8. Close Shift (إقفال الوردية)
  const handleCloseShift = (actualBalances: Record<CurrencyCode, number>, notes: string) => {
    setActiveShift((prev) => ({
      ...prev,
      status: 'closed',
      closedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      actualBalances,
      notes,
    }));
  };

  // 9. Open New Shift
  const handleOpenNewShift = () => {
    setActiveShift({
      ...INITIAL_ACTIVE_SHIFT,
      id: `shift-${Date.now().toString().slice(-4)}`,
      openedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      status: 'open',
    });
  };

  // Open voucher from remittance record
  const handleOpenRemittanceVoucher = (rem: Remittance) => {
    const isOutgoing = rem.direction === 'outgoing';
    const voucher: OfficialVoucher = {
      id: `vouch-${rem.id}`,
      voucherNumber: rem.voucherNumber,
      type: isOutgoing ? 'transfer_outgoing' : 'transfer_incoming',
      templateType: isOutgoing ? 'send' : 'payout',
      date: rem.createdAt.split(' ')[0],
      time: rem.createdAt.split(' ')[1] || '00:00',
      branchName: rem.branchName,
      tellerName: rem.tellerName,
      partyName: isOutgoing ? rem.senderName : rem.recipientName,
      partyPhone: isOutgoing ? rem.senderPhone : rem.recipientPhone,
      senderName: rem.senderName,
      depositorName: rem.senderName,
      recipientName: rem.recipientName,
      recipientPhone: rem.recipientPhone,
      recipientIdType: rem.recipientIdType || 'بطاقة شخصية ذكية',
      recipientIdNumber: rem.recipientIdNumber,
      payoutMethod: 'نقداً من صندوق الكاشير',
      destinationCity: 'كافة المحافظات والمدن اليمنية',
      networkName: rem.networkName,
      amount: rem.amount,
      netAmount: rem.amount,
      totalPaid: rem.totalPaid,
      currency: rem.currency,
      amountInWordsAr: tafqeetArabic(rem.amount, rem.currency),
      commission: rem.feeAmount,
      referenceNumber: rem.transferNumber,
      generalNumber: `${rem.transferNumber}/1211005`,
      accountNumber: rem.recipientIdNumber || '1236334',
      qrCodeData: rem.transferNumber,
      notes: rem.notes,
      signatureStatus: 'pending_print',
      dispatchStatus: 'not_sent',
    };
    setActiveVoucher(voucher);
  };

  // This deployment is intentionally single-user and single-role (owner only).

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center" dir="rtl">
        <div className="text-sm text-slate-300">جارٍ التحقق من جلسة الدخول الآمنة...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-md text-center space-y-3">
          <h1 className="text-xl font-bold">نظام عمرو النماري للصرافة</h1>
          <p className="text-sm text-slate-400">هذا الإصدار مخصص لمالك واحد. سجّل الدخول للمتابعة.</p>
        </div>
        <RoleAuthModal
          isOpen={true}
          isRequired={true}
          targetRole="owner"
          onClose={() => undefined}
          onSuccess={(authedUser) => {
            setCurrentUser(authedUser);
            setIsAuthenticated(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
        isOnline={isOnline}
        setIsOnline={setIsOnline}
        onOpenRatesModal={() => setIsRatesModalOpen(true)}
        onOpenInternalTransferModal={() => setIsInternalTransferModalOpen(true)}
        onOpenA4StatementModal={() => {
          setStatementCustomerId(undefined);
          setStatementType('account');
          setIsA4StatementOpen(true);
        }}
        onOpenOfflineModal={() => setIsOfflineModalOpen(true)}
        onOpenOfficialVoucher={handleOpenOfficialSampleVoucher}
        onOpenPrintAudit={() => setIsPrintAuditOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
      />

      {/* Offline Mode Banner */}
      <OfflineBanner
        isOnline={isOnline}
        onOpenOfflineModal={() => setIsOfflineModalOpen(true)}
        pendingQueueCount={offlineStorage.getOfflineQueue().length}
      />

      {/* Main View Area with mobile bottom padding to clear the mobile nav bar */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-24 lg:pb-8">
        {activeTab === 'dashboard' && (
          <DashboardView
            accounts={accounts}
            exchangeRates={exchangeRates}
            journalEntries={journalEntries}
            remittances={remittances}
            activeShift={activeShift}
            currentUser={currentUser}
            onNavigate={setActiveTab}
            onOpenExchangeModal={() => setActiveTab('exchange')}
            onOpenRatesModal={() => setIsRatesModalOpen(true)}
            onOpenVoucher={(voucherId) => handleOpenOfficialSampleVoucher()}
            onOpenInternalTransferModal={() => setIsInternalTransferModalOpen(true)}
            onOpenA4StatementModal={() => {
              setStatementCustomerId(undefined);
              setStatementType('account');
              setIsA4StatementOpen(true);
            }}
            onOpenOfficialVoucher={handleOpenOfficialSampleVoucher}
          />
        )}

        {activeTab === 'exchange' && (
          <ExchangeDeskView
            accounts={accounts}
            exchangeRates={exchangeRates}
            currentUser={currentUser}
            onExecuteExchange={handleExecuteExchange}
            onOpenRatesModal={() => setIsRatesModalOpen(true)}
          />
        )}

        {activeTab === 'remittance' && (
          <RemittanceView
            remittances={remittances}
            accounts={accounts}
            currentUser={currentUser}
            remittanceSettings={remittanceSettings}
            onOpenSettings={() => setIsSettingsModalOpen(true)}
            onCreateOutgoingRemittance={handleCreateOutgoingRemittance}
            onPayoutIncomingRemittance={handlePayoutIncomingRemittance}
            onCancelRemittance={handleCancelRemittance}
            onOpenVoucher={handleOpenRemittanceVoucher}
          />
        )}

        {activeTab === 'receive_transfer' && (
          <ReceiveTransferDesk
            remittances={remittances}
            accounts={accounts}
            currentUser={currentUser}
            onPayout={handlePayoutIncomingRemittance}
            onOpenVoucher={handleOpenRemittanceVoucher}
            onCreateIncomingRemittance={handleCreateIncomingRemittance}
            onFundDrawer={handleFundDrawer}
          />
        )}

        {activeTab === 'customers' && (
          <CustomersView
            customers={customers}
            remittances={remittances}
            currentUser={currentUser}
            onAddCustomer={(c) => setCustomers((prev) => [c, ...prev])}
            onOpenA4Statement={(customerId) => {
              setStatementCustomerId(customerId);
              setStatementType(customerId ? 'customer' : 'account');
              setIsA4StatementOpen(true);
            }}
          />
        )}

        {activeTab === 'ledger' && (
          <LedgerAndAccountsView
            accounts={accounts}
            journalEntries={journalEntries}
            onRecordExpense={handleRecordExpense}
          />
        )}

        {activeTab === 'treasury' && (
          <TreasuryAndClosureView
            accounts={accounts}
            activeShift={activeShift}
            currentUser={currentUser}
            onCloseShift={handleCloseShift}
            onOpenNewShift={handleOpenNewShift}
          />
        )}

        {activeTab === 'clean_architecture' && <CleanArchitectureFlutterView />}
      </main>

      {/* Official Voucher & Multi-Size Printing Engine Modal */}
      {activeVoucher && (
        <OfficialVoucherModal
          voucher={activeVoucher}
          currentUser={currentUser}
          onClose={() => setActiveVoucher(null)}
          onVoucherChanged={(updated) => setActiveVoucher(updated)}
          onUpdateVoucherStatus={(voucherId, status, time, extraDetails) => {
            setActiveVoucher((prev) =>
              prev && prev.id === voucherId
                ? { ...prev, dispatchStatus: status, dispatchedAt: time, ...extraDetails }
                : prev
            );
          }}
        />
      )}

      {/* Print Audit Log & Manual Signature Records Modal */}
      <PrintAuditLogModal
        isOpen={isPrintAuditOpen}
        onClose={() => setIsPrintAuditOpen(false)}
        currentUser={currentUser}
      />

      {/* Official A4 Account & Profits Statement Modal */}
      <A4AccountStatementModal
        isOpen={isA4StatementOpen}
        onClose={() => {
          setIsA4StatementOpen(false);
          setStatementCustomerId(undefined);
        }}
        accounts={accounts}
        customers={customers}
        journalEntries={journalEntries}
        remittances={remittances}
        currentUser={currentUser}
        targetCustomerId={statementCustomerId}
        initialMode={statementType}
      />



      {/* Exchange Rates & Audit Log Modal */}
      <ExchangeRatesModal
        rates={exchangeRates}
        auditLogs={auditLogs}
        currentUser={currentUser}
        isOpen={isRatesModalOpen}
        onClose={() => setIsRatesModalOpen(false)}
        onUpdateRate={handleUpdateExchangeRate}
      />

      {/* Internal Financial Transfers Modal (Section 3.3) */}
      <InternalTransferModal
        accounts={accounts}
        currentUser={currentUser}
        isOpen={isInternalTransferModalOpen}
        onClose={() => setIsInternalTransferModalOpen(false)}
        onExecuteTransfer={handleExecuteInternalTransfer}
      />

      {/* Offline Mode & Local Data Backup Modal */}
      <OfflineBackupModal
        isOpen={isOfflineModalOpen}
        onClose={() => setIsOfflineModalOpen(false)}
        onDataReload={handleReloadData}
        isOnline={isOnline}
        onToggleOnline={() => setIsOnline(!isOnline)}
        entriesCount={journalEntries.length}
        remittancesCount={remittances.length}
        accountsCount={accounts.length}
      />

      {/* Remittance Numbering Settings & Security Modal (الإعدادات ← إعدادات الحوالات ← طريقة إصدار رقم الحوالة) */}
      <RemittanceSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={remittanceSettings}
        auditLogs={systemAuditLogs}
        currentUser={currentUser}
        onSaveSettings={handleSaveRemittanceSettings}
      />

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 px-6 text-center text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2 max-w-7xl mx-auto w-full no-print">
        <div className="flex items-center gap-2">
          <span>نظام عمرو النماري للصرافة والحسابات © 2026</span>
          <span>·</span>
          <span>الإصدار 1.0 معتمد</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <span className="text-emerald-400">القيد المزدوج: متوازن</span>
          <span>·</span>
          <span className="text-cyan-400">Dart Clean Architecture Ready</span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
