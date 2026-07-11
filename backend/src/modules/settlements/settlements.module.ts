import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { TallyModule } from '../tally/tally.module';
import { SettlementsService } from './settlements.service';
import { SettlementsController } from './settlements.controller';

@Module({
  imports: [FxModule, TallyModule],
  controllers: [SettlementsController],
  providers: [SettlementsService],
  exports: [SettlementsService],
})
export class SettlementsModule {}
