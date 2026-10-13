# Accounting App — Architecture & Code Review

Reviewed: 16 Aug 2026. Scope: full repo (`src/`, `server/`, build/config).
Verdict: **working prototype, not yet a system of record.** The UI surface is
broad and genuinely useful; the persistence and accounting core are not.

> **Remediation in progress.** Rows marked **FIXED** have shipped on the
> `phase-0-hardening` branch and are verified by tests or against a live
> server. Rows marked **PARTLY FIXED** have landed server-side but are not yet
> true end to end. See [STATUS.md](STATUS.md) for commits and evidence. The
> original finding is left in place so the record of what was wrong survives.

---

## 1. Present state

### 1.1 Stack

| Layer | Tech | State |
|---|---|---|
| Frontend | React 19, Vite 7, Tailwind 3, lucide-react, jspdf + xlsx export | Feature-rich, ~26k lines JS/JSX |
| Backend (live) | Express 4 + TypeScript + Prisma 5 + SQLite, JWT auth | `server/src/index.ts`, port 4001 |
| Backend (dead) | Express + Sequelize CommonJS tree | ~2.5k lines, unreachable — `sequelize` isn't even a dependency |
| Data store (real) | **browser localStorage** — key `accountingDB:<accountId>:<orgId>` | Holds nearly all accounting data |
| Tests / CI / containers | none | — |

### 1.2 What the frontend actually does

Single 10.5k-line `src/App.jsx` orchestrates everything. Modules present:

- **Sales** — invoices, estimates, credit notes, invoice preview/PDF, payment capture
- **Purchase** — bills, purchase orders, debit notes, expenses
- **Inventory** — items, stock summary, stock transfers, inter-branch transfer
- **Cash & Bank** — 1,985-line module: receipts, disbursements, bank transactions
- **Accounting** — chart of accounts, account groups/types, journal entries, ledger view
- **Reports** — Trial Balance, P&L, Balance Sheet, Cash Flow, Sales reports, **GSTR-1, GSTR-3B**
- **Masters/settings** — company profile, UoM, GST rates, document numbering, invoice
  templates, tax compliance, branches, warehouses, users, roles
- **GST engine** — `src/utils/gst.js`: 38 state codes, intra/inter-state detection,
  CGST/SGST vs IGST split per line

### 1.3 What the backend actually does

Only **auth + org/branch/warehouse/user/role admin + inter-branch transfers +
invoices** are server-side:

- `POST /api/auth/{login,signup,setup-company,forgot-password,reset-password}`, `GET /api/auth/me`
- `/api/orgs/:orgId/{branches,warehouses,roles,users,transfers,adjustments,invoices}`
- Tenancy chain `Account -> Org -> Branch -> Warehouse`, enforced by
  `requireAuth` -> `requireTenantContext` (headers `x-org-id`, `x-branch-id`,
  `x-warehouse-id`) -> `requirePermission(module, action, subModule)` reading
  DB-stored RBAC (`Role`/`Permission`/`RolePermission`/`UserRoleAssignment`).
- Inter-branch transfer with a real state machine (DRAFT → SENT → RECEIVED/REJECTED)
  and `StockBalance` decrement/increment inside `prisma.$transaction`.

The isolation design is the strongest part of the codebase. It's applied
consistently in `branches.ts`, `warehouses.ts`, `roles.ts`, `users.ts`,
`transfers.ts`, `inventoryAdjustments.ts` — **but not `invoices.ts`** (see C-2).

---

## 2. Gaps

Severity: **P0** = blocks real use / data loss / security, **P1** = serious,
**P2** = quality and maintainability.

### A. Data architecture

