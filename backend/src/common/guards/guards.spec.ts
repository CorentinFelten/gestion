import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { HouseholdMemberGuard } from './household-member.guard';
import { RoleGuard } from './role.guard';
import { CsrfGuard, CSRF_COOKIE } from './csrf.guard';
import type { PrismaService } from '../../prisma/prisma.service';

function contextFor(request: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);
  const recent = new Date(Date.now() - 5_000); // active 5s ago (within idle window)
  const longIdle = new Date(Date.now() - 31 * 60 * 1000); // idle 31 min (past the 30-min window)

  const buildGuard = (session: any) => {
    const update = jest.fn().mockResolvedValue(session);
    const guard = new AuthGuard({
      session: { findUnique: async () => session, update },
    } as unknown as PrismaService);
    return { guard, update };
  };

  it('rejects when no session cookie is present', async () => {
    const { guard } = buildGuard(null);
    await expect(guard.canActivate(contextFor({ cookies: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired session', async () => {
    const { guard } = buildGuard({
      id: 's1',
      expiresAt: past,
      lastActivityAt: recent,
      user: { id: 'u1', isActive: true, email: 'a@b.c', displayName: 'A', preferredCurrency: 'EUR', locale: 'en-US' },
    });
    await expect(
      guard.canActivate(contextFor({ cookies: { gestion_session: 's1' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a session idle beyond the timeout window', async () => {
    const { guard } = buildGuard({
      id: 's1',
      expiresAt: future, // absolute cap fine…
      lastActivityAt: longIdle, // …but idle > 30 min
      user: { id: 'u1', isActive: true, email: 'a@b.c', displayName: 'A', preferredCurrency: 'EUR', locale: 'en-US' },
    });
    await expect(
      guard.canActivate(contextFor({ cookies: { gestion_session: 's1' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an inactive user', async () => {
    const { guard } = buildGuard({
      id: 's1',
      expiresAt: future,
      lastActivityAt: recent,
      user: { id: 'u1', isActive: false, email: 'a@b.c', displayName: 'A', preferredCurrency: 'EUR', locale: 'en-US' },
    });
    await expect(
      guard.canActivate(contextFor({ cookies: { gestion_session: 's1' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a valid session and attaches req.user + req.sessionId', async () => {
    const { guard } = buildGuard({
      id: 's1',
      expiresAt: future,
      lastActivityAt: recent,
      user: { id: 'u1', isActive: true, email: 'a@b.c', displayName: 'Alice', preferredCurrency: 'EUR', locale: 'en-US' },
    });
    const req: any = { cookies: { gestion_session: 's1' } };
    await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
    expect(req.user).toEqual({
      id: 'u1',
      email: 'a@b.c',
      displayName: 'Alice',
      preferredCurrency: 'EUR',
      locale: 'en-US',
    });
    expect(req.sessionId).toBe('s1');
  });

  it('registers activity (slides lastActivityAt) once past the throttle', async () => {
    const staleButValid = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago: valid, past throttle
    const { guard, update } = buildGuard({
      id: 's1',
      expiresAt: future,
      lastActivityAt: staleButValid,
      user: { id: 'u1', isActive: true, email: 'a@b.c', displayName: 'A', preferredCurrency: 'EUR', locale: 'en-US' },
    });
    await expect(
      guard.canActivate(contextFor({ cookies: { gestion_session: 's1' } })),
    ).resolves.toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].where).toEqual({ id: 's1' });
  });

  it('does not write on a very recent request (throttled)', async () => {
    const { guard, update } = buildGuard({
      id: 's1',
      expiresAt: future,
      lastActivityAt: recent, // 5s ago, under the 60s throttle
      user: { id: 'u1', isActive: true, email: 'a@b.c', displayName: 'A', preferredCurrency: 'EUR', locale: 'en-US' },
    });
    await guard.canActivate(contextFor({ cookies: { gestion_session: 's1' } }));
    expect(update).not.toHaveBeenCalled();
  });
});

describe('HouseholdMemberGuard', () => {
  const buildGuard = (membership: any) =>
    new HouseholdMemberGuard({
      householdMember: { findUnique: async () => membership },
    } as unknown as PrismaService);

  it('rejects a non-member with 403', async () => {
    const guard = buildGuard(null);
    const req: any = { user: { id: 'u1' }, params: { id: 'h1' } };
    await expect(guard.canActivate(contextFor(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a member and attaches role', async () => {
    const guard = buildGuard({ role: 'admin' });
    const req: any = { user: { id: 'u1' }, params: { id: 'h1' } };
    await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
    expect(req.householdRole).toBe('admin');
    expect(req.householdId).toBe('h1');
  });

  it('rejects when unauthenticated', async () => {
    const guard = buildGuard({ role: 'member' });
    const req: any = { params: { id: 'h1' } };
    await expect(guard.canActivate(contextFor(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('RoleGuard', () => {
  const buildGuard = (required: string[] | undefined) =>
    new RoleGuard({
      getAllAndOverride: () => required,
    } as unknown as Reflector);

  it('passes through when no roles are required', () => {
    const guard = buildGuard(undefined);
    expect(guard.canActivate(contextFor({ householdRole: 'member' }))).toBe(true);
  });

  it('allows a user whose role is in the allow-list', () => {
    const guard = buildGuard(['owner', 'admin']);
    expect(guard.canActivate(contextFor({ householdRole: 'admin' }))).toBe(true);
  });

  it('rejects a user whose role is insufficient', () => {
    const guard = buildGuard(['owner', 'admin']);
    expect(() => guard.canActivate(contextFor({ householdRole: 'member' }))).toThrow(
      ForbiddenException,
    );
  });
});

describe('CsrfGuard (double-submit)', () => {
  const guard = new CsrfGuard();

  it('is a no-op for safe methods', () => {
    expect(guard.canActivate(contextFor({ method: 'GET', headers: {}, cookies: {} }))).toBe(true);
  });

  it('accepts a matching cookie + header on a mutating request', () => {
    const req = {
      method: 'POST',
      cookies: { [CSRF_COOKIE]: 'tok-123' },
      headers: { 'x-csrf-token': 'tok-123' },
    };
    expect(guard.canActivate(contextFor(req))).toBe(true);
  });

  it('rejects when the header is missing', () => {
    const req = { method: 'POST', cookies: { [CSRF_COOKIE]: 'tok-123' }, headers: {} };
    expect(() => guard.canActivate(contextFor(req))).toThrow(ForbiddenException);
  });

  it('rejects when cookie and header do not match', () => {
    const req = {
      method: 'DELETE',
      cookies: { [CSRF_COOKIE]: 'tok-123' },
      headers: { 'x-csrf-token': 'tok-999' },
    };
    expect(() => guard.canActivate(contextFor(req))).toThrow(ForbiddenException);
  });
});
