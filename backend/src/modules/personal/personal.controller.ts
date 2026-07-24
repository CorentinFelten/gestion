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
  CreateSavedFilterSchema,
  PayoffQuerySchema,
  PersonalTransactionFilterSchema,
  UpdateAccountSchema,
  UpdatePersonalTransactionSchema,
} from './personal.schemas';
import type {
  CreateAccountDto,
  CreatePersonalTransactionDto,
  CreateSavedFilterDto,
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

  // Credit-account payoff projection (#9).
  @Get('accounts/:id/payoff')
  payoff(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(PayoffQuerySchema)) query: { monthlyPayment: string },
  ) {
    return this.personal.getPayoffSchedule(userId, id, query.monthlyPayment);
  }

  // ── Transactions ──────────────────────────────────────────────────────────
  @Get('transactions')
  listTransactions(
    @CurrentUser('id') userId: string,
    @Query(new ZodValidationPipe(PersonalTransactionFilterSchema)) filter: PersonalTransactionFilter,
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

  // Net-worth trend history (#3).
  @Get('net-worth/history')
  netWorthHistory(
    @CurrentUser('id') userId: string,
    @Query('days') days?: string,
  ) {
    // Omitted/invalid `days` ⇒ full history from account creation (undefined);
    // a positive value caps the look-back window (hard 10-year ceiling applies).
    const parsed = Number(days);
    const window =
      days !== undefined && Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 3650) : undefined;
    return this.personal.getNetWorthHistory(userId, window);
  }

  @Post('net-worth/snapshot')
  @UseGuards(CsrfGuard)
  captureSnapshot(@CurrentUser('id') userId: string) {
    return this.personal.captureNetWorthSnapshot(userId);
  }

  // ── Saved transaction filters (#8) ──────────────────────────────────────────
  @Get('saved-filters')
  listSavedFilters(@CurrentUser('id') userId: string) {
    return this.personal.listSavedFilters(userId);
  }

  @Post('saved-filters')
  @UseGuards(CsrfGuard)
  createSavedFilter(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(CreateSavedFilterSchema)) body: CreateSavedFilterDto,
  ) {
    return this.personal.createSavedFilter(userId, body);
  }

  @Delete('saved-filters/:id')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async removeSavedFilter(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.personal.deleteSavedFilter(userId, id);
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
