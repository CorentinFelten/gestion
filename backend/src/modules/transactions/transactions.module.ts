import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { TransactionsService } from './transactions.service';
import {
  HouseholdTransactionsController,
  TransactionsController,
} from './transactions.controller';

@Module({
  imports: [FxModule],
  controllers: [HouseholdTransactionsController, TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
