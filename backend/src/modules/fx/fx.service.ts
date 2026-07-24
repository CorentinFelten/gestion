import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FALLBACK_RATE_PROVIDER,
  RATE_PROVIDER,
  type RateProvider,
  type RateQuote,
} from './rate-provider.interface';
import { RateUnavailableError } from './errors';
import { assertKnownCurrency, normalizeCurrency } from './currencies';
import { dateToISO, isValidDateISO, prevDayISO, todayISO, toUtcDate } from './date.util';

/** Result of a frozen (historical) rate lookup. */
export interface FxRateResult {
  rate: Decimal;
  rateDate: string; // ISO YYYY-MM-DD actually used (may be a prior business day)
  source: string;
}

/** Result of a conversion: the converted amount plus the frozen rate snapshot. */
export interface FxConversionResult {
  amount: Decimal; // converted amount in `to` currency
  rate: Decimal;
  rateDate: string;
  source: string;
}

/** Synthetic source label for same-currency (identity) conversions. */
const IDENTITY_SOURCE = 'identity';
/** How many calendar days to walk back looking for a published rate. */
const MAX_LOOKBACK_DAYS = 10;
/** Money conversions are rounded to 6 dp (NUMERIC(20,6)), PLAN §4 invariant. */
const AMOUNT_SCALE = 6;

