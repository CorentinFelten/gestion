import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FxService } from '../fx/fx.service';
import { resolveSplits, roundMoney } from './money.util';
import { dateToISO, todayISO, toUtcDate } from '../fx/date.util';
import { allowedMimeTypes, maxUploadBytes } from './attachment-upload';
import type {
  AttachmentDto,
  CreateTransactionDto,
  SplitDto,
  TransactionDto,
  TransactionFilter,
  UpdateTransactionDto,
} from './dto/transaction.dto';

type TxnWithSplits = Prisma.TransactionGetPayload<{ include: { splits: true } }>;

/**
 * Reduce a client-supplied file name to a safe display label: strip any
 * directory component (path traversal) and control chars, cap the length, and
 * fall back to a generic name. Never used to build an on-disk path.
 */
function sanitizeDisplayName(name: string): string {
  const noPath = (name ?? '').replace(/^.*[\\/]/, '');
  const noControl = Array.from(noPath)
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
    .join('');
  const cleaned = noControl.trim().slice(0, 200);
  return cleaned.length > 0 ? cleaned : 'attachment';
}
/**
 * Shared-ledger transactions + splits. On create/edit this service freezes the
 * FX snapshot via FxService (payment-date rate) and enforces the split
 * invariant (Σ splits.amountBase == transaction.amountBase) using the
 * largest-remainder method.
 */
