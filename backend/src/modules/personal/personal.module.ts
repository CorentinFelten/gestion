import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { PersonalService } from './personal.service';
import { PersonalController } from './personal.controller';

@Module({
  imports: [FxModule],
  controllers: [PersonalController],
  providers: [PersonalService],
  exports: [PersonalService],
})
export class PersonalModule {}