/**
 * SHARED CONTRACT, imported by transactions, settlements, and personal modules.
 * FxModule exports this service. The SIGNATURES of the public methods are frozen
 *, do not change them; other modules depend on them.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RATE_PROVIDER) private readonly primary: RateProvider,
    @Inject(FALLBACK_RATE_PROVIDER) private readonly fallback: RateProvider | null,
  ) {}

  /**
   * Resolve the rate to convert 1 `from` into `to` on `dateISO`, frozen to the
   * nearest available prior published date. Reads cache, falls through to the
   * provider(s) on miss, and persists the result to `exchange_rates`.
   */
  async getRate(from: string, to: string, dateISO: string): Promise<FxRateResult> {
    const base = normalizeCurrency(from);
    const quote = normalizeCurrency(to);

    if (!isValidDateISO(dateISO)) {
      throw new BadRequestException(`Invalid date (expected YYYY-MM-DD): ${dateISO}`);
    }
    if (dateISO > todayISO()) {
      throw new BadRequestException(`Future date not allowed: ${dateISO}`);
    }
    assertKnownCurrency(base);
    assertKnownCurrency(quote);

    // Same currency: rate 1, no provider call and nothing to cache.
    if (base === quote) {
      return { rate: new Decimal(1), rateDate: dateISO, source: IDENTITY_SOURCE };
    }

    // 1. Cache lookup, exact requested date. Resolved rates are cached under
    //    their own (prior business) date, so a weekend/holiday date whose rate
    //    was frozen under the preceding Friday still misses here and re-queries
    //    the provider, unless the provider is unreachable (see step 3).
    const cached = await this.prisma.exchangeRate.findFirst({
      where: { base, quote, rateDate: toUtcDate(dateISO) },
      orderBy: { fetchedAt: 'desc' },
    });
    if (cached) {
      return {
        rate: new Decimal(cached.rate.toString()),
        rateDate: dateToISO(cached.rateDate),
        source: cached.source,
      };
    }

    // 2. Miss, call the provider(s), walking back to the nearest prior rate.
    let quoteResult: RateQuote;
    try {
      quoteResult = await this.resolveHistorical(base, quote, dateISO);
    } catch (err) {
      // 3. Provider chain unreachable. If a rate for a prior business day was
      //    already frozen in the cache, serve it rather than failing the write:
      //    the frozen snapshot is correct-by-construction and the whole point of
      //    the cache is offline tolerance between nightly prefetches.
      if (err instanceof ServiceUnavailableException) {
        const priorCached = await this.findNearestCachedRate(base, quote, dateISO);
        if (priorCached) {
          this.logger.warn(
            `FX provider unavailable for ${base}->${quote}@${dateISO}; ` +
              `serving cached rate frozen ${priorCached.rateDate}`,
          );
          return priorCached;
        }
      }
      throw err;
    }

    // 4. Persist the resolved snapshot and return it.
    await this.persist(base, quote, quoteResult);
    return { rate: quoteResult.rate, rateDate: quoteResult.rateDate, source: quoteResult.source };
  }

  /**
   * Nearest cached rate at or before `dateISO`, scanning back up to
   * MAX_LOOKBACK_DAYS one day at a time. Used only as an offline fallback when
   * the provider chain is unreachable: every cached row's `rateDate` is a real
   * published day, so the nearest prior one is the correct frozen snapshot for a
   * weekend/holiday date. (On the happy path we always ask the provider so a
   * genuine trading-day rate is never shadowed by an older cached one.)
   */
  private async findNearestCachedRate(
    base: string,
    quote: string,
    dateISO: string,
  ): Promise<FxRateResult | null> {
    let cursor = dateISO;
    for (let i = 0; i <= MAX_LOOKBACK_DAYS; i++) {
      const row = await this.prisma.exchangeRate.findFirst({
        where: { base, quote, rateDate: toUtcDate(cursor) },
        orderBy: { fetchedAt: 'desc' },
      });
      if (row) {
        return {
          rate: new Decimal(row.rate.toString()),
          rateDate: dateToISO(row.rateDate),
          source: row.source,
        };
      }
      cursor = prevDayISO(cursor);
    }
    return null;
  }

  /**
   * Convert `amount` from `from` to `to` on `dateISO`, returning the converted
   * amount together with the frozen rate snapshot to store on the record.
   * amount_base = round(amount * rate, 6).
   */
  async convert(
    amount: Decimal,
    from: string,
    to: string,
    dateISO: string,
  ): Promise<FxConversionResult> {
    const { rate, rateDate, source } = await this.getRate(from, to, dateISO);
    const converted = amount.mul(rate).toDecimalPlaces(AMOUNT_SCALE);
    return { amount: converted, rate, rateDate, source };
  }

  /**
   * Latest available rate, used ONLY for net-worth current-value conversion
   * (§3.4). Every recorded transaction uses getRate/convert (historical freeze).
   * Cached per-day: at most one provider call per (base,quote) per calendar day.
   */
  async getLatestRate(from: string, to: string): Promise<FxRateResult> {
    const base = normalizeCurrency(from);
    const quote = normalizeCurrency(to);
    assertKnownCurrency(base);
    assertKnownCurrency(quote);

    if (base === quote) {
      return { rate: new Decimal(1), rateDate: todayISO(), source: IDENTITY_SOURCE };
    }

    // Cache: reuse any CURRENT-rate row already fetched today (keeps net-worth
    // reads cheap and offline-tolerant between nightly prefetches). A historical
    // getRate() for the same pair also stamps fetchedAt=now but with an old
    // rateDate; bound rateDate to the recent past so such a row can't masquerade
    // as the latest rate (which would silently misvalue net worth).
    const startOfToday = toUtcDate(todayISO());
    const recentCutoff = new Date(startOfToday);
    recentCutoff.setUTCDate(recentCutoff.getUTCDate() - MAX_LOOKBACK_DAYS);
    const cached = await this.prisma.exchangeRate.findFirst({
      where: {
        base,
        quote,
        fetchedAt: { gte: startOfToday },
        rateDate: { gte: recentCutoff },
      },
      orderBy: { rateDate: 'desc' },
    });
    if (cached) {
      return {
        rate: new Decimal(cached.rate.toString()),
        rateDate: dateToISO(cached.rateDate),
        source: cached.source,
      };
    }

    const quoteResult = await this.withFallback(
      (provider) => provider.getLatestRate(base, quote),
      `latest ${base}->${quote}`,
    );
    await this.persist(base, quote, quoteResult);
    return { rate: quoteResult.rate, rateDate: quoteResult.rateDate, source: quoteResult.source };
  }

  /**
   * Every published rate for `from`->`to` between `startISO` and `endISO`
   * (inclusive), ascending by date, one entry per published business day. Used to
   * value a historical DAILY series (the net-worth trend) at each day's OWN rate
   * in a single provider round-trip instead of one `getRate` call per day; the
   * caller forward-fills weekends/holidays from the nearest prior entry.
   *
   * Cache-first: if the `exchange_rates` cache already spans the range it is
   * served without touching the provider (keeps repeat reads cheap & offline).
   * Otherwise one time-series call fetches the whole range, persists every row,
   * and returns it merged with the cache. On provider failure any cached rows for
   * the range are served. Same-currency ⇒ `[]` (caller uses identity).
   *
   * NOTE: additive to the FxService contract, the frozen `getRate` / `convert` /
   * `getLatestRate` signatures are unchanged.
   */
  async getRateSeries(
    from: string,
    to: string,
    startISO: string,
    endISO: string,
  ): Promise<FxRateResult[]> {
    const base = normalizeCurrency(from);
    const quote = normalizeCurrency(to);
    assertKnownCurrency(base);
    assertKnownCurrency(quote);
    if (!isValidDateISO(startISO)) {
      throw new BadRequestException(`Invalid date (expected YYYY-MM-DD): ${startISO}`);
    }
    if (!isValidDateISO(endISO)) {
      throw new BadRequestException(`Invalid date (expected YYYY-MM-DD): ${endISO}`);
    }
    if (base === quote) return [];
    const end = endISO > todayISO() ? todayISO() : endISO;
    if (startISO > end) return [];

    const toFx = (r: { rate: unknown; rateDate: Date; source: string }): FxRateResult => ({
      rate: new Decimal(r.rate!.toString()),
      rateDate: dateToISO(r.rateDate),
      source: r.source,
    });
    const dedupe = (list: FxRateResult[]): FxRateResult[] => {
      const byDate = new Map<string, FxRateResult>();
      for (const r of list) byDate.set(r.rateDate, r); // later entry (provider) wins
      return [...byDate.values()].sort((a, b) =>
        a.rateDate < b.rateDate ? -1 : a.rateDate > b.rateDate ? 1 : 0,
      );
    };

    const cachedRows = await this.prisma.exchangeRate.findMany({
      where: { base, quote, rateDate: { gte: toUtcDate(startISO), lte: toUtcDate(end) } },
      orderBy: { rateDate: 'asc' },
    });
    const cached = cachedRows.map(toFx);
    // Cache "covers" the range when it begins within a few days of the start and
    // extends to within a few days of the end (slack absorbs weekends/holidays).
    if (
      cached.length > 0 &&
      cached[0].rateDate <= this.shiftISO(startISO, 4) &&
      cached[cached.length - 1].rateDate >= this.shiftISO(end, -4)
    ) {
      return dedupe(cached);
    }

    try {
      const quotes = await this.withFallback(
        (provider) =>
          provider.getRateSeries
            ? provider.getRateSeries(base, quote, startISO, end)
            : Promise.reject(new RateUnavailableError(`${provider.name}: no time-series support`)),
        `series ${base}->${quote}@${startISO}..${end}`,
      );
      for (const q of quotes) await this.persist(base, quote, q);
      return dedupe([
        ...cached,
        ...quotes.map((q) => ({ rate: q.rate, rateDate: q.rateDate, source: q.source })),
      ]);
    } catch (err) {
      // Provider chain unreachable, serve whatever the cache holds so the trend
      // still renders offline (may be sparse, the caller forward-fills gaps).
      if (err instanceof ServiceUnavailableException && cached.length > 0) {
        this.logger.warn(
          `FX series provider unavailable for ${base}->${quote}; serving ${cached.length} cached rows`,
        );
        return dedupe(cached);
      }
      throw err;
    }
  }

  /** Shift an ISO date by `days` (may be negative), returning YYYY-MM-DD. */
  private shiftISO(iso: string, days: number): string {
    const d = toUtcDate(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return dateToISO(d);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Historical resolution with walk-back + primary/fallback provider chain. */
  private resolveHistorical(from: string, to: string, dateISO: string): Promise<RateQuote> {
    return this.withFallback(
      (provider) => this.walkBack(provider, from, to, dateISO),
      `${from}->${to}@${dateISO}`,
    );
  }

  /**
   * Ask a single provider for `dateISO`, stepping one calendar day back each
   * time it reports no rate for that day (weekend / holiday), up to
   * MAX_LOOKBACK_DAYS. Provider/network failures abort immediately so the caller
   * can try the fallback provider.
   */
  private async walkBack(
    provider: RateProvider,
    from: string,
    to: string,
    dateISO: string,
  ): Promise<RateQuote> {
    let cursor = dateISO;
    let lastError: unknown;
    for (let i = 0; i <= MAX_LOOKBACK_DAYS; i++) {
      try {
        return await provider.getRate(from, to, cursor);
      } catch (err) {
        lastError = err;
        if (err instanceof RateUnavailableError) {
          cursor = prevDayISO(cursor);
          continue;
        }
        throw err; // provider/network error, let the fallback take over
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new RateUnavailableError(`No rate within ${MAX_LOOKBACK_DAYS} days before ${dateISO}`);
  }

  /** Try the primary provider, then the fallback; surface a 503 if both fail. */
  private async withFallback<T>(
    call: (provider: RateProvider) => Promise<T>,
    context: string,
  ): Promise<T> {
    try {
      return await call(this.primary);
    } catch (primaryErr) {
      this.logger.warn(
        `Primary provider (${this.primary.name}) failed for ${context}: ${(primaryErr as Error).message}`,
      );
      if (this.fallback) {
        try {
          return await call(this.fallback);
        } catch (fallbackErr) {
          this.logger.error(
            `Fallback provider (${this.fallback.name}) failed for ${context}: ${(fallbackErr as Error).message}`,
          );
        }
      }
      throw new ServiceUnavailableException(`No FX rate available (${context})`);
    }
  }

  /** Idempotent upsert into the exchange_rates cache keyed by the resolved date. */
  private async persist(base: string, quote: string, q: RateQuote): Promise<void> {
    await this.prisma.exchangeRate.upsert({
      where: {
        base_quote_rateDate_source: {
          base,
          quote,
          rateDate: toUtcDate(q.rateDate),
          source: q.source,
        },
      },
      create: {
        base,
        quote,
        rateDate: toUtcDate(q.rateDate),
        rate: q.rate.toString(),
        source: q.source,
      },
      update: { rate: q.rate.toString(), fetchedAt: new Date() },
    });
  }
}
