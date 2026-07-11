import { Injectable } from '@nestjs/common';
import type { Category, CategoryFlow, CategoryScope, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_PERSONAL_CATEGORIES, DEFAULT_SHARED_CATEGORIES } from './categories.constants';

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
