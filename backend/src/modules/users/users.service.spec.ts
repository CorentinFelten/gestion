import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateProfileSchema, MAX_PINNED_CURRENCIES } from './dto/user.dto';
import type { PrismaService } from '../../prisma/prisma.service';

/** Minimal in-memory Prisma double covering the user surface UsersService uses. */
function makeFakePrisma() {
  const users = new Map<string, any>();
  users.set('u1', {
    id: 'u1',
    email: 'alice@example.com',
    displayName: 'Alice',
    avatarUrl: null,
    preferredCurrency: 'EUR',
    pinnedCurrencies: [],
    locale: 'fr-FR',
  });

  return {
    user: {
      findUnique: async ({ where, select }: any) => {
        const u = users.get(where.id);
        if (!u) return null;
        if (!select) return u;
        const out: any = {};
        for (const k of Object.keys(select)) out[k] = u[k];
        return out;
      },
      update: async ({ where, data, select }: any) => {
        const u = users.get(where.id);
        if (!u) throw new Error('P2025');
        Object.assign(u, data);
        if (!select) return u;
        const out: any = {};
        for (const k of Object.keys(select)) out[k] = u[k];
        return out;
      },
    },
    _users: users,
  };
}

describe('UsersService, pinnedCurrencies', () => {
  let fake: ReturnType<typeof makeFakePrisma>;
  let service: UsersService;

  beforeEach(() => {
    fake = makeFakePrisma();
    service = new UsersService(fake as unknown as PrismaService);
  });

  it('getProfile returns pinnedCurrencies', async () => {
    fake._users.get('u1').pinnedCurrencies = ['CAD', 'EUR'];
    const profile = await service.getProfile('u1');
    expect(profile.pinnedCurrencies).toEqual(['CAD', 'EUR']);
  });

  it('updateProfile persists and returns pinnedCurrencies', async () => {
    const profile = await service.updateProfile('u1', { pinnedCurrencies: ['USD', 'GBP'] });
    expect(profile.pinnedCurrencies).toEqual(['USD', 'GBP']);
    expect(fake._users.get('u1').pinnedCurrencies).toEqual(['USD', 'GBP']);
  });

  it('updateProfile 404s for an unknown user', async () => {
    await expect(
      service.updateProfile('ghost', { pinnedCurrencies: ['EUR'] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UpdateProfileSchema, pinnedCurrencies validation', () => {
  it('uppercases and de-duplicates codes', () => {
    const parsed = UpdateProfileSchema.parse({ pinnedCurrencies: ['eur', 'EUR', 'cad'] });
    expect(parsed.pinnedCurrencies).toEqual(['EUR', 'CAD']);
  });

  it('accepts an empty list (clears pins)', () => {
    const parsed = UpdateProfileSchema.parse({ pinnedCurrencies: [] });
    expect(parsed.pinnedCurrencies).toEqual([]);
  });

  it('rejects an unknown currency code', () => {
    const res = UpdateProfileSchema.safeParse({ pinnedCurrencies: ['EUR', 'ZZZ'] });
    expect(res.success).toBe(false);
  });

  it('rejects an over-cap list', () => {
    const tooMany = Array.from({ length: MAX_PINNED_CURRENCIES + 1 }, () => 'EUR');
    const res = UpdateProfileSchema.safeParse({ pinnedCurrencies: tooMany });
    expect(res.success).toBe(false);
  });
});
