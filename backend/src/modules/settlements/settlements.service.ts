import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { Prisma, Settlement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FxService } from '../fx/fx.service';
import { TallyService } from '../tally/tally.service';
import { roundMoney } from '../transactions/money.util';
import { dateToISO, todayISO, toUtcDate } from '../fx/date.util';
import type {
  CreateSettlementDto,
  SettlementDto,
  SettlementFilter,
  SettleUpPrefillDto,
} from './dto/settlement.dto';

/**
 * Category-scoped reimbursements (PLAN.md §5.3–5.4). Append-only: a reset never
 * deletes history, it records an offsetting settlement. FX is frozen at the
 * settlement's own payment date so it nets against base-currency balances.
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
    private readonly tally: TallyService,
  ) {}

  private toDto(s: Settlement, extra?: { outstandingBefore?: Decimal; directionWarning?: boolean }): SettlementDto {
    return {
      id: s.id,
      householdId: s.householdId,
      fromUserId: s.fromUserId,
      toUserId: s.toUserId,
      categoryId: s.categoryId,
      amountOriginal: s.amountOriginal.toString(),
      currencyOriginal: s.currencyOriginal,
      paymentDate: dateToISO(s.paymentDate),
      fxRate: s.fxRate.toString(),
      fxRateDate: dateToISO(s.fxRateDate),
      fxSource: s.fxSource,
      amountBase: s.amountBase.toString(),
      isFullReset: s.isFullReset,
      note: s.note,
      createdById: s.createdById,
      createdAt: s.createdAt.toISOString(),
      ...(extra?.outstandingBefore !== undefined
        ? { outstandingBefore: extra.outstandingBefore.toDecimalPlaces(6).toString() }
        : {}),
      ...(extra?.directionWarning !== undefined
        ? { directionWarning: extra.directionWarning }
        : {}),
    };
  }

  private async assertMember(householdId: string, userId: string): Promise<void> {
    const m = await this.prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
    if (!m) throw new BadRequestException(`User ${userId} is not a member of this household`);
  }

  async list(householdId: string, filter: SettlementFilter): Promise<SettlementDto[]> {
    const where: Prisma.SettlementWhereInput = { householdId };
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.memberId) {
      where.OR = [{ fromUserId: filter.memberId }, { toUserId: filter.memberId }];
    }
    const rows = await this.prisma.settlement.findMany({
      where,
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    householdId: string,
    createdByUserId: string,
    dto: CreateSettlementDto,
  ): Promise<SettlementDto> {
    if (dto.fromUserId === dto.toUserId) {
      throw new BadRequestException('from and to must be different members');
    }
    await this.assertMember(householdId, dto.fromUserId);
    await this.assertMember(householdId, dto.toUserId);

    if (dto.paymentDate > todayISO()) {
      throw new BadRequestException('payment_date cannot be in the future');
    }

    const household = await this.prisma.household.findUnique({
      where: { id: householdId },
      select: { baseCurrency: true },
    });
    if (!household) throw new NotFoundException('Household not found');
    const baseCurrency = household.baseCurrency;

    const categoryId = dto.categoryId ?? null;
    // SEC-11: a shared settlement may only reference a global shared default
    // category (householdId=null AND userId=null) or one owned by this
    // household, never a personal/private or other-household category.
    if (categoryId) {
      const cat = await this.prisma.category.findUnique({
        where: { id: categoryId },
        select: { householdId: true, userId: true },
      });
      if (!cat) throw new BadRequestException('Unknown category');
      const isGlobalDefault = cat.householdId === null && cat.userId === null;
      const belongsToHousehold = cat.householdId === householdId;
      if (!isGlobalDefault && !belongsToHousehold) {
        throw new BadRequestException('Category is not available in this household');
      }
    }

    const amountOriginal = roundMoney(new Decimal(dto.amountOriginal));
    if (amountOriginal.lte(0)) {
      throw new BadRequestException('amount must be positive');
    }

    // Freeze FX at the settlement's own payment date.
    const fx = await this.fx.convert(
      amountOriginal,
      dto.currencyOriginal,
      baseCurrency,
      dto.paymentDate,
    );
    const amountBase = roundMoney(fx.amount);

    // Outstanding BEFORE this settlement in the bucket it targets (null →
    // uncategorized). Positive ⇒ `from` owes `to` (correct reset direction).
    // Must be the bucket net, not the overall: a null-category settlement only
    // moves the uncategorized bucket, so isFullReset/directionWarning have to be
    // judged against that bucket, not the sum across every category.
    const outstanding = await this.tally.netCategoryBucket(
      householdId,
      dto.fromUserId,
      dto.toUserId,
      categoryId,
    );
    const directionWarning = !outstanding.gt(0); // from is NOT the debtor
    const isFullReset = outstanding.gt(0) && amountBase.equals(outstanding);

    const created = await this.prisma.settlement.create({
      data: {
        householdId,
        fromUserId: dto.fromUserId,
        toUserId: dto.toUserId,
        categoryId,
        amountOriginal: amountOriginal.toString(),
        currencyOriginal: dto.currencyOriginal,
        paymentDate: toUtcDate(dto.paymentDate),
        fxRate: fx.rate.toString(),
        fxRateDate: toUtcDate(fx.rateDate),
        fxSource: fx.source,
        amountBase: amountBase.toString(),
        isFullReset,
        note: dto.note ?? null,
        createdById: createdByUserId,
      },
    });

    // SEC-04: money-affecting write, record who created the settlement.
    // Append-only ledger: a reset never deletes history (PLAN.md §5.4), and
    // this audit row makes the actor of every settlement attributable.
    const dtoOut = this.toDto(created);
    await this.prisma.auditLog.create({
      data: {
        householdId,
        actorUserId: createdByUserId,
        action: 'settlement.created',
        entity: 'settlement',
        entityId: created.id,
        before: undefined,
        after: dtoOut as unknown as Prisma.InputJsonValue,
      },
    });

    return this.toDto(created, { outstandingBefore: outstanding, directionWarning });
  }

  /** Exact outstanding + prefill for the per-category "Reset tally" button. */
  async settleUpPrefill(
    householdId: string,
    categoryId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<SettleUpPrefillDto> {
    await this.assertMember(householdId, fromUserId);
    await this.assertMember(householdId, toUserId);

    const household = await this.prisma.household.findUnique({
      where: { id: householdId },
      select: { baseCurrency: true },
    });
    if (!household) throw new NotFoundException('Household not found');

    // Bucket net (null → uncategorized): positive ⇒ from owes to (the exact reset amount).
    const outstanding = await this.tally.netCategoryBucket(
      householdId,
      fromUserId,
      toUserId,
      categoryId,
    );

    return {
      fromUserId,
      toUserId,
      categoryId,
      outstandingBase: outstanding.toDecimalPlaces(6).toString(),
      baseCurrency: household.baseCurrency,
      isFullReset: true,
    };
  }
}
