import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { HouseholdMemberGuard } from '../../common/guards/household-member.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CategoriesService } from './categories.service';
import { CreateCategorySchema, type CreateCategoryDto } from './categories.schemas';

/**
 * Member-gated shared categories for a household (PLAN.md §6). Any member may add
 * or remove a household's custom categories, mirroring the household-settings
 * policy (name + base currency are member-editable, no RoleGuard).
 */
@Controller('households/:householdId/categories')
@UseGuards(AuthGuard, HouseholdMemberGuard)
export class HouseholdCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(@Param('householdId') householdId: string) {
    return this.categories.listHouseholdCategories(householdId);
  }

  @Post()
  @UseGuards(CsrfGuard)
  create(
    @Param('householdId') householdId: string,
    @Body(new ZodValidationPipe(CreateCategorySchema)) body: CreateCategoryDto,
  ) {
    return this.categories.createHouseholdCategory(householdId, body);
  }

  @Delete(':categoryId')
  @UseGuards(CsrfGuard)
  @HttpCode(204)
  remove(
    @Param('householdId') householdId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categories.deleteHouseholdCategory(householdId, categoryId);
  }
}

/**
 * Personal-usable categories for the authenticated user (own + global defaults).
 * Create/delete are owner-scoped: the user id comes from the session, so a user
 * can only ever manage their own private categories.
 */
@Controller('categories')
@UseGuards(AuthGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.categories.listPersonalCategories(userId);
  }

  @Post()
  @UseGuards(CsrfGuard)
  create(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(CreateCategorySchema)) body: CreateCategoryDto,
  ) {
    return this.categories.createPersonalCategory(userId, body);
  }

  @Delete(':categoryId')
  @UseGuards(CsrfGuard)
  @HttpCode(204)
  remove(
    @CurrentUser('id') userId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categories.deletePersonalCategory(userId, categoryId);
  }
}
