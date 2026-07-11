import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { FxService } from './fx.service';
import { isKnownCurrency, normalizeCurrency } from './currencies';

/**
 * Nightly FX prefetch (PLAN §3.3). Warms today's latest rate for every currency
 * in use (household base currencies, user preferred currencies, account
 * currencies, transaction currencies) against each household base currency, so
 * same-day entries and net-worth reads are instant and offline-tolerant.
 *
 * Idempotent and best-effort: individual pair failures are logged and skipped;
 * `getLatestRate` de-dupes via the per-day cache.
 */
@Injectable()
export class FxScheduler {
  private readonly logger = new Logger(FxScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  // 03:30 every day (server time). Overridable via FX_PREFETCH_CRON.
  @Cron(process.env.FX_PREFETCH_CRON ?? '0 30 3 * * *', { name: 'fx-nightly-prefetch' })
  async prefetchToday(): Promise<void> {
    try {
      const bases = await this.baseCurrencies();
      const used = await this.usedCurrencies();
      if (bases.size === 0) {
        this.logger.log('FX prefetch: no base currencies configured, skipping');
        return;
      }

      let ok = 0;
      let failed = 0;
      for (const base of bases) {
        for (const currency of used) {
          if (currency === base) continue;
          try {
            await this.fx.getLatestRate(currency, base);
            ok += 1;
          } catch (err) {
            failed += 1;
            this.logger.warn(`FX prefetch ${currency}->${base} failed: ${(err as Error).message}`);
          }
        }
      }
      this.logger.log(`FX prefetch complete: ${ok} cached, ${failed} failed`);
    } catch (err) {
      this.logger.error(`FX prefetch job crashed: ${(err as Error).message}`);
    }
  }

  /** Base currencies to convert into (household base currencies). */
  private async baseCurrencies(): Promise<Set<string>> {
    const set = new Set<string>();
    const households = await this.prisma.household.findMany({ select: { baseCurrency: true } });
    for (const h of households) this.add(set, h.baseCurrency);
    if (set.size === 0) this.add(set, process.env.FX_DEFAULT_BASE ?? 'EUR');
    return set;
  }

  /** All currencies referenced anywhere in the app. */
  private async usedCurrencies(): Promise<Set<string>> {
    const set = new Set<string>();

    const [users, accounts, transactions, households] = await Promise.all([
      this.prisma.user.findMany({ select: { preferredCurrency: true } }),
      this.prisma.account.findMany({ select: { currency: true }, distinct: ['currency'] }),
      this.prisma.transaction.findMany({
        select: { currencyOriginal: true },
        distinct: ['currencyOriginal'],
      }),
      this.prisma.household.findMany({ select: { baseCurrency: true } }),
    ]);

    for (const u of users) this.add(set, u.preferredCurrency);
    for (const a of accounts) this.add(set, a.currency);
    for (const t of transactions) this.add(set, t.currencyOriginal);
    for (const h of households) this.add(set, h.baseCurrency);
    return set;
  }

  private add(set: Set<string>, code: string): void {
    if (isKnownCurrency(code)) set.add(normalizeCurrency(code));
  }
}
