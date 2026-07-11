# Household Spending & Reimbursement App, Build Plan

Self-hosted, Docker-first app for tracking household spending and settling mutual
debts, with full multi-currency support and historical exchange rates fixed to the
day each transaction was paid.

---

## 1. Product scope

### Core features (v1)
- **Multi-user** accounts with authentication and roles.
- **Households/groups**: users belong to one or more households; expenses are scoped to a household.
- **Expense tracking**: who paid, how much, which currency, date, category, notes, receipt image.
- **Expense splitting**: equal / exact amounts / percentages / shares, across selected members.
- **Single main currency**: the household picks one base currency at creation. Every expense is converted into it (using the frozen payment-date rate) and all balances/tallies are computed in it. The **original amount + currency are always kept on the transaction** for tracking.
- **Multi-currency input**: any transaction can be *entered* in any currency; it's stored in the original currency and in the main currency.
- **Historical FX**: exchange rate is pulled and *frozen* for the date the transaction was paid.
- **Per-category tally**: at any point, see how much each user is **in the green / in the red per spending category** (groceries, electricity, internet, water, gas, trips, …), plus the overall total.
- **Category-scoped reimbursement**: record a reimbursement from one person to another **within a category**; a full reimbursement **resets that category's tally** between them to zero.
- **Personal finance profiles** *(private per user)*: each user has their own accounts (checking, savings, cash, credit, investment…) and records their own income and personal expenses. Views & statistics for general money tracking: when was I paid, when/what/from-which-account did I spend, cashflow per month, balance per account, and **total net worth across all accounts**. Only the user sees their own profile.
- **Reports**: spending by category / member / month / currency (shared), plus personal cashflow & net-worth stats.

### Two ledgers (mental model)
The app holds **two separate ledgers** that share users, categories, and currency infra:
1. **Shared ledger**, household expenses, splits, per-category pairwise tallies, reimbursements. Visible to all household members.
2. **Personal ledger**, a user's own accounts and transactions (income/expense/transfer). **Private to that user.** Drives balances, net worth, and personal statistics.
They link *optionally*: a shared expense you paid can also post an outflow to one of your personal accounts (and a reimbursement you receive posts an inflow), so your personal balances stay accurate without double-entry work. Each ledger is fully usable on its own.

### Explicit non-goals for v1 (park for later)
- Bank/CSV import, OCR receipt parsing, recurring transactions, budgets, mobile native apps, OAuth social login. All are natural v2+ additions and the schema below leaves room for them.

---

## 2. Architecture overview

```
                    ┌──────────────────────────────┐
   Browser  ─────►  │  Reverse proxy (Caddy)        │  TLS, auto HTTPS
                    │   /        → frontend (static) │
                    │   /api/*   → backend           │
                    └───────────────┬──────────────┘
                                    │
              ┌─────────────────────┼───────────────────────┐
              ▼                     ▼                        ▼
      ┌──────────────┐     ┌────────────────┐       ┌────────────────┐
      │  Frontend    │     │  Backend API   │◄─────►│  PostgreSQL    │
      │  (SPA build) │     │  (REST/JSON)   │       │  (data + FX    │
      └──────────────┘     │                │       │   rate cache)  │
                           │  FX service    │       └────────────────┘
                           │  Scheduler     │
                           └───────┬────────┘
                                   │ (on new tx / nightly backfill)
                                   ▼
                          External FX rate API
                          (Frankfurter / ECB)
```

### Recommended stack
| Layer | Choice | Why |
|---|---|---|
| Backend | **Node.js + TypeScript, NestJS** (or Fastify) | Node 24 already installed; TS gives safety for money logic; strong ecosystem. Python/FastAPI is an equally valid alt. |
| ORM/migrations | **Prisma** or **Drizzle** | Typed schema + versioned migrations. |
| DB | **PostgreSQL 16** | `NUMERIC` for exact money, good date handling, JSONB for rate snapshots. |
| Frontend | **React + Vite + TypeScript**, TanStack Query, Tailwind | Fast SPA; Query handles server state cleanly. |
| Auth | Session cookie (httpOnly, SameSite=Lax) backed by JWT or server sessions | Self-hosted, single-origin → cookies simpler & safer than localStorage tokens. |
| Money math | **decimal.js** (never JS floats) | Avoid FP rounding on currency. |
| Reverse proxy | **Caddy** | Automatic HTTPS, tiny config. |
| Container | Docker Compose | Single `docker compose up`. |

