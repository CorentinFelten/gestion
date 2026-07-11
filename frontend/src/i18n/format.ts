/**
 * Locale-aware formatters built on `Intl.*`. These REPLACE the ad-hoc money/date
 * helpers in `components/household/format.ts` and `components/money/format.ts`,
 * translators swap their imports to point here. The active locale comes from
 * `useLocale()`; pass it explicitly, or use the pre-bound `useFormat()` hook.
 *
 * Locale effects (fr-FR default, fr-CA alternative):
 *   fr-FR → `1 234,56 €`, dates `DD/MM/YYYY`
 *   fr-CA → `1 234,56 $`, dates `YYYY-MM-DD`
 */
import Decimal from 'decimal.js';
import type { Locale } from '@/types';

/** Default Intl locale when none is supplied. */
export const DEFAULT_LOCALE: Locale = 'fr-FR';

/** Currencies whose minor unit is not 2 digits (default assumed 2). */
const MINOR_UNITS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  HUF: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

/** Minor-unit (decimal) count for a currency. */
export function minorUnits(currency: string): number {
  return MINOR_UNITS[currency?.toUpperCase()] ?? 2;
}

/** Safe numeric coercion for a decimal string (falls back to 0). */
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  try {
    return new Decimal(value).toNumber();
  } catch {
    return 0;
  }
}

export interface MoneyOptions {
  /** Force a leading sign. Defaults to `'auto'` (only negatives get `-`). */
  signDisplay?: 'auto' | 'always' | 'never' | 'exceptZero';
  /** Override the currency's minor-unit count (rarely needed). */
  fractionDigits?: number;
}

/**
 * Format money in `currency` for `locale`, honouring the currency's minor units.
 * e.g. `formatMoney('1234.5', 'EUR', 'fr-FR')` → `1 234,50 €`.
 */
export function formatMoney(
  amount: string | number | null | undefined,
  currency: string,
  locale: Locale | string = DEFAULT_LOCALE,
  opts: MoneyOptions = {},
): string {
  const digits = opts.fractionDigits ?? minorUnits(currency);
  const n = toNumber(amount);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: opts.signDisplay ?? 'auto',
    }).format(n);
  } catch {
    // Unknown ISO code → plain number + code suffix.
    return `${n.toFixed(digits)} ${currency}`;
  }
}

/** Absolute-value money (direction shown separately, e.g. tallies). */
export function formatAbs(
  amount: string | number | null | undefined,
  currency: string,
  locale: Locale | string = DEFAULT_LOCALE,
): string {
  return formatMoney(new Decimal(toNumber(amount)).abs().toNumber(), currency, locale);
}

/** Money with an explicit `+ / −` sign (uses the typographic minus). */
export function formatSignedMoney(
  amount: string | number | null | undefined,
  currency: string,
  locale: Locale | string = DEFAULT_LOCALE,
): string {
  const n = new Decimal(toNumber(amount));
  const sign = n.isNegative() ? '−' : '+';
  return `${sign}${formatMoney(n.abs().toNumber(), currency, locale)}`;
}

/** Plain number with locale grouping/decimals. */
export function formatNumber(
  value: string | number | null | undefined,
  locale: Locale | string = DEFAULT_LOCALE,
  opts: Intl.NumberFormatOptions = {},
): string {
  try {
    return new Intl.NumberFormat(locale, opts).format(toNumber(value));
  } catch {
    return String(toNumber(value));
  }
}

/**
 * Percent. Pass the RATIO (0.125 → `12,5 %`). Set `alreadyPercent` when the
 * input is already scaled to 0–100 (e.g. a `savingsRate` of `12.5`).
 */
export function formatPercent(
  value: string | number | null | undefined,
  locale: Locale | string = DEFAULT_LOCALE,
  opts: { fractionDigits?: number; alreadyPercent?: boolean } = {},
): string {
  const ratio = opts.alreadyPercent ? toNumber(value) / 100 : toNumber(value);
  const digits = opts.fractionDigits ?? 1;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(ratio);
  } catch {
    return `${(ratio * 100).toFixed(digits)} %`;
  }
}

/** Date only: fr-FR → `11/07/2026`, fr-CA → `2026-07-11`. */
export function formatDate(
  value: string | number | Date | null | undefined,
  locale: Locale | string = DEFAULT_LOCALE,
): string {
  if (value === null || value === undefined || value === '') return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Date + time in the active locale. */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  locale: Locale | string = DEFAULT_LOCALE,
): string {
  if (value === null || value === undefined || value === '') return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** `2026-03` → `mars 2026` for month-grouped reports/stats. */
export function formatMonthKey(
  key: string,
  locale: Locale | string = DEFAULT_LOCALE,
  opts: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' },
): string {
  const m = /^(\d{4})-(\d{1,2})$/.exec(key);
  if (!m) return key;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  if (Number.isNaN(d.getTime())) return key;
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

/** Alias kept for parity with the legacy money helper. */
export const formatMonthLabel = formatMonthKey;

/** Today as an ISO `YYYY-MM-DD` (local), used to cap date pickers. */
export function isoToday(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}
