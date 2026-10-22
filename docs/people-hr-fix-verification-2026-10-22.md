# People / HR workflow fixes — 22 October 2026

Implemented in the local working tree. Feature fixes have not been deployed to production.

- Serialized People writes per organization within database transactions. Approval/cancellation reload current state; notifications run after commit.
- Enforced manager-first approval and distinct API leave approval permission.
- Kept attendance and approved leave linked across manual, clock, correction and reader paths. Unlinked leave entries and deletion of linked entries are rejected; closed-month checks cover cancellation.
- Corrected fractional unpaid leave deduction and capped LOP to the payroll period.
- Clamped accrual to joining date and rejected leave before joining.
- Prevented edits to financial policy/period settings once history exists. Effective-dated policy versioning remains a future upgrade.
- Added a linked, idempotent leave encashment payroll adjustment workflow, with an explicit payout amount and reconciliation after payroll calculation.
- Paginated full employee directories for People reports/documents/workspace selectors.
- Made candidate hiring, employee creation and joining checklist atomic.

## Verification

- 18 affected server test files: 150 tests passed.
- 4 affected frontend test files: 13 tests passed.
- Production frontend build, server typecheck, targeted frontend lint and diff whitespace check passed.
- Evidence logs: `/tmp/clor-hr-affected-tests.log`, `/tmp/clor-hr-web-tests.log`, `/tmp/clor-hr-build.log`, `/tmp/clor-hr-typecheck.log`, `/tmp/clor-hr-lint.log`.

## Domain rollout scope

Production hostname routing was built from the existing production commit `c1410dfa70094e6f9e3cc2e359f775285198a992` with only People added to recognized app hosts. Pages deployment `cdcf9de7-4b8b-4b67-ba2d-ef128fbfdc86`. This deployment does not include the local HR feature fixes.

Cloud Run revision `clor-api-00079-m82` serves the same image and configuration as the previous production revision, except that `CORS_ORIGIN` includes `https://people.clor.in`. Production preflight returned 204 with the correct allow-origin and credentials headers.

Cloudflare DNS: CNAME `people` to `clor-app.pages.dev`, proxied, TTL Auto, matching Accounting and Attendance. Pages custom domain validation was requested after the DNS record was saved.

Final domain verification: Pages status, DNS verification and certificate validation all `active`; HTTPS 200; deployed bundle recognizes People hostname. Browser rendered the authenticated application. Current company `Clor Pvt Ltd` has Accounting, Payroll and Attendance subscriptions but not People; the existing shell therefore falls back to Accounting. No company subscription was changed. Enabling People for the intended company is required to open its People workspace.
