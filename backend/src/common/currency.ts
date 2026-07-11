// ISO-4217 currency validation for user/household input.
//
// The canonical set is the FX-supported list (`SUPPORTED_CURRENCIES`, what the FX
// providers can actually quote). We derive from it so input validation and FX
// coverage can never diverge: a currency a user can pick as their preferred /
// pinned / household base is always one the FX service can convert.
import { SUPPORTED_CURRENCIES } from '../modules/fx/currencies';

export const ISO_4217_CURRENCIES: ReadonlySet<string> = new Set(SUPPORTED_CURRENCIES);

/** True when `code` is a syntactically valid, recognized ISO-4217 currency. */
export function isValidCurrency(code: unknown): boolean {
  return typeof code === 'string' && ISO_4217_CURRENCIES.has(code.toUpperCase());
}
