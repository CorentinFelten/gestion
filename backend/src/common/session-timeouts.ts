/**
 * Session idle-timeout policy (shared by the AuthGuard and SessionService).
 *
 * Sessions are revoked a fixed window after the LAST registered activity (a
 * sliding/idle timeout), independent of how many sessions a user has open. Each
 * authenticated request registers activity by advancing `lastActivityAt`; the
 * guard rejects a session once `now - lastActivityAt` exceeds this window.
 */

/** Idle window in ms (default 30 min, override with SESSION_IDLE_MINUTES). */
export function sessionIdleMs(): number {
  const minutes = Number(process.env.SESSION_IDLE_MINUTES ?? 30);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;
}

/**
 * Only persist a new `lastActivityAt` once the stored one is older than this,
 * so a burst of requests doesn't write on every call. Kept far below the idle
 * window, so the enforced timeout stays accurate to within this slack.
 */
export const SESSION_ACTIVITY_THROTTLE_MS = 60 * 1000;
