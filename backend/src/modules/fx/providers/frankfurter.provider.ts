import { Decimal } from 'decimal.js';
import type { RateProvider, RateQuote } from '../rate-provider.interface';
import { RateProviderError, RateUnavailableError } from '../errors';
import { todayISO } from '../date.util';

interface FrankfurterResponse {
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
}

/**
 * Primary provider: Frankfurter (https://api.frankfurter.dev), free, no API
 * key, ECB data. Historical daily rates via `/{YYYY-MM-DD}?base=X&symbols=Y`.
 *
 * Frankfurter itself walks weekend/holiday requests back to the most recent
 * published TARGET business day and reports the resolved date in `.date`, so a
 * single call usually resolves the walk-back. FxService's own walk-back loop
 * still handles providers (or out-of-range dates) that answer with a 404.
 */
export class FrankfurterProvider implements RateProvider {
  readonly name = 'frankfurter';

  constructor(
    private readonly baseUrl: string = process.env.FRANKFURTER_URL ?? 'https://api.frankfurter.dev/v1',
    private readonly timeoutMs: number = Number(process.env.FX_HTTP_TIMEOUT_MS ?? 8000),
  ) {}

  async getRate(from: string, to: string, date: string): Promise<RateQuote> {
    if (from === to) return { rate: new Decimal(1), rateDate: date, source: this.name };
    const url = `${this.baseUrl}/${date}?base=${from}&symbols=${to}`;
    return this.parse(await this.fetchJson(url), to);
  }

  async getLatestRate(from: string, to: string): Promise<RateQuote> {
    if (from === to) return { rate: new Decimal(1), rateDate: todayISO(), source: this.name };
    const url = `${this.baseUrl}/latest?base=${from}&symbols=${to}`;
    return this.parse(await this.fetchJson(url), to);
  }

  private parse(data: FrankfurterResponse, to: string): RateQuote {
    const raw = data?.rates?.[to];
    if (raw === undefined || raw === null || data?.date === undefined) {
      throw new RateUnavailableError(`frankfurter: no rate for ${to} in response`);
    }
    return { rate: new Decimal(String(raw)), rateDate: data.date, source: this.name };
  }

  private async fetchJson(url: string): Promise<FrankfurterResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      // 404 => the requested date has no data (out of range), let FxService walk back.
      if (res.status === 404) {
        throw new RateUnavailableError(`frankfurter: 404 for ${url}`);
      }
      if (!res.ok) {
        throw new RateProviderError(`frankfurter: HTTP ${res.status} for ${url}`);
      }
      return (await res.json()) as FrankfurterResponse;
    } catch (err) {
      if (err instanceof RateUnavailableError || err instanceof RateProviderError) throw err;
      throw new RateProviderError(`frankfurter: request failed, ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
