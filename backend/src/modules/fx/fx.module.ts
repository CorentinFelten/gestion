import { Module } from '@nestjs/common';
import { FxService } from './fx.service';
import { FxController } from './fx.controller';
import { FxScheduler } from './fx.scheduler';
import { FALLBACK_RATE_PROVIDER, RATE_PROVIDER } from './rate-provider.interface';
import { createRateProvider } from './providers/provider.factory';

/**
 * FxModule exports FxService so transactions / settlements / personal can inject
 * it. Concrete providers are selected by env (FX_PROVIDER / FX_FALLBACK_PROVIDER)
 * and bound to the RATE_PROVIDER / FALLBACK_RATE_PROVIDER tokens. The nightly
 * prefetch scheduler (FxScheduler) runs off @nestjs/schedule.
 */
@Module({
  controllers: [FxController],
  providers: [
    FxService,
    FxScheduler,
    {
      provide: RATE_PROVIDER,
      useFactory: () => createRateProvider(process.env.FX_PROVIDER ?? 'frankfurter'),
    },
    {
      provide: FALLBACK_RATE_PROVIDER,
      useFactory: () => createRateProvider(process.env.FX_FALLBACK_PROVIDER ?? 'erapi'),
    },
  ],
  exports: [FxService],
})
export class FxModule {}
