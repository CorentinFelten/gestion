import { Decimal } from 'decimal.js';
import type { AccountType, PersonalTxnType } from '@/types';

/**
 * Decimal-safe helpers for the personal-finance ("My Money") area.
 *
 * All *formatting* (money / dates / numbers / percent) now lives in the locale
 * layer, import `useFormat()` from `@/i18n` and use `f.money`, `f.date`, … so
 * output follows the active locale (fr-FR / fr-CA). This module keeps only the
 * decimal maths helpers and the small icon maps that drive the ledger visuals.
 */

function safeDecimal(value: string | number | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  try {
    return new Decimal(value);
  } catch {
    return new Decimal(0);
  }
}

export function toNumber(value: string | null | undefined): number {
  return safeDecimal(value).toNumber();
}

/** The signed contribution of a transaction to *its own account* balance. */
export function signedAmountForType(type: PersonalTxnType, amount: string): Decimal {
  const n = safeDecimal(amount);
  if (type === 'income') return n;
  if (type === 'expense') return n.negated();
  // transfer: an outflow from the row's `accountId`.
  return n.negated();
}

export function isNegative(value: string | number | null | undefined): boolean {
  return safeDecimal(value).isNegative();
}

export function sumStrings(values: (string | null | undefined)[]): string {
  return values.reduce<Decimal>((acc, v) => acc.plus(safeDecimal(v)), new Decimal(0)).toString();
}

// ── Ledger glyphs (labels come from `@/i18n` terms) ──────────────────────────
/** Icon per account type, labels via `accountTypeLabel` from `@/i18n`. */
export const ACCOUNT_TYPE_ICON: Record<AccountType, string> = {
  checking: '◉',
  savings: '▲',
  cash: '❖',
  credit_card: '◈',
  investment: '↗',
  other: '○',
};

/** Icon per personal transaction type, labels via `personalTxTypeLabel`. */
export const TXN_TYPE_ICON: Record<PersonalTxnType, string> = {
  income: '↓',
  expense: '↑',
  transfer: '⇄',
};
