import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { HouseholdMemberGuard } from '../../common/guards/household-member.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TallyService } from './tally.service';
import type { ReportGroup } from './dto/tally.dto';

@Controller('households/:householdId')
@UseGuards(AuthGuard, HouseholdMemberGuard)
export class TallyController {
  constructor(private readonly tally: TallyService) {}

  // GET /households/:id/tally            (full matrix)
  // GET /households/:id/tally?me=1       (my positions vs each member)
  // GET /households/:id/tally?category=  (single-category pairwise ledger)
  @Get('tally')
  async getTally(
    @Param('householdId') householdId: string,
    @CurrentUser('id') userId: string,
    @Query('me') me?: string,
    @Query('category') category?: string,
  ) {
    return this.tally.getTally(householdId, {
      subjectUserId: me ? userId : undefined,
      categoryId: category,
    });
  }

  // GET /households/:id/settle-up            (non-zero pairwise positions)
  // GET /households/:id/settle-up?simplify=1 (greedy overall simplification)
  @Get('settle-up')
  async settleUp(
    @Param('householdId') householdId: string,
    @Query('simplify') simplify?: string,
  ) {
    return this.tally.getSettleUp(householdId, simplify === '1' || simplify === 'true');
  }

  // GET /households/:id/reports?group=category|member|month|currency
  @Get('reports')
  async reports(
    @Param('householdId') householdId: string,
    @Query('group') group: ReportGroup = 'category',
  ) {
    return this.tally.getReports(householdId, group);
  }
}
