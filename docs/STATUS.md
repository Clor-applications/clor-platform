# Build Status

Updated 16 Aug 2026. Tracks what has actually shipped against
[ROADMAP.md](ROADMAP.md). Gap IDs refer to [REVIEW.md](REVIEW.md).

Branch: `phase-0-hardening` (baseline commit on `main`).

---

## Phase 0 — Stop the bleeding: **done**

| Item | Gap | Commit | Verified by |
|---|---|---|---|
| git init + baseline commit | B-7 | `5555c28` | 139 files tracked, no secrets staged |
| Hardened .gitignore, rotated JWT_SECRET | B-3 | `5555c28` | `git check-ignore .env` passes; secret was literally `change-me` |
| Removed hardcoded superuser email | C-1 | `174f854` | no `isOwnerUser` references remain; frontend builds |
| RBAC on all five invoice routes | C-2 | `ed850dd` | live server: VIEW+CREATE role gets 200/201, EDIT and DELETE get 403 |
| Global email uniqueness + org context on login | C-3, E-7 | `1f145bc` | duplicate email across accounts rejected on create *and* rename; login returns activeOrgId/activeBranchId |
| Server build emits runnable ESM | B-1 | `dd81852` | `npm run build && npm start` serves /health 200 |
| Deleted the dead Sequelize backend | D-4 | `8b962ce` | 3,281 lines removed across 37 files; both builds clean |
| Cross-platform npm scripts, PowerShell removed | B-2, B-5 | `30e9db8` | tasks.json valid; scripts run on macOS |

## Phase 1 — Server as system of record: **started**

| Item | Gap | Commit | Status |
|---|---|---|---|
| Double-entry ledger schema | A-3 | `a99a76f` | **done** — FiscalYear, Journal, LedgerAccount, JournalEntry, JournalLine |
| Control accounts by `controlKind`, not by name | A-3 | `a99a76f` | **done** — proven by a test that renames the AR account and keeps posting |
| Balanced-or-rejected posting, integer paise | A-3 | `a99a76f` | **done** |
| Posted entries immutable, corrections by contra entry | A-3, A-5 | `a99a76f` | **done** |
| Period lock | A-4 | `a99a76f` | **done** — posting into a locked period returns 409 |
| Hash chain over posted entries | A-5 | `a99a76f` | **done** |
| Invoice posts to the GL on create, reverses on delete | A-3 | `a99a76f` | **done** |
| Trial balance from posted lines | A-3 | `a99a76f` | **done** — `GET /api/orgs/:orgId/ledger/trial-balance` |
| Test suite | B-4 | `a99a76f` | **done** — vitest + supertest, 11 passing |
| Postgres + migration history | D-1 | — | not started |
| Remaining domain models (customer, vendor, item, bill, payment...) | D-2 | — | not started |
| Frontend reads from the API instead of localStorage | A-1, A-2 | — | **not started — this is the next and largest piece** |
| `sourceSystem`/`sourceKey` on every entity | migration | — | present on LedgerAccount only |

---

## How to verify locally

```bash
npm run setup && npm test
```

11 tests should pass. Then:

```bash
npm start
```

Web on 5173, API on 4001.

---

## 17 Aug 2026 — payments reach the ledger

| Item | Commit | Verified by |
|---|---|---|
| Receipts/payments UI wired to the server API (req. 14) | `dde9c70` | live server: `/payment-modes` returns 1200 Cash-in-Hand + 1300 Bank Accounts; a 5000 receipt posts as `RCP-2627-00001`; trial balance Bank Dr 5000 / AR Cr 5000, balanced |
| IPv6 clients could not sign in, sign up or reset a password | `f52620d` | regression test sends `X-Forwarded-For: 2001:db8::1` with the limiter on — fails on the old code, passes on the fix |
| `npm run typecheck` (and so `npm run verify`) exited TS5058 | `f52620d` | `npm run typecheck` clean |

The auth bug is the one worth remembering: `ipKeyGenerator`'s second argument
is an IPv6 subnet mask, and the code passed the response object, so every
rate-limited route replied `{"error":"Invalid subnet mask."}`. It never showed
up in tests because supertest connects over IPv4 and the mask is only consulted
for IPv6 — but a browser on `localhost` (macOS resolves it to ::1) hit it every
time. Found by exercising the running server rather than by reading the code.

## Known blockers and caveats

- **Docker stack is still unverified, and it is an environment problem, not a
  code one.** Everything checkable without the daemon passes: `docker compose
  config` validates, every file the two images copy exists, and the exact
  command the API image runs — `node dist/index.js` — serves `/health` 200
  locally from the same compiled output. What cannot be done here is the build
  and run itself: Docker Desktop's processes are up and the CLI resolves its
  context, but the engine never answers, so `docker info` hangs on the Server
  section. Two attempts, hours apart.

  Three defects found and fixed by inspection while the daemon was down:

  1. **The api build shipped 536 MB of context.** Its context is `./server`,
     and Docker reads the `.dockerignore` beside the context — the root one
     does not apply. Added `server/.dockerignore`; context is now 0.5 MB
     across 49 files, and `prisma/dev.db` (48 MB) can no longer leak into an
     image.
  2. **Emailed links pointed at a dead port.** Compose never set `APP_URL`, so
     the server fell back to `http://localhost:5173` — the Vite dev port,
     which nothing serves under Docker. Every password-reset and verification
     link would have 404'd. Now defaults to `http://localhost:8080`.
  3. **`MAIL_SECRET_KEY` was unset**, so SMTP-password encryption silently fell
     back to `JWT_SECRET`; rotating the JWT secret would have made every stored
     SMTP password undecryptable. Now a separate generated secret.

  Known and deliberate: under `--profile postgres`, `api` has no `depends_on`
  on `db`. Adding one would implicitly activate the postgres profile on every
  default (SQLite) run. `restart: unless-stopped` covers the startup race
  instead.

  To finish it on a machine with a working daemon:

  ```bash
  npm run docker:up                       # creates .env and its secrets
  curl -f http://localhost:8080/          # the app
  curl -f http://localhost:8080/health    # the API through nginx
  ```
- **The frontend still writes the book to localStorage.** The ledger exists and
  invoices post to it, but every other voucher type is still client-only. Until
  the frontend migration lands, the GL is authoritative for invoices only.
- **SQLite still.** `invoices.ts` continues to use `$queryRawUnsafe` with
  SQLite `?` placeholders; Postgres needs `$1..$n` (gap D-1, C-9).
- **`requirePermission` still self-heals** for the org creator (gap C-4). Left
  in deliberately — removing it without a role-management UI would lock owners
  out of their own orgs. Phase 3.
- **Existing non-creator admins** need SALES/Invoices and ACCOUNTING/Ledger
  granted once via Settings → Roles.
- **node_modules had Windows binaries** (rollup, esbuild, bcrypt). Reinstalled
  for macOS; a Windows machine will need its own `npm install`.
