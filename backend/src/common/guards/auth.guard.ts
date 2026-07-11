import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestWithUser } from '../types/authenticated-user';

export const SESSION_COOKIE = 'gestion_session';

/**
 * Session-cookie auth guard.
 *
 * Reads the httpOnly session cookie, resolves it to an active, unexpired session
 * whose user is still active, and attaches `req.user` / `req.sessionId` so
 * `@CurrentUser()` works everywhere. Sessions are minted fresh (rotated) on
 * login by `SessionService`; expiry is fixed at creation — there is no sliding
 * renewal on use.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const sessionId = request.cookies?.[SESSION_COOKIE];

    if (!sessionId) {
      throw new UnauthorizedException('No session');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date() || !session.user.isActive) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    request.sessionId = session.id;
    request.user = {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      preferredCurrency: session.user.preferredCurrency,
      locale: session.user.locale,
    };

    return true;
  }
}
