import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestWithUser } from '../types/authenticated-user';

/**
 * Ensures the authenticated user is a member of the household referenced by the
 * route param (`:id` or `:householdId`). Attaches the membership role to the
 * request as `req.householdRole` for RoleGuard. Must run AFTER AuthGuard.
 *
 * REAL skeleton, the households feature agent may refine param resolution, but
 * the guarantee (membership enforced, role attached) is the shared contract.
 */
@Injectable()
export class HouseholdMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      RequestWithUser & { householdRole?: Role; householdId?: string }
    >();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('Not authenticated');
    }

    const params = request.params as Record<string, string | undefined>;
    const householdId: string | undefined = params?.householdId ?? params?.id;
    if (!householdId) {
      throw new ForbiddenException('No household in scope');
    }

    const membership = await this.prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId: user.id } },
    });
    if (!membership) {
      throw new ForbiddenException('Not a member of this household');
    }

    request.householdId = householdId;
    request.householdRole = membership.role;
    return true;
  }
}
