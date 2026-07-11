import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController, HouseholdCategoriesController } from './categories.controller';

@Module({
  controllers: [HouseholdCategoriesController, CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
