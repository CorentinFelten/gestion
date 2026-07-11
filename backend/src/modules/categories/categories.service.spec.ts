import { ConflictException, NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service';

/**
 * Unit tests for custom-category create/delete (household + personal):
 * duplicate-name guard, in-use guard, and owner/household isolation. Uses a
 * light Prisma mock — only the `category`/count paths the service touches.
 */

type Cat = {
  id: string;
  householdId: string | null;
  userId: string | null;
  scope: string;
  flow: string;
  name: string;
  icon: string | null;
  color: string | null;
};

function makeService(seed: Cat[] = []) {
  const cats: Cat[] = [...seed];
  let seq = 1;
  const usage = { transaction: 0, settlement: 0, personalTransaction: 0 };

  const matchName = (c: Cat, cond: any) =>
    cond?.mode === 'insensitive'
      ? c.name.toLowerCase() === String(cond.equals).toLowerCase()
      : c.name === cond;

  const findFirst = ({ where }: any): Cat | null =>
    cats.find((c) => {
      if (where.id !== undefined && c.id !== where.id) return false;
      if (where.householdId !== undefined && c.householdId !== where.householdId) return false;
      if (where.userId !== undefined && c.userId !== where.userId) return false;
      if (where.flow !== undefined && c.flow !== where.flow) return false;
      if (where.name !== undefined && !matchName(c, where.name)) return false;
      return true;
    }) ?? null;

  const prisma: any = {
    category: {
      findFirst: jest.fn(async (args: any) => findFirst(args)),
      create: jest.fn(async ({ data }: any) => {
        const row: Cat = { id: `cat_${seq++}`, ...data };
        cats.push(row);
        return row;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = cats.findIndex((c) => c.id === where.id);
        if (i >= 0) cats.splice(i, 1);
        return {};
      }),
    },
    transaction: { count: jest.fn(async () => usage.transaction) },
    settlement: { count: jest.fn(async () => usage.settlement) },
    personalTransaction: { count: jest.fn(async () => usage.personalTransaction) },
  };

  return { service: new CategoriesService(prisma), cats, usage, prisma };
}

describe('CategoriesService — custom household categories', () => {
  it('creates a shared category scoped to the household', async () => {
    const { service } = makeService();
    const c = await service.createHouseholdCategory('h1', { name: 'Animaux', flow: 'expense' });
    expect(c).toMatchObject({ householdId: 'h1', userId: null, scope: 'shared', flow: 'expense', name: 'Animaux' });
  });

  it('rejects a duplicate name (case-insensitive) within the same household + flow', async () => {
    const { service } = makeService([
      { id: 'c1', householdId: 'h1', userId: null, scope: 'shared', flow: 'expense', name: 'Loyer', icon: null, color: null },
    ]);
    await expect(
      service.createHouseholdCategory('h1', { name: 'loyer', flow: 'expense' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows the same name in a different household', async () => {
    const { service } = makeService([
      { id: 'c1', householdId: 'h1', userId: null, scope: 'shared', flow: 'expense', name: 'Loyer', icon: null, color: null },
    ]);
    await expect(
      service.createHouseholdCategory('h2', { name: 'Loyer', flow: 'expense' }),
    ).resolves.toMatchObject({ householdId: 'h2' });
  });

  it('deletes an unused custom category', async () => {
    const { service, cats } = makeService([
      { id: 'c1', householdId: 'h1', userId: null, scope: 'shared', flow: 'expense', name: 'Animaux', icon: null, color: null },
    ]);
    await service.deleteHouseholdCategory('h1', 'c1');
    expect(cats).toHaveLength(0);
  });

  it('refuses to delete a category in use', async () => {
    const { service, usage } = makeService([
      { id: 'c1', householdId: 'h1', userId: null, scope: 'shared', flow: 'expense', name: 'Animaux', icon: null, color: null },
    ]);
    usage.transaction = 2;
    await expect(service.deleteHouseholdCategory('h1', 'c1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('will not delete another household’s category (404, not cross-tenant)', async () => {
    const { service } = makeService([
      { id: 'c1', householdId: 'h1', userId: null, scope: 'shared', flow: 'expense', name: 'Animaux', icon: null, color: null },
    ]);
    await expect(service.deleteHouseholdCategory('h2', 'c1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('will not delete a global default category', async () => {
    const { service } = makeService([
      { id: 'g1', householdId: null, userId: null, scope: 'shared', flow: 'expense', name: 'Divers', icon: null, color: null },
    ]);
    await expect(service.deleteHouseholdCategory('h1', 'g1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CategoriesService — custom personal categories', () => {
  it('creates a personal category scoped to the user', async () => {
    const { service } = makeService();
    const c = await service.createPersonalCategory('u1', { name: 'Loisirs', flow: 'expense' });
    expect(c).toMatchObject({ userId: 'u1', householdId: null, scope: 'personal', name: 'Loisirs' });
  });

  it('isolates personal categories per user (one user can’t delete another’s)', async () => {
    const { service } = makeService([
      { id: 'c1', householdId: null, userId: 'u1', scope: 'personal', flow: 'expense', name: 'Loisirs', icon: null, color: null },
    ]);
    await expect(service.deletePersonalCategory('u2', 'c1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to delete a personal category referenced by a personal transaction', async () => {
    const { service, usage } = makeService([
      { id: 'c1', householdId: null, userId: 'u1', scope: 'personal', flow: 'expense', name: 'Loisirs', icon: null, color: null },
    ]);
    usage.personalTransaction = 1;
    await expect(service.deletePersonalCategory('u1', 'c1')).rejects.toBeInstanceOf(ConflictException);
  });
});