| # | P | Gap |
|---|---|---|
| A-1 | **P0** | **Books of account live in localStorage.** Clearing site data, switching browser, or switching device destroys the ledger. No backup, no server copy, no export-on-write. This is the single blocking defect for an accounting product. |
| A-2 | **P0** | **Invoice sync is write-only.** `createInvoiceApi/updateInvoiceApi` push to the server, but `listInvoicesApi` is never imported anywhere — the server copy is never read back. Two devices diverge silently; a re-install shows an empty book while the server holds rows. |
| A-3 | **P0** | **PARTLY FIXED** (`a99a76f` — real double-entry GL, control accounts by `controlKind`, balanced-or-rejected, immutable posted entries; invoices post to it, but every other voucher type is still client-only). Original finding: **No general ledger.** `buildLedgerStatement` (`src/data/db.js:3110`) *derives* postings at render time from invoices/bills/expenses/payments, resolving control accounts by **name/code string match** (`'accounts receivable'`, code `'1100'`, falling back to a suspense account). Rename an account and the trial balance changes retroactively. There is no immutable journal, no double-entry guarantee, no posted/unposted state. |
| A-4 | **P1** | **FIXED** (`a99a76f` — period lock; posting into a locked period returns 409). Original finding: No fiscal-period close or lock. Any historical voucher can be edited or deleted forever; there is no "books closed through" date. |
| A-5 | **P1** | **PARTLY FIXED** (`a99a76f` — posted entries are immutable and hash-chained, corrections are contra entries; a full per-field audit log is still missing). Original finding: No audit trail on the data that matters. `AuditLog` exists in Prisma and is written only for user CREATE/DELETE; nothing logs invoice/ledger changes. |
| A-6 | **P1** | Numeric IDs come from `getNextNumericId` (max + 1 over a local array). Two tabs, or one tab per branch, mint the same ID. |
| A-7 | **P1** | Money is JS `number` with `round2` at the edges. Float drift is small but real in a book that must foot exactly; server-side `Decimal` exists only for stock quantities. |
| A-8 | **P2** | Voucher numbering (`bumpCompanyNextNumber`) is client-side and unenforced — the only uniqueness guard anywhere is the DB unique index `(orgId, branchId, number)` on `Invoice`. |

### B. Build, runtime, ops

| # | P | Gap |
|---|---|---|
| B-1 | **P0** | **FIXED** (`dd81852` — NodeNext plus `.js` specifiers; `npm run build && npm start` boots). Original finding: **`npm start` on the server is broken.** `tsconfig` emits ESM (`module: ES2022`, `moduleResolution: Bundler`) but leaves relative imports extensionless — `server/dist/index.js` does `import { buildApp } from './app'`, which Node rejects with `ERR_MODULE_NOT_FOUND`. Only `tsx` works. Fix: `module/moduleResolution: NodeNext` + `.js` specifiers, or bundle with tsup/esbuild. |
| B-2 | **P0** | **PARTLY FIXED** (Docker stack added; compose validates but an end-to-end run is still unverified, and there is no CI). Original finding: No containers, no CI, no deployment path (addressed here: `docker-compose.yml`, `docker/`). |
| B-3 | **P1** | **FIXED** (`5555c28` — .env, *.db, dist, logs, tmp ignored; JWT_SECRET rotated off `change-me`). Original finding: **`server/.env` exists on disk and `.gitignore` does not cover it** (it only ignores `*.local`, not `.env`). Same for `server/prisma/dev.db`. Rotate `JWT_SECRET` before this repo goes anywhere. |
| B-4 | **P1** | **PARTLY FIXED** (`a99a76f` — vitest + supertest, 11 tests covering ledger math, period lock, and tenancy isolation; frontend and GST logic remain untested). Original finding: Zero tests. No vitest/jest, no supertest, no smoke script. For tax logic (GSTR-1/3B) and ledger math, this is the highest-value missing safety net. |
| B-5 | **P1** | **FIXED** (`30e9db8` — cross-platform npm scripts, PowerShell tasks and .ps1 helpers removed). Original finding: Windows-only tooling: every `.vscode/tasks.json` task shells `powershell.exe`/`npm.cmd`; helper scripts are `.ps1`. Nothing runs on this macOS host. |
| B-6 | **P2** | Committed build output (`dist/`, `server/dist/`), logs (`server/logs/`, `*.out.log`, `*.err.log`), `tmp/`, and `_backup_before_onedrive_restore/` all sit in the working tree. `tools/bracecheck.js` exists purely to find unbalanced braces in `App.jsx` — a symptom, not a tool. |
| B-7 | **P2** | **FIXED** (`5555c28` — repo initialised, baseline committed). Original finding: Not a git repo. There is no undo stack for a 39k-line codebase. |
| B-8 | **P2** | No lint/typecheck on the server (`eslint.config.js` covers the frontend only); frontend is untyped JS despite `@types/react` being installed. |

### C. Security

