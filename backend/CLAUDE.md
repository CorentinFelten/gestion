# CLAUDE.md, Backend (NestJS API)

Scoped guidance for `/backend`. Read the **root `CLAUDE.md`** first for domain concepts, security model, and the QA process. This file is the tactical guide for the API.

## Stack
Node 24 · **NestJS 11** · TypeScript · **Prisma 7** (engine-free; `pg` driver adapter) · PostgreSQL 16 · decimal.js · zod 4 · argon2 · @nestjs/throttler · helmet · cookie-parser. Global prefix **`/api/v1`**.

## Module map (`src/modules/`)
| Module | Responsibility |
|---|---|
| `auth` | register/login/logout/me, cookie sessions, `SessionService`, `GET /auth/csrf`. Finalizes `AuthGuard`. |
| `users` | profile get/update (incl. `pinnedCurrencies`); `GET /users/:id` is co-member-scoped. |
| `households` | single-household CRUD; **global settings (name + base currency) editable by ANY member** (HouseholdMemberGuard only); members roster; seeds French shared categories on creation. `invites.service` = **in-app invitations** (owner/admin invites a registered user by `invitedUserId`; `status: pending/accepted/declined`; `GET :id/invitable-users`, `GET :id/invites`, `DELETE :id/invites/:inviteId`, `GET /me/invites`, `POST /invites/:id/accept|decline`; owner-only for an `admin` role; single-household enforced on accept). |
| `fx` | **`FxService`** (frozen contract), Frankfurter provider + erapi fallback, `exchange_rates` cache, nightly prefetch, `/fx/rate`, `/currencies`. |
| `transactions` | expenses + splits (largest-remainder), FX freeze on create/edit, receipt upload, audit log. |
| `settlements` | category-scoped reimbursements, `is_full_reset`, append-only, audit log. |
| `tally` | pairwise per-category balance engine (`net_pair`), settle-up. |
| `personal` | **owner-only `/me/*`**: accounts (with `country`), personal transactions (income/expense/transfer), net worth (latest rate), stats. |
| `categories` | `GET /households/:id/categories`, `GET /categories`; French default seeds in `categories.constants.ts`. |

Shared infra: `src/common/`, `AuthGuard`, `HouseholdMemberGuard`, `RoleGuard`, `CsrfGuard`, `@CurrentUser()`, `@Roles()`, `ZodValidationPipe`, `AllExceptionsFilter`; `prisma/prisma.service.ts` (`@Global`).

## Contracts, keep stable (other code depends on these)
- **`FxService`**: `getRate(from,to,dateISO)`, `convert(amount,from,to,dateISO)`, `getLatestRate(from,to)` → all return `{rate, rateDate, source}` (+`amount` for convert). Use `convert()` to freeze a payment-date rate; `getLatestRate()` only for net worth.
- **Guards** (import from `src/common`): put `AuthGuard` on everything authenticated; `HouseholdMemberGuard` on `/households/:id/*`; `RoleGuard` + `@Roles('owner','admin')` on **destructive membership actions only** (remove member, mint invite, revoke invite); **`CsrfGuard` on every POST/PATCH/DELETE**. Note: `PATCH /households/:id` (name + base currency) is intentionally member-level (no `RoleGuard`), any member may manage global settings.
- **`PrismaService`** for all DB access.

## Money & ledger rules
- **All money is Prisma `Decimal` + decimal.js, never floats.** `NUMERIC(20,6)`; rates `NUMERIC(20,10)`. Serialize to **strings** over the wire.
- **Freeze FX per transaction/settlement**; never re-convert history, read stored `amount_base`.
- **Splits sum exactly** via largest-remainder (`transactions/money.util.ts`).
- **Tally is pairwise/per-category** and derived from splits + settlements (no balance table). `net_pair(u,v,c) = -net_pair(v,u,c)`.
- **`/me/*` is owner-only**, always derive `userId` from `@CurrentUser`, filter every query by it, 404 (not leak) on non-owned resources.
- Reject future payment dates; validate currency (ISO-4217); category must be a global default or belong to the household.

## Prisma / migrations
- The **rtk hook intercepts `npx prisma`**, call the binary directly: `./node_modules/.bin/prisma <cmd>`.
- **Prisma 7, engine-free.** Runtime uses the **`pg` driver adapter** in `PrismaService` (`new PrismaPg({ connectionString, max })`); pool size = `DB_POOL_MAX` (default 10). The datasource `url` is in **`prisma.config.ts`** (root of `/backend`, read from `process.env.DATABASE_URL`) — it is NOT in `schema.prisma` (Prisma 7 removed schema-level `url`). `prisma.config.ts` is excluded from `tsconfig.build.json` (keeps `dist/main.js`), and copied into both Docker stages (generate + migrate deploy need it). An npm `override` pins `@hono/node-server` past GHSA-92pp-h63x-v22m (pulled transitively by `@prisma/dev`, used only by the unused `prisma dev` command).
- Migrations are append-only folders in `prisma/migrations/`. **Never edit `0000_init`.** Current: `0000_init`, `0001_account_country`, `0002_user_pinned_currencies`, `0003_inapp_invites`, `0004_personal_transfer_index`, `0005_household_member_unique_user`, `0006_session_last_activity`, `0007_account_credit_fields`, `0008_net_worth_snapshots`, `0009_saved_filters`.
- To add a migration without a running DB, generate the delta via `prisma migrate diff ... --script` into a new folder, then `prisma generate`. Backend container runs `prisma migrate deploy` on startup (`docker-entrypoint.sh`).
- **Enum values are stable internal keys** (`checking`, `owner`, `income`, `FR`…), never rename (breaks migrations); French labels live in the frontend's `terms.ts`.
- Seeds: `prisma/seed.ts` (+ `categories.constants.ts` for French defaults). `preferredCurrency` default `EUR`, `locale` default `fr-FR`.

## Security (do not regress, see `SECURITY_AUDIT.md`)
argon2id · CSPRNG session ids (`randomBytes(32).base64url` in `SessionService.create`) · CSRF on all mutations · generic 500s (no internal leak) · audit_log on money writes · edit/delete tx restricted to creator/payer/admin · in-app invites: only the invited user may accept/decline, only an owner may grant `admin` · CORS fail-closed (requires `APP_URL`) · `COOKIE_SECURE`/APP_URL-scheme drives cookie `Secure` (not `NODE_ENV`) · global `ThrottlerGuard` (do not double-register on auth routes, it halves the limit) · upload MIME allowlist + size cap + random filename.

## Commands & QA gates
```bash
npm run build          # nest build, must be GREEN
npm test               # full Jest suite (~175 tests), must be GREEN
npx tsc --noEmit       # type-check without writing dist/ (use for isolated edits)
./node_modules/.bin/prisma generate|migrate deploy|migrate status
```
Any change must keep build + tests green. For behavioral changes, run the end-to-end smoke (`scripts/smoke-test*.mjs`) against a real Postgres. Security-sensitive changes must re-pass the SEC regression assertions (root `CLAUDE.md` §7.3).

## Testing conventions
- Unit tests use an **in-memory Prisma fake** and a **mocked `FxService`** (see `personal.service.spec.ts`, `settlements.service.spec.ts`). FX provider tests use recorded fixtures, **no network in tests**.
- Add tests for: money/rounding, FX walk-back, pairwise net symmetry, owner-only isolation, and any authz/audit behavior you touch.