> Decision rule: store **all monetary values as `NUMERIC(20,6)`** in the DB and as `decimal.js` in code. Never use floating point for amounts. Display rounds to the currency's minor unit (e.g. 2 dp for EUR/USD, 0 for JPY).

---

## 3. Currency & exchange-rate design (the core requirement)

### 3.1 Principles
- The **household picks one main currency at creation** (e.g. EUR), this is fixed and drives *all* balances, per-category tallies, and reports. Changing it later is an admin-gated recompute (see §6).
- Each transaction stores its **original amount + original currency** as the source of truth *and* the converted `amount_base` in the main currency. Nothing is destroyed by conversion; the original price stays on the transaction for tracking.
- All balances and reports are computed from `amount_base` in the main currency.
- When a transaction is created, we fetch the FX rate **for the payment date** and store a **frozen snapshot**: `rate`, `rate_date`, `source`, `fetched_at`. Later rate changes never alter historical transactions.
- Conversion is always: `amount_base = amount_original × rate(original→base, payment_date)`.

### 3.2 Rate provider
Primary: **Frankfurter** (https://api.frankfurter.dev), free, no API key, ECB data, supports historical daily rates via `/{YYYY-MM-DD}?base=USD&symbols=EUR`.

Caveats and how we handle them:
- **ECB publishes only on TARGET business days** (no weekends/holidays). → If the requested date has no rate, walk back to the **most recent prior published date** and record which date was actually used (`rate_date` may differ from `payment_date`).
- **~30 currencies covered.** For currencies outside ECB coverage, configure a **secondary provider** (open.er-api.com or exchangerate.host) via an adapter interface.
- **Future dates** are rejected (payment date can't be in the future).

Provider abstraction (pluggable):
```ts
interface RateProvider {
  name: string;
  // returns rate to convert 1 `from` into `to`, on or before `date`
  getRate(from: string, to: string, date: string): Promise<{
    rate: Decimal; rateDate: string; source: string;
  }>;
}
```
Config via env: `FX_PROVIDER=frankfurter`, `FX_FALLBACK_PROVIDER=erapi`, `FX_BASE_CURRENCY` default.

### 3.3 Rate cache
Table `exchange_rates(base, quote, rate_date, rate, source, fetched_at)` with unique key `(base, quote, rate_date, source)`. Flow on new transaction:
1. Look up cache for `(original→base, payment_date_or_prior)`.
2. Miss → call provider, walk back to nearest available date, insert into cache.
3. Store the resolved rate as a snapshot **on the transaction** (denormalized) so it's immutable even if the cache row is later corrected.

Also run a **nightly scheduler** to prefetch "today's" rates for all currencies used by any household, so same-day entries are instant and offline-tolerant.

### 3.4 Two conversion modes
- **Historical freeze** (shared ledger + personal transactions): the rate is fixed to the
  transaction's date and stored, so past records never change. Used for every recorded
  transaction and tally.
- **Current-value conversion** (net worth only): aggregating account balances that are held
  in *different* currencies into the user's profile currency uses the **latest available
  rate**, because net worth is a snapshot of "what it's worth today". This is the one place
  we intentionally use a live/latest rate rather than a frozen one; each account's own
  native balance is always shown untouched alongside.

### 3.5 Worked example
Household base = EUR. Alice pays a **120 USD** hotel on 2026-03-14.
- Fetch USD→EUR for 2026-03-14 (Saturday → no ECB rate → fall back to Fri 2026-03-13, rate 0.918).
- Store on transaction: `amount_original=120 USD`, `rate=0.918`, `rate_date=2026-03-13`, `amount_base=110.16 EUR`.
- Balances/splits computed in EUR from `amount_base`.

---

## 4. Data model

```sql
-- Users & auth
users(id, email UNIQUE, password_hash, display_name, avatar_url,
      preferred_currency, locale, created_at, is_active)

sessions(id, user_id, expires_at, ...)          -- or JWT, no table

-- Households (groups)
households(id, name, base_currency, created_by, created_at)

household_members(household_id, user_id, role /* owner|admin|member */,
                  joined_at, PRIMARY KEY(household_id, user_id))

invites(id, household_id, email, token, expires_at, accepted_at)

-- Reference
categories(
  id, household_id NULLABLE, user_id NULLABLE,   -- household=null&user=null → global default;
                                                 -- user set → private personal category
  scope /* shared|personal|both */,
  flow  /* expense|income|any */,                -- income categories (salary, refunds) for personal
  name, icon, color
)

-- ── Personal finance ledger (private per user) ─────────────────────────
accounts(
  id, user_id, name,
  type /* checking|savings|cash|credit_card|investment|other */,
  currency CHAR(3),
  opening_balance NUMERIC(20,6) DEFAULT 0,
  is_active BOOLEAN, archived_at NULLABLE,
  sort_order, created_at
)

personal_transactions(
  id, user_id, account_id,
  type /* income | expense | transfer */,
  category_id NULLABLE,
  amount        NUMERIC(20,6),      -- in the account's currency (drives the balance)
  -- original entry (if paid in a different currency than the account):
  amount_original NUMERIC(20,6) NULLABLE, currency_original CHAR(3) NULLABLE,
  fx_rate NULLABLE, fx_rate_date NULLABLE, fx_source NULLABLE,
  txn_date DATE,
  payee_source TEXT,                -- employer, merchant, "who paid me" / "who I paid"
  notes,
  transfer_account_id NULLABLE,     -- for type=transfer: the destination account
  linked_transaction_id NULLABLE,   -- optional link to a shared-ledger transaction
  linked_settlement_id  NULLABLE,   -- optional link to a reimbursement received/paid
  created_at, updated_at, deleted_at NULLABLE
)

-- FX
exchange_rates(id, base, quote, rate_date, rate NUMERIC(20,10),
               source, fetched_at,
               UNIQUE(base, quote, rate_date, source))

-- Transactions / expenses
transactions(
  id, household_id, payer_user_id,
  description, category_id, notes,
  amount_original   NUMERIC(20,6),
  currency_original CHAR(3),
  payment_date      DATE,
  -- frozen FX snapshot:
  base_currency     CHAR(3),
  fx_rate           NUMERIC(20,10),
  fx_rate_date      DATE,
  fx_source         TEXT,
  amount_base       NUMERIC(20,6),        -- amount_original * fx_rate
  created_by, created_at, updated_at, deleted_at NULLABLE
)

-- Splitting: how a transaction is shared
transaction_splits(
  id, transaction_id, user_id,
  split_type /* equal|exact|percent|shares */,
  share_value    NUMERIC(20,6),   -- weight/percent/exact input
  amount_base    NUMERIC(20,6)    -- resolved owed amount in base ccy
)
-- Invariant: SUM(splits.amount_base) == transaction.amount_base (to the cent)

-- Settlements (reimbursement payments between members), category-scoped
settlements(
  id, household_id, from_user_id, to_user_id,
  category_id NULLABLE,          -- NULL = overall/cross-category settlement
  amount_original NUMERIC(20,6), currency_original CHAR(3),
  payment_date DATE,
  fx_rate, fx_rate_date, fx_source, amount_base NUMERIC(20,6),
  is_full_reset BOOLEAN,         -- true when it zeroes the category tally
  note, created_by, created_at
)

-- Receipts
attachments(id, transaction_id, filename, mime, size, storage_path, created_at)

-- Audit
audit_log(id, household_id, actor_user_id, action, entity, entity_id,
          before JSONB, after JSONB, created_at)
```

### Money invariants (enforce in code + DB checks/tests)
- `amount_base == round(amount_original * fx_rate, 6)`.
- `SUM(transaction_splits.amount_base) == transaction.amount_base`, distribute rounding remainder deterministically (largest-remainder method) so the split always sums exactly.
- Balances derive **only** from `amount_base` values; never re-convert historical rows.

---

## 5. Reimbursement / balance engine

### 5.1 Balance computation, pairwise, per category
Tallies are tracked as **directed debts between each pair of members, per category**, the
exact "A owes B in groceries" relationship is preserved, never pooled into a household net.
All amounts in the main currency. Everything below is *derivable* from `transaction_splits`
+ `settlements` (no extra table needed): a split where `user = u` on a transaction paid by
`v` in category `c` means **u owes v** `split.amount_base` in category `c`.

For an ordered pair `(u, v)` and category `c`:
```
owes(u→v, c) = Σ splits.amount_base
                 where split.user = u AND tx.payer = v AND tx.category = c
paid(u→v, c) = Σ settlements.amount_base
                 where from_user = u AND to_user = v AND category = c

-- gross claims in each direction, netted:
net_pair(u,v,c) = ( owes(u→v,c) - paid(u→v,c) )      -- what u still owes v
                - ( owes(v→u,c) - paid(v→u,c) )      -- minus what v owes u
```
- `net_pair(u,v,c) > 0` → **u owes v** (u red, v green) in category `c`.
- `net_pair(u,v,c) < 0` → **v owes u**.  (`net_pair(u,v,c) = −net_pair(v,u,c)`.)
- A user's category tally = sum of their pairwise positions:
  `net(u,c) = Σ_v −net_pair(u,v,c)` (positive = net green in that category).
- Overall between two people: `Σ_c net_pair(u,v,c)`.

**Tally views:**
- *Personal*: for the logged-in user, per category, a list of "you owe X / Y owes you"
  against each other member, color-coded, with a per-category and overall total.
- *Matrix* (households > 2): members × categories grid of each member's net position.
- For a **2-person household** this reduces to a single clean "A ↔ B per category" ledger.

### 5.2 Settle-up
Because debts are tracked pairwise, **there's nothing to simplify per category**, each
`net_pair(u,v,c)` is already the exact transfer needed to clear category `c` between u and v.
Settle-up just lists non-zero pairwise positions (optionally grouped so "u owes v" nets
across categories into one suggested payment, while still recording per-category which
categories it clears). An optional **overall cross-category simplification** (greedy
creditor/debtor matching) can be offered on top for households > 2 who just want the
fewest total transfers, clearly labelled as "simplified (loses per-category detail)".

### 5.3 Multi-currency in settlements
A settlement can be paid in any currency; it's converted at its own `payment_date` rate and stored as `amount_base`, so it nets correctly against main-currency balances. UI shows original amount + main-currency equivalent.

### 5.4 Category-scoped reimbursement ("reset the tally")
A reimbursement is a settlement with `from_user`, `to_user`, and a `category_id`, it
directly reduces `net_pair(from, to, category)`. Semantics:
- **"Reset tally" one-click** on any non-zero pairwise position: pre-fills a settlement
  `from → to` for the *exact outstanding* `net_pair(from,to,c)`, flagged `is_full_reset = true`.
  Recording it drives `net_pair(from,to,c)` to zero.
- **Partial reimbursement**: user types a smaller amount → reduces the pairwise tally by
  that amount; `is_full_reset` auto-set only when the amount equals the outstanding.
- **Direction is validated**: `from` must be the debtor (the one with the negative position)
  for a reset; paying the wrong way would create a reverse debt (allowed, but the UI warns).
- Append-only ledger, a reset never deletes splits/history, it adds an offsetting
  settlement, so every pairwise tally is fully reconstructable and auditable.

### 5.5 Personal account balances & net worth
All private to the owning user.
```
balance(account a) = a.opening_balance
   + Σ personal_transactions.amount where account=a AND type=income
   − Σ personal_transactions.amount where account=a AND type=expense
   − Σ transfers OUT of a  (type=transfer, account_id=a)
   + Σ transfers INTO a    (type=transfer, transfer_account_id=a)
```
- Each account balance is in the **account's native currency** (no FX inside an account).
- **Transfers** are one row that debits `account_id` and credits `transfer_account_id`; if the
  two accounts differ in currency, the row stores both legs' amounts (amount + a second
  converted amount) at the transfer-date rate.
- **Net worth** = Σ over active accounts of `balance(a)` converted to the user's profile
  currency at the **latest available rate** (§3.4). Credit-card / liability accounts count
  negative. Shown as a total with a per-account breakdown (native + converted).

### 5.6 Optional link to the shared ledger
When recording a shared expense, the payer may tick "also deduct from my account X" → creates
a linked `personal_transactions` expense (`linked_transaction_id`). Receiving a reimbursement
can post a linked income. Deleting/editing one side prompts about the linked row. This keeps
personal balances honest without forcing double entry; unlinked use is fully supported.

---

## 6. API surface (REST, `/api/v1`)

```
Auth
  POST   /auth/register
  POST   /auth/login
  POST   /auth/logout
  GET    /auth/me

Households
  GET    /households
  POST   /households
  GET    /households/:id
  PATCH  /households/:id            (name, base_currency*)
  POST   /households/:id/invites
  POST   /invites/:token/accept
  GET    /households/:id/members
  DELETE /households/:id/members/:userId

Transactions
  GET    /households/:id/transactions        (filter: date range, member, category, currency)
  POST   /households/:id/transactions        (server fetches/freezes FX)
  GET    /transactions/:id
  PATCH  /transactions/:id                    (re-resolves FX if date/currency changes)
  DELETE /transactions/:id                    (soft delete)
  POST   /transactions/:id/attachments

Splits are embedded in the transaction payload.

Settlements / reimbursements
  GET    /households/:id/settlements                (filter by category, member)
  POST   /households/:id/settlements                (body: from, to, amount, currency, date, category_id?)
  GET    /households/:id/categories/:catId/settle-up   (exact outstanding + prefill for reset)

Balances & tallies (pairwise)
  GET    /households/:id/tally                       (pairwise net per member-pair × category)
  GET    /households/:id/tally?me=1                  (my positions vs each member, per category)
  GET    /households/:id/tally?category=:catId       (single-category pairwise ledger)
  GET    /households/:id/settle-up                   (non-zero pairwise positions to clear)
  GET    /households/:id/settle-up?simplify=1        (optional overall greedy simplification)
  GET    /households/:id/reports?group=category|member|month|currency

Personal ledger (all scoped to the authenticated user, private)
  GET    /me/accounts
  POST   /me/accounts
  PATCH  /me/accounts/:id                            (rename, archive)
  GET    /me/accounts/:id/balance
  GET    /me/transactions        (filter: type, account, category, date range, payee, search)
  POST   /me/transactions        (income | expense | transfer; optional link to shared tx)
  PATCH  /me/transactions/:id
  DELETE /me/transactions/:id
  GET    /me/net-worth                               (total + per-account, native + converted)
  GET    /me/stats?view=cashflow|by-category|by-account|income-timeline&period=month|year
  GET    /me/stats/summary                           (this-month income, spend, savings rate)

FX
  GET    /fx/rate?from=USD&to=EUR&date=2026-03-14   (debug/preview)
  GET    /currencies
```
*Changing a household base currency is a heavy operation, recompute is done from stored originals, re-fetching historical rates. Gate behind admin + confirmation.

---

## 7. Frontend (SPA)

Pages:
- **Login / register**.
- **Household switcher** (top nav) for multi-household users.
- **Dashboard**: your net balance, recent transactions, "you owe / you're owed" summary, spend-this-month chart.
- **Add/edit transaction**: amount + currency picker (defaults to user's preferred), date picker, payer, category, split editor (equal/exact/%/shares with live "sums to total" validation), receipt upload. Shows live base-currency conversion preview.
- **Transactions list**: filters, search, currency badges (shows original + base).
- **Tally board**: for the logged-in user, per category, "you owe X" / "Y owes you" against each member (pairwise), color-coded green/red, with per-category + overall totals. Households > 2 also get a members × categories matrix of net positions.
- **Settle up**: non-zero pairwise positions listed per category (and netted per person); each row has a **"Reset tally"** button that pre-fills the exact outstanding `from → to` reimbursement (currency picker for how it was actually paid), plus a manual "record partial payment" flow. Optional "simplify overall" toggle for the fewest-transfers view.
- **Reports**: category/member/month breakdowns, multi-currency aware.

**Personal finance area** *(private, a separate top-level "My Money" section):*
- **Overview**: total net worth (profile currency) + card per account showing native balance; this-month income vs spending, savings rate.
- **Accounts**: list/create/archive accounts (type, currency, opening balance); click an account → its transaction ledger and running balance.
- **Add transaction**: income / expense / transfer, account picker, category, payee/source, date, amount (with foreign-currency entry + conversion preview), optional "link to a shared expense" toggle.
- **Statistics**: cashflow chart (income vs expense per month), spending by category, spending by account, **income timeline ("when was I paid")**, net-worth trend over time.
- **Settings**: profile, preferred/profile currency, household base currency (admin), members & invites.

Key UX rules:
- Always show the **original currency amount** with base-currency equivalent secondary.
- Split editor must visibly enforce `Σ splits == total`.
- Money formatted per currency minor units and user locale.

---

## 8. Docker & deployment

`docker-compose.yml` services:
```yaml
services:
  db:        # postgres:16, named volume, healthcheck
  backend:   # node app; depends_on db healthy; runs migrations on start
  frontend:  # nginx serving built SPA (or served by Caddy directly)
  caddy:     # reverse proxy, TLS, routes / and /api
volumes: [db-data, uploads, caddy-data]
```

Configuration via `.env` (documented `.env.example`):
```
POSTGRES_USER / PASSWORD / DB
JWT_SECRET / SESSION_SECRET
FX_PROVIDER=frankfurter
FX_FALLBACK_PROVIDER=erapi
FX_DEFAULT_BASE=EUR
APP_URL=https://gestion.example.com
UPLOAD_DIR=/data/uploads
```

Operational concerns:
- **Migrations** run automatically on backend startup (idempotent).
- **Backups**: nightly `pg_dump` sidecar/cron to the `db-data`-adjacent volume; document restore. Uploads volume backed up too.
- **Healthchecks** on db and backend; `restart: unless-stopped`.
- **Logs** to stdout (Docker captures).
- Single-command bootstrap: `cp .env.example .env && docker compose up -d`.

---

## 9. Security

- Passwords hashed with **argon2id** (or bcrypt cost ≥ 12).
- Session cookie: `httpOnly`, `Secure`, `SameSite=Lax`; CSRF protection for state-changing routes (double-submit token) since cookie-based.
- **Authorization**: every request scoped, user must be a member of the household for any household resource; role checks for admin actions (invites, base currency, member removal). **Personal-ledger resources (`/me/*`) are owner-only**, never exposed to other members or admins; enforce `user_id = session.user` on every accounts/personal-transactions query.
- Rate-limit auth endpoints; lockout/backoff on repeated failures.
- Validate & sanitize all input (zod schemas). Reject future payment dates, unknown currencies, splits that don't sum.
- File uploads: whitelist mime types, size cap, store outside webroot, randomized filenames, never execute.
- Secrets from env only; no secrets in image. Non-root container user.
- Audit log for money-affecting actions.

---

## 10. Testing

- **Unit**: money math (rounding, split distribution, largest-remainder), FX resolution incl. weekend/holiday fallback, balance & debt-simplification algorithms.
- **Integration**: transaction create → FX freeze → balance recompute; settlement clears debt; multi-currency end-to-end.
- **Contract test / mock** for the FX provider (record fixtures so tests don't hit the network; test fallback provider path).
- **Personal ledger**: account balance math (income/expense/transfer, cross-currency transfer legs), net-worth aggregation with current-rate conversion, owner-only access (a member cannot read another's `/me/*`), linked shared↔personal edit/delete propagation.
- **Seed script** with a demo household, 3 users, mixed-currency shared expenses, plus per-user accounts and personal transactions for manual QA.
- Property test: for any random set of expenses/splits, `Σ net(u) == 0` and simplified transfers reconcile balances.

---

## 11. Phased roadmap

**Phase 0, Skeleton (foundation)**
Repo layout (monorepo: `/backend`, `/frontend`, `/infra`), docker-compose with db+backend+frontend+caddy, migrations tooling, CI lint/test, `.env.example`. Health endpoints.

**Phase 1, Auth & households**
Register/login/sessions, household CRUD, membership, invites, authorization middleware.

**Phase 2, FX core**
`RateProvider` abstraction, Frankfurter adapter, cache table, weekend/holiday fallback, nightly prefetch scheduler, `/fx/rate` preview, unit tests with fixtures.

**Phase 3, Transactions & splits**
Transaction CRUD with FX freeze on create/edit, split types + invariant enforcement, receipt upload, list/filter.

**Phase 4, Tallies & reimbursements**
Balance engine with **per-category tallies** (green/red matrix), overall + per-category debt simplification, category-scoped reimbursements with "reset tally" (full/partial), settlements in any currency, tally board + settle-up UI.

**Phase 5, Personal finance module**
Accounts CRUD, personal transactions (income/expense/transfer), account balances, net worth (current-rate conversion), optional link to shared expenses, privacy scoping (owner-only). "My Money" overview + accounts + add-transaction UI.

**Phase 6, Statistics & polish**
Personal stats (cashflow, by-category, by-account, income timeline, net-worth trend) + shared reports & charts, dashboards, formatting/locale, audit log, backup sidecar, docs.

**Phase 7 (v2 backlog)**
CSV/bank import, OCR receipts, recurring transactions & scheduled income, budgets/savings goals, mobile PWA, OAuth login, per-user notifications.

---

## 12. Key decisions locked in
1. **Backend: Node + TypeScript + NestJS** (shared types with the React frontend).
2. **Single household** for v1: one group, no household-switcher, users belong to exactly one household. Keep `household_members` (roster + roles). Multi-household is a v2 lift, schema already carries `household_id` so it's non-breaking to add.
3. Store originals; freeze FX per transaction; never re-convert history.
4. `NUMERIC`/decimal everywhere; largest-remainder split rounding.
5. **One main currency** chosen at household creation drives all balances, per-category tallies, and reports; originals kept on every transaction.
6. **Tally is pairwise, per category**, exact "A owes B in category C" is preserved (derived from splits + settlements, no pooling into a household net); green = owed to user, red = user owes.
7. **Reimbursements are pairwise, category-scoped settlements**; a full one flags `is_full_reset` and zeroes `net_pair(from,to,category)`. History is append-only (offsetting entries, never deletion).
8. **Two ledgers**: shared (household, visible to members) and personal (private per user: accounts + income/expense/transfer, net worth). Optionally linked, independently usable.
9. **Net worth uses the latest rate** (current value); every *recorded* transaction still freezes its historical rate. Account balances are native-currency; aggregation converts.
10. Frankfurter primary + fallback provider; walk back to nearest prior published rate and record it.
11. Cookie-based auth, single origin, Caddy TLS, one-command Docker bootstrap.

> Single-household simplifications vs. the plan above: drop `/households` switcher UI and multi-membership joins; `GET /household` returns the one household. The `invites` flow still applies (add members to the household).
```