| # | P | Gap |
|---|---|---|
| C-1 | **P0** | **FIXED** (`174f854` — removed; authority comes only from `/auth/me`). Original finding: **Hardcoded superuser by email.** `src/App.jsx:9068` — `email === 'anandgowda.sr@gmail.com'` grants `isOwnerUser`, which disables all branch restrictions client-side. Anyone can set `localStorage.userEmail`. Remove entirely; authority must come from `/auth/me`. |
| C-2 | **P0** | **FIXED** (`ed850dd` — all five routes gate on SALES/Invoices; verified live that a VIEW+CREATE role gets 403 on EDIT and DELETE). Original finding: **Invoice routes have no permission check.** `invoicesRouter.use(requireAuth, requireTenantContext)` only — any authenticated member of a branch can create, edit, restatus, or **delete** invoices regardless of role. Every other router calls `requirePermission`. |
| C-3 | **P1** | **FIXED** (`1f145bc` — email and username are unique across all accounts, on create and on rename). Original finding: **Login is not account-scoped.** `prisma.user.findFirst({ where: { OR: [{email},{username}] } })` searches across all accounts, while the unique index is `(accountId, email)` — the same email can exist in two accounts, and login resolves to whichever row comes first. |
| C-4 | **P1** | **RBAC self-escalation path.** `requirePermission` catches a denial and calls `ensureOwnerPermissionForCreator`, which *grants the missing permission* to the org creator's Owner role and retries. Convenient, but it means a permission check can mutate the permission table. Bootstrap belongs in signup/setup only. |
| C-5 | **P1** | Password reset tokens live in a **module-level `Map`** (`RESET_TOKENS`) — lost on restart, not shared across instances, and generated with `Math.random()` (not cryptographic). Use `crypto.randomBytes` + a DB table. |
| C-6 | **P1** | No rate limiting or lockout on `/login`, `/signup`, `/forgot-password`. No email verification on signup — every signup silently creates a new `Account` (tenant). |
| C-7 | **P1** | JWT in `localStorage` (XSS-readable), 8h lifetime, no refresh, no revocation/logout server-side. `logout()` just deletes the local key. |
| C-8 | **P1** | `POST /api/users` accepts `orgIds`/`branchIdsByOrg` from the request body and creates memberships without verifying those orgs/branches belong to the caller's `accountId`. Cross-account rows don't currently leak data (queries also filter `accountId`), but it's an unvalidated foreign key straight from user input. |
| C-9 | **P2** | `invoices.ts` uses `$queryRawUnsafe`/`$executeRawUnsafe` throughout. Values *are* bound as parameters so it isn't injectable today, but it bypasses Prisma's typing and hardcodes SQLite syntax. Likely a workaround for a stale generated client — regenerate and use `prisma.invoice.*`. |
| C-10 | **P2** | Dev-mode leaks: login distinguishes "User not found" from "Wrong password"; `/forgot-password` returns `devToken`. Both are `NODE_ENV`-gated, so ship with `NODE_ENV=production` set. |

### D. Backend completeness

