# Gestion, Household Spending & Reimbursement

Self-hosted web app for tracking household spending, settling mutual debts
(pairwise, per-category, multi-currency with historical FX **frozen to the day
each transaction was paid**), plus a **private personal-finance ledger**
(accounts, income/expense/transfer, net worth, statistics).

It targets the **French and Canadian** markets: the UI is in **French**,
formatting is locale-aware (**fr-FR** default, **fr-CA** supported), and each
personal account is tagged with a country (FR/CA) that defaults its currency
(EUR/CAD). It is designed to run on a **home/household LAN**, not to be exposed
to the internet.

See [`PLAN.md`](./PLAN.md) for the full product spec and
[`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md) for the security posture.

## Features

- **Shared household ledger** — expenses with `equal | exact | percent | shares`
  splits (largest-remainder rounding), multi-currency with FX **frozen to the
  payment date**, receipt uploads, audit log.
- **Reimbursement engine** — directed, pairwise, per-category tally with
  category-scoped settlements and full-reset reimbursements. Green = owed to you,
  red = you owe.
- **Private personal ledger** (`/me/*`) — accounts (checking, savings, cash,
  credit card, investments, other), per-country FR/CA, income/expense/transfer,
  net worth and statistics computed at the **latest** rate. Includes historical
  net-worth snapshots, saved transaction filters, and a credit-card payoff
  projection. Strictly private to the owner.
- **In-app invitations** — a household owner/admin invites an existing
  registered user; no emails, tokens, or invite links.
- **French UI** — locale-aware (fr-FR / fr-CA) via a typed i18n dictionary.
- **Ops** — Docker Compose stack behind Caddy (auto-HTTPS), nightly
  integrity-verified `pg_dump` backups, all state bind-mounted to `./data/`,
  pinned image tags.

## Stack

| Layer     | Tech |
|-----------|------|
| Backend   | Node 24 · NestJS 11 · TypeScript · Prisma 7 (engine-free, `pg` driver adapter) · PostgreSQL 16 |
| Frontend  | React 18 · Vite 8 · TypeScript · Tailwind · TanStack Query · React Router 7 · Recharts |
| Money     | `decimal.js` in code · `NUMERIC(20,6)` in DB (rates `NUMERIC(20,10)`), never floats |
| Auth      | Opaque server-side session cookie (httpOnly, SameSite=Lax), argon2id, CSRF double-submit |
| FX        | Frankfurter (primary) with erapi fallback |
| Proxy     | Caddy (auto-HTTPS, `/api/*` → backend, `/` → frontend) |
| Runtime   | Docker Compose (`db`, `backend`, `frontend`, `caddy`, `db-backup`) |

## Prerequisites

- Docker + Docker Compose.
- A host on your LAN, and (for a real deployment) a hostname so Caddy can
  provision TLS.

## Quick start

The shipped `.env.example` defaults to a **plain-HTTP local-dev** setup (`:80`,
no TLS, insecure cookies) so it works out of the box on a laptop:

```bash
cp .env.example .env
docker compose up -d
```

Then open **http://localhost** in a browser and register the first user.

- Web UI: `http://localhost` (Caddy publishes ports `80` and `443`)
- API base path: `/api/v1`
- Health check: `GET /api/v1/health`

The backend applies Prisma migrations on startup (`prisma migrate deploy`) and
seeds nothing automatically, the first account you register becomes a real user.

## Production / LAN deployment

Do **not** run the plain-HTTP dev defaults on a real network. This app is meant
for a home LAN where a foothold (a passive sniffer or an ARP-spoof from a
compromised device) is in scope, over plain HTTP the session cookie and all
financial data traverse the LAN in cleartext. **Serve it over HTTPS.**

Change these together in `.env` (all documented inline in `.env.example`):

1. **`POSTGRES_PASSWORD` + `DATABASE_URL`** — a real secret. Generate one with
   `openssl rand -hex 32` and put the *same* value in both. The backend
   **refuses to boot in production** while these still contain `change-me…`.
2. **`CADDY_SITE_ADDRESS`** — a hostname so Caddy auto-provisions HTTPS.
3. **`APP_URL=https://<host>`** and **`COOKIE_SECURE=true`**.

`CADDY_SITE_ADDRESS` picks how TLS is obtained:

| `CADDY_SITE_ADDRESS` | TLS | Use |
|----------------------|-----|-----|
| `gestion.example.com` | Let's Encrypt (public DNS) | Public/real deploy |
| `gestion.home` (+ uncomment `tls internal` in `infra/Caddyfile`) | Caddy internal CA | LAN-only hostname |
| `:80` | **none** | **Dev only** — not for real deployments |

### Key environment variables

Full documentation lives in [`.env.example`](./.env.example); the ones you must
review:

| Var | Purpose |
|-----|---------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Postgres credentials. Backend refuses production boot while the password is `change-me…`. |
| `DATABASE_URL` | Prisma connection string, must match the Postgres credentials above. |
| `APP_URL` | **Required in production.** CORS allow-list origin (fails closed if unset in prod) and default source of the cookie `Secure` flag. Must match the scheme+host you actually reach the app on. |
| `COOKIE_SECURE` | `true` for HTTPS, `false` for plain-HTTP dev. Unset ⇒ derived from `APP_URL` scheme. |
| `CADDY_SITE_ADDRESS` / `CADDY_ACME_EMAIL` | Hostname for auto-HTTPS; ACME email for Let's Encrypt. |
| `SESSION_IDLE_MINUTES` / `SESSION_TTL_DAYS` | Sliding idle timeout (30 min) and absolute session lifetime (30 days). |
| `FX_PROVIDER` / `FX_FALLBACK_PROVIDER` / `FX_DEFAULT_BASE` | `frankfurter` / `erapi` / `EUR`. |
| `UPLOAD_DIR` / `UPLOAD_MAX_BYTES` / `UPLOAD_ALLOWED_MIME` | Receipt storage path, size cap (10 MB), and MIME allowlist. |
| `BACKUP_CRON` / `BACKUP_RETENTION_DAYS` | Nightly dump schedule and how many daily dumps to keep. |

There is deliberately **no `SESSION_SECRET` / `JWT_SECRET`** — sessions are
opaque server-side DB rows, not signed tokens.

## Data, backups & restore

All persistent state is **bind-mounted to `./data/`** (not Docker named
volumes), so it lives as plain files in the project tree:

| Path | Contents |
|------|----------|
| `./data/postgres` | PostgreSQL data cluster (owned by uid 999, mode 0700 — use `sudo` to read) |
| `./data/uploads` | Uploaded receipts |
| `./data/backups` | Nightly `pg_dump` archives |
| `./data/caddy/{data,config}` | Caddy certificates and state |

**To back up or migrate:** `docker compose down`, copy `./data` to the new host,
`docker compose up -d`.

The `db-backup` sidecar runs a nightly `pg_dump` (schedule `BACKUP_CRON`), writes
each dump to a temp file, verifies its gzip integrity, then atomically renames
it — so retention never keeps a truncated archive. Dumps older than
`BACKUP_RETENTION_DAYS` are pruned. Restore one with:

```bash
gunzip -c ./data/backups/gestion-<ts>.sql.gz \
  | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

## Troubleshooting

- **Login/registration fails with 403 over plain HTTP.** A `Secure` cookie is
  dropped by the browser over HTTP, so the session/CSRF cookies never stick. For
  a plain-HTTP run set `COOKIE_SECURE=false`, an `http://` `APP_URL`, and
  `CADDY_SITE_ADDRESS=:80`. For a real deployment, use HTTPS instead (see above).
- **Backend won't start in production.** It refuses to boot while
  `POSTGRES_PASSWORD` / `DATABASE_URL` still contain `change-me…`, or while
  `APP_URL` is unset. Set real values.
- **CORS errors in the browser.** `APP_URL` must exactly match the scheme+host
  you load the app from; the backend never reflects arbitrary origins.

## Security

Threat model: a self-hosted LAN deployment whose primary adversary is a
semi-trusted housemate plus anyone with a LAN foothold. Highlights:

- argon2id password hashing; opaque server-side sessions rotated on login; CSRF
  double-submit on every state-changing route.
- Household resources scoped to members; the `/me/*` personal ledger is
  owner-only (filtered by the session user, never a client-supplied id).
- Rate-limited auth, input validation, upload MIME/size allowlist, generic 500s
  (no internal leakage), non-root backend container, Postgres port not published.

Full detail and the regression checklist are in
[`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md).

## Local development

Running without Docker (needs a reachable Postgres):

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

Useful backend scripts (`backend/package.json`): `npm run build`, `npm test`,
`npm run prisma:migrate:dev` (create a migration), `npm run seed` (idempotent
demo data). Frontend: `npm run build` (`tsc -b && vite build`).

Contributor conventions, the QA gates, and the domain model are documented in
[`CLAUDE.md`](./CLAUDE.md).
