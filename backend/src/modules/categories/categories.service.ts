import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Category, CategoryFlow, CategoryScope, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_PERSONAL_CATEGORIES, DEFAULT_SHARED_CATEGORIES } from './categories.constants';
import type { CreateCategoryDto } from './categories.schemas';

/** Wire-shape mirrors the frontend `Category` type (src/types/index.ts). */
export interface CategoryDto {
  id: string;
  householdId: string | null;
  userId: string | null;
  scope: CategoryScope;
  flow: CategoryFlow;
  name: string;
  icon: string | null;
  color: string | null;
}

/**
 * Reference categories (PLAN.md §1/§4). Shared categories are seeded per household
 * at creation; global personal defaults are seeded lazily on first read. The
 * frontend expects `GET /households/:id/categories` and `GET /categories`.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(c: Category): CategoryDto {
    return {
      id: c.id,
      householdId: c.householdId,
      userId: c.userId,
      scope: c.scope,
      flow: c.flow,
      name: c.name,
      icon: c.icon,
      color: c.color,
    };
  }

  /**
   * Nested-write payload to seed a household's default SHARED categories in the
   * same transaction that creates the household (idempotent by construction:
   * only ever run once, at creation).
   */
  static householdSeedCreateInput(): Prisma.CategoryCreateWithoutHouseholdInput[] {
    return DEFAULT_SHARED_CATEGORIES.map((c) => ({
      scope: c.scope,
      flow: c.flow,
      name: c.name,
      icon: c.icon ?? null,
      color: c.color ?? null,
    }));
  }

  /** Shared categories for a household (member-gated at the controller). */
  async listHouseholdCategories(householdId: string): Promise<CategoryDto[]> {
    const rows = await this.prisma.category.findMany({
      where: {
        scope: { in: ['shared', 'both'] },
        OR: [{ householdId }, { householdId: null, userId: null }],
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Personal-usable categories for a user: their own private categories plus the
   * global personal defaults. Seeds the global defaults on first access.
   */
  async listPersonalCategories(userId: string): Promise<CategoryDto[]> {
    await this.ensureGlobalPersonalDefaults();
    const rows = await this.prisma.category.findMany({
      where: {
        scope: { in: ['personal', 'both'] },
        OR: [{ userId }, { userId: null, householdId: null }],
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  // ── Custom categories (create / delete) ─────────────────────────────────────
  //
  // Users may add their own categories in two scopes: household SHARED buckets
  // (any member, matches the household-settings policy) and PERSONAL buckets
  // (owner-only). Global default categories (household=null & user=null) are
  // never mutable through these paths — a delete only ever targets a row owned by
  // the caller's household / user, so one owner can't touch another's or a
  // global default.

  /** Create a custom SHARED category on a household (member-gated at the controller). */
  async createHouseholdCategory(householdId: string, dto: CreateCategoryDto): Promise<CategoryDto> {
    await this.assertNameFree({ householdId }, dto.flow, dto.name);
    const created = await this.prisma.category.create({
      data: {
        householdId,
        userId: null,
        scope: 'shared',
        flow: dto.flow,
        name: dto.name,
        icon: dto.icon ?? null,
        color: dto.color ?? null,
      },
    });
    return this.toDto(created);
  }

  /** Create a custom PERSONAL category for a user (owner-only). */
  async createPersonalCategory(userId: string, dto: CreateCategoryDto): Promise<CategoryDto> {
    await this.assertNameFree({ userId }, dto.flow, dto.name);
    const created = await this.prisma.category.create({
      data: {
        householdId: null,
        userId,
        scope: 'personal',
        flow: dto.flow,
        name: dto.name,
        icon: dto.icon ?? null,
        color: dto.color ?? null,
      },
    });
    return this.toDto(created);
  }

  /** Delete a household's own custom category (never a global default). */
  async deleteHouseholdCategory(householdId: string, categoryId: string): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, householdId },
    });
    if (!category) throw new NotFoundException('Category not found');
    await this.deleteIfUnused(categoryId);
  }

  /** Delete a user's own custom personal category (never a global default). */
  async deletePersonalCategory(userId: string, categoryId: string): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, userId },
    });
    if (!category) throw new NotFoundException('Category not found');
    await this.deleteIfUnused(categoryId);
  }

  /**
   * Reject a duplicate name (case-insensitive) within the same owner + flow so a
   * user can't create two indistinguishable buckets.
   */
  private async assertNameFree(
    owner: { householdId: string } | { userId: string },
    flow: CategoryFlow,
    name: string,
  ): Promise<void> {
    const clash = await this.prisma.category.findFirst({
      where: { ...owner, flow, name: { equals: name, mode: 'insensitive' } },
    });
    if (clash) throw new ConflictException('A category with this name already exists');
  }

  /**
   * Delete a category only if nothing references it. The ledger is append-only
   * and the tally is computed per-category, so removing an in-use category would
   * orphan history; block it and let the caller keep the bucket instead.
   */
  private async deleteIfUnused(categoryId: string): Promise<void> {
    // Soft-deleted rows are treated as gone everywhere else (balances, stats,
    // lists), so a category referenced only by them is genuinely unused.
    const [txns, settlements, personalTxns] = await Promise.all([
      this.prisma.transaction.count({ where: { categoryId, deletedAt: null } }),
      this.prisma.settlement.count({ where: { categoryId } }),
      this.prisma.personalTransaction.count({ where: { categoryId, deletedAt: null } }),
    ]);
    if (txns + settlements + personalTxns > 0) {
      throw new ConflictException('Category is in use and cannot be deleted');
    }
    await this.prisma.category.delete({ where: { id: categoryId } });
  }

  /**
   * Stable, application-reserved key for the transaction-scoped Postgres advisory
   * lock that serialises global-default seeding (SEC-13). Arbitrary constant,
   * only needs to be unique among this app's advisory locks.
   */
  private static readonly GLOBAL_DEFAULTS_LOCK_KEY = 4815162342n;

  private static readonly GLOBAL_DEFAULTS_WHERE: Prisma.CategoryWhereInput = {
    userId: null,
    householdId: null,
    scope: { in: ['personal', 'both'] },
  };

  /**
   * Idempotently create the global personal default categories if absent.
   *
   * Race-safe (SEC-13): two concurrent first-reads could both observe `count===0`
   * and both insert the default set, duplicating the globals. There is no unique
   * constraint to lean on (schema is owned elsewhere), so we serialise the seed
   * with a transaction-scoped Postgres advisory lock: concurrent callers block on
   * the same key, and whoever runs second re-checks the count inside the lock and
   * skips. The lock auto-releases at transaction end. The seeded set is unchanged.
   */
  private async ensureGlobalPersonalDefaults(): Promise<void> {
    // Fast path: already seeded, keep the hot read path lock-free.
    const existing = await this.prisma.category.count({
      where: CategoriesService.GLOBAL_DEFAULTS_WHERE,
    });
    if (existing > 0) return;

    await this.prisma.$transaction(async (tx) => {
      // Serialise concurrent first-readers; released automatically on commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CategoriesService.GLOBAL_DEFAULTS_LOCK_KEY})`;

      // Re-check inside the lock: a racing caller may have just seeded.
      const count = await tx.category.count({
        where: CategoriesService.GLOBAL_DEFAULTS_WHERE,
      });
      if (count > 0) return;

      await tx.category.createMany({
        data: DEFAULT_PERSONAL_CATEGORIES.map((c) => ({
          householdId: null,
          userId: null,
          scope: c.scope,
          flow: c.flow,
          name: c.name,
          icon: c.icon ?? null,
          color: c.color ?? null,
        })),
        skipDuplicates: true,
      });
    });
  }
}
