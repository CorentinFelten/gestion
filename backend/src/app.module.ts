import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HouseholdsModule } from './modules/households/households.module';
import { FxModule } from './modules/fx/fx.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import { TallyModule } from './modules/tally/tally.module';
import { PersonalModule } from './modules/personal/personal.module';
import { CategoriesModule } from './modules/categories/categories.module';

@Module({
  imports: [
    // Global config from env (.env in dev; real env in Docker).
    ConfigModule.forRoot({ isGlobal: true }),
    // Scheduler backbone (nightly FX prefetch lives in FxModule).
    ScheduleModule.forRoot(),
    // Baseline rate limiting; auth endpoints tighten this further.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),

    PrismaModule,

    // Feature modules (order is irrelevant; Nest resolves the graph).
    AuthModule,
    UsersModule,
    HouseholdsModule,
    FxModule,
    TransactionsModule,
    SettlementsModule,
    TallyModule,
    PersonalModule,
    CategoriesModule,
  ],
  controllers: [AppController],
  providers: [
    // Enforce the baseline ThrottlerModule.forRoot limit (60s/120) on every
    // route (SEC-08). Auth login/register carry an @Throttle override that this
    // same global guard reads to apply the stricter 5/min there, they must NOT
    // also add a route-level ThrottlerGuard or the guard runs twice and
    // double-counts (halving the effective limit).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
