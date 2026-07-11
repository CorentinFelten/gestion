import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import type { PrismaService } from '../../prisma/prisma.service';

/** Minimal in-memory Prisma double covering the user+session surface auth uses. */
function makeFakePrisma() {
  const users = new Map<string, any>();
  const sessions = new Map<string, any>();
  let seq = 0;
  const id = () => `id_${++seq}`;

  return {
    user: {
      findUnique: async ({ where }: any) => {
        if (where.id) return users.get(where.id) ?? null;
        if (where.email) return [...users.values()].find((u) => u.email === where.email) ?? null;
        return null;
      },
      create: async ({ data }: any) => {
        const u = {
          id: id(),
          avatarUrl: null,
          preferredCurrency: 'EUR',
          pinnedCurrencies: [],
          locale: 'en-US',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        users.set(u.id, u);
        return u;
      },
    },
    session: {
      create: async ({ data }: any) => {
        const s = { id: id(), createdAt: new Date(), userAgent: null, ip: null, ...data };
        sessions.set(s.id, s);
        return s;
      },
      deleteMany: async ({ where }: any) => {
        if (where.id) sessions.delete(where.id);
        return { count: 0 };
      },
    },
    _users: users,
    _sessions: sessions,
  };
}

describe('AuthService', () => {
  let fake: ReturnType<typeof makeFakePrisma>;
  let service: AuthService;

  beforeEach(() => {
    fake = makeFakePrisma();
    const sessions = new SessionService(fake as unknown as PrismaService);
    service = new AuthService(fake as unknown as PrismaService, sessions);
  });

  it('hashes the password with argon2id (never stored in plaintext)', async () => {
    await service.register({
      email: 'alice@example.com',
      password: 'sup3rsecret',
      displayName: 'Alice',
    });

    const stored = [...fake._users.values()][0];
    expect(stored.passwordHash).toBeDefined();
    expect(stored.passwordHash).not.toContain('sup3rsecret');
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
    await expect(argon2.verify(stored.passwordHash, 'sup3rsecret')).resolves.toBe(true);
  });

  it('issues a session on register and returns the sanitized user', async () => {
    const res = await service.register({
      email: 'bob@example.com',
      password: 'password123',
      displayName: 'Bob',
      preferredCurrency: 'USD',
    });
    expect(res.sessionId).toBeDefined();
    expect(res.user).not.toHaveProperty('passwordHash');
    expect(res.user.preferredCurrency).toBe('USD');
    expect(new Date(res.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('mints session ids from a CSPRNG (high entropy, base64url, not a cuid)', async () => {
    const sessions = new SessionService(fake as unknown as PrismaService);
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { id } = await sessions.create('user-1');
      // 32 random bytes base64url-encoded => 43 chars, charset [A-Za-z0-9_-].
      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // cuid v1 ids start with 'c' and are ~25 chars, ensure we're not using them.
      expect(id).not.toMatch(/^c[a-z0-9]{24}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(50); // no collisions across draws
  });

  it('rejects duplicate email registration', async () => {
    await service.register({ email: 'dup@example.com', password: 'password123', displayName: 'A' });
    await expect(
      service.register({ email: 'dup@example.com', password: 'password123', displayName: 'B' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('logs in with correct credentials and mints a fresh session (rotation)', async () => {
    const reg = await service.register({
      email: 'carol@example.com',
      password: 'password123',
      displayName: 'Carol',
    });
    const login = await service.login({ email: 'carol@example.com', password: 'password123' });
    expect(login.user.id).toBe(reg.user.id);
    expect(login.sessionId).not.toBe(reg.sessionId); // rotated
  });

  it('rejects a wrong password', async () => {
    await service.register({ email: 'dave@example.com', password: 'password123', displayName: 'Dave' });
    await expect(
      service.login({ email: 'dave@example.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects login for an unknown email (no enumeration)', async () => {
    await expect(
      service.login({ email: 'ghost@example.com', password: 'whatever123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects login for a deactivated account', async () => {
    await service.register({ email: 'eve@example.com', password: 'password123', displayName: 'Eve' });
    [...fake._users.values()][0].isActive = false;
    await expect(
      service.login({ email: 'eve@example.com', password: 'password123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
