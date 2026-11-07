import { CurrencyCode } from './exchange';

export interface CustomerKYC {
  id: string;
  code: string;
  fullName: string;
  phone: string;
  address: string;
  idType: 'national_id' | 'passport' | 'family_card';
  idTypeNameAr: string;
  idNumber: string;
  idIssueDate: string;
  idExpiryDate: string;
  balances: Record<CurrencyCode, number>;
  totalTransfersCount: number;
  totalTransfersVolume: Record<CurrencyCode, number>;
  createdAt: string;
  status: 'active' | 'suspended';
  notes?: string;
}

export const INITIAL_CUSTOMERS: CustomerKYC[] = [];
