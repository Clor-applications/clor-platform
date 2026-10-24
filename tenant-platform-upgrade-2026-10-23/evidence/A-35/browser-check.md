# A-35 browser check (local dev, 2026-10-24)

Locally the API normally connects as a **superuser**, which PostgreSQL exempts from every policy, so the usual dev server cannot show A-35 at all. For this pass:

1. The four fail-closed migrations were applied to the local dev database (`prisma migrate deploy`, all four schemas): 170 `tenant_isolation` policies now read `clor.bypass = 'on' OR <company column> = NULLIF(clor.org_id, '')`; none fail open.
2. The local role `clor_app` (NOSUPERUSER, NOBYPASSRLS — as created by the test harness) was granted the dev database.
3. The dev API was restarted as `clor_app` (launch config `clor-api-app-role`, local only).

Results:

| Check | Result |
|---|---|
| Raw `psql` as `clor_app`, no company set: `select count(*) from "Invoice"` | **0** — fail-closed in the database itself |
| Sign out → sign in as the A03 owner | signed in, `/o/ATES-C100/`, A03 dashboard |
| A03's data through the API (company-scoped) | invoices 1, ledger accounts 21, People employees 4, payroll employees 4, payroll loans 2, documents 2, users 6, roles 26, audit 5, security policy, closure status — all 200 |
| `/api/auth/me` (across companies) | both of the owner's companies |
| Employee portal: sign in `ATES-C100` / `P900` | 200; `/me`, `/home`, `/attendance`, `/leave`, `/schedule`, `/requests`, `/documents`, `/company-updates`, `/attention`, `/my-data`, `/privacy-notice`, `/payslips` all 200; wrong password 401 |
| Screens: Accounting home, Payroll overview, People employees, Attendance readers / portal access, Company admin audit and users | each loads its own data; Company admin → Users: 20 API calls, none failed (`browser-admin-users-as-app-role.jpg`) |

Token routes (readers, SCIM, share and pay links, public API, site agent) are covered by the server suite, which runs as `clor_app` with these policies.
