# Gestion, Household Spending & Reimbursement

Self-hosted app for tracking household spending, settling mutual debts (pairwise,
per-category, multi-currency with frozen historical FX), plus a private personal
finance ledger (accounts, income/expense/transfer, net worth). See
[`PLAN.md`](./PLAN.md) for the full product spec.

> **Status: Phase 0 skeleton.** The monorepo, shared contracts, Docker stack, and
> tooling are in place. Feature modules are typed **stubs** that throw
> `NOT_IMPLEMENTED`, feature agents fill the bodies without touching contracts.

## Stack

| Layer     | Tech |
|-----------|------|
| Backend   | NestJS 11 · TypeScript · Prisma 6 · PostgreSQL 16 |
| Frontend  | React 18 · Vite 6 · TypeScript · Tailwind · TanStack Query · React Router |
| Money     | `decimal.js` in code · `NUMERIC(20,6)` in DB (rates `NUMERIC(20,10)`) |
| Auth      | Session cookie (httpOnly, SameSite=Lax) |
| Proxy     | Caddy (auto-HTTPS, `/api/*` → backend, `/` → frontend) |
| Runtime   | Docker Compose |

## Layout

```
Gestion/
├── backend/        NestJS API (Prisma schema, modules, guards, FX contract)
├── frontend/       Vite + React SPA (typed API client, shared types, routes)
├── infra/          Caddyfile + ops
├── docker-compose.yml
├── .env.example
└── PLAN.md
```

## Quick start (Docker)

```bash
cp .env.example .env
openssl rand -hex 32                 # generate a POSTGRES_PASSWORD; put it in .env
                                     # (both POSTGRES_PASSWORD and DATABASE_URL)
docker compose up -d
```

In production the backend **refuses to start** while `POSTGRES_PASSWORD`/`DATABASE_URL`
still hold the shipped `change-me…` placeholder, and requires `APP_URL` (the CORS
allow-list origin). The backend applies Prisma migrations on startup (`prisma migrate deploy`).

- Health check: `GET /api/v1/health`
- API base path: `/api/v1`

### TLS is required (LAN threat model)

This app is meant to run on a home LAN where a foothold (a passive sniffer or an
ARP-spoof from a compromised device) is in scope. Over plain HTTP the session
cookie and all financial data traverse the LAN in cleartext and are trivially
captured, so **serve the app over HTTPS**. Point `CADDY_SITE_ADDRESS` at a hostname
and Caddy provisions a certificate automatically:

| `CADDY_SITE_ADDRESS` | TLS | Use |
|----------------------|-----|-----|
| `gestion.example.com` | Let's Encrypt (public DNS) | Public/real deploy |
| `gestion.home` (+ `tls internal` in `infra/Caddyfile`) | Caddy internal CA | LAN-only hostname |
| `:80` | **none** | **Dev only**, not for real deployments |

Cookie `Secure` is driven by `COOKIE_SECURE` (or, if unset, the `APP_URL` scheme:
`https` ⇒ Secure), it is no longer tied to `NODE_ENV`, so an HTTPS deploy gets
`Secure` cookies without forcing `NODE_ENV=development`. For a local HTTP dev run,
set `CADDY_SITE_ADDRESS=:80`, `COOKIE_SECURE=false`, and an `http://` `APP_URL`.

## Local development

```bash
# Backend
cd backend
npm install
npm run prisma:generate
docker compose up -d db            # or point DATABASE_URL at any Postgres
npm run prisma:migrate:deploy      # apply migrations
npm run start:dev                  # http://localhost:3000/api/v1

# Frontend (separate shell)
cd frontend
npm install
npm run dev                        # http://localhost:5173  (proxies /api → :3000)
```

## Backend commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile with `nest build` |
| `npm run start:dev` | Watch-mode dev server |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:migrate:dev` | Create a new migration (needs a running DB) |
| `npm run seed` | Seed demo data (skeleton) |
| `npm test` | Jest unit tests |

## Contracts feature agents must use

These are stable; fill the bodies, don't change the signatures.

**Backend, shared (`backend/src/common/`)**
- Guards: `AuthGuard`, `HouseholdMemberGuard`, `RoleGuard`
- Decorators: `@CurrentUser()`, `@Roles()`
- Pipe: `ZodValidationPipe` · Filter: `AllExceptionsFilter`
- Type: `AuthenticatedUser` / `RequestWithUser`
- DB: inject `PrismaService` (global module), never `new PrismaClient()`

**Backend, FX (`backend/src/modules/fx/`)**, imported by transactions,
settlements, personal. `FxService`: `getRate`, `convert`, `getLatestRate`;
provider abstraction via the `RateProvider` interface.

**Frontend, shared**
- Types: `frontend/src/types/index.ts` (mirror the backend DTOs)
- API client: `frontend/src/lib/api.ts` (`api` axios instance, `withCredentials`)
- Auth: `frontend/src/context/AuthContext.tsx` (`useAuth`)

## Money & FX invariants (enforce in code + tests)

- `amount_base == round(amount_original × fx_rate, 6)`
- `Σ transaction_splits.amount_base == transaction.amount_base` (largest-remainder rounding)
- Balances derive **only** from stored `amount_base`; never re-convert history
- Recorded transactions freeze the FX rate to the payment date; **net worth** is
  the sole place using the latest/current rate

## Security notes (PLAN.md §9)

- argon2id password hashing · session cookie httpOnly/Secure/SameSite=Lax + CSRF for writes
- Household resources scoped to members; `/me/*` personal ledger is owner-only
- Rate-limited auth · zod input validation · upload mime/size whitelist · non-root container

## Backups

The `db-backup` sidecar runs a nightly `pg_dump` into the `backups` volume and
prunes dumps older than `BACKUP_RETENTION_DAYS`. Restore:

```bash
gunzip -c backups/gestion-<ts>.sql.gz | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```
