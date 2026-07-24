import { FrankfurterProvider } from './frankfurter.provider';
import { ErApiProvider } from './erapi.provider';
import { RateProviderError, RateUnavailableError } from '../errors';

/** Build a fake `fetch` Response. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('FrankfurterProvider (mocked fetch)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('parses a historical rate and reports the resolved date', async () => {
    // Frankfurter itself resolves Sat -> Fri and returns the resolved `date`.
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ amount: 1, base: 'USD', date: '2026-03-13', rates: { EUR: 0.918 } }),
    );
    const provider = new FrankfurterProvider('https://example.test/v1', 1000);

    const quote = await provider.getRate('USD', 'EUR', '2026-03-14');

    expect(quote.rate.toString()).toBe('0.918');
    expect(quote.rateDate).toBe('2026-03-13');
    expect(quote.source).toBe('frankfurter');
  });

  it('parses a time-series into one quote per published day', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        amount: 1,
        base: 'USD',
        start_date: '2026-03-11',
        end_date: '2026-03-13',
        rates: {
          '2026-03-11': { EUR: 0.9 },
          '2026-03-12': { EUR: 0.91 },
          '2026-03-13': { EUR: 0.918 },
        },
      }),
    );
    const provider = new FrankfurterProvider('https://example.test/v1', 1000);

    const series = await provider.getRateSeries('USD', 'EUR', '2026-03-11', '2026-03-13');

    expect(series).toHaveLength(3);
    expect(series.map((q) => q.rateDate).sort()).toEqual([
      '2026-03-11', '2026-03-12', '2026-03-13',
    ]);
    expect(series.find((q) => q.rateDate === '2026-03-13')?.rate.toString()).toBe('0.918');
    expect(series[0].source).toBe('frankfurter');
  });

  it('getRateSeries short-circuits same-currency without fetching', async () => {
    const spy = jest.spyOn(global, 'fetch');
    const provider = new FrankfurterProvider('https://example.test/v1', 1000);
    expect(await provider.getRateSeries('EUR', 'EUR', '2026-03-01', '2026-03-13')).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps a 404 to RateUnavailableError (drives walk-back)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ message: 'not found' }, 404));
    const provider = new FrankfurterProvider('https://example.test/v1', 1000);
    await expect(provider.getRate('USD', 'EUR', '1900-01-01')).rejects.toBeInstanceOf(
      RateUnavailableError,
    );
  });

  it('maps a 5xx to RateProviderError (drives fallback)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, 503));
    const provider = new FrankfurterProvider('https://example.test/v1', 1000);
    await expect(provider.getRate('USD', 'EUR', '2026-03-13')).rejects.toBeInstanceOf(
      RateProviderError,
    );
  });

  it('wraps a network throw as RateProviderError', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    const provider = new FrankfurterProvider('https://example.test/v1', 1000);
    await expect(provider.getRate('USD', 'EUR', '2026-03-13')).rejects.toBeInstanceOf(
      RateProviderError,
    );
  });

  it('short-circuits same-currency without fetching', async () => {
    const spy = jest.spyOn(global, 'fetch');
    const provider = new FrankfurterProvider('https://example.test/v1', 1000);
    const quote = await provider.getRate('EUR', 'EUR', '2026-03-14');
    expect(quote.rate.toString()).toBe('1');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('ErApiProvider (mocked fetch)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('parses the latest rate and derives rateDate from last-update', async () => {
    const unix = Math.floor(Date.parse('2026-03-14T00:00:00Z') / 1000);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        result: 'success',
        base_code: 'USD',
        time_last_update_unix: unix,
        rates: { EUR: 0.921 },
      }),
    );
    const provider = new ErApiProvider('https://example.test/v6', 1000);

    const quote = await provider.getLatestRate('USD', 'EUR');

    expect(quote.rate.toString()).toBe('0.921');
    expect(quote.rateDate).toBe('2026-03-14');
    expect(quote.source).toBe('erapi');
  });

  it('throws RateUnavailableError when the target currency is missing', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ result: 'success', rates: { GBP: 0.8 } }));
    const provider = new ErApiProvider('https://example.test/v6', 1000);
    await expect(provider.getLatestRate('USD', 'EUR')).rejects.toBeInstanceOf(
      RateUnavailableError,
    );
  });
});
