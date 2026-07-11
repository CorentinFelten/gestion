# SECURITY_AUDIT.md, Gestion

> **⚠️ Reconstructed / living document.** The original signed audit artifact was
> not committed to the repository. This file is a **faithful reconstruction** of
> that audit, rebuilt from the evidence recorded in `CLAUDE.md` (§6 security
> model and §7.3 security audit → remediation → regression). It is intended as
> the working security reference and regression checklist; it is **not** the
> original signed report, and it should be kept in sync as the code evolves.
> Do not treat unqualified statements here as an independent re-audit.

---

## 1. Scope & threat model

**Gestion** is a self-hosted, Docker-first household finance app. It is
**LAN-only and not internet-facing by design** (single household on a home
network).

Primary adversaries, in priority order:

1. **A semi-trusted housemate** — a legitimate, authenticated user of the same
   deployment who should *not* be able to read another member's private personal
   ledger, tamper with money-affecting rows they don't own, escalate their role,
   or act on invitations addressed to someone else.
2. **A LAN foothold** — a passive sniffer or an ARP-spoofing device on the same
   network that can observe/redirect traffic (hence TLS is required; over plain
   HTTP the session cookie and all financial data cross the LAN in cleartext).

Out of scope by design: a hostile internet (the app is not exposed publicly),
nation-state adversaries, physical compromise of the host, and multi-household
tenancy (v2).

The audit reviewed every controller's guard stack, Prisma scoping, cookies /
sessions / CSRF, invitations, input validation, the global error filter,
secrets handling, the container/compose posture, and `npm audit`, calibrated to
the threat model above.

---

## 2. Controls that must be preserved (do not regress)

Any change touching auth, guards, the ledger, uploads, or ops **must** keep all
of these intact, and re-run the regression assertions in §4:

- **Personal ledger isolation** — `/me/*` is owner-only; every query is filtered
  by the session `userId`, never a client-supplied id. Non-owned resources
  return **404** (no existence leak).
- **Authorization stack** — `AuthGuard` + `HouseholdMemberGuard` + `RoleGuard`
  on household routes; resource routes (`/transactions/:id`) do a
  membership/ownership check and return **404 (not 403)** to non-members.
  Transaction edit/delete is restricted to the creator/payer or an admin.
- **CSRF** — `CsrfGuard` (double-submit, `timingSafeEqual`) on **every**
  state-changing route (POST/PATCH/DELETE).
- **Sessions** — CSPRNG token (`randomBytes(32).base64url`), httpOnly +
  SameSite=Lax + Secure (per `COOKIE_SECURE` / `APP_URL` scheme, not
  `NODE_ENV`), server-side rows, rotated on login.
- **Passwords** — argon2id; login is timing-normalized with a generic error (no
  user enumeration).
- **Invites** — in-app only (no emails/tokens/links). An owner/admin invites an
  existing registered user; only the invited user may accept/decline; only an
  owner may grant `admin`; the single-household invariant is enforced on accept.
- **Audit log** — money-affecting writes (transactions, settlements) write
  `audit_log` rows.
- **Error hygiene** — 500s return a generic message (no Prisma/internal
  leakage); full detail is logged server-side only.
- **Uploads** — `FileInterceptor` with MIME allowlist + size cap + randomized
  on-disk filename, stored outside any webroot.
- **CORS fails closed** — requires `APP_URL`; never reflects arbitrary origins.
- **Rate limiting** — global `ThrottlerGuard` registered as `APP_GUARD`, with
  stricter limits on auth; must **not** be double-registered on auth routes (that
  halves the effective limit — see SEC-07).
- **Data-tier exposure** — Prisma only (no raw SQL); non-root backend container;
  Postgres port **not** published to the host.

---

## 3. Findings summary

Calibrated to the LAN + semi-trusted-housemate threat model. **13 findings:
0 Critical, 0 High, 4 Medium, 7 Low, 2 Info.** All findings were remediated
(SEC-01…SEC-13) and each fix is covered by a regression assertion (§4).

