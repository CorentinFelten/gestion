import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { Account, PersonalTransaction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FxService } from '../fx/fx.service';
import { dateToISO, todayISO, toUtcDate } from '../fx/date.util';
import type {
  AccountBalanceDto,
  AccountDto,
  CreateAccountDto,
  CreatePersonalTransactionDto,
  CreateSavedFilterDto,
  NetWorthAccountDto,
  NetWorthDto,
  NetWorthHistoryDto,
  NetWorthSnapshotDto,
  PayoffMonthDto,
  PayoffScheduleDto,
  PersonalTransactionDto,
  PersonalTransactionFilter,
  SavedFilterDto,
  StatsPeriod,
  StatsPoint,
  StatsResponseDto,
  StatsSummaryDto,
  StatsView,
  UpdateAccountDto,
  UpdatePersonalTransactionDto,
} from './dto/personal.dto';

/** Columns needed to reduce a transaction set into per-account balances. */
const BALANCE_ROW_SELECT = {
  type: true,
  amount: true,
  transferAmount: true,
  accountId: true,
  transferAccountId: true,
} satisfies Prisma.PersonalTransactionSelect;

type BalanceRow = Prisma.PersonalTransactionGetPayload<{ select: typeof BALANCE_ROW_SELECT }>;

/** Fields resolved (amount in account currency + frozen FX snapshot + transfer leg). */
interface ResolvedAmounts {
  amount: Decimal;
  amountOriginal: Decimal | null;
  currencyOriginal: string | null;
  fxRate: Decimal | null;
  fxRateDate: Date | null;
  fxSource: string | null;
  transferAmount: Decimal | null;
}

/**
 * Personal finance ledger, PRIVATE per user (PLAN.md §5.5, §9).
 *
 * PRIVACY: every query is scoped by `user_id = userId` (owner-only). The userId
 * always comes from the session (`@CurrentUser`), never from the client, so no
 * member/admin can read another user's accounts, transactions, or stats.
 *
 * Money is decimal.js + Prisma Decimal throughout, never floats. Recorded
 * transactions freeze their FX rate (FxService.convert at the txn date); net
 * worth converts at the latest available rate (FxService.getLatestRate, §3.4).
 */
