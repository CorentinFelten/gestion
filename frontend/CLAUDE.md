# CLAUDE.md, Frontend (React SPA)

Scoped guidance for `/frontend`. Read the **root `CLAUDE.md`** first for domain concepts and the QA process. This file is the tactical guide for the UI.

## Stack
**Vite 8** (Rolldown bundler) · **React 18.3** · TypeScript · **Tailwind 3.4** · **TanStack Query** · **React Router 7** · **Recharts** · decimal.js · date-fns · zod. Single-origin; talks to `/api/v1` via `src/lib/api.ts` (axios, `withCredentials`).

## Directory map (`src/`)
| Path | What |
|---|---|
| `pages/` | Route components: `Login, Register, Dashboard, Transactions, Tally, SettleUp, Reports, Settings` (household) · `MoneyOverviewPage, MoneyAccountsPage, MoneyAddPage, MoneyStatsPage` (personal). |
| `components/household/**` | Household UI + `SplitEditor`, `TransactionModal`, `SettlementModal`, `TallyStrip`, `ReceivedInvites` (accept/refuse), scoped `format.ts` (non-formatting helpers only now), `household.css`. |
| `components/money/**` | «Mon argent» UI + `NetWorthStatement`, `AccountLedger`, charts. |
| `components/Layout.tsx` | App shell + responsive nav (desktop sidebar / mobile drawer). Uses i18n `nav.*` keys. |
| `i18n/**` | **The localization system**, see below. |
| `hooks/` | TanStack Query hooks: `useHousehold` (+ `useCreateHousehold`), `useTransactions`, `useTally`, `useSettlements`, `useReports`, `useSettings`, `useAccounts`, `usePersonalTx`, `useNetWorth`, `usePersonalStats`, **`useInvites`** (received/accept/decline + invitable-users/sent/create/revoke), **`usePinnedCurrencies`** (`usePinnedCurrencyOptions`). |
| `lib/api.ts` | axios instance (base `/api/v1`, `withCredentials`). **Frozen**, don't change. |
| `types/index.ts` | Shared API DTO types (the frontend contract). Append-only. |

## i18n, all UI text goes through `@/i18n` (non-negotiable)
```ts
const { t, plural } = useT();     t('transactions.addTitle')          // French string
const f = useFormat();            f.money(amount, currency)           // locale-aware output
const { locale, setLocale } = useLocale();                            // 'fr-FR' | 'fr-CA'
```
- **Never hardcode** user-facing English, `en-US`, `toLocaleString('en-US')`, `MM/DD/YYYY`, or a currency symbol (`$`/`€`). Money/dates/numbers/percent come **only** from `useFormat()` (`f.money/signedMoney/abs/number/percent/date/dateTime/monthKey`).
- **Dictionary:** `i18n/dictionaries/fr.ts`, keyed `namespace.camelCaseKey` (names describe *meaning*, not English). Namespaces: `common, auth, nav, dashboard, transactions, tally, settleUp, reports, settings, money, accounts, stats, validation`. Add keys under the matching namespace; reuse `common.*`.
- **Vocabulary (enums → French labels):** `i18n/terms.ts`, `accountTypeLabel`, `personalTxTypeLabel` (Revenu/Dépense/Virement), `roleLabel`, `countryLabel`, `countryDefaultCurrency` (FR→EUR, CA→CAD), `currencyLabel`, `CURRENCY_OPTIONS`/`COUNTRY_OPTIONS`/`ACCOUNT_TYPE_OPTIONS`, `categoryLabel`. **Enum values are English keys from the API**, always render via these label maps, never show the raw key.
- Core i18n files (`translate.ts`, `format.ts`, `terms.ts`, providers) are **infrastructure**, use them, don't edit casually. Language is French only for now, structured so another language could be added.

## Domain terminology (use consistently)
dépense, remboursement, solde, «On vous doit» (green) / «Vous devez» (red), «Tableau des soldes» (tally), «Régler les comptes» (settle up), «Solder» (reset), foyer/membre, patrimoine net (net worth), Revenu/Dépense/Virement, flux de trésorerie, «Privé 🔒», Invitations (Accepter/Refuser/Inviter/Révoquer).

## Currency dropdowns & invitations
- **Every currency `<Select>` must use `usePinnedCurrencyOptions(baseList?)`** (from `hooks/usePinnedCurrencies`) so the user's pinned currencies (from `user.pinnedCurrencies`) sort to the top. Don't render a raw `CURRENCY_OPTIONS`/currency list directly. Pins are managed in Settings ("Devises épinglées", cap 12) via `PATCH /users/me`.
- **Invitations are in-app** (no emails/links): owner/admin invites a *registered user* picked from `useInvitableUsers` (Settings → Membres); the invited user accepts/refuses in Settings → Invitations and on the no-household dashboard onboarding (`ReceivedInvites`). There is no invite code/link/`?invite=` flow, don't reintroduce one.

## Data fetching
- **TanStack Query** for all server state, queries + mutations with cache invalidation. Don't fetch in effects.
- Cookie auth is automatic (`withCredentials`). For mutations, the CSRF token flow is handled (`GET /auth/csrf` → `X-CSRF-Token`); see `components/household/csrf.ts` / auth hooks.
- `types/index.ts` is the contract, money fields are **strings**; parse with decimal.js when doing math, never native floats.

## Responsive / mobile (keep it working, 360px → desktop)
- **Mobile-first Tailwind**, breakpoints `sm:640 md:768 lg:1024`; nav flips at `lg`.
- Patterns already established, match them: mobile **drawer nav** (`Layout.tsx`, with aria/focus/Échap/safe-area), dense tables → **stacked card rows** on mobile, the tally **matrix** in an `overflow-x-auto` container with a **sticky first column**, modals → **bottom sheets** with sticky footers, charts in `ResponsiveContainer`, touch targets **≥44px**, form inputs **≥16px** on ≤640px (prevents iOS zoom).
- No horizontal overflow at 360px, avoid fixed pixel widths (`w-[..px]`, `min-w-[..]`) that can overflow; if a wide element is unavoidable, scroll it inside its own container.
- Respect the «porcelain & ink» visual identity; this is responsiveness, not a redesign. Light + dark must both work at every breakpoint.

## Commands & QA gates
```bash
npm run dev            # local dev server
npm run build          # tsc -b && vite build, must be GREEN
npm run lint           # eslint, no new errors (pre-existing fast-refresh warnings ok)
```
Before finishing any change: `npm run build` green, no new lint errors, and a static sweep for `en-US`/`toLocaleString`/hardcoded `$` in your scope. The >500 kB recharts chunk warning is pre-existing/advisory.

## Gotchas
- Add strings only via the dictionary; add money/date output only via `useFormat()`.
- Account/role/country/tx-type values are **English enum keys**, display through `terms.ts`.
- Currency dropdowns: pinned-first via `usePinnedCurrencyOptions` (never a raw list). Invitations are in-app only, no code/link.
- `index.html` must keep `lang="fr"` and the responsive viewport (`width=device-width, viewport-fit=cover`).
- Scoped `components/*/format.ts` files keep only non-formatting helpers; formatting was migrated to `@/i18n`.
