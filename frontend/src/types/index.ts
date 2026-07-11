/**
 * Shared frontend contract, mirrors the backend API DTOs (PLAN.md §6).
 * Feature agents import these; keep them in sync with backend `dto` files.
 * Money values are strings (decimal-safe); parse with decimal.js where needed.
 */

// ── Enums (string unions matching Prisma enums) ───────────────────────────────
export type Role = 'owner' | 'admin' | 'member';
/** Country a personal account belongs to; defaults its currency (FR→EUR, CA→CAD). */
export type Country = 'FR' | 'CA';
/** Intl formatting locale (distinct from UI language). Read from `User.locale`. */
export type Locale = 'fr-FR' | 'fr-CA';
export type SplitType = 'equal' | 'exact' | 'percent' | 'shares';
export type AccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'credit_card'
  | 'investment'
  | 'other';
export type PersonalTxnType = 'income' | 'expense' | 'transfer';
export type CategoryScope = 'shared' | 'personal' | 'both';
export type CategoryFlow = 'expense' | 'income' | 'any';

// ── Users ─────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  preferredCurrency: string;
  /** ISO-4217 codes the user pinned; rendered first in every currency picker. */
  pinnedCurrencies: string[];
  locale: string;
}

export interface PublicUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

// ── Households ──────────────────────────────────────────────────────────────
export interface Household {
  id: string;
  name: string;
  baseCurrency: string;
  createdById: string;
  createdAt: string;
  role: Role;
}

export interface Member {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
  joinedAt: string;
}

export type InviteStatus = 'pending' | 'accepted' | 'declined';

/** Sent-invite view, how a household owner/admin sees an invite they created. */
export interface Invite {
  id: string;
  invitedUser: { id: string; displayName: string; email: string };
  role: Role;
  status: InviteStatus;
  createdAt: string;
}

/** Received-invite view, a pending invite addressed to the current user. */
export interface ReceivedInvite {
  id: string;
  household: { id: string; name: string };
  invitedByName: string;
  role: Role;
  createdAt: string;
}

/** A registered user the sender may invite (no household, no pending invite). */
export interface InvitableUser {
  id: string;
  displayName: string;
  email: string;
}

// ── Categories ────────────────────────────────────────────────────────────────
export interface Category {
  id: string;
  householdId: string | null;
  userId: string | null;
  scope: CategoryScope;
  flow: CategoryFlow;
  name: string;
  icon: string | null;
  color: string | null;
}

// ── Shared transactions & splits ──────────────────────────────────────────────
export interface SplitInput {
  userId: string;
  splitType: SplitType;
  shareValue: string;
}

export interface Split {
  id: string;
  userId: string;
  splitType: SplitType;
  shareValue: string;
  amountBase: string;
}

export interface Transaction {
  id: string;
  householdId: string;
  payerUserId: string;
  description: string;
  categoryId: string | null;
  notes: string | null;
  amountOriginal: string;
  currencyOriginal: string;
  paymentDate: string;
  baseCurrency: string;
  fxRate: string;
  fxRateDate: string;
  fxSource: string;
  amountBase: string;
  splits: Split[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransactionInput {
  payerUserId: string;
  description: string;
  categoryId?: string | null;
  notes?: string | null;
  amountOriginal: string;
  currencyOriginal: string;
  paymentDate: string;
  splits: SplitInput[];
  linkToAccountId?: string | null;
}

export interface Attachment {
  id: string;
  transactionId: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
}

// ── Settlements ───────────────────────────────────────────────────────────────
export interface Settlement {
  id: string;
  householdId: string;
  fromUserId: string;
  toUserId: string;
  categoryId: string | null;
  amountOriginal: string;
  currencyOriginal: string;
  paymentDate: string;
  fxRate: string;
  fxRateDate: string;
  fxSource: string;
  amountBase: string;
  isFullReset: boolean;
  note: string | null;
  createdById: string;
  createdAt: string;
}

export interface CreateSettlementInput {
  fromUserId: string;
  toUserId: string;
  categoryId?: string | null;
  amountOriginal: string;
  currencyOriginal: string;
  paymentDate: string;
  note?: string | null;
  linkToAccountId?: string | null;
}

export interface SettleUpPrefill {
  fromUserId: string;
  toUserId: string;
  categoryId: string;
  outstandingBase: string;
  baseCurrency: string;
  isFullReset: true;
}

// ── Tally / balances ──────────────────────────────────────────────────────────
export interface TallyCell {
  categoryId: string | null;
  categoryName: string;
  otherUserId: string;
  otherUserName: string;
  net: string; // +owed (green) / -owes (red), base currency
}

export interface TallyBoard {
  baseCurrency: string;
  subjectUserId: string | null;
  cells: TallyCell[];
  categoryTotals: { categoryId: string | null; categoryName: string; net: string }[];
  overall: string;
}

export interface SettleUpEntry {
  fromUserId: string;
  toUserId: string;
  categoryId: string | null;
  categoryName: string;
  amountBase: string;
}

export interface SettleUpResponse {
  baseCurrency: string;
  simplified: boolean;
  entries: SettleUpEntry[];
}

export type ReportGroup = 'category' | 'member' | 'month' | 'currency';

export interface ReportRow {
  key: string;
  label: string;
  totalBase: string;
  count: number;
}

export interface ReportResponse {
  baseCurrency: string;
  group: ReportGroup;
  rows: ReportRow[];
}

// ── Personal ledger ─────────────────────────────────────────────────────────
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  /** Country the account belongs to; defaults its currency (FR→EUR, CA→CAD). */
  country?: Country;
  openingBalance: string;
  isActive: boolean;
  archivedAt: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface AccountBalance {
  accountId: string;
  currency: string;
  balance: string;
}

export interface PersonalTransaction {
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

export interface CreatePersonalTransactionInput {
  accountId: string;
  type: PersonalTxnType;
  categoryId?: string | null;
  amount: string;
  amountOriginal?: string | null;
  currencyOriginal?: string | null;
  txnDate: string;
  payeeSource?: string | null;
  notes?: string | null;
  transferAccountId?: string | null;
  transferAmount?: string | null;
  linkedTransactionId?: string | null;
  linkedSettlementId?: string | null;
}

export interface NetWorthAccount {
  accountId: string;
  name: string;
  type: AccountType;
  nativeCurrency: string;
  nativeBalance: string;
  convertedBalance: string;
}

export interface NetWorth {
  profileCurrency: string;
  total: string;
  asOf: string;
  accounts: NetWorthAccount[];
}

export type StatsView = 'cashflow' | 'by-category' | 'by-account' | 'income-timeline';
export type StatsPeriod = 'month' | 'year';

export interface StatsPoint {
  key: string;
  label: string;
  income?: string;
  expense?: string;
  total?: string;
}

export interface StatsResponse {
  view: StatsView;
  period: StatsPeriod;
  profileCurrency: string;
  points: StatsPoint[];
}

export interface StatsSummary {
  profileCurrency: string;
  month: string;
  income: string;
  spending: string;
  savingsRate: string;
}

// ── FX ────────────────────────────────────────────────────────────────────────
export interface FxRate {
  rate: string;
  rateDate: string;
  source: string;
}

// ── Auth request bodies (household/auth UI) ───────────────────────────────────
export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  preferredCurrency?: string;
  locale?: string;
}

/** register/login response envelope (session delivered as httpOnly cookie). */
export interface AuthResult {
  user: User;
}
