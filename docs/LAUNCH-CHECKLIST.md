# CLOR launch checklist

One list for what is done and what is left, from two reports of 11 Nov 2026:
the **Launch Review** (`CLOR-Launch-Review-2026-11-11.pdf`) and the **Platform Audit**
(`CLOR-Platform-Audit-2026-11-11.pdf`, 9 launch blockers, scores 51/100 overall).
Both PDFs are on the owner's Desktop.

Any session can continue from here. Tick a line when it is **merged and live**, and
write the PR number and date. Last updated: 13 Nov 2026 (every Stage 0 branch below has
since merged and shipped; checked against `origin/main`, the live API revision and the live app).
A second audit on 17 Nov 2026 added the section at the end and marked the older lines it
found changed; those marks come from reading the code, not from the live app.

`[x]` done and live · `[~]` built, waiting (PR open, merged not released, or partly done) · `[ ]` not started

---

## How to work on this (read first)

- Start from `origin/main` (fetch first). Work in a fresh worktree under `/private/tmp`.
- **Release recipe:** memory file `deploy-recipe.md`. Backup first
  (`gcloud sql backups create --instance clor-pg`), build with the `clor-build` account,
  deploy `--no-traffic --tag rel-<sha>`, test `/ready`, then move traffic. Web: `clor-app`
  Pages; website: `clor` Pages. Live now: **rel-d4433c9** (rollback **rel-467eaaf**).
