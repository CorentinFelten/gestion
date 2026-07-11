import { Module } from '@nestjs/common';
import { TallyService } from './tally.service';
import { TallyController } from './tally.controller';

/**
 * Exports TallyService so SettlementsModule can compute reset prefills.
 * Depends only on PrismaService (global), keeps it cycle-free.
 */
@Module({
  controllers: [TallyController],
  providers: [TallyService],
  exports: [TallyService],
})
export class TallyModule {}
