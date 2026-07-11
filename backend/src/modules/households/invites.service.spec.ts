import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvitesService } from './invites.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CreateInviteDto } from './dto/household.dto';

/**
 * In-app invitations: an owner/admin invites an EXISTING registered user; the
 * invited user (and only them) may accept or decline. Single-household invariant
 * is enforced both when creating and when accepting.
 */
describe('InvitesService', () => {
  const now = new Date('2026-03-14T10:00:00.000Z');

  // ── create ────────────────────────────────────────────────────────────────
  describe('create', () => {
    function build(opts: {
      target?: { id: string; displayName: string; email: string } | null;
      membership?: { householdId: string } | null;
      pendingInvite?: { id: string } | null;
    }) {
      const prisma = {
        household: { findUnique: jest.fn().mockResolvedValue({ id: 'hh1' }) },
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValue(
              opts.target === undefined
                ? { id: 'u2', displayName: 'Bob', email: 'bob@example.com' }
                : opts.target,
            ),
        },
        householdMember: {
          findFirst: jest.fn().mockResolvedValue(opts.membership ?? null),
        },
        invite: {
          findFirst: jest.fn().mockResolvedValue(opts.pendingInvite ?? null),
          create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({
              id: 'inv1',
              householdId: data.householdId,
              invitedUserId: data.invitedUserId,
              invitedById: data.invitedById,
              role: data.role,
              status: data.status,
              createdAt: now,
              respondedAt: null,
            }),
          ),
        },
      } as unknown as PrismaService;
      return { service: new InvitesService(prisma), prisma };
    }

    const memberDto: CreateInviteDto = { invitedUserId: 'u2', role: 'member' };

    it('invites a registered non-member (success)', async () => {
      const { service, prisma } = build({});
      const invite = await service.create('hh1', memberDto, 'owner', 'u1');
      expect(invite.invitedUser).toEqual({ id: 'u2', displayName: 'Bob', email: 'bob@example.com' });
      expect(invite.role).toBe('member');
      expect(invite.status).toBe('pending');
      expect((prisma.invite.create as jest.Mock)).toHaveBeenCalled();
    });

    it('rejects inviting a user who is already a member of this household', async () => {
      const { service, prisma } = build({ membership: { householdId: 'hh1' } });
      await expect(service.create('hh1', memberDto, 'owner', 'u1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect((prisma.invite.create as jest.Mock)).not.toHaveBeenCalled();
    });

    it('rejects inviting a user already in another household', async () => {
      const { service } = build({ membership: { householdId: 'other' } });
      await expect(service.create('hh1', memberDto, 'owner', 'u1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects a duplicate pending invite', async () => {
      const { service, prisma } = build({ pendingInvite: { id: 'inv0' } });
      await expect(service.create('hh1', memberDto, 'owner', 'u1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect((prisma.invite.create as jest.Mock)).not.toHaveBeenCalled();
    });

    it('rejects when the target user does not exist', async () => {
      const { service } = build({ target: null });
      await expect(service.create('hh1', memberDto, 'owner', 'u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects an admin invite minted by a non-owner (admin caller)', async () => {
      const { service, prisma } = build({});
      await expect(
        service.create('hh1', { invitedUserId: 'u2', role: 'admin' }, 'admin', 'u1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect((prisma.invite.create as jest.Mock)).not.toHaveBeenCalled();
    });

    it('allows an owner to mint an admin invite', async () => {
      const { service } = build({});
      const invite = await service.create('hh1', { invitedUserId: 'u2', role: 'admin' }, 'owner', 'u1');
      expect(invite.role).toBe('admin');
    });

    it('allows an admin to mint a member invite', async () => {
      const { service } = build({});
      const invite = await service.create('hh1', memberDto, 'admin', 'u1');
      expect(invite.role).toBe('member');
    });
  });

  // ── accept ──────────────────────────────────────────────────────────────
  describe('accept', () => {
    function build(opts: {
      invite?: Record<string, unknown> | null;
      membership?: { householdId: string } | null;
    }) {
      const invite =
        opts.invite === undefined
          ? {
              id: 'inv1',
              householdId: 'hh1',
              invitedUserId: 'u2',
              invitedById: 'u1',
              role: 'member',
              status: 'pending',
              createdAt: now,
              respondedAt: null,
            }
          : opts.invite;
      const prisma = {
        invite: {
          findUnique: jest.fn().mockResolvedValue(invite),
          update: jest.fn().mockResolvedValue({}),
        },
        householdMember: {
          findFirst: jest.fn().mockResolvedValue(opts.membership ?? null),
          create: jest.fn().mockResolvedValue({
            userId: 'u2',
            role: 'member',
            joinedAt: now,
            user: { displayName: 'Bob', avatarUrl: null },
          }),
        },
        $transaction: jest.fn(),
      } as unknown as PrismaService;
      (prisma.$transaction as unknown as jest.Mock).mockImplementation((ops: unknown[]) =>
        Promise.all(ops as Promise<unknown>[]),
      );
      return { service: new InvitesService(prisma), prisma };
    }

    it('adds a membership with the invite role and marks the invite accepted', async () => {
      const { service, prisma } = build({});
      const member = await service.accept('inv1', 'u2');
      expect(member.userId).toBe('u2');
      expect(member.role).toBe('member');
      expect((prisma.householdMember.create as jest.Mock)).toHaveBeenCalled();
      expect((prisma.invite.update as jest.Mock)).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'accepted' }) }),
      );
    });

    it('rejects (404) when a different user tries to accept', async () => {
      const { service, prisma } = build({});
      await expect(service.accept('inv1', 'someone-else')).rejects.toBeInstanceOf(NotFoundException);
      expect((prisma.householdMember.create as jest.Mock)).not.toHaveBeenCalled();
    });

    it('rejects (404) when the invite is not pending', async () => {
      const { service } = build({
        invite: {
          id: 'inv1',
          householdId: 'hh1',
          invitedUserId: 'u2',
          invitedById: 'u1',
          role: 'member',
          status: 'declined',
          createdAt: now,
          respondedAt: now,
        },
      });
      await expect(service.accept('inv1', 'u2')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects (404) when the invite does not exist', async () => {
      const { service } = build({ invite: null });
      await expect(service.accept('inv1', 'u2')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('enforces the single-household invariant', async () => {
      const { service, prisma } = build({ membership: { householdId: 'other' } });
      await expect(service.accept('inv1', 'u2')).rejects.toBeInstanceOf(ConflictException);
      expect((prisma.householdMember.create as jest.Mock)).not.toHaveBeenCalled();
    });
  });

  // ── decline ─────────────────────────────────────────────────────────────
  describe('decline', () => {
    function build(invitedUserId: string, status = 'pending') {
      const prisma = {
        invite: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'inv1',
            householdId: 'hh1',
            invitedUserId,
            invitedById: 'u1',
            role: 'member',
            status,
            createdAt: now,
            respondedAt: null,
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      } as unknown as PrismaService;
      return { service: new InvitesService(prisma), prisma };
    }

    it('sets the invite declined for the invited user', async () => {
      const { service, prisma } = build('u2');
      const res = await service.decline('inv1', 'u2');
      expect(res.status).toBe('declined');
      expect((prisma.invite.update as jest.Mock)).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'declined' }) }),
      );
    });

    it('rejects (404) when a different user tries to decline', async () => {
      const { service, prisma } = build('u2');
      await expect(service.decline('inv1', 'intruder')).rejects.toBeInstanceOf(NotFoundException);
      expect((prisma.invite.update as jest.Mock)).not.toHaveBeenCalled();
    });
  });
});
