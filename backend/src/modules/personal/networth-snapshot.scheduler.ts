import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PersonalService } from './personal.service';

/**
 * Nightly net-worth snapshot (#3). For every active user that owns at least one
 * account, freeze today's net worth into `net_worth_snapshots` so the trend line
 * has history. Runs after the FX prefetch (03:30) so the latest rates are warm.
 *
 * Idempotent (one row per user per day, upsert) and best-effort: a single user's
 * failure is logged and skipped, never aborting the batch.
 */
@Injectable()
export class NetWorthSnapshotScheduler {
  private readonly logger = new Logger(NetWorthSnapshotScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly personal: PersonalService,
  ) {}

  // 03:45 every day (server time). Overridable via NET_WORTH_SNAPSHOT_CRON.
  @Cron(process.env.NET_WORTH_SNAPSHOT_CRON ?? '0 45 3 * * *', { name: 'net-worth-snapshot' })
  async captureAll(): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        where: { isActive: true, accounts: { some: {} } },
        select: { id: true },
      });

      let ok = 0;
      let failed = 0;
      for (const user of users) {
        try {
          await this.personal.captureNetWorthSnapshot(user.id);
          ok += 1;
        } catch (err) {
          failed += 1;
          this.logger.warn(
            `net-worth snapshot for user ${user.id} failed: ${(err as Error).message}`,
          );
        }
      }
      this.logger.log(`net-worth snapshot complete: ${ok} captured, ${failed} failed`);
    } catch (err) {
      this.logger.error(`net-worth snapshot job crashed: ${(err as Error).message}`);
    }
  }
}