@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  // ── helpers ────────────────────────────────────────────────────────────
  private async baseCurrencyOf(householdId: string): Promise<string> {
    const hh = await this.prisma.household.findUnique({
      where: { id: householdId },
      select: { baseCurrency: true },
    });
    if (!hh) throw new NotFoundException('Household not found');
    return hh.baseCurrency;
  }

  private assertPaymentDate(iso: string): void {
    if (iso > todayISO()) {
      throw new BadRequestException('payment_date cannot be in the future');
    }
  }

  /**
   * Resource-level authorization for `/transactions/:id`: the caller must be a
   * member of the transaction's household. Throws NotFound (not Forbidden) so a
   * non-member cannot even probe whether a given id exists (PLAN.md §9).
   */
  private async assertCallerMember(householdId: string, userId: string): Promise<void> {
    const membership = await this.prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId } },
      select: { userId: true },
    });
    if (!membership) {
      throw new NotFoundException('Transaction not found');
    }
  }

  private async assertMembers(householdId: string, userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    const members = await this.prisma.householdMember.findMany({
      where: { householdId, userId: { in: unique } },
      select: { userId: true },
    });
    const found = new Set(members.map((m) => m.userId));
    for (const id of unique) {
      if (!found.has(id)) {
        throw new BadRequestException(`User ${id} is not a member of this household`);
      }
    }
  }

  /**
   * SEC-11: a shared-ledger row may only reference a category that is either a
   * global shared default (`householdId=null AND userId=null`) or one owned by
   * the target household. A personal/private or other-household category is
   * rejected so it can't be smuggled onto a shared transaction.
   */
  private async assertCategoryInScope(
    householdId: string,
    categoryId: string | null,
  ): Promise<void> {
    if (!categoryId) return;
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

  /**
   * SEC-04: mutation of a transaction is restricted to its creator/payer OR a
   * household admin/owner, membership alone is insufficient. A non-member is
   * hidden with a 404 (matches the resource-level existence-hiding elsewhere);
   * a member who is neither creator/payer nor admin gets a 403 (they can
   * already read the row, so its existence isn't secret from them).
   */
  private async assertCanMutate(
    txn: { householdId: string; createdById: string; payerUserId: string },
    callerUserId: string,
  ): Promise<void> {
    const membership = await this.prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId: txn.householdId, userId: callerUserId } },
      select: { role: true },
    });
    if (!membership) {
      throw new NotFoundException('Transaction not found');
    }
    const role: Role = membership.role;
    const isAdmin = role === 'owner' || role === 'admin';
    const isCreatorOrPayer =
      callerUserId === txn.createdById || callerUserId === txn.payerUserId;
    if (!isAdmin && !isCreatorOrPayer) {
      throw new ForbiddenException(
        'Only the transaction creator/payer or a household admin can modify it',
      );
    }
  }

  /** SEC-04: append an audit_log row for a money-affecting transaction write. */
  private async writeAudit(
    householdId: string,
    actorUserId: string,
    action: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        householdId,
        actorUserId,
        action,
        entity: 'transaction',
        entityId,
        before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private toDto(txn: TxnWithSplits): TransactionDto {
    return {
      id: txn.id,
      householdId: txn.householdId,
      payerUserId: txn.payerUserId,
      description: txn.description,
      categoryId: txn.categoryId,
      notes: txn.notes,
      amountOriginal: txn.amountOriginal.toString(),
      currencyOriginal: txn.currencyOriginal,
      paymentDate: dateToISO(txn.paymentDate),
      baseCurrency: txn.baseCurrency,
      fxRate: txn.fxRate.toString(),
      fxRateDate: dateToISO(txn.fxRateDate),
      fxSource: txn.fxSource,
      amountBase: txn.amountBase.toString(),
      splits: txn.splits.map(
        (s): SplitDto => ({
          id: s.id,
          userId: s.userId,
          splitType: s.splitType,
          shareValue: s.shareValue.toString(),
          amountBase: s.amountBase.toString(),
        }),
      ),
      createdById: txn.createdById,
      createdAt: txn.createdAt.toISOString(),
      updatedAt: txn.updatedAt.toISOString(),
    };
  }

  // ── queries ────────────────────────────────────────────────────────────
  async list(householdId: string, filter: TransactionFilter): Promise<TransactionDto[]> {
    const where: Prisma.TransactionWhereInput = {
      householdId,
      deletedAt: null,
    };
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.memberId) where.payerUserId = filter.memberId;
    if (filter.currency) where.currencyOriginal = filter.currency.toUpperCase();
    if (filter.from || filter.to) {
      where.paymentDate = {};
      if (filter.from) where.paymentDate.gte = toUtcDate(filter.from);
      if (filter.to) where.paymentDate.lte = toUtcDate(filter.to);
    }
    if (filter.search) {
      where.OR = [
        { description: { contains: filter.search, mode: 'insensitive' } },
        { notes: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.transaction.findMany({
      where,
      include: { splits: true },
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async getById(transactionId: string, callerUserId: string): Promise<TransactionDto> {
    const txn = await this.prisma.transaction.findFirst({
      where: { id: transactionId, deletedAt: null },
      include: { splits: true },
    });
    if (!txn) throw new NotFoundException('Transaction not found');
    await this.assertCallerMember(txn.householdId, callerUserId);
    return this.toDto(txn);
  }

  // ── create ─────────────────────────────────────────────────────────────
  async create(
    householdId: string,
    createdByUserId: string,
    dto: CreateTransactionDto,
  ): Promise<TransactionDto> {
    const baseCurrency = await this.baseCurrencyOf(householdId);
    this.assertPaymentDate(dto.paymentDate);
    await this.assertMembers(householdId, [
      dto.payerUserId,
      ...dto.splits.map((s) => s.userId),
    ]);
    await this.assertCategoryInScope(householdId, dto.categoryId);

    const amountOriginal = roundMoney(new Decimal(dto.amountOriginal));
    if (amountOriginal.lte(0)) {
      throw new BadRequestException('amount_original must be positive');
    }

    // Freeze the FX snapshot at the payment date.
    const fx = await this.fx.convert(
      amountOriginal,
      dto.currencyOriginal,
      baseCurrency,
      dto.paymentDate,
    );
    const amountBase = roundMoney(fx.amount);

    const resolved = resolveSplits(
      amountBase,
      amountOriginal,
      dto.splits.map((s) => ({
        userId: s.userId,
        splitType: s.splitType,
        shareValue: new Decimal(s.shareValue),
      })),
    );

    const created = await this.prisma.transaction.create({
      data: {
        householdId,
        payerUserId: dto.payerUserId,
        description: dto.description,
        categoryId: dto.categoryId,
        notes: dto.notes ?? null,
        amountOriginal: amountOriginal.toString(),
        currencyOriginal: dto.currencyOriginal,
        paymentDate: toUtcDate(dto.paymentDate),
        baseCurrency,
        fxRate: fx.rate.toString(),
        fxRateDate: toUtcDate(fx.rateDate),
        fxSource: fx.source,
        amountBase: amountBase.toString(),
        createdById: createdByUserId,
        splits: {
          create: resolved.map((r) => ({
            userId: r.userId,
            splitType: r.splitType,
            shareValue: r.shareValue.toString(),
            amountBase: r.amountBase.toString(),
          })),
        },
      },
      include: { splits: true },
    });
    const dto2 = this.toDto(created);
    await this.writeAudit(
      householdId,
      createdByUserId,
      'transaction.created',
      created.id,
      null,
      dto2,
    );
    return dto2;
  }

  // ── update (re-resolves FX if date/currency change) ──────────────────────
  async update(
    transactionId: string,
    callerUserId: string,
    dto: UpdateTransactionDto,
  ): Promise<TransactionDto> {
    const existing = await this.prisma.transaction.findFirst({
      where: { id: transactionId, deletedAt: null },
      include: { splits: true },
    });
    if (!existing) throw new NotFoundException('Transaction not found');
    await this.assertCanMutate(existing, callerUserId);

    const before = this.toDto(existing);
    const householdId = existing.householdId;
    const baseCurrency = existing.baseCurrency;

    const payerUserId = dto.payerUserId ?? existing.payerUserId;
    const description = dto.description ?? existing.description;
    const categoryId = dto.categoryId ?? existing.categoryId;
    // SEC-11: re-validate the category scope when it is (re)assigned.
    if (dto.categoryId !== undefined) {
      await this.assertCategoryInScope(householdId, categoryId);
    }
    const notes = dto.notes !== undefined ? dto.notes : existing.notes;
    const currencyOriginal = dto.currencyOriginal ?? existing.currencyOriginal;
    const paymentDate = dto.paymentDate ?? dateToISO(existing.paymentDate);
    const amountOriginal = roundMoney(
      new Decimal(dto.amountOriginal ?? existing.amountOriginal.toString()),
    );
    if (amountOriginal.lte(0)) {
      throw new BadRequestException('amount_original must be positive');
    }

    this.assertPaymentDate(paymentDate);

    // Re-freeze FX only when the date or currency changed; otherwise keep the
    // immutable historical snapshot untouched.
    let fxRate = new Decimal(existing.fxRate.toString());
    let fxRateDate = dateToISO(existing.fxRateDate);
    let fxSource = existing.fxSource;
    const dateChanged = paymentDate !== dateToISO(existing.paymentDate);
    const currencyChanged = currencyOriginal !== existing.currencyOriginal;
    if (dateChanged || currencyChanged) {
      const fx = await this.fx.convert(
        amountOriginal,
        currencyOriginal,
        baseCurrency,
        paymentDate,
      );
      fxRate = fx.rate;
      fxRateDate = fx.rateDate;
      fxSource = fx.source;
    }
    const amountBase = roundMoney(amountOriginal.times(fxRate));

    // Rebuild splits: use the provided splits, else re-resolve the existing
    // participants against the (possibly new) total.
    let splitInputs;
    if (dto.splits) {
      splitInputs = dto.splits.map((s) => ({
        userId: s.userId,
        splitType: s.splitType,
        shareValue: new Decimal(s.shareValue),
      }));
    } else {
      const prev = existing.splits.map((s) => ({
        userId: s.userId,
        splitType: s.splitType,
        shareValue: new Decimal(s.shareValue.toString()),
      }));
      // Reused EXACT shares are absolute amounts that sum to the OLD total; if the
      // amount changed they'd no longer sum and resolveSplits would reject them.
      // Re-express them as `shares` (weights) so the split rescales proportionally
      // to the new total, matching how equal/percent/shares already behave.
      const prevSum = prev.reduce((a, s) => a.plus(s.shareValue), new Decimal(0));
      const allExact = prev.length > 0 && prev.every((s) => s.splitType === 'exact');
      if (allExact && prevSum.gt(0) && !roundMoney(prevSum).equals(roundMoney(amountOriginal))) {
        splitInputs = prev.map((s) => ({
          userId: s.userId,
          splitType: 'shares' as const,
          shareValue: s.shareValue,
        }));
      } else {
        splitInputs = prev;
      }
    }

    await this.assertMembers(householdId, [payerUserId, ...splitInputs.map((s) => s.userId)]);
    const resolved = resolveSplits(amountBase, amountOriginal, splitInputs);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.transactionSplit.deleteMany({ where: { transactionId } });
      return tx.transaction.update({
        where: { id: transactionId },
        data: {
          payerUserId,
          description,
          categoryId,
          notes,
          amountOriginal: amountOriginal.toString(),
          currencyOriginal,
          paymentDate: toUtcDate(paymentDate),
          fxRate: fxRate.toString(),
          fxRateDate: toUtcDate(fxRateDate),
          fxSource,
          amountBase: amountBase.toString(),
          splits: {
            create: resolved.map((r) => ({
              userId: r.userId,
              splitType: r.splitType,
              shareValue: r.shareValue.toString(),
              amountBase: r.amountBase.toString(),
            })),
          },
        },
        include: { splits: true },
      });
    });
    const after = this.toDto(updated);
    await this.writeAudit(
      householdId,
      callerUserId,
      'transaction.updated',
      transactionId,
      before,
      after,
    );
    return after;
  }

  async remove(transactionId: string, callerUserId: string): Promise<void> {
    const existing = await this.prisma.transaction.findFirst({
      where: { id: transactionId, deletedAt: null },
      include: { splits: true },
    });
    if (!existing) throw new NotFoundException('Transaction not found');
    await this.assertCanMutate(existing, callerUserId);
    const before = this.toDto(existing);
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { deletedAt: new Date() },
    });
    // Append-only history: soft delete + audit trail (never a hard delete).
    await this.writeAudit(
      existing.householdId,
      callerUserId,
      'transaction.deleted',
      transactionId,
      before,
      null,
    );
  }

  async addAttachment(
    transactionId: string,
    callerUserId: string,
    file: { originalname: string; mimetype: string; size: number; path: string },
  ): Promise<AttachmentDto> {
    const txn = await this.prisma.transaction.findFirst({
      where: { id: transactionId, deletedAt: null },
      select: { id: true, householdId: true },
    });
    if (!txn) throw new NotFoundException('Transaction not found');
    await this.assertCallerMember(txn.householdId, callerUserId);
    if (!file.path) {
      throw new BadRequestException('No file uploaded');
    }
    // SEC-10 defense-in-depth: the FileInterceptor already enforces the MIME
    // allowlist and size cap while streaming, but re-check here so the metadata
    // we persist can never be out of policy (and yields a 400, not a 413).
    if (!allowedMimeTypes().has((file.mimetype ?? '').toLowerCase())) {
      throw new BadRequestException('Unsupported attachment type');
    }
    if (file.size > maxUploadBytes()) {
      throw new BadRequestException('Attachment exceeds the maximum allowed size');
    }
    // SEC-10: never trust the client `originalname` for a path. The on-disk
    // `storagePath` is the randomized name multer wrote under UPLOAD_DIR; the
    // client name is kept only as a display label, stripped to its basename so
    // no directory component (traversal) can leak into stored metadata.
    const displayName = sanitizeDisplayName(file.originalname);
    const att = await this.prisma.attachment.create({
      data: {
        transactionId,
        filename: displayName,
        mime: file.mimetype,
        size: file.size,
        storagePath: file.path,
      },
    });
    return {
      id: att.id,
      transactionId: att.transactionId,
      filename: att.filename,
      mime: att.mime,
      size: att.size,
      createdAt: att.createdAt.toISOString(),
    };
  }
}
