import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestWithUser } from '../types/authenticated-user';
import { SESSION_ACTIVITY_THROTTLE_MS, sessionIdleMs } from '../session-timeouts';
import { SESSION_COOKIE, setSessionCookie } from '../session-cookie';

export { SESSION_COOKIE };

/**
 * Session-cookie auth guard.
 *
 * Reads the httpOnly session cookie, resolves it to an active session whose user
 * is still active, and attaches `req.user` / `req.sessionId` so `@CurrentUser()`
 * works everywhere. Sessions enforce a SLIDING idle timeout: a session is
 * rejected once it has been idle longer than the window (SESSION_IDLE_MINUTES),
 * and every authenticated request registers activity by advancing
 * `lastActivityAt` (throttled). Multiple concurrent sessions are independent —
 * each ages by its own last activity. `expiresAt` remains an absolute cap.
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

    const now = new Date();
    if (!session || session.expiresAt < now || !session.user.isActive) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Sliding idle timeout: revoke once idle beyond the window.
    const idleMs = sessionIdleMs();
    const idleForMs = now.getTime() - session.lastActivityAt.getTime();
    if (idleForMs > idleMs) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Register activity, throttled so a burst doesn't write on every request.
    if (idleForMs > SESSION_ACTIVITY_THROTTLE_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastActivityAt: now },
      });
    }

    // Roll the client cookie forward so its lifetime tracks activity too (the
    // browser then drops it on idle, matching the server-side revocation). This
    // is a response header only; the logout handler's clearCookie still wins as
    // it is appended afterwards.
    const response = context.switchToHttp().getResponse<Response>();
    if (typeof response?.cookie === 'function') {
      setSessionCookie(response, session.id, new Date(now.getTime() + idleMs));
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
