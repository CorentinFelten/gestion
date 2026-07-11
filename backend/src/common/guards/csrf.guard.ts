import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Double-submit-token CSRF protection (PLAN.md §9). Since auth is cookie-based,
 * every state-changing request must echo the readable CSRF cookie back in the
 * `X-CSRF-Token` header; a cross-site attacker can send the cookie but cannot
 * read it to set the matching header (same-origin policy), so the two won't match.
 *
 * Flow: client calls `GET /auth/csrf` → server sets `gestion_csrf` (readable,
 * NOT httpOnly) → client sends the value in `X-CSRF-Token` on POST/PATCH/PUT/DELETE.
 *
 * Wire onto mutating routes with `@UseGuards(CsrfGuard)`. Safe methods are exempt.
 */

export const CSRF_COOKIE = 'gestion_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Generate a fresh, unguessable CSRF token (hex-encoded 32 random bytes). */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = (request.method ?? 'GET').toUpperCase();
    if (SAFE_METHODS.has(method)) {
      return true;
    }

    const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
    const cookieToken = cookies?.[CSRF_COOKIE];
    const rawHeader = request.headers[CSRF_HEADER];
    const headerToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!cookieToken || !headerToken || !constantTimeEquals(cookieToken, headerToken)) {
      throw new ForbiddenException('Invalid or missing CSRF token');
    }
    return true;
  }
}
