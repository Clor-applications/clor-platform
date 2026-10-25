# Staging test report — 25 Oct 2026

End-to-end, isolation/security and load testing of Clor on a new staging
stack that mirrors production. Scripts are in `test/staging/`.

## The staging stack

| Piece | Staging | Production |
|---|---|---|
| Website | staging.clor.in (Pages `clor-staging`) | clor.in |
| App | app., accounting., payroll., attendance., people., ops.staging.clor.in (Pages `clor-app-staging`) | *.clor.in |
| API | api.staging.clor.in → Worker `clor-api-proxy-staging` → Cloud Run `clor-api-staging` | api.clor.in → `clor-api` |
| Database | Cloud SQL `clor-pg-staging` (db-f1-micro, own instance) | `clor-pg` (db-f1-micro) |
| Secrets | `JWT_SECRET_STAGING`, `EDGE_SECRET_STAGING`, `MAIL_SECRET_KEY_STAGING`, `DB_PASSWORD_STAGING` | separate |
| Email | not sent (captured in `EmailOutbox`) | Brevo SMTP |
| Rate limits | **off** (`DISABLE_RATE_LIMIT=true`) for test runs | on |
| Indexing | `X-Robots-Tag: noindex` | indexed |

Staging sign-ins are useless on production and the other way round (own JWT
secret, issuer `clor-staging`). The `*_staging` databases left on `clor-pg`
are no longer used.

## Results

### Journey (`journey-signup.cjs`) — pass
staging.clor.in → product page → its Start button (`?app=accounting`) →
sign-up → company setup → lands in Accounting at `/o/<10-digit code>/`.
No page errors. Warm timings: sign-up 2.4 s, setup → app 1.4 s.

### Isolation & security (`isolation-security.cjs`) — 53 / 55 pass

Pass:
- **Company isolation** — account A cannot list, read, edit, delete or export
  account B's data by B's path, B's headers, mixed path/headers, or B's
  record ids through A's company; B cannot reach A's second company.
- **Roles** — a member holding only "view items" cannot create items, list
  invoices, add users, create roles (no self-escalation), read account
  members, or open another company of the same account.
- **Operator console** — every `/api/ops/*` route refuses a customer.
- **Sign-in** — no token, bad signature, `alg=none`, edited claims: all 401.
  Repeated wrong passwords lock the account.
- **Injection** — script in names stored as text; SQL/template/path strings in
  search never 500; path traversal not served; no stack traces in errors.
- **CORS** — foreign origin refused, own app allowed.
- **Cookies** — refresh cookie HttpOnly, Secure, SameSite.
- **Headers** — HSTS, X-Frame-Options DENY, nosniff; API hides its framework.
- **Rate limits** (limiter on) — per email (10/15 min), per address
  (30/15 min, IPv6 per /56), sign-up per address; a forged
  `X-Forwarded-For` does not get round them.
- **Guessing** — unknown company codes on the portal all get one answer.

Open:
1. **CSP is report-only** (medium). Enforced on staging across every app's
   screens (`csp-walk.cjs`), the only thing it blocks is Cloudflare Web
   Analytics' injected beacon. To enforce in production: add
   `https://static.cloudflareinsights.com` to `script-src` and
   `https://cloudflareinsights.com` to `connect-src` (or turn the beacon
   off), then rename the header in `public/_headers`.
2. **Account enumeration through lockout** (low–medium). A locked real
   address answers 429 "Too many failed attempts"; an unknown address keeps
   answering 401 until the per-email limiter's 429 (different wording).

### Bugs found by concurrent use — fixed and released (PR #34)

| Finding | Fix |
|---|---|
| Two invoices posted at once: one failed on the journal entry number, and the hash chain could fork | Postings take an advisory lock per company + branch |
| First two invoices of a financial year at once: one failed | Fiscal year insert-or-take |
| Two customers/vendors added at once: "code already in use" | Allotted code re-allotted on a race |
| Two items added at once: same | Same |
| A failed invoice save showed the raw database error | Logged; user gets a plain message and request id |
| Company setup took ~7 s | Batched inserts: ~1 s |

Still open: party and item codes have **no unique index** in the database,
so a very tight race can still store a duplicate code. Adding one needs a
check of existing data for duplicates first.

### Load (`load-seed.cjs`, `load-run.cjs`)

Seeded 10 companies × (25 customers, 40 items, 100 invoices, 25 employees),
0 errors. Each virtual user: sign in, open lists, open an invoice, save an
invoice every fourth round, ~1.5 s think time.

| 10 users, 150–180 s | Pools 4/2 (production today) | Pools 6/3 |
|---|---|---|
| `/auth/me` median / p95 | 2,552 / 7,180 ms | 347 / 799 ms |
| Lists median / p95 | ~2,000 / 10–19,000 ms | ~300 / <800 ms |
| Save invoice median / p95 | 10,571 / 17,388 ms | 898 / 1,832 ms |
| Browser: open invoices screen | 18 s median | — |
| Errors | 0 | 0 |
| Database CPU | ~20 % | — |

Single user, no load: 230–650 ms per request.

**Capacity finding (high).** Requests queue on the database connection pool
(4 main / 2 platform per instance). Bigger pools fix 10 users, but with the
50-company seed running the staging server reached **25/25 connections and
100 % memory** and requests stalled for minutes. db-f1-micro (~0.6 GB) cannot
serve 50–100 active users with either setting.

**Production's `clor-pg` is at 100 % memory while nearly idle** (18
connections now, 30 peak this week). Decision on 25 Oct: no upgrade for now.
Recommended when ready: `db-custom-1-3840` (1 vCPU, 3.75 GB, ~$50/month,
one 1–2 min restart), pools 6/3, then repeat the 50- and 100-user steps on a
matching staging instance. The 50/100-user steps were not run.

## Running the suites

```bash
export STAGING_PASSWORD=...                    # test password, not a real one
node test/staging/isolation-security.cjs       # limiter off on staging
LIMITER=on node test/staging/isolation-security.cjs   # limiter on
node <playwright-skill>/run.js test/staging/journey-signup.cjs
COMPANIES=10 OUT=seed.json node test/staging/load-seed.cjs
SEED=seed.json USERS=10 SECONDS=180 BROWSERS=2 node test/staging/load-run.cjs
```

Load scripts refuse any API URL without "staging" in it.
