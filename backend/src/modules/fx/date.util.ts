/**
 * ISO date (YYYY-MM-DD) helpers. All dates are handled as UTC calendar days,
 * we never carry a time-of-day for FX. ECB/rate dates are calendar days.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `s` is a syntactically valid, real YYYY-MM-DD calendar date. */
export function isValidDateISO(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's UTC calendar day as YYYY-MM-DD. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The calendar day before `s` (YYYY-MM-DD). */
export function prevDayISO(s: string): string {
  const d = new Date(`${s}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** A `Date` at UTC midnight for a YYYY-MM-DD string (matches Prisma `@db.Date`). */
export function toUtcDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** YYYY-MM-DD for a `Date` returned by Prisma (`@db.Date`, UTC midnight). */
export function dateToISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
