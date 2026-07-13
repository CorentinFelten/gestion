import type { Response } from 'express';

/** Name of the httpOnly session cookie (opaque session id). */
export const SESSION_COOKIE = 'gestion_session';

/**
 * Whether to set the `Secure` flag on the session cookie. Decoupled from
 * NODE_ENV (SEC-02): an explicit `COOKIE_SECURE` always wins; otherwise derive
 * from the `APP_URL` scheme (HTTPS ⇒ Secure), secure-by-default when unset.
 */
export function resolveSecureCookies(): boolean {
  const explicit = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (explicit === 'true' || explicit === '1') return true;
  if (explicit === 'false' || explicit === '0') return false;
  return !(process.env.APP_URL ?? '').startsWith('http://');
}

/**
 * Write the session cookie. `expires` is the ROLLING idle deadline (now + idle
 * window); it is re-set on every authenticated request so the browser cookie
 * lifetime tracks activity, matching the server-side idle revocation.
 */
export function setSessionCookie(res: Response, sessionId: string, expires: Date): void {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: resolveSecureCookies(),
    expires,
    path: '/',
  });
}
