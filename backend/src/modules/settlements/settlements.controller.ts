import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { HouseholdMemberGuard } from '../../common/guards/household-member.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SettlementsService } from './settlements.service';
import {
  CreateSettlementSchema,
  type CreateSettlementDto,
  type SettlementFilter,
} from './dto/settlement.dto';

@Controller('households/:householdId')
@UseGuards(AuthGuard, HouseholdMemberGuard)
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('settlements')
  async list(@Param('householdId') householdId: string, @Query() filter: SettlementFilter) {
    return this.settlements.list(householdId, filter);
  }

  @Post('settlements')
  @UseGuards(CsrfGuard)
  async create(
    @Param('householdId') householdId: string,
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(CreateSettlementSchema)) body: CreateSettlementDto,
  ) {
    return this.settlements.create(householdId, userId, body);
  }

  // GET /households/:id/categories/:catId/settle-up?from=&to=  (exact outstanding + prefill)
  @Get('categories/:catId/settle-up')
  async settleUpPrefill(
    @Param('householdId') householdId: string,
    @Param('catId') catId: string,
    @Query('from') fromUserId: string,
    @Query('to') toUserId: string,
  ) {
    return this.settlements.settleUpPrefill(householdId, catId, fromUserId, toUserId);
  }
}
