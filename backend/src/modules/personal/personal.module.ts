import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { PersonalService } from './personal.service';
import { PersonalController } from './personal.controller';
import { NetWorthSnapshotScheduler } from './networth-snapshot.scheduler';

@Module({
  imports: [FxModule],
  controllers: [PersonalController],
  providers: [PersonalService, NetWorthSnapshotScheduler],
  exports: [PersonalService],
})
export class PersonalModule {}