| ID | Severity | Area | Finding (summary) | Remediation |
|----|----------|------|-------------------|-------------|
| SEC-01 | Medium | Sessions | Session identifier must be an unpredictable CSPRNG token, not a guessable/sequential id (e.g. a cuid). | `SessionService.create` issues `randomBytes(32).base64url` (43-char, high-entropy). |
| SEC-02 | Medium | Cookies | Cookie `Secure` flag was coupled to `NODE_ENV`, so an HTTPS deploy left in `production` was fine but the flag couldn't be set without forcing env changes; risk of shipping non-Secure cookies over TLS. | `Secure` now derives from `COOKIE_SECURE`, or the `APP_URL` scheme when unset (`https` ⇒ Secure), independent of `NODE_ENV`. |
| SEC-03 | Medium | Invitations | An invitation must only be acceptable by the invited user; a mismatched actor must not be able to accept/join. | Accept/decline verify the session user is the invitee; mismatch → **404**. Only an owner may grant `admin`; single-household enforced on accept. |
| SEC-04 | Medium | Ledger authz + audit | Transaction edit/delete must be restricted to the creator/payer or an admin; money-affecting writes must be auditable. | Ownership/role check on edit/delete (non-authorized → **403**); `audit_log` rows written on transaction + settlement writes. |
| SEC-05 | Low | Error hygiene | Unhandled errors could leak Prisma/internal detail to clients. | `AllExceptionsFilter` returns a generic 500 body; full detail logged server-side only. |
| SEC-06 | Low | CORS | CORS must fail closed and never reflect arbitrary origins. | CORS allow-list is driven by `APP_URL`; the backend refuses to boot in production without it and does not reflect other origins. |
| SEC-07 | Low | Rate limiting | Global throttler was double-registered on auth routes, **halving** the intended auth rate limit (a defect unit tests missed, caught in consolidated verification). | Single `ThrottlerGuard` as `APP_GUARD`; auth-specific limits applied once, not stacked. |
| SEC-08 | Low | Personal ledger | `/me/*` must be strictly owner-scoped and never trust a client-supplied user id. | Every `/me/*` query filters by the session `userId`; non-owned rows → 404. |
| SEC-09 | Low | Resource authz | Household resource routes must not leak existence to non-members. | `/transactions/:id` and peers return **404 (not 403)** to non-members. |
| SEC-10 | Low | Uploads | Receipt upload must restrict content type and size and not use client filenames. | `FileInterceptor` with MIME allowlist + size cap + randomized on-disk filename; disallowed MIME → **400**. |
| SEC-11 | Low | Input scoping | A category used on a transaction must be a global default or belong to the household. | Category ownership validated; out-of-household category → **400**. |
| SEC-12 | Info | Container/compose | Backend should run non-root and the database port should not be reachable from the host. | Non-root backend container; Postgres port **not** published in compose (reachable only on the internal Docker network). |
| SEC-13 | Info | Secrets | Inert signing secrets create a false sense of protection; shipped placeholder credentials must not reach production. | `SESSION_SECRET`/`JWT_SECRET` removed (sessions are opaque DB rows); backend refuses to boot in production while `POSTGRES_PASSWORD`/`DATABASE_URL` still contain `change-me`. |

---

## 4. Remediation regression assertions (must stay green)

These are exercised by the end-to-end security regression suite
(`scripts/smoke-test-postfix.mjs`, which also inspects the DB) alongside the
unit tests. Re-run them after any change to auth, guards, sessions/CSRF,
invites, uploads, the error filter, or the container/compose posture:

- **SEC-01** — the issued session cookie matches `^[A-Za-z0-9_-]{43}$` (a CSPRNG
  `base64url` token), **not** a cuid/sequential id.
- **SEC-02** — with an `https` `APP_URL` (or `COOKIE_SECURE=true`) the session /
  CSRF cookies carry `Secure`; with the plain-HTTP dev config they do not (so
  the browser keeps them).
- **SEC-03** — accepting an invitation as a **mismatched** user → **404**;
  accepting as the correctly invited user → **201**.
- **SEC-04** — money-affecting writes create `audit_log` rows; a non-creator /
  non-admin editing another user's transaction → **403**.
- **SEC-05** — a forced 500 returns a **generic** body with **no** internal /
  Prisma leakage.
- **SEC-07** — the auth rate limit reflects the intended (non-halved) value
  (regression for the double-registration defect).
- **SEC-08** — a user cannot read another user's `/me/*` resources (owner-scoped;
  non-owned → 404).
- **SEC-10** — a disallowed upload MIME type → **400**.
- **SEC-11** — a transaction referencing an out-of-household category → **400**.
- **SEC-12/13** — Postgres port is not published to the host; the backend
  refuses to boot in production with `change-me` credentials or without
  `APP_URL`.

> The SEC-07 finding is the canonical example of why this project mandates a
> **consolidated verification after any parallel/multi-agent change**: independent
> agents each registered the throttler, unit tests passed in isolation, and only
> the combined run surfaced the halved auth limit. Keep that discipline.

---

## 5. Operational security notes

- **TLS is required** for any real deployment — point `CADDY_SITE_ADDRESS` at a
  hostname (Let's Encrypt for public DNS, or `tls internal` for a LAN-only host)
  and set `COOKIE_SECURE=true` with an `https://` `APP_URL`. The `:80` /
  `COOKIE_SECURE=false` path is **dev only**.
- **Reverse-proxy hardening** — Caddy emits HSTS, `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options: DENY`, and a strict same-origin CSP
  (`frame-ancestors 'none'`) for the self-contained SPA.
- **Backups** — the `db-backup` sidecar writes each dump to a temp file,
  verifies the gzip stream (`gzip -t`), and atomically renames it, so retention
  never keeps a truncated/corrupt archive; dumps carry a Postgres
  `statement_timeout` so a hung query can't block backups indefinitely.
- **Secrets** — never commit a real `.env`; rotate `POSTGRES_PASSWORD` (and the
  matching `DATABASE_URL`) before any non-local deploy.
- **Dependencies** — CI runs build + tests on every push/PR; Dependabot tracks
  npm (backend + frontend), Docker base images, and GitHub Actions.

---

*Reconstructed from `CLAUDE.md` §6 and §7.3. When the code or threat model
changes, update both this file and `CLAUDE.md`.*
