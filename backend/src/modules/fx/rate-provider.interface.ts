import type { Decimal } from 'decimal.js';

/**
 * A resolved FX quote. `rateDate` may differ from the requested date when the
 * provider walked back to the nearest prior published (TARGET business) day.
 */
export interface RateQuote {
  rate: Decimal;
  rateDate: string; // ISO date (YYYY-MM-DD) actually used
  source: string; // provider name
}

/**
 * Pluggable exchange-rate provider. Frankfurter is primary; a fallback provider
 * (e.g. erapi) is configured for currencies outside ECB coverage.
 * The `fx` feature agent implements concrete providers behind this interface.
 */
export interface RateProvider {
  readonly name: string;

  /** Rate to convert 1 unit of `from` into `to`, on or before `date` (ISO YYYY-MM-DD). */
  getRate(from: string, to: string, date: string): Promise<RateQuote>;

  /** Latest available rate (used for net-worth current-value conversion). */
  getLatestRate(from: string, to: string): Promise<RateQuote>;
}

/** DI token for the primary provider. */
export const RATE_PROVIDER = Symbol('RATE_PROVIDER');
/** DI token for the fallback provider. */
export const FALLBACK_RATE_PROVIDER = Symbol('FALLBACK_RATE_PROVIDER');