@Injectable()
export class PersonalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────
  private dec(v: Prisma.Decimal | string | number | null | undefined): Decimal {
    return new Decimal((v ?? 0).toString());
  }

  private dateOnly(d: Date | null): string | null {
    return d ? dateToISO(d) : null;
  }

  /** Owner-only account lookup. Throws 404 if the account isn't the user's. */
  private async assertAccount(userId: string, accountId: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }

  private accountToDto(a: Account): AccountDto {
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      country: a.country,
      openingBalance: this.dec(a.openingBalance).toString(),
      isActive: a.isActive,
      archivedAt: a.archivedAt ? a.archivedAt.toISOString() : null,
      sortOrder: a.sortOrder,
      createdAt: a.createdAt.toISOString(),
      interestRate: a.interestRate !== null ? this.dec(a.interestRate).toString() : null,
      creditLimit: a.creditLimit !== null ? this.dec(a.creditLimit).toString() : null,
      minPayment: a.minPayment !== null ? this.dec(a.minPayment).toString() : null,
    };
  }

  private txnToDto(t: PersonalTransaction): PersonalTransactionDto {
    return {
      id: t.id,
      accountId: t.accountId,
      type: t.type,
      categoryId: t.categoryId,
      amount: this.dec(t.amount).toString(),
      amountOriginal: t.amountOriginal !== null ? this.dec(t.amountOriginal).toString() : null,
      currencyOriginal: t.currencyOriginal,
      fxRate: t.fxRate !== null ? this.dec(t.fxRate).toString() : null,
      fxRateDate: this.dateOnly(t.fxRateDate),
      fxSource: t.fxSource,
      txnDate: t.txnDate.toISOString().slice(0, 10),
      payeeSource: t.payeeSource,
      notes: t.notes,
      transferAccountId: t.transferAccountId,
      transferAmount: t.transferAmount !== null ? this.dec(t.transferAmount).toString() : null,
      linkedTransactionId: t.linkedTransactionId,
      linkedSettlementId: t.linkedSettlementId,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  // ── Accounts ────────────────────────────────────────────────────────────
  async listAccounts(userId: string): Promise<AccountDto[]> {
    const accounts = await this.prisma.account.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return accounts.map((a) => this.accountToDto(a));
  }

  async createAccount(userId: string, dto: CreateAccountDto): Promise<AccountDto> {
    const country = dto.country ?? 'FR';
    // Default the currency from the account's country when not supplied
    // (FR → EUR, CA → CAD).
    const currency = dto.currency ?? PersonalService.defaultCurrencyForCountry(country);
    const account = await this.prisma.account.create({
      data: {
        userId,
        name: dto.name,
        type: dto.type,
        currency,
        country,
        openingBalance: this.dec(dto.openingBalance ?? '0').toString(),
        sortOrder: dto.sortOrder ?? 0,
        interestRate: dto.interestRate != null ? this.dec(dto.interestRate).toString() : null,
        creditLimit: dto.creditLimit != null ? this.dec(dto.creditLimit).toString() : null,
        minPayment: dto.minPayment != null ? this.dec(dto.minPayment).toString() : null,
      },
    });
    return this.accountToDto(account);
  }

  /** Default currency for a supported account country (PLAN.md §3/§5.5). */
  private static defaultCurrencyForCountry(country: string): string {
    return country === 'CA' ? 'CAD' : 'EUR';
  }

  async updateAccount(
    userId: string,
    accountId: string,
    dto: UpdateAccountDto,
  ): Promise<AccountDto> {
    await this.assertAccount(userId, accountId);

    const data: Prisma.AccountUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
      data.archivedAt = dto.isActive ? null : new Date();
    }
    // Credit metadata: `null` clears the field, a value sets it.
    if (dto.interestRate !== undefined) {
      data.interestRate = dto.interestRate === null ? null : this.dec(dto.interestRate).toString();
    }
    if (dto.creditLimit !== undefined) {
      data.creditLimit = dto.creditLimit === null ? null : this.dec(dto.creditLimit).toString();
    }
    if (dto.minPayment !== undefined) {
      data.minPayment = dto.minPayment === null ? null : this.dec(dto.minPayment).toString();
    }

    const account = await this.prisma.account.update({
      where: { id: accountId },
      data,
    });
    return this.accountToDto(account);
  }

  /**
   * Native-currency balance (PLAN.md §5.5):
   *   opening + Σincome − Σexpense − Σtransfers_out + Σtransfers_in.
   * Transfers into the account credit `transferAmount` (converted leg) when the
   * two accounts differ in currency, else the plain `amount`.
   */
  private async computeBalance(userId: string, account: Account): Promise<Decimal> {
    const rows = await this.prisma.personalTransaction.findMany({
      where: {
        userId,
        deletedAt: null,
        OR: [{ accountId: account.id }, { transferAccountId: account.id }],
      },
      select: BALANCE_ROW_SELECT,
    });
    return this.reduceBalance(account, rows);
  }

  /**
   * Pure reduce of a set of (already-fetched) transactions into one account's
   * native-currency balance. Filters by account id internally so a single shared
   * `rows` array can be reduced per account (net worth) without an N+1 query.
   */
  private reduceBalance(account: Account, rows: BalanceRow[]): Decimal {
    let balance = this.dec(account.openingBalance);
    for (const r of rows) {
      if (r.type === 'income' && r.accountId === account.id) {
        balance = balance.plus(this.dec(r.amount));
      } else if (r.type === 'expense' && r.accountId === account.id) {
        balance = balance.minus(this.dec(r.amount));
      } else if (r.type === 'transfer') {
        if (r.accountId === account.id) {
          balance = balance.minus(this.dec(r.amount)); // leg out (source currency)
        }
        if (r.transferAccountId === account.id) {
          const credit = r.transferAmount !== null ? this.dec(r.transferAmount) : this.dec(r.amount);
          balance = balance.plus(credit); // leg in (dest currency)
        }
      }
    }
    return balance.toDecimalPlaces(6);
  }

  async getAccountBalance(userId: string, accountId: string): Promise<AccountBalanceDto> {
    const account = await this.assertAccount(userId, accountId);
    const balance = await this.computeBalance(userId, account);
    return {
      accountId: account.id,
      currency: account.currency,
      balance: balance.toString(),
    };
  }

  /**
   * Credit-card payoff projection (#9): amortize the current debt in the
   * account's native currency at its APR, paying `monthlyPayment` each month
   * (interest first, then principal). All math is decimal.js; interest and
   * principal are rounded to 2 dp per month like a real statement.
   *
   * A credit account carrying spend has a NEGATIVE balance, so the amount owed
   * is `-balance`. If the payment doesn't cover the first month's interest the
   * balance never shrinks (`neverPaysOff`); the simulation is also capped so a
   * pathological input can't loop forever.
   */
  private static readonly PAYOFF_MAX_MONTHS = 1200;

  async getPayoffSchedule(
    userId: string,
    accountId: string,
    monthlyPaymentStr: string,
  ): Promise<PayoffScheduleDto> {
    const account = await this.assertAccount(userId, accountId);
    if (account.type !== 'credit_card') {
      throw new BadRequestException('Payoff projection is only available for credit-card accounts');
    }
    const monthlyPayment = this.dec(monthlyPaymentStr);
    const balanceNative = await this.computeBalance(userId, account);
    const owed = balanceNative.isNegative() ? balanceNative.negated() : new Decimal(0);
    const apr = account.interestRate !== null ? this.dec(account.interestRate) : new Decimal(0);
    const monthlyRate = apr.div(100).div(12);

    const base = {
      accountId: account.id,
      currency: account.currency,
      startingBalance: owed.toDecimalPlaces(2).toString(),
      monthlyPayment: monthlyPayment.toDecimalPlaces(2).toString(),
      interestRate: apr.toString(),
    };

    if (owed.lte(0)) {
      return { ...base, months: 0, totalInterest: '0', totalPaid: '0', neverPaysOff: false, schedule: [] };
    }
    if (monthlyPayment.lte(owed.mul(monthlyRate))) {
      // Payment never even covers the interest → the debt can't be cleared.
      return { ...base, months: 0, totalInterest: '0', totalPaid: '0', neverPaysOff: true, schedule: [] };
    }

    const schedule: PayoffMonthDto[] = [];
    let balance = owed;
    let totalInterest = new Decimal(0);
    let totalPaid = new Decimal(0);
    let month = 0;
    while (balance.gt(0) && month < PersonalService.PAYOFF_MAX_MONTHS) {
      month += 1;
      const interest = balance.mul(monthlyRate).toDecimalPlaces(2);
      const due = balance.plus(interest);
      let payment = monthlyPayment;
      let principal: Decimal;
      if (payment.gte(due)) {
        payment = due; // final (partial) payment
        principal = balance;
        balance = new Decimal(0);
      } else {
        principal = payment.minus(interest);
        balance = balance.minus(principal);
      }
      totalInterest = totalInterest.plus(interest);
      totalPaid = totalPaid.plus(payment);
      schedule.push({
        month,
        interest: interest.toString(),
        principal: principal.toDecimalPlaces(2).toString(),
        balance: balance.toDecimalPlaces(2).toString(),
      });
    }
    const neverPaysOff = balance.gt(0);
    return {
      ...base,
      months: neverPaysOff ? 0 : month,
      totalInterest: totalInterest.toDecimalPlaces(2).toString(),
      totalPaid: totalPaid.toDecimalPlaces(2).toString(),
      neverPaysOff,
      schedule: neverPaysOff ? [] : schedule,
    };
  }

  // ── Personal transactions ─────────────────────────────────────────────────
  /**
   * Resolves the persisted amount (in the account's currency) plus the frozen FX
   * snapshot and the converted transfer leg. Foreign-currency entries and
   * cross-currency transfers are frozen via FxService.convert at the txn date.
   */
  private async resolveAmounts(
    userId: string,
    dto: CreatePersonalTransactionDto,
    account: Account,
  ): Promise<ResolvedAmounts> {
    const result: ResolvedAmounts = {
      amount: this.dec(dto.amount),
      amountOriginal: null,
      currencyOriginal: null,
      fxRate: null,
      fxRateDate: null,
      fxSource: null,
      transferAmount: null,
    };

    if (dto.type === 'transfer') {
      if (!dto.transferAccountId) {
        throw new BadRequestException('transfer requires transferAccountId');
      }
      if (dto.transferAccountId === account.id) {
        throw new BadRequestException('cannot transfer to the same account');
      }
      const dest = await this.assertAccount(userId, dto.transferAccountId);
      if (account.currency === dest.currency) {
        result.transferAmount = dto.transferAmount ? this.dec(dto.transferAmount) : result.amount;
      } else if (dto.transferAmount) {
        // Client supplied the converted leg explicitly.
        result.transferAmount = this.dec(dto.transferAmount);
      } else {
        // Freeze the transfer-date rate (source → dest currency).
        const conv = await this.fx.convert(
          result.amount,
          account.currency,
          dest.currency,
          dto.txnDate,
        );
        result.transferAmount = conv.amount.toDecimalPlaces(6);
        result.fxRate = conv.rate;
        result.fxRateDate = toUtcDate(conv.rateDate);
        result.fxSource = conv.source;
      }
      return result;
    }

    // income | expense, optional foreign-currency entry.
    if (dto.amountOriginal && dto.currencyOriginal) {
      if (dto.currencyOriginal === account.currency) {
        // Same currency: no conversion, just keep the original for the record.
        result.amount = this.dec(dto.amountOriginal);
        result.amountOriginal = this.dec(dto.amountOriginal);
        result.currencyOriginal = dto.currencyOriginal;
      } else {
        const conv = await this.fx.convert(
          this.dec(dto.amountOriginal),
          dto.currencyOriginal,
          account.currency,
          dto.txnDate,
        );
        result.amount = conv.amount.toDecimalPlaces(6);
        result.amountOriginal = this.dec(dto.amountOriginal);
        result.currencyOriginal = dto.currencyOriginal;
        result.fxRate = conv.rate;
        result.fxRateDate = toUtcDate(conv.rateDate);
        result.fxSource = conv.source;
      }
    }
    return result;
  }

  /**
   * Reject a future transaction date, matching the shared ledger (a payment
   * cannot have happened yet). Applies to same-currency entries too, which never
   * touch the FX layer and would otherwise be silently accepted.
   */
  private assertNotFutureDate(txnDate: string): void {
    if (txnDate > todayISO()) {
      throw new BadRequestException('txnDate cannot be in the future');
    }
  }

  async createTransaction(
    userId: string,
    dto: CreatePersonalTransactionDto,
  ): Promise<PersonalTransactionDto> {
    this.assertNotFutureDate(dto.txnDate);
    const account = await this.assertAccount(userId, dto.accountId);
    if (dto.categoryId) await this.assertCategory(userId, dto.categoryId);
    await this.assertLinkedRefs(userId, {
      linkedTransactionId: dto.linkedTransactionId,
      linkedSettlementId: dto.linkedSettlementId,
    });

    const r = await this.resolveAmounts(userId, dto, account);

    const created = await this.prisma.personalTransaction.create({
      data: {
        userId,
        accountId: dto.accountId,
        type: dto.type,
        categoryId: dto.categoryId ?? null,
        amount: r.amount.toString(),
        amountOriginal: r.amountOriginal ? r.amountOriginal.toString() : null,
        currencyOriginal: r.currencyOriginal,
        fxRate: r.fxRate ? r.fxRate.toString() : null,
        fxRateDate: r.fxRateDate,
        fxSource: r.fxSource,
        txnDate: toUtcDate(dto.txnDate),
        payeeSource: dto.payeeSource ?? null,
        notes: dto.notes ?? null,
        transferAccountId: dto.type === 'transfer' ? dto.transferAccountId ?? null : null,
        transferAmount: r.transferAmount ? r.transferAmount.toString() : null,
        linkedTransactionId: dto.linkedTransactionId ?? null,
        linkedSettlementId: dto.linkedSettlementId ?? null,
      },
    });
    return this.txnToDto(created);
  }

  /**
   * Category guard for personal transactions: only the user's own personal
   * categories or the GLOBAL personal defaults. Mirrors listPersonalCategories —
   * `{ userId: null }` alone would also match other households' shared categories
   * (which carry userId=null but a non-null householdId), leaking them across
   * tenants; require householdId=null and a personal-usable scope.
   */
  private async assertCategory(userId: string, categoryId: string): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: {
        id: categoryId,
        scope: { in: ['personal', 'both'] },
        OR: [{ userId }, { userId: null, householdId: null }],
      },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }

  /**
   * Referential-integrity guard for personal→shared links (SEC-12): a linked
   * shared Transaction/Settlement must belong to a household the user is a member
   * of before it can be connected. Write-only correctness, the linked record is
   * never expanded back to the client, so this leaks nothing; it just prevents
   * pointing a personal entry at a shared row outside the user's households.
   * `userId` is the session-derived owner (never client-supplied).
   */
  private async assertLinkedRefs(
    userId: string,
    refs: { linkedTransactionId?: string | null; linkedSettlementId?: string | null },
  ): Promise<void> {
    if (refs.linkedTransactionId) {
      const txn = await this.prisma.transaction.findFirst({
        where: {
          id: refs.linkedTransactionId,
          household: { members: { some: { userId } } },
        },
        select: { id: true },
      });
      if (!txn) {
        throw new NotFoundException('Linked transaction not found');
      }
    }
    if (refs.linkedSettlementId) {
      const settlement = await this.prisma.settlement.findFirst({
        where: {
          id: refs.linkedSettlementId,
          household: { members: { some: { userId } } },
        },
        select: { id: true },
      });
      if (!settlement) {
        throw new NotFoundException('Linked settlement not found');
      }
    }
  }

  async updateTransaction(
    userId: string,
    transactionId: string,
    dto: UpdatePersonalTransactionDto,
  ): Promise<PersonalTransactionDto> {
    const existing = await this.prisma.personalTransaction.findFirst({
      where: { id: transactionId, userId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Transaction not found');
    }
    if (dto.txnDate !== undefined) this.assertNotFutureDate(dto.txnDate);
    if (dto.categoryId) await this.assertCategory(userId, dto.categoryId);
    await this.assertLinkedRefs(userId, {
      linkedTransactionId: dto.linkedTransactionId,
      linkedSettlementId: dto.linkedSettlementId,
    });

    // Fields that require re-resolving the amount / frozen FX snapshot.
    const fxKeys: (keyof UpdatePersonalTransactionDto)[] = [
      'amount',
      'amountOriginal',
      'currencyOriginal',
      'txnDate',
      'accountId',
      'transferAccountId',
      'transferAmount',
      'type',
    ];
    const needsResolve = fxKeys.some((k) => dto[k] !== undefined);

    const data: Prisma.PersonalTransactionUpdateInput = {};

    if (needsResolve) {
      const merged: CreatePersonalTransactionDto = {
        accountId: dto.accountId ?? existing.accountId,
        type: dto.type ?? existing.type,
        amount:
          dto.amount ??
          (existing.amountOriginal !== null
            ? this.dec(existing.amountOriginal).toString()
            : this.dec(existing.amount).toString()),
        amountOriginal:
          dto.amountOriginal !== undefined
            ? dto.amountOriginal
            : existing.amountOriginal !== null
              ? this.dec(existing.amountOriginal).toString()
              : null,
        currencyOriginal:
          dto.currencyOriginal !== undefined ? dto.currencyOriginal : existing.currencyOriginal,
        txnDate: dto.txnDate ?? existing.txnDate.toISOString().slice(0, 10),
        transferAccountId:
          dto.transferAccountId !== undefined
            ? dto.transferAccountId
            : existing.transferAccountId,
        // Only honor an explicitly-supplied transferAmount. Carrying forward the
        // stored one would desync the destination leg when the source amount /
        // currency / date changes (resolveAmounts treats a present transferAmount
        // as authoritative and never recomputes it) — leaving `undefined` forces a
        // fresh recompute of the converted leg.
        transferAmount: dto.transferAmount !== undefined ? dto.transferAmount : undefined,
      };
      // If the caller passes a fresh `amount` but no original entry, use it directly.
      if (dto.amount !== undefined && dto.amountOriginal === undefined && merged.amountOriginal === null) {
        merged.amount = dto.amount;
      }

      const account = await this.assertAccount(userId, merged.accountId);
      const r = await this.resolveAmounts(userId, merged, account);

      data.account = { connect: { id: merged.accountId } };
      data.type = merged.type;
      data.amount = r.amount.toString();
      data.amountOriginal = r.amountOriginal ? r.amountOriginal.toString() : null;
      data.currencyOriginal = r.currencyOriginal;
      data.fxRate = r.fxRate ? r.fxRate.toString() : null;
      data.fxRateDate = r.fxRateDate;
      data.fxSource = r.fxSource;
      data.txnDate = toUtcDate(merged.txnDate);
      data.transferAmount = r.transferAmount ? r.transferAmount.toString() : null;
      if (merged.type === 'transfer' && merged.transferAccountId) {
        data.transferAccount = { connect: { id: merged.transferAccountId } };
      } else {
        data.transferAccount = { disconnect: true };
      }
    }

    // Non-FX metadata updates.
    if (dto.categoryId !== undefined) {
      data.category = dto.categoryId
        ? { connect: { id: dto.categoryId } }
        : { disconnect: true };
    }
    if (dto.payeeSource !== undefined) data.payeeSource = dto.payeeSource;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.linkedTransactionId !== undefined) {
      data.linkedTransaction = dto.linkedTransactionId
        ? { connect: { id: dto.linkedTransactionId } }
        : { disconnect: true };
    }
    if (dto.linkedSettlementId !== undefined) {
      data.linkedSettlement = dto.linkedSettlementId
        ? { connect: { id: dto.linkedSettlementId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.personalTransaction.update({
      where: { id: transactionId },
      data,
    });
    return this.txnToDto(updated);
  }

  /** Soft delete (owner-only). */
  async removeTransaction(userId: string, transactionId: string): Promise<void> {
    const res = await this.prisma.personalTransaction.updateMany({
      where: { id: transactionId, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (res.count === 0) {
      throw new NotFoundException('Transaction not found');
    }
  }

  async listTransactions(
    userId: string,
    filter: PersonalTransactionFilter,
  ): Promise<PersonalTransactionDto[]> {
    const where: Prisma.PersonalTransactionWhereInput = { userId, deletedAt: null };

    const and: Prisma.PersonalTransactionWhereInput[] = [];

    if (filter.type) where.type = filter.type;
    if (filter.accountId) {
      // Match either leg: a posting on the account itself, or the incoming leg
      // of a transfer whose destination is this account (mirrors the balance
      // query and AccountLedger's per-leg delta). Filtering on accountId alone
      // would hide transfers *into* the account from its ledger.
      and.push({
        OR: [{ accountId: filter.accountId }, { transferAccountId: filter.accountId }],
      });
    }
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.from || filter.to) {
      where.txnDate = {};
      if (filter.from) (where.txnDate as Prisma.DateTimeFilter).gte = toUtcDate(filter.from);
      if (filter.to) (where.txnDate as Prisma.DateTimeFilter).lte = toUtcDate(filter.to);
    }
    if (filter.payee) {
      where.payeeSource = { contains: filter.payee, mode: 'insensitive' };
    }
    if (filter.search) {
      and.push({
        OR: [
          { payeeSource: { contains: filter.search, mode: 'insensitive' } },
          { notes: { contains: filter.search, mode: 'insensitive' } },
        ],
      });
    }
    if (filter.minAmount || filter.maxAmount) {
      const amount: Prisma.DecimalFilter = {};
      if (filter.minAmount) amount.gte = this.dec(filter.minAmount).toString();
      if (filter.maxAmount) amount.lte = this.dec(filter.maxAmount).toString();
      where.amount = amount;
    }

    if (and.length > 0) where.AND = and;

    const rows = await this.prisma.personalTransaction.findMany({
      where,
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((t) => this.txnToDto(t));
  }

  // ── Net worth & stats ──────────────────────────────────────────────────────
  private async getProfileCurrency(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferredCurrency: true },
    });
    return user?.preferredCurrency ?? 'EUR';
  }

  /**
   * Net worth (PLAN.md §5.5, §3.4): Σ over active accounts of the native balance
   * converted to the profile currency at the LATEST available rate. Liability
   * balances (e.g. a credit card carrying spend) are naturally negative and thus
   * reduce the total. Each account's native balance is returned untouched.
   */
  async getNetWorth(userId: string): Promise<NetWorthDto> {
    const profileCurrency = await this.getProfileCurrency(userId);
    const accounts = await this.prisma.account.findMany({
      where: { userId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    // Single query for all of the user's transactions, then reduce per account
    // in memory (avoids an N+1 findMany per account). `reduceBalance` filters by
    // account id, so passing the full set yields the same per-account result.
    const rows = await this.prisma.personalTransaction.findMany({
      where: { userId, deletedAt: null },
      select: BALANCE_ROW_SELECT,
    });

    const rateCache = new Map<string, Decimal>();
    // Net worth is only as fresh as its stalest input rate: start at today (the
    // ceiling, correct when nothing needs converting) and pull `asOf` back to the
    // oldest latest-rate date actually used (e.g. Friday's rate over a weekend).
    let asOf = new Date().toISOString().slice(0, 10);
    let total = new Decimal(0);
    const breakdown: NetWorthAccountDto[] = [];

    for (const account of accounts) {
      const native = this.reduceBalance(account, rows);

      let converted: Decimal;
      if (account.currency === profileCurrency) {
        converted = native;
      } else {
        let rate = rateCache.get(account.currency);
        if (!rate) {
          const r = await this.fx.getLatestRate(account.currency, profileCurrency);
          rate = r.rate;
          rateCache.set(account.currency, rate);
          if (r.rateDate < asOf) asOf = r.rateDate;
        }
        converted = native.mul(rate).toDecimalPlaces(6);
      }

      total = total.plus(converted);
      breakdown.push({
        accountId: account.id,
        name: account.name,
        type: account.type,
        nativeCurrency: account.currency,
        nativeBalance: native.toString(),
        convertedBalance: converted.toString(),
      });
    }

    return {
      profileCurrency,
      total: total.toDecimalPlaces(6).toString(),
      asOf,
      accounts: breakdown,
    };
  }

  // ── Net-worth history (#3) ──────────────────────────────────────────────────
  /**
   * Freeze today's net worth into a daily snapshot so the trend survives (live
   * net worth is recomputed every read and would otherwise leave no history).
   * Idempotent: one row per user per calendar day (upsert). Called on demand and
   * by the nightly NetWorthSnapshotScheduler.
   */
  async captureNetWorthSnapshot(userId: string, dateISO?: string): Promise<NetWorthSnapshotDto> {
    const nw = await this.getNetWorth(userId);
    const snapshotDate = toUtcDate(dateISO ?? todayISO());
    const snap = await this.prisma.netWorthSnapshot.upsert({
      where: { userId_snapshotDate: { userId, snapshotDate } },
      create: { userId, snapshotDate, currency: nw.profileCurrency, totalBase: nw.total },
      update: { currency: nw.profileCurrency, totalBase: nw.total },
    });
    return {
      date: dateToISO(snap.snapshotDate),
      currency: snap.currency,
      total: this.dec(snap.totalBase).toString(),
    };
  }

  /** Net-worth snapshots over the last `days` (owner-only), oldest first. */
  async getNetWorthHistory(userId: string, days = 365): Promise<NetWorthHistoryDto> {
    const profileCurrency = await this.getProfileCurrency(userId);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - Math.max(1, days));
    const rows = await this.prisma.netWorthSnapshot.findMany({
      where: { userId, snapshotDate: { gte: toUtcDate(dateToISO(since)) } },
      orderBy: { snapshotDate: 'asc' },
    });
    return {
      profileCurrency,
      points: rows.map((r) => ({
        date: dateToISO(r.snapshotDate),
        currency: r.currency,
        total: this.dec(r.totalBase).toString(),
      })),
    };
  }

  // ── Saved filters (#8) ──────────────────────────────────────────────────────
  private savedFilterToDto(r: {
    id: string;
    name: string;
    filters: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): SavedFilterDto {
    return {
      id: r.id,
      name: r.name,
      filters: (r.filters ?? {}) as PersonalTransactionFilter,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async listSavedFilters(userId: string): Promise<SavedFilterDto[]> {
    const rows = await this.prisma.savedFilter.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.savedFilterToDto(r));
  }

  async createSavedFilter(userId: string, dto: CreateSavedFilterDto): Promise<SavedFilterDto> {
    const row = await this.prisma.savedFilter.create({
      data: {
        userId,
        name: dto.name,
        filters: dto.filters as Prisma.InputJsonValue,
      },
    });
    return this.savedFilterToDto(row);
  }

  async deleteSavedFilter(userId: string, id: string): Promise<void> {
    const res = await this.prisma.savedFilter.deleteMany({ where: { id, userId } });
    if (res.count === 0) {
      throw new NotFoundException('Saved filter not found');
    }
  }

  /** Bucket key for a date at the requested granularity. */
  private bucketKey(date: Date, period: StatsPeriod): string {
    const iso = date.toISOString();
    return period === 'year' ? iso.slice(0, 4) : iso.slice(0, 7);
  }

  /** Convert an amount from a source currency to the profile currency (latest rate). */
  private async toProfile(
    amount: Decimal,
    from: string,
    profileCurrency: string,
    rateCache: Map<string, Decimal>,
  ): Promise<Decimal> {
    if (from === profileCurrency) return amount;
    let rate = rateCache.get(from);
    if (!rate) {
      const r = await this.fx.getLatestRate(from, profileCurrency);
      rate = r.rate;
      rateCache.set(from, rate);
    }
    return amount.mul(rate).toDecimalPlaces(6);
  }

  async getStats(
    userId: string,
    view: StatsView,
    period: StatsPeriod,
  ): Promise<StatsResponseDto> {
    const profileCurrency = await this.getProfileCurrency(userId);
    const rows = await this.prisma.personalTransaction.findMany({
      where: { userId, deletedAt: null, type: { in: ['income', 'expense'] } },
      include: {
        account: { select: { name: true, currency: true } },
        category: { select: { name: true } },
      },
      orderBy: [{ txnDate: 'asc' }],
    });

    const rateCache = new Map<string, Decimal>();

    // Accumulators keyed by bucket.
    const income = new Map<string, Decimal>();
    const expense = new Map<string, Decimal>();
    const labels = new Map<string, string>();

    const add = (map: Map<string, Decimal>, key: string, val: Decimal) => {
      map.set(key, (map.get(key) ?? new Decimal(0)).plus(val));
    };

    for (const row of rows) {
      const amount = await this.toProfile(
        this.dec(row.amount),
        row.account.currency,
        profileCurrency,
        rateCache,
      );

      let key: string;
      let label: string;
      if (view === 'by-category') {
        key = row.categoryId ?? 'uncategorized';
        label = row.category?.name ?? 'Uncategorized';
      } else if (view === 'by-account') {
        key = row.accountId;
        label = row.account.name;
      } else {
        // cashflow | income-timeline
        key = this.bucketKey(row.txnDate, period);
        label = key;
      }
      labels.set(key, label);

      if (row.type === 'income') add(income, key, amount);
      else add(expense, key, amount);
    }

    const keys = new Set<string>([...income.keys(), ...expense.keys()]);
    const points: StatsPoint[] = [];

    for (const key of keys) {
      const inc = income.get(key) ?? new Decimal(0);
      const exp = expense.get(key) ?? new Decimal(0);
      const label = labels.get(key) ?? key;

      if (view === 'income-timeline') {
        if (inc.isZero()) continue; // "when was I paid", income only
        points.push({ key, label, income: inc.toString(), total: inc.toString() });
      } else if (view === 'by-category') {
        points.push({
          key,
          label,
          income: inc.toString(),
          expense: exp.toString(),
          total: exp.toString(), // spending by category
        });
      } else if (view === 'by-account') {
        points.push({
          key,
          label,
          income: inc.toString(),
          expense: exp.toString(),
          total: inc.minus(exp).toString(), // net flow
        });
      } else {
        // cashflow
        points.push({
          key,
          label,
          income: inc.toString(),
          expense: exp.toString(),
          total: inc.minus(exp).toString(),
        });
      }
    }

    // Time views sort chronologically; category/account views by magnitude desc.
    if (view === 'cashflow' || view === 'income-timeline') {
      points.sort((a, b) => a.key.localeCompare(b.key));
    } else {
      points.sort((a, b) => new Decimal(b.total ?? 0).minus(a.total ?? 0).toNumber());
    }

    return { view, period, profileCurrency, points };
  }

  /** This-month income, spending, and savings rate in the profile currency. */
  async getStatsSummary(userId: string): Promise<StatsSummaryDto> {
    const profileCurrency = await this.getProfileCurrency(userId);

    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const month = start.toISOString().slice(0, 7);

    const rows = await this.prisma.personalTransaction.findMany({
      where: {
        userId,
        deletedAt: null,
        type: { in: ['income', 'expense'] },
        txnDate: { gte: start, lt: end },
      },
      include: { account: { select: { currency: true } } },
    });

    const rateCache = new Map<string, Decimal>();
    let income = new Decimal(0);
    let spending = new Decimal(0);
    for (const row of rows) {
      const amount = await this.toProfile(
        this.dec(row.amount),
        row.account.currency,
        profileCurrency,
        rateCache,
      );
      if (row.type === 'income') income = income.plus(amount);
      else spending = spending.plus(amount);
    }

    const savingsRate = income.isZero()
      ? '0'
      : income.minus(spending).div(income).toDecimalPlaces(4).toString();

    return {
      profileCurrency,
      month,
      income: income.toDecimalPlaces(6).toString(),
      spending: spending.toDecimalPlaces(6).toString(),
      savingsRate,
    };
  }
}
