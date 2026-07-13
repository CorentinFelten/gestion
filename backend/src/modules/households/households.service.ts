import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Household, type Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';
import type {
  CreateHouseholdDto,
  HouseholdDto,
  MemberDto,
  UpdateHouseholdDto,
} from './dto/household.dto';

@Injectable()
export class HouseholdsService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(household: Household, role: Role): HouseholdDto {
    return {
      id: household.id,
      name: household.name,
      baseCurrency: household.baseCurrency,
      createdById: household.createdById,
      createdAt: household.createdAt.toISOString(),
      role,
    };
  }

  /** Households the user is a member of (v1: expected to be exactly one). */
  async listForUser(userId: string): Promise<HouseholdDto[]> {
    const memberships = await this.prisma.householdMember.findMany({
      where: { userId },
      include: { household: true },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => this.toDto(m.household, m.role));
  }

  async create(userId: string, dto: CreateHouseholdDto): Promise<HouseholdDto> {
    // v1 single-household invariant (PLAN.md §12): a user belongs to exactly one.
    const existing = await this.prisma.householdMember.findFirst({ where: { userId } });
    if (existing) {
      throw new ConflictException('User already belongs to a household');
    }

    let household: Household;
    try {
      household = await this.prisma.household.create({
        data: {
          name: dto.name,
          baseCurrency: dto.baseCurrency,
          createdById: userId,
          members: {
            create: { userId, role: 'owner' },
          },
          // Seed the default shared category set (groceries, rent, …) so the
          // tally + transaction UI have buckets from day one (PLAN.md §1).
          categories: {
            create: CategoriesService.householdSeedCreateInput(),
          },
        },
      });
    } catch (e) {
      // The user_id unique index guards against a concurrent create/accept
      // racing past the pre-check above.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('User already belongs to a household');
      }
      throw e;
    }
    return this.toDto(household, 'owner');
  }

  async getById(householdId: string, userId: string): Promise<HouseholdDto> {
    const membership = await this.prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId } },
      include: { household: true },
    });
    if (!membership) {
      // Guard should have caught this, but keep the service self-defending.
      throw new NotFoundException('Household not found');
    }
    return this.toDto(membership.household, membership.role);
  }

  /**
   * Update the household's global settings (name + base currency). Any member may
   * do this (authorization is HouseholdMemberGuard at the controller). A
   * base-currency change is flagged as a heavy operation (recompute is a TODO).
   */
  async update(householdId: string, dto: UpdateHouseholdDto, actorUserId: string): Promise<HouseholdDto> {
    const household = await this.prisma.household.findUnique({ where: { id: householdId } });
    if (!household) {
      throw new NotFoundException('Household not found');
    }

    const currencyChanged =
      dto.baseCurrency !== undefined && dto.baseCurrency !== household.baseCurrency;

    // A base-currency change is only safe on an empty ledger. Once any
    // transaction or settlement exists, its `amount_base` is frozen against the
    // OLD base (the FX-freeze rule, PLAN.md §3.2) and is never re-derived, so a
    // new base would leave history denominated in the prior base while new rows
    // freeze against the new one, and TallyService would sum incompatible
    // bases. Reject rather than silently corrupt the ledger.
    if (currencyChanged) {
      const [txnCount, settlementCount] = await Promise.all([
        this.prisma.transaction.count({ where: { householdId } }),
        this.prisma.settlement.count({ where: { householdId } }),
      ]);
      if (txnCount > 0 || settlementCount > 0) {
        throw new ConflictException(
          'Cannot change the base currency once transactions or settlements exist: ' +
            'historical amounts are frozen against the original base and are never re-converted.',
        );
      }
    }

    const updated = await this.prisma.household.update({
      where: { id: householdId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.baseCurrency !== undefined ? { baseCurrency: dto.baseCurrency } : {}),
      },
    });

    // Base-currency change is money-affecting: audit it. The actual recompute of
    // stored transactions/settlements is another module's concern (PLAN.md §6).
    if (currencyChanged) {
      await this.prisma.auditLog.create({
        data: {
          householdId,
          actorUserId,
          action: 'household.base_currency_changed',
          entity: 'household',
          entityId: householdId,
          before: { baseCurrency: household.baseCurrency },
          after: { baseCurrency: updated.baseCurrency },
        },
      });
    }

    const membership = await this.prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId: actorUserId } },
    });
    return this.toDto(updated, membership?.role ?? 'admin');
  }

  async listMembers(householdId: string): Promise<MemberDto[]> {
    const members = await this.prisma.householdMember.findMany({
      where: { householdId },
      include: { user: { select: { displayName: true, avatarUrl: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return members.map((m) => ({
      userId: m.userId,
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    }));
  }

  async removeMember(householdId: string, targetUserId: string, actorUserId: string): Promise<void> {
    const target = await this.prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId: targetUserId } },
    });
    if (!target) {
      throw new NotFoundException('Member not found in this household');
    }
    // The owner cannot be removed (would orphan the household); they must transfer
    // ownership first (a v2 concern). Admins/owners cannot remove the owner.
    if (target.role === 'owner') {
      throw new BadRequestException('The household owner cannot be removed');
    }

    const actor = await this.prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId: actorUserId } },
    });
    // Admins may remove members; only an owner may remove another admin.
    if (target.role === 'admin' && actor?.role !== 'owner') {
      throw new ForbiddenException('Only the owner can remove an admin');
    }

    await this.prisma.householdMember.delete({
      where: { householdId_userId: { householdId, userId: targetUserId } },
    });

    await this.prisma.auditLog.create({
      data: {
        householdId,
        actorUserId,
        action: 'household.member_removed',
        entity: 'household_member',
        entityId: targetUserId,
        before: { userId: targetUserId, role: target.role },
        after: undefined,
      },
    });
  }
}