- **Migrations run as a non-superuser on Cloud SQL.** Local tests run as superuser and will
  not catch permission errors. Test a new migration with a NOSUPERUSER role
  (see PR #217). Never put `SET clor.x = ...` in a function header; use `set_config`.
- **A new public route** must be added to
  `tenant-platform-upgrade-2026-10-23/route-allowlist.json` or CI `verify` fails.
- **Server tests only run on a PR with the `full-tests` label.** CI runs on the owner's Mac
  (3 runners, shared with other sessions): expect 30–60 min queues. Keep the Mac awake.
- **The agent cannot:** merge PRs (owner presses Merge), read or write the live database,
  or change Google Cloud permissions. For those, write a script and ask the owner to run it.
- Never put employer names in commits. CLOR always in capitals.

---

## Done and live

- [x] People navigation: Attendance, leave, shifts and readers inside People; Back returns to the page you came from — PR #207
- [x] CIN on website and app — PR #211 (CIN U58200KA2026PTC230731)
- [x] Data processing agreement page, security contact on clor.in — PR #212 (lawyer review still pending, below)
- [x] Status page clor.in/status and `/api/public/status` — PR #214, live 12 Nov
- [x] Urgent staff alert when the API starts failing (5+ errors in 15 min) — PR #215, live 12 Nov
- [x] Restore drill: full restore from backup tested, 13 min, 4 databases checked (11 Nov)
- [x] Off-site backup: nightly copy of 4 databases to Delhi bucket `clor-apps-511409-db-copies`, 30 days, deletes recoverable 30 days; first copies verified 12 Nov
- [x] Database server keeps its backups if deleted (`retainBackupsOnDelete`)
- [x] Grievance officer name and email set (`VITE_GRIEVANCE_*` in `.env.production`)
- [x] Ledger safety: database refuses unbalanced or edited posted entries, one reversal per entry, lock history — PR #137 + #217, live 12 Nov (rel-d4433c9)
- [x] GST returns in government formats: GSTR-1 (B2CL ₹1L from Aug 2024, exports, cdnur, nil, Table 13), GSTR-3B, e-invoice INV-01 — PR #136, live 12 Nov
- [x] Leave engine complete (audit score 88)
- [x] Payroll statutory engine, ECR, Form 16 Part B (audit: verified correct)
- [x] Row-level security fail-closed, refresh token rotation (audit: verified)

## Built, waiting

- [x] **PR #216** nightly backup script — merged
- [x] **`claude/audit-stage0`** (PR #218) — merged and live

## Stage 0 — stop the bleeding (audit: about 2 weeks)

- [x] Timed jobs see no data when Cloud Scheduler wakes them (recurring invoices, reminders, digests, purges) — PR #218, live (`server/src/routes/internalJobs.ts`)
- [x] `/signup` gives every app free forever — PR #218, live: a dated trial (published trial length, 14 days default), test `signupTrial.test.ts`
- [x] "Start free trial" lands on Sign in — fixed: `app.clor.in/start` answers 200 on the live app (checked 12 Nov)
- [x] Production behind main — released through #215 on 12 Nov. Still missing: scripted release with notes and a CHANGELOG entry
- [~] Release record: a script that builds, tags and writes release notes (audit P0 8) — `scripts/release.sh` and `scripts/release-notes.mjs` merged (PR #225). **Still not used for a real release**: every release so far, including 13 Nov, was built and deployed by hand
- [x] People / Attendance boundary, permission rule — PR #218, live: Attendance alone opens only Employees, Org Structure, Documents, Announcements, Requests, Approvals in People (owner chose this list 12 Nov). `middleware/rbac.ts` `ATTENDANCE_OPENS_PEOPLE`, test `attendanceBoundary.test.ts`
- [x] Boundary, employee app — PR #218, live: money, engagement and referrals routes need People (`portalNeedsPeople`); `/portal/me` says `people`, and the app hides Money, Jobs, Growth and Celebrations without it
- [~] Boundary, billing — PR #218, live: with People on a plan, Attendance is always free (`peopleIncludesAttendance` in `services/subscriptions.ts`), so nobody pays for both. Upgrade from Attendance to People keeps all data (same tables). Still open: an "Upgrade to People" button for the customer
- [x] Hide the Attendance menu for People customers — PR #224, live: a company on People is not listed Attendance (rail, switcher, More apps, Workspace), and attendance.clor.in or a notice link opens the matching People screen (`packages/platform/includedApps.js`, test `packages/shell/includedApps.test.js`). Seen in the live app on 13 Nov: a company on Books, Payroll and People is listed three applications, with no Attendance. The employee app stays at attendance.clor.in/#/portal
- [~] Payroll export for companies paying salaries outside CLOR — PR #224, live: a closed month as Generic, greytHR, Keka or Tally (`services/attendance/payrollExport.ts`, test `attendancePayrollExport.test.ts`), offered on Month close. The greytHR, Keka and Tally headings were not checked against a live account
- [~] Error tracker and uptime check with alerts to phone — **done except the phone** (checked 13 Nov):
  - Uptime checks live for `api.clor.in`, `app.clor.in` and `clor.in`
  - Six alert policies on: each of those three down, Cloud SQL down, a scheduled job failing, and clor-api 5xx
  - Errors group in Cloud Error Reporting, no Sentry needed: `reportError` writes a `ReportedErrorEvent` with the stack, called from the 500 handler and from `unhandledRejection` / `uncaughtException` (`server/src/utils/log.ts`). No error groups in the last week because the API threw none; the pipeline last carried one on 1 Nov
  - **Left: alerts reach e-mail only** (`suresh@clor.in`). **Owner:** Cloud console, Monitoring, Alerting, Notification channels, add **SMS** (or the Google Cloud mobile app) and enter the code it texts you; then tick that channel on the six policies. It cannot be done from here: the code goes to your phone
- [ ] **Owner:** GSTIN; prices in ops.clor.in; PAN in ops; lawyer on terms and privacy

## Stage 1 — private beta, 3–5 free design partners (audit: weeks 3–8)

- [ ] Invoice tax computed on the server: subtotal, CGST/SGST/IGST and place of supply recomputed, not trusted from the browser — `server/src/routes/invoices.ts:446-452` (audit P0 4)
- [x] Admin 2FA and payroll step-up on by default (14 Nov): companies created from now ask owners and admins for an authenticator; SSO, directory sync and its tokens need one outright (`stepUpIfHeld`); existing companies keep their setting. A locked account now answers sign-in like an unknown address
- [x] Enforce CSP on the app and clor.in (enforced since 12 Nov; checked live 14 Nov on app., ops. and clor.in)
- [x] SSO session bound to its company (11 Nov), and no account-wide Workspace powers once the account has another company (14 Nov, `SSO_ACCOUNT_WIDE`)
- [~] Approval emails and Android push — the People approval engine now emails approvers and the requester (`services/people/approvals/engine.ts:800-838`, read 17 Nov). Leave and attendance requests use their own notices, not traced. No push anywhere
- [ ] Payroll: EPS exclusions (58+, joined after Sep 2014 above ₹15k) — `statutory/engine.ts:170-176`
- [ ] Payroll: ESI contribution period (cover holds to end of Apr–Sep / Oct–Mar) — `engine.ts:211-219`
- [~] Payroll: full and final notice pay, TDS, s.10(10)/10(10AA), post to Books — a notice shortfall on resignation is now recovered at gross ÷ 30 (`finalSettlement.ts:211-238`, read 17 Nov). Notice pay owed by the employer is still a ₹0 line to fill by hand (`:218`); tax and posting to Books still not built
- [ ] Support desk, 20 help articles, onboarding checklist, Excel import templates
- [ ] Nightly CI green 7 days running
- [ ] Terms say CLOR "does not currently charge" (`packages/shell/legal/documents.jsx:264`) — update once prices are set; lawyer review

## Stage 2 — paid pilot, 10–20 customers (audit: weeks 9–16)

- [ ] Published price book; trial-ending and renewal reminders; dunning; cancel; per-employee usage limits
- [ ] Manual UPI / bank payment with Mark paid, GST invoice from CLOR's own Books (PR #198 / #208, other session)
- [ ] GSTR-3B with reverse charge and 2B-gated ITC; reverse charge flag on bills (`schema.prisma:287`)
- [ ] P&L and balance sheet by period, comparatives, Schedule III (server statements partly in #137)
- [ ] TDS register on the server (now in the browser, `features/tds/tdsSync.js`)
- [ ] Rule 3(1) edit log with before/after values; a failed audit write blocks the change (`middleware/auditMutations.ts`)
- [ ] Editable roster grid (bulk assign, publish, coverage); OT rates by day type and caps; multiple breaks; comp-off expiry
- [ ] People reports with filters and charts; letters issued by event
- [ ] Bigger DB pools or a pooler; payroll run as a background job with `createMany`. Email outbox with retry: [~] on main (`services/emailRetry.ts`, started from `server/src/index.ts:129`, read 17 Nov); live not checked
- [ ] Payroll EDLI and admin charges computed (`defaults.ts:58`); Labour Code 50% wage rule
- [~] Mask PAN and bank numbers in payroll lists, reveal one with step-up — masked on the server unless the person holds the field right (`routes/payrollEmployees.ts:148-149`, read 17 Nov); live not checked
- [ ] Named second person for incidents and releases; sub-processor list
- [ ] Two case studies and customer logos on clor.in

## Stage 3 — public launch (audit: weeks 17–24)

- [ ] Razorpay or Cashfree checkout with subscriptions (`billing/gateway.ts:76-93`) — owner has no gateway yet
- [ ] Published SLA, 30+ help articles, CA partner programme
- [ ] Hosted CI, branch protection, credentials off the Mac
- [ ] PAN and bank encrypted at rest; security questionnaire pack; ISO 27001 plan
- [ ] greytHR, Keka and Tally migration guides; JSON-LD and comparison pages on clor.in
- [ ] Hindi employee app; native iOS

## Smaller findings (any time)

- [x] Cloud Run settings in the repo (`deploy/cloudrun.service.yaml`); `DEPLOY.md` and `BACKUP-AND-RESTORE.md` rewritten for Cloud Run, Cloud SQL and Pages — PR #225, merged. The live service's request timeout is **300s**, checked 13 Nov
- [x] Migrations run as a pre-deploy step (`scripts/migrate.sh`, called by `scripts/release.sh`), not at container start
- [x] Alert when a background job fails or goes stale (`JobRun`) — PR #225, live (`services/ops/jobHealth.ts`); the matching alert policy "FAILED: a scheduled job" is on
- [~] Idempotency keyed by user and company, not the Authorization header — in the code on main (`middleware/idempotency.ts:62`, read 17 Nov); live not checked
- [ ] E-invoice calls: queue, retry, timeout (`services/einvoice.ts:367`)
- [ ] zod validation on the route files without it: 22 of 142 on 17 Nov (was 47). Of those, `payrollTaxDeclarations`, `scim`, `invitations` and `outsideAccess` take a body
- [x] Readers identified only by printed serial: per-reader IP allow-list (`routes/iclock.ts`) — PR #225, live; set on the reader's page
- [~] UPI pay page reflects `?err=` text: use fixed codes — in the code on main (`routes/payRequests.ts:245`, read 17 Nov); live not checked
- [~] Separate encryption key, not `JWT_SECRET` fallback — new secrets are sealed with `MAIL_SECRET_KEY` and production refuses without it (`services/mailer.ts:59`, read 17 Nov). `JWT_SECRET` is still tried when opening older secrets (`mailer.ts:70`) until they are sealed again
- [ ] Leave day counts are Float: Decimal(6,2) (`prisma/people/schema.prisma:688-878`)
- [ ] Keyboard path for clickable rows in Payroll and Attendance (`useListKeys` in the Shell)
- [ ] Bundle size: charts chunk 1.15 MB, Accounting chunk 1.54 MB, 418 KB CSS
- [ ] Design contract: 56 raw palette classes, 25 off-contract radii, 63 raw hex colours, `toFixed(2)` amounts without Indian grouping
- [ ] E2E tests for Books, Payroll, sign-up and clor.in
- [ ] Public "See a sample company" per product
- [ ] People form field names simpler (Launch Review)
- [ ] Close old PR #129 (off-site backup) — replaced by #216

---

## Audit of 17 Nov 2026

A read-only audit of `origin/main` at `f3fb86c6`, in five parts: security, Books, Payroll and
People and Attendance, billing and operations, front end and tests. Every line below was found
by reading the code. Nothing was run, and none of it was reproduced in the live app. The top
findings in each part were read a second time.

Not covered: bank reconciliation, fixed assets, payslip PDF, onboarding, letters, live Cloud
Run and Cloud SQL settings, and about 100 of the 142 route files beyond their guards.

Security came out sound: no open route, no leak between companies, no SQL injection, no
secret in the repository. Its findings are all medium or low.

### Critical: Books ledger and returns

- [x] **Editing a bill twice posts the first amount again.** A bill of 1,00,000 edited to 1,20,000 and then to 1,30,000 leaves 2,30,000 in the ledger. The same happens on edit then delete, on cancel then delete, and on an invoice cancelled, reinstated and cancelled again. The lookup for entries to reverse also finds the reversals made earlier. Add `reversesId: null`, as `routes/payments.ts:487` already has — `routes/purchaseDocs.ts:508`, `:663`, `:706`; `routes/invoices.ts:761`. No test edits a purchase document twice — **Fixed and live 17 Nov (#292). Books already damaged: Ops, Jobs & workers, "Books to check" (#294); no repair yet.**
- [~] **The server stores totals and tax as the browser sends them** (the Stage 1 line above), and it goes further than invoices: bills, expenses, credit notes, debit notes, POS, the TDS amount on a bill, and `status: 'Paid'` with a paid amount. Any gap between the total and its parts is posted to Rounding — `routes/invoices.ts:446-459`, `routes/purchaseDocs.ts:349-354`, `services/posCheckout.ts`, `services/ledger.ts:613` — **Merged, not live (#302): a document whose figures disagree with its lines is refused. Still open: `status: Paid` and paid amount as sent, TDS amount on a bill as sent.**
- [~] **GSTR-1, GSTR-3B, Trial Balance, P&L, Balance Sheet and Cash Flow in Reports are worked out in the browser from lists that stop short**: 500 invoices, 200 bills, 100 payments each way, 500 journal entries, one branch only. A larger company gets a short return with no warning. A list that fails to load shows as empty, with no message — `packages/ui/src/hooks/useServerDocSync.js:455-464` (and the empty `catch` blocks at `:475` onward), `apps/accounting/src/features/gst/GstCompliance.jsx:49`, `apps/accounting/src/features/reports/ReportsWorkspace.jsx:1277`. There is no GST return route on the server and no record that a return was filed — **In review (#304): every page is read and a warning shows when a list is missing or cut. Still open: figures are added up in the browser, one branch, no record of filing.**

### High: Books

- [~] Freight and other charges are taxed but kept out of the subtotal and the lines, so the ledger credits them to Rounding, GSTR-1 leaves them out and the e-invoice sends their GST as round-off — `packages/ui/src/utils/gst.js:214-230`, `services/ledger.ts:613-635`, `gst/inv01.ts:245-291` — **In review (#305): credited to Sales, not Rounding. Still open: GSTR-1 and the e-invoice.**
- [~] A Draft invoice posts to the ledger when it is made; a recurring invoice is made as Draft and never posts; an invoice moved back from Cancelled keeps its reversal — `routes/invoices.ts:459`, `:531-552`, `:784-794`; `services/recurring.ts:104-139` — **In review (#305): a draft is posted when finalised; put back from Cancelled is posted again.**
- [~] CGST and SGST or IGST is chosen from the company's state, not the state of the branch that issues the document — `apps/accounting/src/features/sales/InvoiceForm.jsx:492`, `:515`; `apps/accounting/src/features/purchase/Bills.jsx:270` — **In review (#307): invoice and bill forms use the branch state. Still open: notes, estimates, orders, expenses, recurring.**
- [~] TDS yearly limit is wrong both ways: bills under the limit never add up, and once one bill has had TDS the next is taxed on the whole year again — `packages/ui/src/utils/tds.js:171-208`, `apps/accounting/src/features/tds/engine.js:312-321` — **In review (#307): bill form. Still open: payment form and the receivable side.**
- [~] A foreign currency invoice reaches the server with no currency or rate and is booked at 1; paying a foreign bill at another rate posts no exchange difference — `apps/accounting/src/features/sales/InvoiceForm.jsx:1205-1250`, `routes/payments.ts:204-226` — **In review (#307): currency and rate are sent. Still open: exchange difference on paying a foreign bill.**

### High: Payroll

- [x] "Days from leave" gives a person who joined or left in the month the whole period less unpaid leave. Joined on the 16th on ₹60,000 with one unpaid day: paid ₹58,000, due ₹28,000. Companies with People and Payroll but no Attendance — `routes/payrollRuns.ts:609-618`, `services/payroll/run.ts:1053` — **Fixed and live 17 Nov (#291).**
- [x] A salary revision in the middle of a month pays the new salary for the whole month, and a revision dated back into a finished month pays no arrears — `services/payroll/run.ts:1202`, `:1709`; `services/payroll/revision.ts:293-299` — **Fixed and live 17 Nov (#291).**
- [x] Loan instalments that fall after the pay periods that exist when the loan is approved are saved with no period and never collected — `services/payroll/loan.ts:144-150`, `:236-251` — **Fixed and live 17 Nov (#291).**
- [x] PF, ESI and professional tax are not worked out on arrears, bonus, incentive or leave encashment added to a run — `services/payroll/run.ts:1719-1727`, `:1785-1788` — **Fixed and live 17 Nov (#291).**
- [x] Weekly and fortnightly pay is accepted, but tax, the PF ceiling, the ESI limit and professional tax all assume a month. Refuse it or build it — `routes/payrollStructures.ts:59`, `services/payroll/run.ts:938`, `:988` — **Refused when statutory rules are on, live 17 Nov (#291). Not built.**

### High: billing, operations, phones, tests

- [~] A reopened or re-granted account becomes active with no end date, so it is never invoiced and never lapses. The code does this on purpose; it still needs a date or a flag for staff — `routes/opsCustomers.ts:104-108`, `services/subscriptions.ts:189` — **In review: Ops, Customers, filter "Active, no end date" and a notice on the customer page.**
- [~] Employees or users bought on a deal are billed but not enforced: buy 20, add 500 — `routes/opsDeals.ts:530` — **In review: held to the number bought (People, Payroll, public API, users). Not held: employees made by a reader or an HR connection.**
- [ ] 9 database connections for each instance against 80 requests at once (the Stage 2 pool line above, now with the numbers) — `server/scripts/cloudrun-start.sh:42-45`, `deploy/cloudrun.service.yaml:51`
- [~] One wake call runs about 38 jobs side by side on those connections, and several read every company with no limit — `services/jobRegistry.ts:68-92`, `services/booksDigest.ts:40`, `services/people/weeklySummary.ts:218` — **In review: four at a time (`JOBS_CONCURRENCY`). Still open: jobs that read every company with no limit.**
- [ ] Phone wrappers: the sign-in cookie is not sent from the wrapper's own address, so people are likely signed out every 15 minutes; the Android wrappers ask only for internet, so location and camera fail. Not tried on a phone — `server/src/utils/refreshCookie.ts:43`, `mobile/attendance/capacitor.config.json`, `mobile/attendance/android/app/src/main/AndroidManifest.xml:34`
- [~] An ordinary pull request runs only the server tests a script can match by file name or direct import, and a push to main runs none — `scripts/ci/related-server-tests.mjs:44-52`, `.github/workflows/ci.yml` — **Left as it is by the owner's CI decision (11 Nov): the full suite runs nightly and on the `full-tests` label.**

### Medium: security

- [~] 3 medium and 8 low findings, none critical or high. This repository is public, so the detail of findings that are not yet fixed is kept out of it and held by the owner. Each gets a line here when its fix is merged and live — **Merged, not live (#298): 10 of 11 closed. Open: Engineering Console sessions and lockouts; `/auth/signup` for an address nobody proved.**

### Medium: Payroll, People, Attendance

- [ ] Full and final has no tax, posts nothing to Books and is missing from Form 16 and 24Q (adds to the Stage 1 line above) — `routes/payrollSettlements.ts:309-383`, `services/payroll/form16.ts:59`
- [~] Gratuity rounds up only after seven full months, so 5 years 6 months and 15 days is paid for 5 years, not 6 — `services/payroll/finalSettlement.ts:80` — **Merged, not live (#300).**
- [~] Leave encashment in full and final is always gratuity wage ÷ 26, whatever the leave type says — `services/payroll/finalSettlement.ts:154` — **Merged, not live (#300).**
- [ ] ESI cover is tested on the month's earned wage, not the wage rate, so unpaid leave or overtime moves a person in or out — `services/payroll/run.ts:976`, `statutory/engine.ts:215`
- [~] The ECR, ESIC and PT files are built from payslips of a run that is not yet approved; a member with no PF that month is left out — `services/payroll/filings.ts:65-68`, `:112` — **Merged, not live (#300).**
- [ ] A bonus or deduction approved into a month whose run is already final, in a period that is not locked, is never paid — `services/payroll/run.ts:557-571`
- [ ] Payroll gets raw overtime hours; the company's rates by day type and its caps are not passed (adds to the Stage 2 line above) — `routes/payrollRuns.ts:514`
- [~] Entered deductions can take net pay below zero, and the whole deduction is still marked recovered — `services/payroll/run.ts:1786`, `services/payroll/payment.ts:153` — **Merged, not live (#300): such a payroll cannot be sent for review or approved.**
- [ ] Employee app People routes check sign-in only, so in an Attendance-only company a private case can be filed where HR cannot open it — `routes/peoplePortal.ts:29`, `routes/peopleTimePortal.ts:26`

### Medium: Books

- [ ] Reverse charge is a label: a sale marked reverse charge still bills and posts GST, and bills and expenses have no reverse charge or blocked-credit field — `services/ledger.ts:647-693`, `packages/ui/src/utils/gstrExport.js:499`
- [ ] Settlement checks the document total only: it ignores TDS taken on the bill and credit notes, and a receipt can be set against a bill — `services/settlement.ts`
- [ ] The GSTR-3B figures on screen count drafts and cancelled invoices and so disagree with the file made from the same screen — `apps/accounting/src/features/gst/GstCompliance.jsx:439-484`
- [ ] E-invoice and books are not tied: cancelling an invoice leaves the IRN live, a Draft can get an IRN, credit notes cannot be registered, and a call has no timeout — `routes/einvoice.ts`, `routes/invoices.ts:736-782`
- [ ] Invoice numbers are taken before the invoice is saved, so a refused invoice leaves a gap — `routes/invoices.ts:402-417`
- [ ] An imported document whose posting fails stays in the list with no ledger entry — `routes/imports.ts:597-655`
- [ ] Stock never reaches the ledger: no cost of goods sold or closing stock on the server; stock with no warehouse can be sold from every warehouse — `services/stockLedger.ts:53`
- [ ] The general reverse route can reverse the entry behind a live invoice or bill; bank book rows are saved without a ledger entry; a row the server refused stays on screen for that session — `routes/ledger.ts:414`, `routes/bankBook.ts:81`
- [ ] Smaller: 194A limit of 50,000 where a non-bank payer's is 10,000; TCS under 206C(1H) still charged; "This year" in Trial Balance starts on 1 January (`packages/ui/src/utils/tds.js:110`, `apps/accounting/src/features/reports/TrialBalanceReport.jsx:40`)

### Medium: billing and operations

- [ ] A payment event from the gateway makes a subscription active without checking the amount, the invoice or the period — `billing/events.ts:156-164`, `billing/razorpay.ts:155`
- [ ] `/auth/signup` gives a full trial to an email nobody proved, and ignores the switch that pauses sign-ups — `routes/auth.ts:621-655`
- [ ] A lapsed People, Payroll or Attendance app refuses reading too, so employees lose their payslips, though the message says everything can still be read — `services/people/guards.ts:43`, `services/payroll/guards.ts:46`
- [ ] A trial that turns paid keeps its old trial end as the expiry of extras — `services/subscriptions.ts:276`
- [ ] Nothing moves a subscription to past due when its period ends, so "stop at period end" never stops — `services/subscriptions.ts:107`, `routes/billing.ts:293`
- [ ] Company export builds one answer from 36 unbounded reads — `routes/dataExport.ts:234`
- [ ] With no instance kept warm and a wake every 10 minutes, jobs meant for every few seconds or every minute wait up to 10 minutes — `deploy/cloudrun.service.yaml:44`
- [ ] Migrations for the four databases run one after another with no way back, and no index is built with CONCURRENTLY — `server/package.json:18`
- [ ] Nobody is told when the nightly off-site copy fails, and the Delhi copy has never been restored — `docs/BACKUP-AND-RESTORE.md:53`, `:205`

### Medium: front end and tests

- [ ] When the session ends, the open form is thrown away — `packages/platform/http.js:86-98`, `packages/shell/Shell.jsx:857`
- [ ] Bills, expenses, notes, orders, leave and holidays can be saved twice by a double click — `packages/platform/http.js:195`, `apps/accounting/src/features/purchase/Bills.jsx:474`
- [ ] Pickers stop at 500 people, so in a larger company a manager past the 500th cannot be chosen — `apps/people/src/workforce/AddEmployee.jsx:116`, `server/src/routes/people.ts:612`
- [ ] 159 places in the front end swallow a failed call and show blanks — `apps/admin/src/screens/AdminHome.jsx:111-127`, `apps/people/src/workforce/Directory.jsx:106`
- [ ] Each app loads all of its screens at once; People imports 41 files from other apps, and the boundary check named in `.dependency-cruiser.cjs` has no script and no CI step
- [ ] `tenant-platform-upgrade-2026-10-23/` holds 32 MB of evidence logs in a public repository, some with test tokens. Keep `route-allowlist.json` and the route script, which CI needs, and remove the rest after checking the tokens were signed with a test secret
- [ ] clor.in says "File GSTR-1 and GSTR-3B"; the product makes a file to download — `website/src/pages/Home.jsx:72`, `:117`

### Design contract, counted 17 Nov

- [ ] Raw palette classes 28 (was 56), none in app chrome; radii off the two sizes 21 in JSX and about 45 in CSS; `shadow-*` classes 85, of which 83 in Books; 35 identifiers not in the mono class; 33 clickable rows with no keyboard path
- [ ] Money without Indian grouping or two decimals — `apps/accounting/src/features/sales/UpiPayLink.jsx:87`, `:104`, `:128`; `packages/ui/src/utils/money.js:252`
- [ ] Dark theme code still in the token file — `packages/ui/src/index.css:492` and 20 more selectors; charts set in Inter — `packages/ui/src/components/charts/useChartTheme.js:93`
- [ ] `DESIGN.md` disagrees with itself on dark mode (lines 89, 179), the tinted list header (61, 170), the Books panel tint (70), Sora and Inter (71, 151) and Fluent icons (259, 387)
- [ ] The ended sign-up link page uses AuthLayout, not GatePage — `packages/shell/Start.jsx:96`

### For selling to accountants and charging by result

Asked for by the owner on 17 Nov. What the code has today:

- Built: one sign-in for many companies with a switcher; an outside accountant invited to a company with a limited role and an end date; a practice plan of 50 companies and 25 users; CSV and Excel import of invoices, bills, notes and journals
- Partly built: a firm above its client companies (only when the firm's own account owns them); a view across companies (no due dates, no filing status)
- [ ] Not built: requests to a client for documents; partner or wholesale prices; the firm's name and logo on reports; import from Tally; bulk import of parties and items
- [ ] Not built: any count of billable events. For a price per result: an append-only event table in the platform database, a price per outcome beside COMPANY, USER and EMPLOYEE (`services/pricing/engine.ts:27`), a month-end step that adds count × rate lines to the renewal invoice (`billing/renewals.ts:107`), and a server record of "return filed"
