/**
 * Shared French vocabulary maps, enum→label helpers and curated pickers.
 * France French terminology. These are pure functions (no hook needed) so they
 * can be used anywhere. Import the `*Options` arrays to drive `<select>`s.
 */
import type {
  AccountType,
  Country,
  PersonalTxnType,
  Role,
  SplitType,
} from '@/types';

// ── Account types ─────────────────────────────────────────────────────────────
const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Compte courant',
  savings: "Compte d'épargne",
  cash: 'Espèces',
  credit_card: 'Carte de crédit',
  investment: 'Placements',
  other: 'Autre',
};

/** Display order for account-type pickers. */
export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  'checking',
  'savings',
  'cash',
  'credit_card',
  'investment',
  'other',
];

export function accountTypeLabel(type: AccountType | string): string {
  return ACCOUNT_TYPE_LABELS[type as AccountType] ?? String(type);
}

/** `{ value, label }` list in display order for account-type `<select>`s. */
export const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] =
  ACCOUNT_TYPE_ORDER.map((value) => ({ value, label: ACCOUNT_TYPE_LABELS[value] }));

/** Liability account types (credit cards) subtract from net worth. */
export function isLiabilityAccount(type: AccountType | string): boolean {
  return type === 'credit_card';
}

// ── Countries ─────────────────────────────────────────────────────────────────
const COUNTRY_LABELS: Record<Country, string> = {
  FR: 'France',
  CA: 'Canada',
};

const COUNTRY_DEFAULT_CURRENCY: Record<Country, string> = {
  FR: 'EUR',
  CA: 'CAD',
};

/** Display order for the account-form country picker. */
export const COUNTRY_ORDER: Country[] = ['FR', 'CA'];

export function countryLabel(code: Country | string): string {
  return COUNTRY_LABELS[code as Country] ?? String(code);
}

/** Default currency a country implies for a new personal account. */
export function countryDefaultCurrency(code: Country | string): string {
  return COUNTRY_DEFAULT_CURRENCY[code as Country] ?? 'EUR';
}

export const COUNTRY_OPTIONS: { value: Country; label: string }[] = COUNTRY_ORDER.map(
  (value) => ({ value, label: COUNTRY_LABELS[value] }),
);

// ── Currencies ────────────────────────────────────────────────────────────────
const CURRENCY_LABELS: Record<string, string> = {
  CAD: 'Dollar canadien',
  EUR: 'Euro',
  USD: 'Dollar américain',
  GBP: 'Livre sterling',
  CHF: 'Franc suisse',
  JPY: 'Yen japonais',
  AUD: 'Dollar australien',
  SEK: 'Couronne suédoise',
  NOK: 'Couronne norvégienne',
  DKK: 'Couronne danoise',
  PLN: 'Zloty polonais',
  CZK: 'Couronne tchèque',
};

/**
 * Featured currency codes in picker order, CAD & EUR first, then the common
 * majors. Codes not in this list are still valid; look them up via
 * `currencyLabel` (falls back to the code).
 */
export const CURRENCIES: string[] = [
  'CAD',
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'JPY',
  'AUD',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
];

export function currencyLabel(code: string): string {
  return CURRENCY_LABELS[code?.toUpperCase()] ?? code;
}

/** `{ value, label }` list (e.g. `EUR, Euro`) in featured order for `<select>`s. */
export const CURRENCY_OPTIONS: { value: string; label: string }[] = CURRENCIES.map(
  (value) => ({ value, label: `${value}, ${currencyLabel(value)}` }),
);

export interface CurrencyOption {
  value: string;
  label: string;
}

/**
 * Order a base list of currency codes so the user's pinned codes come FIRST (in
 * the user's pinned order), followed by the remaining base codes in their given
 * order. Everything is uppercased and de-duplicated; pinned codes absent from
 * the base list are still surfaced on top.
 */
export function orderCurrenciesByPinned(
  base: readonly string[],
  pinned: readonly string[] | null | undefined,
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (raw: string | null | undefined) => {
    const code = raw?.trim().toUpperCase();
    if (!code || seen.has(code)) return;
    seen.add(code);
    ordered.push(code);
  };
  (pinned ?? []).forEach(push);
  base.forEach(push);
  return ordered;
}

