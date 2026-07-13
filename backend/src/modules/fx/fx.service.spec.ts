import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { FxService } from './fx.service';
import type { RateProvider, RateQuote } from './rate-provider.interface';
import { RateProviderError, RateUnavailableError } from './errors';
import { todayISO } from './date.util';

// ── Test doubles ─────────────────────────────────────────────────────────────

/** Minimal in-memory stand-in for the exchange_rates table. */
class FakeExchangeRateRepo {
  rows: Array<{
    base: string;
    quote: string;
    rateDate: Date;
    rate: string;
    source: string;
    fetchedAt: Date;
  }> = [];

  findFirst = jest.fn(async ({ where, orderBy }: any) => {
    let matches = this.rows.filter(
      (r) => r.base === where.base && r.quote === where.quote,
    );
    if (where.rateDate instanceof Date) {
      const target = where.rateDate.getTime();
      matches = matches.filter((r) => r.rateDate.getTime() === target);
    } else if (where.rateDate?.gte) {
      const gte = where.rateDate.gte.getTime();
      matches = matches.filter((r) => r.rateDate.getTime() >= gte);
    }
    if (where.fetchedAt?.gte) {
      const gte = where.fetchedAt.gte.getTime();
      matches = matches.filter((r) => r.fetchedAt.getTime() >= gte);
    }
    if (orderBy?.fetchedAt === 'desc') {
      matches = [...matches].sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
    }
    if (orderBy?.rateDate === 'desc') {
      matches = [...matches].sort((a, b) => b.rateDate.getTime() - a.rateDate.getTime());
    }
    return matches[0] ?? null;
  });

