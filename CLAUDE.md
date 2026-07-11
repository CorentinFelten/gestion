# CLAUDE.md, Gestion

Guidance for Claude (and humans) working in this repository. Read this before making changes.

---

## 1. What this is

**Gestion** is a self-hosted, Docker-first web app for **household spending tracking + mutual reimbursement**, with **multi-currency** support and **historical exchange rates frozen to the day each transaction was paid**, plus a **private per-user personal-finance ledger** (accounts, income/expense/transfers, net worth, statistics).

It targets the **French and Canadian** markets: the UI is in **French (France)**, formatting is locale-aware (**fr-FR** default, **fr-CA** supported), and each personal account is tagged with a **country (FR/CA)** that defaults its currency (EUR/CAD). It is **not** internet-facing by design, it runs on a home/household LAN.

Full product spec lives in **`PLAN.md`**. Security posture lives in **`SECURITY_AUDIT.md`**. This file is the working guide.

---

## 2. Architecture & stack

```
Browser ──► Caddy (reverse proxy, TLS) ──► /api/*  → Backend (NestJS)
                                          └─ /      → Frontend (React SPA via nginx)
                                                        Backend ──► PostgreSQL
                                                        Backend ──► Frankfurter / erapi (FX)
```

| Layer | Tech |
|---|---|
| Backend | Node 24 · **NestJS 11** · TypeScript · **Prisma 6** · PostgreSQL 16 |
| Money math | **decimal.js** + Prisma `Decimal` (`NUMERIC(20,6)`; rates `NUMERIC(20,10)`), **never floats** |
| Auth | Cookie sessions (server-side rows), **argon2id**, CSRF double-submit |
| Frontend | **Vite 6** · **React 18.3** · TypeScript · **Tailwind 3.4** · TanStack Query · React Router · Recharts |
| i18n | Custom typed dictionary under `src/i18n` (`@/i18n`), French, locale-aware Intl formatters |
| Proxy | **Caddy** (auto-HTTPS) |
| Orchestration | Docker Compose (`db`, `backend`, `frontend`, `caddy`, `db-backup`) |

### Repo layout
```
/backend      NestJS API + Prisma (schema, migrations, seed)
  src/modules/{auth,users,households,fx,transactions,settlements,tally,personal,categories}
  src/common/{guards,decorators,pipes,filters}   # AuthGuard, HouseholdMemberGuard, RoleGuard, CsrfGuard, ...
  prisma/{schema.prisma, migrations/, seed.ts}
/frontend     React SPA
  src/pages/            # Login, Register, Dashboard, Transactions, Tally, SettleUp, Reports, Settings,
                        # MoneyOverviewPage, MoneyAccountsPage, MoneyAddPage, MoneyStatsPage
  src/components/{household,money}/   # scoped UI + scoped format helpers
  src/i18n/             # dictionaries/fr.ts, translate.ts, format.ts, terms.ts, providers
  src/hooks/  src/lib/api.ts  src/types/index.ts
/infra        Caddyfile
/scripts      smoke-test*.mjs (+ saved outputs)
docker-compose.yml  .env.example  PLAN.md  SECURITY_AUDIT.md  CLAUDE.md
```

---

## 3. Core domain concepts (get these right)

1. **Two ledgers.**
   - *Shared ledger*, household expenses, splits, reimbursements. Visible to household members.
   - *Personal ledger* (`/me/*`), a user's own accounts & transactions. **Strictly private to the owner**, never exposed to other members or admins. Every `/me/*` query is filtered by the session `userId`; never trust a client-supplied user id.
2. **Multi-currency + FX freeze.** Every transaction stores its **original amount + currency** *and* a **frozen FX snapshot** (`fx_rate`, `fx_rate_date`, `fx_source`, `amount_base`) resolved for the **payment date**. History is never re-converted. ECB (Frankfurter) skips weekends/holidays → the FX service **walks back to the nearest prior published date** and records which date was actually used.
3. **Net worth uses the *latest* rate** (current value), the one deliberate exception to the freeze rule (`FxService.getLatestRate`). Account balances are in each account's native currency; aggregation converts to the user's profile currency.
4. **Pairwise, per-category tally.** Debts are tracked **directed, per (userA, userB, category)**, the exact "A owes B in Alimentation", derived on the fly from splits + settlements. `net_pair(u,v,c) = -net_pair(v,u,c)`. Green = owed to you, red = you owe.
5. **Reimbursements are category-scoped settlements.** A full reimbursement flags `is_full_reset` and drives `net_pair(from,to,category)` to zero. The ledger is **append-only**, a reset adds an offsetting row, never deletes history.
6. **Split integrity.** Splits (`equal|exact|percent|shares`) always sum to the transaction total exactly via the **largest-remainder method**.
7. **Per-account country (FR/CA).** Personal accounts carry `country`; it defaults the currency (FR→EUR, CA→CAD) but currency stays overridable. A user may hold accounts in both countries.
8. **Pinned currencies.** Each user has `pinnedCurrencies` (managed in Settings, cap 12). Every currency dropdown floats pinned currencies to the top via the frontend `usePinnedCurrencyOptions` hook.
9. **In-app invitations.** No emails/tokens/links. An owner/admin invites an existing **registered user**; the invite (`status: pending/accepted/declined`) appears in that user's Settings → Invitations (and the no-household onboarding) to **accept** (join) or **refuse**. Global household settings (name + base currency) are editable by **any member**; removing a member / granting `admin` stay owner/admin.

