import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { HouseholdMemberGuard } from '../../common/guards/household-member.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CategoriesService } from './categories.service';

/** Member-gated shared categories for a household (PLAN.md §6). */
@Controller('households/:householdId/categories')
@UseGuards(AuthGuard, HouseholdMemberGuard)
export class HouseholdCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(@Param('householdId') householdId: string) {
    return this.categories.listHouseholdCategories(householdId);
  }
}

/** Personal-usable categories for the authenticated user (own + global defaults). */
@Controller('categories')
@UseGuards(AuthGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.categories.listPersonalCategories(userId);
  }
}
