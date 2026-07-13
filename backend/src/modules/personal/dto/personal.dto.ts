import type { AccountType, PersonalTxnType } from '@prisma/client';

// ── Accounts ────────────────────────────────────────────────────────────────
export interface CreateAccountDto {
  name: string;
  type: AccountType;
  currency?: string; // when omitted, derived from country (FR→EUR, CA→CAD)
  country?: 'FR' | 'CA';
  openingBalance?: string;
  sortOrder?: number;
  // Credit-account payoff metadata (only meaningful for type = credit).
  interestRate?: string | null; // annual percentage rate, e.g. "19.99"
  creditLimit?: string | null;
  minPayment?: string | null;
}

export interface UpdateAccountDto {
  name?: string;
  country?: 'FR' | 'CA';
  sortOrder?: number;
  isActive?: boolean; // false => archive
  interestRate?: string | null;
  creditLimit?: string | null;
  minPayment?: string | null;
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
  interestRate: string | null;
  creditLimit: string | null;
  minPayment: string | null;
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
  minAmount?: string; // inclusive, in the transaction's account currency
  maxAmount?: string; // inclusive
}

// ── Saved filters (#8) ──────────────────────────────────────────────────────
export interface CreateSavedFilterDto {
  name: string;
  filters: PersonalTransactionFilter;
}

export interface SavedFilterDto {
  id: string;
  name: string;
  filters: PersonalTransactionFilter;
  createdAt: string;
  updatedAt: string;
}

// ── Credit-account payoff projection (#9) ───────────────────────────────────
export interface PayoffMonthDto {
  month: number; // 1-based month index
  interest: string; // interest accrued that month
  principal: string; // principal paid that month
  balance: string; // remaining balance after the payment
}

export interface PayoffScheduleDto {
  accountId: string;
  currency: string;
  startingBalance: string; // current amount owed (positive)
  monthlyPayment: string;
  interestRate: string; // APR used
  months: number; // number of payments to clear the debt
  totalInterest: string;
  totalPaid: string;
  // True when the monthly payment doesn't even cover the first month's interest,
  // so the balance never decreases (no finite schedule).
  neverPaysOff: boolean;
  schedule: PayoffMonthDto[];
}

// ── Net-worth history (#3) ──────────────────────────────────────────────────
export interface NetWorthSnapshotDto {
  date: string; // YYYY-MM-DD
  currency: string;
  total: string;
}

export interface NetWorthHistoryDto {
  profileCurrency: string;
  points: NetWorthSnapshotDto[];
}

// ── Net worth ─────────────────────────────────────────────────────────────────
export interface NetWorthAccountDto {
  accountId: string;
  name: string;
  type: AccountType;
  nativeCurrency: string;
  nativeBalance: string;
  convertedBalance: string; // in profile currency, at latest rate
  fxRate: string | null; // latest rate native→profile (null when same currency)
  fxRateDate: string | null; // ISO YYYY-MM-DD the rate actually applies to
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