| # | P | Gap |
|---|---|---|
| D-1 | **P1** | SQLite only. Single-writer, no concurrency, `Decimal` emulated. Postgres needs: provider switch, `?` → `$1` in the raw invoice SQL, and a real migration history (`prisma/migrations` doesn't exist — schema is applied by `db push`). |
| D-2 | **P1** | No API for the bulk of the domain: customers, vendors, items, chart of accounts, journal entries, bills, payments, expenses, credit/debit notes, estimates, POs. All client-only. |
| D-3 | **P1** | The `Item` and `StockBalance` tables are server-side, but the frontend's items live in localStorage with numeric IDs — the transfer feature therefore transfers items the server may not know about. Two disconnected item catalogs. |
| D-4 | **P2** | **FIXED** (`8b962ce` — 3,281 lines across 37 files removed, plus its two dangling client calls). Original finding: Dead Sequelize backend (`server/src/{controllers,models,routes/*.js,services}`) duplicates auth/roles/permissions with a *different* permission vocabulary (`sales.invoices.create` vs `SALES::Invoices::CREATE`). Delete it, or it will be edited by mistake. |
| D-5 | **P2** | `transfers` reduce stock on send with no negative-stock guard and no reservation; `InventoryAdjustment` rows are recorded but never applied to `StockBalance`. |
| D-6 | **P2** | No pagination anywhere — `GET /invoices` returns every row for the branch. |

### E. Frontend quality

| # | P | Gap |
|---|---|---|
| E-1 | **P1** | `App.jsx` is 10,554 lines holding ~35 components including full report implementations (Balance Sheet, GSTR-1, GSTR-3B). Unreviewable, unmergeable, and it re-renders the world on every keystroke — the whole DB is one `useState` serialized to `localStorage` on every change (`JSON.stringify` of the entire book, per edit). |
| E-2 | **P1** | No routing (`react-router` absent). Navigation is `useState('dashboard')`, so there are no deep links, no back button, no refresh-safe state. |
| E-3 | **P1** | No client-side permission gating tied to the server's permission set — `/auth/me` returns `isOrgAdmin` + `allowedBranchIds` only. Menus are hidden by ad-hoc checks. |
| E-4 | **P1** | User feedback is `alert()` and `window.confirm`; no toasts, no inline error surfaces, no optimistic/rollback handling. Failed invoice sync shows an alert and silently aborts the local save. |
| E-5 | **P2** | No form validation library; no i18n; currency is hardcoded INR (`getCurrencyCode` ignores its argument). No dark mode, no responsive/mobile pass, no a11y pass. |
| E-6 | **P2** | No data-grid virtualization — every list renders all rows. At the seeded 75 vouchers it's fine; at 10k it won't be. |
| E-7 | **P2** | **FIXED** (`1f145bc` — login returns companies, activeOrgId, activeBranchId and AuthGate stores them). Original finding: Login never sets `activeOrgId`: `AuthGate` reads `res.data?.companies?.[0]?.orgId`, but `POST /auth/login` returns only `{token, user}`. Returning users work only because the value survives in localStorage from the original signup on that browser. Fix on the server (return orgs) or call `/auth/me` right after login. |

---

## 3. Upgrades & enhancements (recommended)

### 3.1 Must-fix before any real user (P0)

1. **Move the book to the server.** Promote the localStorage schema to Prisma
   models (customers, vendors, items, accounts, vouchers, journal lines) and make
   the client a cache, not the source of truth.
2. **Introduce a real double-entry GL**: immutable `JournalEntry` +
   `JournalLine` rows, posted per voucher, balanced-or-rejected at write time,
   with control accounts referenced **by ID**, not by name. Reports read the GL.
3. **Close the invoice loop** — call `listInvoicesApi` on load, reconcile by
   `backendInvoiceId`, and make server state win.
4. **Delete the hardcoded owner email** (C-1) and **add `requirePermission` to
   invoice routes** (C-2).
5. **Fix the server build** (B-1) so a plain `node dist/index.js` boots.
6. **Ignore and rotate secrets** — add `.env`, `*.db`, `dist/`, `logs/`, `tmp/`
   to `.gitignore`; regenerate `JWT_SECRET`.

### 3.2 High value next (P1)

- Postgres + `prisma migrate` history; `Decimal` for every monetary column.
- Split `App.jsx` by route; adopt `react-router` and lazy-load report modules.
- Server-side permission list on `/auth/me`, and a `<Can permission="...">`
  wrapper so UI and API agree on one vocabulary.
- Replace `alert()` with a toast/error system and add a global API error handler
  (401 → re-auth, 403 → explain the missing permission).
- Tests: vitest for `gst.js`/GSTR builders/ledger math, supertest for tenancy
  isolation (the "user of org A cannot read org B" case deserves a permanent test).
- Rate limiting (`express-rate-limit`) on auth routes, `crypto.randomBytes`
  reset tokens persisted in the DB, refresh-token rotation.
- Pagination + server-side filtering on every list endpoint.
- Delete the dead Sequelize tree.

### 3.3 Product enhancements (P2, after the core is solid)

- **Compliance**: e-Invoice (IRN/QR via IRP), e-Way bill, GSTR-2B reconciliation,
  TDS/TCS, GSTR-1 JSON export in the government schema (today's report is on-screen only).
- **Banking**: bank statement import (CSV/OFX) + reconciliation UI (the
  `bankTransactions` array already exists, unused by any importer).
- **Ops**: recurring invoices, payment reminders, customer portal / payment links,
  multi-currency with FX revaluation, budgets, cost centres, project accounting.
- **Platform**: background jobs (queue) for PDF/export/email, S3-compatible file
  storage for attachments, structured logging (pino) + request IDs, OpenTelemetry,
  Sentry, a `/metrics` endpoint, daily backups with a restore drill.

---

## 4. Running it

```bash
cp .env.docker.example .env   # then set JWT_SECRET
docker compose up --build
```

Web on `http://localhost:8080`, API on `http://localhost:4001`, SQLite persisted
in the `api-data` volume. `docker compose --profile postgres up` starts Postgres
too — read gap D-1 first, the schema switch is not automatic.

Local (no Docker):

```bash
cd server && npm install && npx prisma generate && npx prisma db push && npm run dev
```

```bash
npm install && npm run dev
```
