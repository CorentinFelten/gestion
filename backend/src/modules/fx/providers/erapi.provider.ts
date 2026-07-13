import { Decimal } from 'decimal.js';
import type { RateProvider, RateQuote } from '../rate-provider.interface';
import { RateProviderError, RateUnavailableError } from '../errors';
import { todayISO } from '../date.util';

interface ErApiResponse {
  result?: string;
  base_code?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number>;
}

/**
 * Fallback provider: open.er-api.com (https://www.exchangerate-api.com), free,
 * no API key. Used for currencies outside ECB/Frankfurter coverage, or when the
 * primary provider is unreachable.
 *
 * The free tier only exposes LATEST rates (`/v6/latest/{base}`). It has no
 * historical endpoint, so `getRate(from, to, date)` returns the latest rate and
 * reports the provider's own last-update date as `rateDate`. This is a graceful
 * degradation, historical precision comes from the primary (ECB) provider.
 */
export class ErApiProvider implements RateProvider {
  readonly name = 'erapi';

  constructor(
    private readonly baseUrl: string = process.env.ERAPI_URL ?? 'https://open.er-api.com/v6',
    private readonly timeoutMs: number = Number(process.env.FX_HTTP_TIMEOUT_MS ?? 8000),
  ) {}

  // Historical not supported on the free tier, best-effort latest. When used to
  // freeze a PAST date, tag the source `erapi-latest` so the degraded rate is
  // auditable in exchange_rates and not silently indistinguishable from a real
  // historical rate.
  async getRate(from: string, to: string, date: string): Promise<RateQuote> {
    const quote = await this.latest(from, to);
    return date < todayISO() ? { ...quote, source: `${this.name}-latest` } : quote;
  }

  async getLatestRate(from: string, to: string): Promise<RateQuote> {
    return this.latest(from, to);
  }

  private async latest(from: string, to: string): Promise<RateQuote> {
    if (from === to) return { rate: new Decimal(1), rateDate: todayISO(), source: this.name };
    const url = `${this.baseUrl}/latest/${from}`;
    const data = await this.fetchJson(url);
    const raw = data?.rates?.[to];
    if (data?.result !== 'success' || raw === undefined || raw === null) {
      throw new RateUnavailableError(`erapi: no rate for ${from}->${to}`);
    }
    const rateDate = data.time_last_update_unix
      ? new Date(data.time_last_update_unix * 1000).toISOString().slice(0, 10)
      : todayISO();
    return { rate: new Decimal(String(raw)), rateDate, source: this.name };
  }

  private async fetchJson(url: string): Promise<ErApiResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        throw new RateProviderError(`erapi: HTTP ${res.status} for ${url}`);
      }
      return (await res.json()) as ErApiResponse;
    } catch (err) {
      if (err instanceof RateUnavailableError || err instanceof RateProviderError) throw err;
      throw new RateProviderError(`erapi: request failed, ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
