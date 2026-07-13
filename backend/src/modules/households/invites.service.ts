import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateInviteDto,
  InvitableUserDto,
  InviteDto,
  MemberDto,
  ReceivedInviteDto,
} from './dto/household.dto';

@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a pending in-app invite for an EXISTING registered user.
   * Enforces: target exists, is not already a member, is not in ANY household
   * (single-household invariant, PLAN.md §12), has no existing pending invite
   * for this household, and only an owner may invite as `admin` (SEC-03-style).
   */
  async create(
    householdId: string,
    dto: CreateInviteDto,
    callerRole: Role,
    invitedById: string,
  ): Promise<InviteDto> {
    const role: Role = dto.role ?? 'member';

    // Only a household owner may grant `admin`; a mere admin cannot escalate.
    if (role === 'admin' && callerRole !== 'owner') {
      throw new ForbiddenException('Only the household owner can invite an admin');
    }

    const household = await this.prisma.household.findUnique({ where: { id: householdId } });
    if (!household) {
      throw new NotFoundException('Household not found');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: dto.invitedUserId },
      select: { id: true, displayName: true, email: true },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }

    // Single-household invariant: the target must not already belong to a household
    // (this also covers "already a member of THIS household").
    const existingMembership = await this.prisma.householdMember.findFirst({
      where: { userId: target.id },
    });
    if (existingMembership) {
      if (existingMembership.householdId === householdId) {
        throw new ConflictException('User is already a member of this household');
      }
      throw new ConflictException('User already belongs to a household');
    }

    // Reject a duplicate pending invite for the same user + household.
    const existingInvite = await this.prisma.invite.findFirst({
      where: { householdId, invitedUserId: target.id, status: 'pending' },
    });
    if (existingInvite) {
      throw new ConflictException('A pending invite already exists for this user');
    }

    const invite = await this.prisma.invite.create({
      data: { householdId, invitedUserId: target.id, invitedById, role, status: 'pending' },
    });

    return {
      id: invite.id,
      invitedUser: { id: target.id, displayName: target.displayName, email: target.email },
      role: invite.role,
      status: invite.status,
      createdAt: invite.createdAt.toISOString(),
    };
  }

  /**
   * Registered users who can be invited to this household: they have NO household
   * membership AND no pending invite to this household. Email is returned so the
   * owner/admin can pick the right person.
   */
  async invitableUsers(householdId: string): Promise<InvitableUserDto[]> {
    const [memberships, pending] = await Promise.all([
      this.prisma.householdMember.findMany({ select: { userId: true } }),
      this.prisma.invite.findMany({
        where: { householdId, status: 'pending' },
        select: { invitedUserId: true },
      }),
    ]);
    const excluded = new Set<string>([
      ...memberships.map((m) => m.userId),
      ...pending.map((p) => p.invitedUserId),
    ]);

    const users = await this.prisma.user.findMany({
      where: { isActive: true, id: { notIn: Array.from(excluded) } },
      select: { id: true, displayName: true, email: true },
      orderBy: { displayName: 'asc' },
    });
    return users.map((u) => ({ id: u.id, displayName: u.displayName, email: u.email }));
  }

  /** Pending invites sent for this household (owner/admin management view). */
  async listSent(householdId: string): Promise<InviteDto[]> {
    const invites = await this.prisma.invite.findMany({
      where: { householdId, status: 'pending' },
      include: { invitedUser: { select: { id: true, displayName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((inv) => ({
      id: inv.id,
      invitedUser: {
        id: inv.invitedUser.id,
        displayName: inv.invitedUser.displayName,
        email: inv.invitedUser.email,
      },
      role: inv.role,
      status: inv.status,
      createdAt: inv.createdAt.toISOString(),
    }));
  }

  /** Revoke a PENDING invite (owner/admin). Never touches accepted/declined history. */
  async revoke(householdId: string, inviteId: string): Promise<void> {
    const invite = await this.prisma.invite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.householdId !== householdId || invite.status !== 'pending') {
      throw new NotFoundException('Invite not found');
    }
    await this.prisma.invite.delete({ where: { id: inviteId } });
  }

  /** The current user's PENDING received invites. */
  async listReceived(userId: string): Promise<ReceivedInviteDto[]> {
    const invites = await this.prisma.invite.findMany({
      where: { invitedUserId: userId, status: 'pending' },
      include: {
        household: { select: { id: true, name: true } },
        invitedBy: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((inv) => ({
      id: inv.id,
      household: { id: inv.household.id, name: inv.household.name },
      invitedByName: inv.invitedBy.displayName,
      role: inv.role,
      createdAt: inv.createdAt.toISOString(),
    }));
  }

  /**
   * Accept a pending invite, only the invited user may do so. Enforces the
   * single-household invariant and, on success, creates the membership with the
   * invite's role and marks the invite accepted, atomically.
   */
  async accept(inviteId: string, userId: string): Promise<MemberDto> {
    const invite = await this.prisma.invite.findUnique({ where: { id: inviteId } });
    // Respond as if it doesn't exist unless it's this user's own pending invite,
    // so we never leak the existence of invites addressed to others.
    if (!invite || invite.invitedUserId !== userId || invite.status !== 'pending') {
      throw new NotFoundException('Invite not found');
    }

    // Single-household invariant (PLAN.md §12): a user belongs to exactly one.
    const existingMembership = await this.prisma.householdMember.findFirst({ where: { userId } });
    if (existingMembership) {
      throw new ConflictException('User already belongs to a household');
    }

    const [member] = await this.prisma.$transaction([
      this.prisma.householdMember.create({
        data: { householdId: invite.householdId, userId, role: invite.role },
        include: { user: { select: { displayName: true, avatarUrl: true } } },
      }),
      this.prisma.invite.update({
        where: { id: invite.id },
        data: { status: 'accepted', respondedAt: new Date() },
      }),
    ]);

    return {
      userId: member.userId,
      displayName: member.user.displayName,
      avatarUrl: member.user.avatarUrl,
      role: member.role,
      joinedAt: member.joinedAt.toISOString(),
    };
  }

  /** Decline a pending invite, only the invited user may do so. */
  async decline(inviteId: string, userId: string): Promise<{ id: string; status: 'declined' }> {
    const invite = await this.prisma.invite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.invitedUserId !== userId || invite.status !== 'pending') {
      throw new NotFoundException('Invite not found');
    }
    await this.prisma.invite.update({
      where: { id: invite.id },
      data: { status: 'declined', respondedAt: new Date() },
    });
    return { id: invite.id, status: 'declined' };
  }
}
