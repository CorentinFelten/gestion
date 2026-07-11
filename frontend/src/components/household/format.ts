/**
 * Non-formatting helpers for the household (shared) ledger: currency minor-unit
 * lookup, decimal coercion, the today-ISO date cap, a fallback currency list,
 * and client-side split resolution for the live preview. All user-facing money /
 * date FORMATTING lives in `@/i18n` (`useFormat()`), not here.
 */
import Decimal from 'decimal.js';

/** Currencies whose minor unit is not 2 digits. Default assumed 2. */
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

/** A pragmatic default currency list for pickers when /currencies is unavailable. */
export const COMMON_CURRENCIES = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'JPY',
  'CAD',
  'AUD',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'CNY',
  'HKD',
  'SGD',
  'INR',
  'BRL',
  'MXN',
  'ZAR',
];

export function minorUnits(currency: string): number {
  return MINOR_UNITS[currency?.toUpperCase()] ?? 2;
}

/** Safe numeric coercion for a decimal string (falls back to 0). */
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Today as an ISO `YYYY-MM-DD` (local), used to cap the payment-date picker. */
export function isoToday(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

// ── Split resolution (client-side preview + validation) ───────────────────────

export type SplitDraft = {
  userId: string;
  selected: boolean;
  /** Raw input: percent, share weight, or exact amount (original currency). */
  value: string;
};

/**
 * Resolve each member's owed amount in the *original* currency for a preview,
 * distributing any rounding remainder by the largest-remainder method so the
 * parts always sum exactly to the total. Returns a map userId → Decimal.
 */
export function resolveSplits(
  type: 'equal' | 'exact' | 'percent' | 'shares',
  total: string | number,
  drafts: SplitDraft[],
  currency: string,
): { amounts: Record<string, Decimal>; sum: Decimal } {
  const digits = minorUnits(currency);
  const active = drafts.filter((d) => d.selected);
  const totalDec = new Decimal(toNumber(total));
  const amounts: Record<string, Decimal> = {};

  if (active.length === 0) {
    return { amounts, sum: new Decimal(0) };
  }

  if (type === 'exact') {
    let sum = new Decimal(0);
    for (const d of active) {
      const v = new Decimal(toNumber(d.value)).toDecimalPlaces(digits);
      amounts[d.userId] = v;
      sum = sum.plus(v);
    }
    return { amounts, sum };
  }

  // equal / percent / shares → proportional weights, then largest-remainder.
  const weights: Record<string, Decimal> = {};
  let weightSum = new Decimal(0);
  for (const d of active) {
    const w =
      type === 'equal' ? new Decimal(1) : new Decimal(toNumber(d.value)).clampedTo(0, Infinity);
    weights[d.userId] = w;
    weightSum = weightSum.plus(w);
  }
  if (weightSum.isZero()) {
    for (const d of active) amounts[d.userId] = new Decimal(0);
    return { amounts, sum: new Decimal(0) };
  }

  const unit = new Decimal(10).pow(-digits);
  const raw: { userId: string; floor: Decimal; remainder: Decimal }[] = [];
  let allocated = new Decimal(0);
  for (const d of active) {
    const exact = totalDec.times(weights[d.userId]).dividedBy(weightSum);
    const floor = exact.dividedBy(unit).floor().times(unit);
    raw.push({ userId: d.userId, floor, remainder: exact.minus(floor) });
    amounts[d.userId] = floor;
    allocated = allocated.plus(floor);
  }
  // Distribute leftover cents to the largest remainders.
  let leftover = totalDec.minus(allocated).dividedBy(unit).round();
  raw.sort((a, b) => b.remainder.comparedTo(a.remainder));
  for (let i = 0; leftover.gt(0) && i < raw.length; i++) {
    amounts[raw[i].userId] = amounts[raw[i].userId].plus(unit);
    leftover = leftover.minus(1);
  }

  let sum = new Decimal(0);
  for (const d of active) sum = sum.plus(amounts[d.userId]);
  return { amounts, sum };
}
