import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedUser, RequestWithUser } from '../types/authenticated-user';

/**
 * Inject the authenticated user (populated by AuthGuard).
 * Usage: `myRoute(@CurrentUser() user: AuthenticatedUser) { ... }`
 * Pass a field name to project a single property: `@CurrentUser('id') userId: string`
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('Not authenticated');
    }
    return data ? user[data] : user;
  },
);