  upsert = jest.fn(async ({ where, create, update }: any) => {
    const key = where.base_quote_rateDate_source;
    const existing = this.rows.find(
      (r) =>
        r.base === key.base &&
        r.quote === key.quote &&
        r.rateDate.getTime() === key.rateDate.getTime() &&
        r.source === key.source,
    );
    if (existing) {
      existing.rate = update.rate;
      existing.fetchedAt = update.fetchedAt ?? new Date();
      return existing;
    }
    const row = {
      base: create.base,
      quote: create.quote,
      rateDate: create.rateDate,
      rate: create.rate,
      source: create.source,
      fetchedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  });
}

function makePrisma(repo: FakeExchangeRateRepo) {
  return { exchangeRate: repo } as any;
}

/** Provider returning a fixed rate on any date (records calls). */
function staticProvider(name: string, rate: number, rateDate = '2026-03-13'): RateProvider {
  return {
    name,
    getRate: jest.fn(
      async (): Promise<RateQuote> => ({ rate: new Decimal(rate), rateDate, source: name }),
    ),
    getLatestRate: jest.fn(
      async (): Promise<RateQuote> => ({
        rate: new Decimal(rate),
        rateDate: todayISO(),
        source: name,
      }),
    ),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FxService', () => {
  let repo: FakeExchangeRateRepo;

  beforeEach(() => {
    repo = new FakeExchangeRateRepo();
  });

  describe('same-currency', () => {
    it('returns rate 1 without touching cache or provider', async () => {
      const primary = staticProvider('frankfurter', 0.9);
      const svc = new FxService(makePrisma(repo), primary, null);

      const res = await svc.getRate('EUR', 'EUR', '2026-03-14');

      expect(res.rate.toString()).toBe('1');
      expect(res.rateDate).toBe('2026-03-14');
      expect(res.source).toBe('identity');
      expect(primary.getRate).not.toHaveBeenCalled();
      expect(repo.findFirst).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('convert of same currency returns the untouched amount', async () => {
      const svc = new FxService(makePrisma(repo), staticProvider('frankfurter', 0.9), null);
      const res = await svc.convert(new Decimal('120.5'), 'usd', 'USD', '2026-03-14');
      expect(res.amount.toString()).toBe('120.5');
      expect(res.rate.toString()).toBe('1');
    });
  });

  describe('future date', () => {
    it('rejects a date after today', async () => {
      const svc = new FxService(makePrisma(repo), staticProvider('frankfurter', 0.9), null);
      await expect(svc.getRate('USD', 'EUR', '2999-01-01')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a malformed date', async () => {
      const svc = new FxService(makePrisma(repo), staticProvider('frankfurter', 0.9), null);
      await expect(svc.getRate('USD', 'EUR', '14-03-2026')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects an unknown currency', async () => {
      const svc = new FxService(makePrisma(repo), staticProvider('frankfurter', 0.9), null);
      await expect(svc.getRate('USD', 'ZZZ', '2026-03-14')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('cache miss then hit', () => {
    it('calls the provider on miss, persists, and serves the next call from cache', async () => {
      const primary = staticProvider('frankfurter', 0.918, '2026-03-13');
      const svc = new FxService(makePrisma(repo), primary, null);

      const first = await svc.getRate('USD', 'EUR', '2026-03-13');
      expect(first.rate.toString()).toBe('0.918');
      expect(first.rateDate).toBe('2026-03-13');
      expect(primary.getRate).toHaveBeenCalledTimes(1);
      expect(repo.upsert).toHaveBeenCalledTimes(1);
      expect(repo.rows).toHaveLength(1);

      const second = await svc.getRate('USD', 'EUR', '2026-03-13');
      expect(second.rate.toString()).toBe('0.918');
      expect(second.source).toBe('frankfurter');
      // Provider NOT called again, served from cache.
      expect(primary.getRate).toHaveBeenCalledTimes(1);
    });
  });

  describe('weekend / holiday walk-back', () => {
    it('steps back to the most recent prior published date', async () => {
      // Requested Sat 2026-03-14; no rate Sat/Sun; Fri 2026-03-13 = 0.918.
      const primary: RateProvider = {
        name: 'frankfurter',
        getRate: jest.fn(async (_from: string, _to: string, date: string): Promise<RateQuote> => {
          if (date === '2026-03-13') {
            return { rate: new Decimal('0.918'), rateDate: '2026-03-13', source: 'frankfurter' };
          }
          throw new RateUnavailableError(`no rate for ${date}`);
        }),
        getLatestRate: jest.fn(),
      };
      const svc = new FxService(makePrisma(repo), primary, null);

      const res = await svc.getRate('USD', 'EUR', '2026-03-14');

      expect(res.rate.toString()).toBe('0.918');
      // rateDate reflects the ACTUAL date used, not the requested Saturday.
      expect(res.rateDate).toBe('2026-03-13');
      expect(primary.getRate).toHaveBeenCalledWith('USD', 'EUR', '2026-03-14');
      expect(primary.getRate).toHaveBeenCalledWith('USD', 'EUR', '2026-03-13');
      // Persisted under the resolved date.
      expect(repo.rows[0].rateDate.toISOString().slice(0, 10)).toBe('2026-03-13');
    });

    it('gives up after MAX_LOOKBACK days and surfaces a 503', async () => {
      const primary: RateProvider = {
        name: 'frankfurter',
        getRate: jest.fn(async (): Promise<RateQuote> => {
          throw new RateUnavailableError('never available');
        }),
        getLatestRate: jest.fn(),
      };
      const svc = new FxService(makePrisma(repo), primary, null);
      await expect(svc.getRate('USD', 'EUR', '2026-03-14')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('fallback provider path', () => {
    it('falls back when the primary provider errors', async () => {
      const primary: RateProvider = {
        name: 'frankfurter',
        getRate: jest.fn(async (): Promise<RateQuote> => {
          throw new RateProviderError('network down');
        }),
        getLatestRate: jest.fn(),
      };
      const fallback = staticProvider('erapi', 0.92, '2026-03-14');
      const svc = new FxService(makePrisma(repo), primary, fallback);

      const res = await svc.getRate('USD', 'EUR', '2026-03-14');

      expect(res.source).toBe('erapi');
      expect(res.rate.toString()).toBe('0.92');
      expect(primary.getRate).toHaveBeenCalled();
      expect(fallback.getRate).toHaveBeenCalled();
    });

    it('throws 503 when both providers fail', async () => {
      const fail = (): RateProvider => ({
        name: 'x',
        getRate: jest.fn(async (): Promise<RateQuote> => {
          throw new RateProviderError('boom');
        }),
        getLatestRate: jest.fn(),
      });
      const svc = new FxService(makePrisma(repo), fail(), fail());
      await expect(svc.getRate('USD', 'EUR', '2026-03-14')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('serves a prior-business-day cached rate when the provider is unreachable', async () => {
      // A rate for Fri 2026-03-13 is already frozen in the cache.
      repo.rows.push({
        base: 'USD',
        quote: 'EUR',
        rateDate: new Date('2026-03-13T00:00:00.000Z'),
        rate: '0.918',
        source: 'frankfurter',
        fetchedAt: new Date('2026-03-13T02:00:00.000Z'),
      });
      // Provider is now down for a Sat 2026-03-14 request (not just a weekend gap).
      const primary: RateProvider = {
        name: 'frankfurter',
        getRate: jest.fn(async (): Promise<RateQuote> => {
          throw new RateProviderError('network down');
        }),
        getLatestRate: jest.fn(),
      };
      const svc = new FxService(makePrisma(repo), primary, null);

      const res = await svc.getRate('USD', 'EUR', '2026-03-14');

      // Falls back to Friday's frozen rate instead of 503-ing the write.
      expect(res.rate.toString()).toBe('0.918');
      expect(res.rateDate).toBe('2026-03-13');
      expect(res.source).toBe('frankfurter');
    });
  });

  describe('convert', () => {
    it('multiplies with decimal precision and rounds to 6 dp', async () => {
      const primary = staticProvider('frankfurter', 0.918, '2026-03-13');
      const svc = new FxService(makePrisma(repo), primary, null);

      const res = await svc.convert(new Decimal('120'), 'USD', 'EUR', '2026-03-13');

      expect(res.amount.toString()).toBe('110.16'); // 120 * 0.918
      expect(res.rate.toString()).toBe('0.918');
      expect(res.rateDate).toBe('2026-03-13');
    });

    it('rounds a repeating product to 6 decimal places', async () => {
      const primary = staticProvider('frankfurter', 1 / 3, '2026-03-13');
      const svc = new FxService(makePrisma(repo), primary, null);
      const res = await svc.convert(new Decimal('10'), 'USD', 'EUR', '2026-03-13');
      // 10 * (1/3) = 3.3333... -> 3.333333 (6dp)
      expect(res.amount.toString()).toBe('3.333333');
    });
  });

  describe('getLatestRate', () => {
    it('same currency returns 1 with today as rateDate', async () => {
      const svc = new FxService(makePrisma(repo), staticProvider('frankfurter', 0.9), null);
      const res = await svc.getLatestRate('EUR', 'EUR');
      expect(res.rate.toString()).toBe('1');
      expect(res.rateDate).toBe(todayISO());
    });

    it('fetches and caches, then serves the same day from cache', async () => {
      const primary = staticProvider('frankfurter', 0.95);
      const svc = new FxService(makePrisma(repo), primary, null);

      const first = await svc.getLatestRate('USD', 'EUR');
      expect(first.rate.toString()).toBe('0.95');
      expect(primary.getLatestRate).toHaveBeenCalledTimes(1);

      const second = await svc.getLatestRate('USD', 'EUR');
      expect(second.rate.toString()).toBe('0.95');
      // Cached today -> no second provider call.
      expect(primary.getLatestRate).toHaveBeenCalledTimes(1);
    });

    it('ignores a same-day HISTORICAL row and fetches the real latest rate', async () => {
      // A historical getRate persisted today stamps fetchedAt=now but an old
      // rateDate; it must not be served as the current rate for net worth.
      repo.rows.push({
        base: 'USD',
        quote: 'EUR',
        rateDate: new Date('2020-06-12T00:00:00.000Z'),
        rate: '0.5',
        source: 'frankfurter',
        fetchedAt: new Date(),
      });
      const primary = staticProvider('frankfurter', 0.95);
      const svc = new FxService(makePrisma(repo), primary, null);

      const res = await svc.getLatestRate('USD', 'EUR');
      expect(res.rate.toString()).toBe('0.95'); // provider's latest, not the 0.5 historical
      expect(primary.getLatestRate).toHaveBeenCalledTimes(1);
    });
  });
});
