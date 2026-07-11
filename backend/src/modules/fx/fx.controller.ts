import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common';
import { FxService } from './fx.service';
import { SUPPORTED_CURRENCIES } from './currencies';

/**
 * FX debug/preview endpoints (PLAN.md §6). Guarded by AuthGuard, only
 * authenticated users can preview rates or list currencies.
 */
@Controller()
@UseGuards(AuthGuard)
export class FxController {
  constructor(private readonly fx: FxService) {}

  // GET /fx/rate?from=USD&to=EUR&date=2026-03-14
  @Get('fx/rate')
  async getRate(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('date') date: string,
  ): Promise<{ from: string; to: string; rate: string; rateDate: string; source: string }> {
    const result = await this.fx.getRate(from, to, date);
    return {
      from,
      to,
      rate: result.rate.toString(),
      rateDate: result.rateDate,
      source: result.source,
    };
  }

  // GET /currencies, list of supported ISO currency codes.
  @Get('currencies')
  currencies(): string[] {
    return [...SUPPORTED_CURRENCIES];
  }
}
