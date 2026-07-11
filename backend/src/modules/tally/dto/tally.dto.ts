/**
 * Pairwise, per-category balances (PLAN.md §5). All amounts in the household
 * base currency, as decimal-safe strings. net > 0 in a cell means the subject
 * user is OWED (green); net < 0 means the subject OWES (red).
 */

export interface TallyCell {
  categoryId: string | null;
  categoryName: string;
  /** The other member in the pair. */
  otherUserId: string;
  otherUserName: string;
  /** net_pair from the subject's perspective, base currency. +owed / -owes. */
  net: string;
}

export interface CategoryTotal {
  categoryId: string | null;
  categoryName: string;
  net: string;
}

/** One member's full position: per-category cells vs each other member. */
export interface TallyMemberPosition {
  subjectUserId: string;
  subjectUserName: string;
  cells: TallyCell[];
  /** Per-category subtotal for the subject (base currency). */
  categoryTotals: CategoryTotal[];
  /** Overall total across categories for the subject (base currency). */
  overall: string;
}

/** One member's full position: per-category cells vs each other member. */
export interface TallyBoardDto {
  baseCurrency: string;
  subjectUserId: string | null; // set when ?me=1
  subjectUserName?: string | null;
  cells: TallyCell[];
  /** Per-category subtotal for the subject (base currency). */
  categoryTotals: CategoryTotal[];
  /** Overall total across categories for the subject (base currency). */
  overall: string;
  /** Populated for the full matrix view (no ?me): every member's position. */
  members?: TallyMemberPosition[];
}

/** A non-zero pairwise position to clear (settle-up list). */
export interface SettleUpEntry {
  fromUserId: string; // debtor
  fromUserName?: string;
  toUserId: string; // creditor
  toUserName?: string;
  categoryId: string | null;
  categoryName: string;
  amountBase: string;
}

export interface SettleUpResponseDto {
  baseCurrency: string;
  simplified: boolean; // true when greedy cross-category simplification applied
  entries: SettleUpEntry[];
}

export type ReportGroup = 'category' | 'member' | 'month' | 'currency';

export interface ReportRow {
  key: string; // category id / member id / YYYY-MM / currency code
  label: string;
  totalBase: string;
  count: number;
}

export interface ReportResponseDto {
  baseCurrency: string;
  group: ReportGroup;
  rows: ReportRow[];
}
