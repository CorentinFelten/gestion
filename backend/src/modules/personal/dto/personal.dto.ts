import type { AccountType, PersonalTxnType } from '@prisma/client';

// ── Accounts ────────────────────────────────────────────────────────────────
export interface CreateAccountDto {
  name: string;
  type: AccountType;
  currency?: string; // when omitted, derived from country (FR→EUR, CA→CAD)
  country?: 'FR' | 'CA';
  openingBalance?: string;
  sortOrder?: number;
}

export interface UpdateAccountDto {
  name?: string;
  country?: 'FR' | 'CA';
  sortOrder?: number;
  isActive?: boolean; // false => archive
}

export interface AccountDto {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  country: string;
  openingBalance: string;
  isActive: boolean;
  archivedAt: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface AccountBalanceDto {
  accountId: string;
  currency: string;
  balance: string; // native currency
}

// ── Personal transactions ────────────────────────────────────────────────────
export interface CreatePersonalTransactionDto {
  accountId: string;
  type: PersonalTxnType;
  categoryId?: string | null;
  amount: string; // in the account's currency
  // foreign-currency entry (optional)
  amountOriginal?: string | null;
  currencyOriginal?: string | null;
  txnDate: string; // ISO YYYY-MM-DD
  payeeSource?: string | null;
  notes?: string | null;
  // transfer-only
  transferAccountId?: string | null;
  transferAmount?: string | null; // converted leg for cross-currency transfers
  // optional links to the shared ledger
  linkedTransactionId?: string | null;
  linkedSettlementId?: string | null;
}

export type UpdatePersonalTransactionDto = Partial<CreatePersonalTransactionDto>;

export interface PersonalTransactionDto {
  id: string;
  accountId: string;
  type: PersonalTxnType;
  categoryId: string | null;
  amount: string;
  amountOriginal: string | null;
  currencyOriginal: string | null;
  fxRate: string | null;
  fxRateDate: string | null;
  fxSource: string | null;
  txnDate: string;
  payeeSource: string | null;
  notes: string | null;
  transferAccountId: string | null;
  transferAmount: string | null;
  linkedTransactionId: string | null;
  linkedSettlementId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalTransactionFilter {
  type?: PersonalTxnType;
  accountId?: string;
  categoryId?: string;
  from?: string;
  to?: string;
  payee?: string;
  search?: string;
}

// ── Net worth ─────────────────────────────────────────────────────────────────
export interface NetWorthAccountDto {
  accountId: string;
  name: string;
  type: AccountType;
  nativeCurrency: string;
  nativeBalance: string;
  convertedBalance: string; // in profile currency, at latest rate
}

export interface NetWorthDto {
  profileCurrency: string;
  total: string; // converted total (liabilities negative)
  asOf: string; // ISO timestamp of the rate snapshot
  accounts: NetWorthAccountDto[];
}

// ── Stats ─────────────────────────────────────────────────────────────────────
export type StatsView = 'cashflow' | 'by-category' | 'by-account' | 'income-timeline';
export type StatsPeriod = 'month' | 'year';

export interface StatsPoint {
  key: string; // YYYY-MM / category id / account id
  label: string;
  income?: string;
  expense?: string;
  total?: string;
}

export interface StatsResponseDto {
  view: StatsView;
  period: StatsPeriod;
  profileCurrency: string;
  points: StatsPoint[];
}

export interface StatsSummaryDto {
  profileCurrency: string;
  month: string; // YYYY-MM
  income: string;
  spending: string;
  savingsRate: string; // e.g. "0.32"
}