/** Split a base list into `{ pinned, rest }` (uppercased, deduped) for optgroups. */
export function splitCurrenciesByPinned(
  base: readonly string[],
  pinned: readonly string[] | null | undefined,
): { pinned: string[]; rest: string[] } {
  const pinnedSet = new Set((pinned ?? []).map((c) => c?.trim().toUpperCase()).filter(Boolean));
  const seen = new Set<string>();
  const pinnedCodes: string[] = [];
  const rest: string[] = [];
  // Pinned first, in the user's pinned order.
  for (const raw of pinned ?? []) {
    const code = raw?.trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    pinnedCodes.push(code);
  }
  for (const raw of base) {
    const code = raw?.trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    (pinnedSet.has(code) ? pinnedCodes : rest).push(code);
  }
  return { pinned: pinnedCodes, rest };
}

/** Build `{ value, label }` options (e.g. `EUR, Euro`) from ordered codes. */
export function currencyOptionsFrom(codes: readonly string[]): CurrencyOption[] {
  return codes.map((value) => ({ value, label: `${value}, ${currencyLabel(value)}` }));
}

/**
 * `{ value, label }` options ordered pinned-first, the pure convenience behind
 * the `usePinnedCurrencyOptions` hook. Defaults its base list to `CURRENCIES`.
 */
export function pinnedCurrencyOptions(
  pinned: readonly string[] | null | undefined,
  base: readonly string[] = CURRENCIES,
): CurrencyOption[] {
  return currencyOptionsFrom(orderCurrenciesByPinned(base, pinned));
}

// ── Personal transaction types ────────────────────────────────────────────────
const PERSONAL_TX_TYPE_LABELS: Record<PersonalTxnType, string> = {
  income: 'Revenu',
  expense: 'Dépense',
  transfer: 'Virement',
};

export const PERSONAL_TX_TYPE_ORDER: PersonalTxnType[] = ['income', 'expense', 'transfer'];

export function personalTxTypeLabel(type: PersonalTxnType | string): string {
  return PERSONAL_TX_TYPE_LABELS[type as PersonalTxnType] ?? String(type);
}

export const PERSONAL_TX_TYPE_OPTIONS: { value: PersonalTxnType; label: string }[] =
  PERSONAL_TX_TYPE_ORDER.map((value) => ({ value, label: PERSONAL_TX_TYPE_LABELS[value] }));

// ── Split types (shared-expense editor) ───────────────────────────────────────
const SPLIT_TYPE_LABELS: Record<SplitType, string> = {
  equal: 'Parts égales',
  exact: 'Montants exacts',
  percent: 'Pourcentages',
  shares: 'Parts',
};

export const SPLIT_TYPE_ORDER: SplitType[] = ['equal', 'exact', 'percent', 'shares'];

export function splitTypeLabel(type: SplitType | string): string {
  return SPLIT_TYPE_LABELS[type as SplitType] ?? String(type);
}

export const SPLIT_TYPE_OPTIONS: { value: SplitType; label: string }[] = SPLIT_TYPE_ORDER.map(
  (value) => ({ value, label: SPLIT_TYPE_LABELS[value] }),
);

// ── Roles ─────────────────────────────────────────────────────────────────────
const ROLE_LABELS: Record<Role, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  member: 'Membre',
};

export function roleLabel(role: Role | string): string {
  return ROLE_LABELS[role as Role] ?? String(role);
}

// ── Legacy category names (English default seeds → French) ────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  Groceries: 'Alimentation',
  Food: 'Alimentation',
  Electricity: 'Électricité',
  Water: 'Eau',
  Gas: 'Gaz',
  Rent: 'Loyer',
  Internet: 'Internet',
  Trips: 'Voyages',
  Travel: 'Voyages',
  Restaurants: 'Restaurants',
  Dining: 'Restaurants',
  Transport: 'Transport',
  Transportation: 'Transport',
  Other: 'Divers',
  Miscellaneous: 'Divers',
  Salary: 'Salaire',
  Income: 'Revenu',
  Reimbursement: 'Remboursement',
  Refund: 'Remboursement',
  Health: 'Santé',
  Insurance: 'Assurance',
  Entertainment: 'Loisirs',
  Shopping: 'Achats',
};

/**
 * Map a known English default category name to French. Names not in the map
 * (including already-French ones the backend now seeds) pass through unchanged.
 */
export function categoryLabel(name: string | null | undefined): string {
  if (!name) return '';
  return CATEGORY_LABELS[name] ?? name;
}