---

## 4. Localization (French)

- **UI language:** French (France), «vous» register. All user-facing strings go through `@/i18n`:
  ```ts
  const { t, plural } = useT();     t('transactions.addTitle')
  const f = useFormat();            f.money(amount, currency)  // locale-aware
  ```
- **Never** hardcode `en-US`, `toLocaleString('en-US')`, `MM/DD/YYYY`, or a currency symbol (`$`/`€`). Use `useFormat()`, it respects the user's locale (fr-FR → `1 234,56 €`, `DD/MM/YYYY`; fr-CA → `1 234,56 $`, `YYYY-MM-DD`).
- **Dictionary:** `src/i18n/dictionaries/fr.ts`, keyed `namespace.camelCaseKey` (key names describe *meaning*, not English text). Add new keys under the matching namespace.
- **Vocabulary maps:** `src/i18n/terms.ts`, `accountTypeLabel` (Compte courant, Compte d'épargne, Espèces, Carte de crédit, Placements, Autre), `personalTxTypeLabel` (Revenu/Dépense/Virement), `roleLabel`, `countryLabel`, `currencyLabel`, `categoryLabel`. **Account-type enum values stay English keys internally** (`checking`, `savings`, …), only the *labels* are French; do not rename enum values (would break migrations).
- **Default categories** are seeded in French (Alimentation, Électricité, Internet, Eau, Gaz, Loyer, Voyages, Restaurants, Transport, Divers; personal: Salaire, Remboursement, …), see `backend/src/modules/categories/categories.constants.ts`.
- New users default to `locale='fr-FR'`, `preferredCurrency='EUR'`. USD is still selectable but is not a default.

---

## 5. Running it

```bash
cp .env.example .env         # then set real secrets + APP_URL (see below)
docker compose up -d         # migrations auto-apply on backend start; app on Caddy
```
Local dev without Docker:
```bash
# backend
cd backend && npm install && npm run build && npm test
#   needs a Postgres + DATABASE_URL; apply migrations: npx prisma migrate deploy
# frontend
cd frontend && npm install && npm run build     # dev: npm run dev
```

### Required / important env vars
| Var | Notes |
|---|---|
| `APP_URL` | **Required in production.** CORS allow-list origin **and** drives cookie `Secure` (https ⇒ Secure). CORS fails closed if unset in prod. |
| `COOKIE_SECURE` | `true`/`false` override; unset ⇒ derived from `APP_URL` scheme. Set `false` only for local HTTP dev. |
| `POSTGRES_USER/PASSWORD/DB`, `DATABASE_URL` | Backend refuses to boot in production if these still contain `change-me`. |
| `FX_DEFAULT_BASE` | `EUR`. `FX_PROVIDER=frankfurter`, `FX_FALLBACK_PROVIDER=erapi`. |
| `UPLOAD_DIR`, `UPLOAD_MAX_BYTES`, `UPLOAD_ALLOWED_MIME` | Receipt-attachment storage + limits. |
| `CADDY_SITE_ADDRESS` | Hostname for auto-HTTPS; `:80` is **dev-only** (see §7). |

`SESSION_SECRET`/`JWT_SECRET` were **removed**, sessions are opaque DB rows, not signed. Don't reintroduce them without wiring.

> **Plain-HTTP gotcha:** over HTTP (`:80`), you **must** set `COOKIE_SECURE=false` and an `http://` `APP_URL`, or the browser drops the session/CSRF cookies and login/registration fail with a 403. Secure cookies require HTTPS.

### Data, images & migrations
- **All persistent state is bind-mounted to `./data/`** (not Docker named volumes): `./data/postgres` (DB cluster), `./data/uploads` (receipts), `./data/backups` (nightly pg_dump), `./data/caddy/{data,config}`. To back up or migrate: `docker compose down`, copy `./data` to the new host, `docker compose up -d`. `./data/` is gitignored; `./data/postgres` is owned by uid 999 / mode 0700 (use `sudo` or a throwaway container to read it).
- **Image tags are pinned** to exact versions (no floating tags): `postgres:16.14`, `caddy:2.11.4`, `node:24.18.0-slim` (backend + frontend build), `nginx:1.27.5-alpine` (frontend runtime).
- **Migrations** (append-only, applied by the backend entrypoint on boot): `0000_init`, `0001_account_country`, `0002_user_pinned_currencies`, `0003_inapp_invites`.

### Handy commands
```bash
cd backend  && npm run build && npm test        # must both be green
cd frontend && npm run build                     # tsc -b && vite build, must be green
node scripts/smoke-test-postfix.mjs              # end-to-end + security regression (needs a running backend+DB)
docker compose config                            # validate compose
```

---

## 6. Security model (do not regress)

Threat model: **self-hosted LAN, not internet-facing; primary adversary is a semi-trusted housemate** + anyone with a LAN foothold. The full audit + what's verified-safe is in **`SECURITY_AUDIT.md`**, read it before touching auth, guards, or the ledger.

Controls that **must be preserved** on any change:
- **Personal ledger isolation**, `/me/*` is owner-only; filter by session `userId`, never a client id.
- **Authorization**, `AuthGuard` + `HouseholdMemberGuard` + `RoleGuard` on household routes; resource routes (`/transactions/:id`) do a membership/ownership check and return **404 (not 403)** to non-members. Transaction edit/delete restricted to creator/payer or admin.
- **CSRF**, `CsrfGuard` (double-submit, `timingSafeEqual`) on **every** state-changing route.
- **Sessions**, CSPRNG token (`randomBytes(32).base64url`), httpOnly + SameSite=Lax + Secure (per `COOKIE_SECURE`/APP_URL), server-side, rotated on login.
- **Passwords**, argon2id; login is timing-normalized + generic error (no user enumeration).
- **Invites**, in-app only: a household owner/admin invites an **existing registered user** (no emails/tokens/links); only the invited user may accept/decline; only an owner may grant `admin`; single-household invariant enforced on accept.
- **Audit log**, money-affecting writes (transactions, settlements) write `audit_log` rows.
- **Error hygiene**, 500s return a generic message (no Prisma/internal leakage); full detail is logged server-side only.
- **Uploads**, `FileInterceptor` with MIME allowlist + size cap + randomized on-disk filename, stored outside any webroot.
- **CORS fails closed**; global rate limiter registered (`ThrottlerGuard` as `APP_GUARD`) with stricter limits on auth.
- **Prisma only** (no raw SQL / injection surface); non-root backend container; **Postgres port not published** to the host.

If you change any of the above, re-run the security regression assertions (see §7) and update `SECURITY_AUDIT.md`.

---

## 7. Verification & Quality-Assurance process (mandatory)

This project was built and hardened under a strict, enforced QA discipline. **Keep it.** No change is "done" until it passes the relevant gates below.

### 7.1 Build & type gates (every change)
- `backend`: `npm run build` **green** and `npm test` **green** (~127 tests across auth, fx, transactions, settlements, tally, personal, categories, users, households/invites, common).
- `frontend`: `npm run build` **green** (`tsc -b && vite build`); `eslint` with no new errors.
- When editing in parallel/isolated contexts, type-check with `npx tsc --noEmit` (does not write the shared `dist/`) and run only the affected module's tests; then run a **consolidated full build + full test** afterward.

### 7.2 End-to-end smoke test (behavioral proof, not just unit tests)
A real Postgres is started, all migrations applied (`prisma migrate deploy`), the backend booted, and a scripted flow is driven through `/api/v1`:
`GET /auth/csrf → register A → login → create household → invite registered user B → B accepts → GET categories → multi-currency split transaction → tally → reset settlement → tally cleared → personal account + income/expense → net worth`.
Key invariants asserted (regression-locked): **120 USD → 104.5656 EUR @ 0.87138 frozen 2026-03-13**; tally B→A **52.2828 EUR** then **0** after reset; net worth **3100 EUR**.
The scripts use the current **in-app invite** flow (`register B → GET :id/invitable-users → POST :id/invites {invitedUserId} → GET /me/invites → POST /invites/:id/accept`). `scripts/smoke-test.mjs` is pure-API, run it through Caddy: `node scripts/smoke-test.mjs http://localhost/api/v1` (it registers `@example.com` throwaways; clean up after with `DELETE FROM households/users WHERE … LIKE '%@example.com'`). `smoke-test-postfix.mjs` (security regressions) and `smoke-test-fr.mjs` (French/locale) additionally inspect the DB and expect a throwaway container (`DB_CONTAINER`).

### 7.3 Security audit → remediation → regression (enforced)
1. A dedicated **security audit** reviewed every controller's guard stack, Prisma scoping, cookies/sessions/CSRF, invite tokens, validation, error filter, secrets, container/compose, and `npm audit`, calibrated to the LAN + semi-trusted-housemate threat model → 13 findings (0 Critical/High, 4 Medium, 7 Low, 2 Info) written to `SECURITY_AUDIT.md`.
2. Each finding was **fixed** by a scoped agent (SEC-01…SEC-13).
3. A **consolidated verification** ran the full suite + smoke test **plus security regression assertions**, each proven with evidence:
   - SEC-01: session cookie matches `^[A-Za-z0-9_-]{43}$` (CSPRNG), not a cuid.
   - SEC-03: mismatched-email invite acceptance → 404; matching → 201.
   - SEC-04: `audit_log` rows written; non-creator/admin editing another's tx → 403.
   - SEC-05: forced 500 → generic body, no internal leak.
   - SEC-10 / SEC-11: disallowed upload MIME → 400; out-of-household category → 400.
   - This step also caught a **cross-agent defect** unit tests missed (double-registered throttler halving the auth rate limit), hence the rule: **always run a combined verification after parallel changes.**

### 7.4 Localization / market verification
Fresh-DB migration integrity (`0000_init` + `0001_account_country`, `migrate status` clean; `accounts.country` default `FR`, `users.locale` default `fr-FR`), plus a French smoke: new user defaults fr-FR/EUR; seeded categories are French (Alimentation, Électricité, Loyer, Voyages); `country:'CA'`→CAD and `country:'FR'`→EUR account defaults; and a static sweep confirming **no** `en-US`/`toLocaleString`/`$` hardcoding, viewport meta present, `lang="fr"`, and `Layout` nav uses i18n keys.

### 7.5 Mobile / responsive verification
Whole-app responsive pass (360px → tablet → desktop): mobile drawer nav, tables→card rows, tally matrix in a sticky-column horizontal scroller, modals→bottom-sheets with sticky footers, ≥44px touch targets, 16px inputs (no iOS zoom), safe-area insets, no horizontal overflow. Verified via build + static overflow sweep (grep for fixed pixel widths) and screenshots where the environment allowed.

### 7.6 Docker gate
`docker compose config` valid; `docker compose build` succeeds; a `docker compose up` health check confirms the stack is healthy through Caddy (`/api/v1/health` 200, SPA root 200, migrations applied on boot) before teardown (`down -v`).

### How this codebase was produced (context)
Built by **dedicated expert subagents, one per task**, against **frozen shared contracts** (Prisma schema, `FxService` signature, common guards, frontend i18n API) so parallel agents didn't collide, each **scoped to disjoint files**. Pipeline: foundation → parallel feature agents (auth, fx, shared-ledger, personal-ledger, 2× frontend) → integration → security audit → parallel per-module fix agents → consolidated verification; then localization (backend locale + i18n infra → household & personal translation sweeps) → mobile responsive → final verification. When you extend it, follow the same discipline: small scoped changes, keep contracts stable, and run the gates in §7.

---

## 8. Conventions & gotchas

- **Money is always `Decimal`/decimal.js server-side and strings over the wire.** Never use JS floats for money. Split remainders use the largest-remainder method.
- **Never re-convert historical FX**, read stored `amount_base`. Only net worth uses the latest rate.
- **Account-type / role / country enum values are stable internal keys**; translate via `terms.ts`, don't rename the enums.
- **All `/me/*` access is owner-scoped**, derive the user from the session, never the request body/params.
- **Add UI strings only via `@/i18n`**; add money/date output only via `useFormat()`.
- Migrations are append-only folders under `backend/prisma/migrations`; generate a **new** migration, never edit `0000_init`.
- **Currency dropdowns** must use `usePinnedCurrencyOptions` (pinned-first); **invitations are in-app only**, never reintroduce email/token/`?invite=` links.
- **Persistent data lives in `./data/`** (bind mounts) and **image tags are pinned**, see §5; update both when adding a service or bumping a version.
- Frozen-by-convention files (change deliberately, and re-verify): `prisma/schema.prisma`, `app.module.ts`, `main.ts`, the `common/` guards, `src/i18n/**` core, `src/lib/api.ts`.

## 9. Known gaps / TODO (documented, non-blocking)
- **Base-currency change does not (and should not) re-derive recorded transactions.** A transaction's `amount_base` is frozen the day it is paid — it is spent-in-time and never re-converted; changing a household's base currency is audit-logged and applies to *new* rows only. The personal ledger already reflects current value where it should (net worth and stats convert at the **latest** rate, §3.3), so it "evolves" without any recompute. Caveat for operators: because history stays frozen, changing the base currency after transactions exist leaves older rows denominated in the prior base, so the base currency is effectively a set-once choice; there is no cross-base recompute by design.
- **Multi-household** is intentionally v2 (schema already carries `household_id`, so it's non-breaking to add).
- Frontend ships a >500 kB recharts chunk (build advisory only).
- v2 backlog (see `PLAN.md` §11): CSV/bank import, OCR receipts, recurring transactions & scheduled income, budgets/savings goals, PWA, OAuth, notifications.
