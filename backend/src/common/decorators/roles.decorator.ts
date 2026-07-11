import { SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restrict a household route to members with one of the given roles.
 * Must be used together with HouseholdMemberGuard + RoleGuard.
 * Usage: `@Roles('owner', 'admin')`
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
