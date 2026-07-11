import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PersonalService } from './personal.service';
import {
  CreateAccountSchema,
  CreatePersonalTransactionSchema,
  UpdateAccountSchema,
  UpdatePersonalTransactionSchema,
} from './personal.schemas';
import type {
  CreateAccountDto,
  CreatePersonalTransactionDto,
  PersonalTransactionFilter,
  StatsPeriod,
  StatsView,
  UpdateAccountDto,
  UpdatePersonalTransactionDto,
} from './dto/personal.dto';

/**
 * All routes are owner-scoped to the authenticated user (`/me/*`). The user id
 * comes from the session, NEVER from a route param, so one user can never read
 * another's personal ledger (PLAN.md §9).
 */
@Controller('me')
@UseGuards(AuthGuard)
export class PersonalController {
  constructor(private readonly personal: PersonalService) {}

  // ── Accounts ────────────────────────────────────────────────────────────
  @Get('accounts')
  listAccounts(@CurrentUser('id') userId: string) {
    return this.personal.listAccounts(userId);
  }

  @Post('accounts')
  @UseGuards(CsrfGuard)
  createAccount(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(CreateAccountSchema)) body: CreateAccountDto,
  ) {
    return this.personal.createAccount(userId, body);
  }

  @Patch('accounts/:id')
  @UseGuards(CsrfGuard)
  updateAccount(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAccountSchema)) body: UpdateAccountDto,
  ) {
    return this.personal.updateAccount(userId, id, body);
  }

  @Get('accounts/:id/balance')
  accountBalance(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.personal.getAccountBalance(userId, id);
  }

  // ── Transactions ──────────────────────────────────────────────────────────
  @Get('transactions')
  listTransactions(
    @CurrentUser('id') userId: string,
    @Query() filter: PersonalTransactionFilter,
  ) {
    return this.personal.listTransactions(userId, filter);
  }

  @Post('transactions')
  @UseGuards(CsrfGuard)
  createTransaction(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(CreatePersonalTransactionSchema)) body: CreatePersonalTransactionDto,
  ) {
    return this.personal.createTransaction(userId, body);
  }

  @Patch('transactions/:id')
  @UseGuards(CsrfGuard)
  updateTransaction(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePersonalTransactionSchema)) body: UpdatePersonalTransactionDto,
  ) {
    return this.personal.updateTransaction(userId, id, body);
  }

  @Delete('transactions/:id')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async removeTransaction(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.personal.removeTransaction(userId, id);
  }

  // ── Net worth & stats ──────────────────────────────────────────────────────
  @Get('net-worth')
  netWorth(@CurrentUser('id') userId: string) {
    return this.personal.getNetWorth(userId);
  }

  @Get('stats')
  stats(
    @CurrentUser('id') userId: string,
    @Query('view') view: StatsView = 'cashflow',
    @Query('period') period: StatsPeriod = 'month',
  ) {
    return this.personal.getStats(userId, view, period);
  }

  @Get('stats/summary')
  statsSummary(@CurrentUser('id') userId: string) {
    return this.personal.getStatsSummary(userId);
  }
}
