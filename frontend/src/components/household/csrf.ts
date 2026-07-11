/**
 * Best-effort CSRF support for the cookie-based session (PLAN.md §9, double-submit).
 * We fetch a token from `GET /auth/csrf` once and attach it as `X-CSRF-Token` on
 * state-changing requests. If the backend doesn't (yet) expose the endpoint, we
 * degrade gracefully, the request proceeds without the header rather than failing.
 */
import { api } from '@/lib/api';

let cached: string | null = null;

async function fetchToken(): Promise<string | null> {
  if (cached) return cached;
  try {
    const { data } = await api.get<{ csrfToken?: string; token?: string }>('/auth/csrf');
    cached = data.csrfToken ?? data.token ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Header object to spread into a mutating axios call. Never throws. */
export async function csrfHeaders(): Promise<Record<string, string>> {
  const token = await fetchToken();
  return token ? { 'X-CSRF-Token': token } : {};
}

/** Drop the cached token (e.g. after logout) so the next mutation refetches it. */
export function resetCsrf(): void {
  cached = null;
}
