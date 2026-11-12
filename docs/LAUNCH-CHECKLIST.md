# CLOR launch checklist

One list for what is done and what is left, from two reports of 11 Nov 2026:
the **Launch Review** (`CLOR-Launch-Review-2026-11-11.pdf`) and the **Platform Audit**
(`CLOR-Platform-Audit-2026-11-11.pdf`, 9 launch blockers, scores 51/100 overall).
Both PDFs are on the owner's Desktop.

Any session can continue from here. Tick a line when it is **merged and live**, and
write the PR number and date. Last updated: 12 Nov 2026, evening.

`[x]` done and live · `[~]` built, waiting (PR open, merged not released, or partly done) · `[ ]` not started

---

## How to work on this (read first)

- Start from `origin/main` (fetch first). Work in a fresh worktree under `/private/tmp`.
- **Release recipe:** memory file `deploy-recipe.md`. Backup first
  (`gcloud sql backups create --instance clor-pg`), build with the `clor-build` account,
  deploy `--no-traffic --tag rel-<sha>`, test `/ready`, then move traffic. Web: `clor-app`
  Pages; website: `clor` Pages. Live now: **rel-1ef7878** (rollback **rel-d4433c9**).
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
- [x] Off-site backup (script PR #216): nightly copy of 4 databases to Delhi bucket `clor-apps-511409-db-copies`, 30 days, deletes recoverable 30 days; first copies verified 12 Nov
- [x] Database server keeps its backups if deleted (`retainBackupsOnDelete`)
- [x] Grievance officer name and email set (`VITE_GRIEVANCE_*` in `.env.production`)
- [x] Ledger safety: database refuses unbalanced or edited posted entries, one reversal per entry, lock history — PR #137 + #217, live 12 Nov (rel-d4433c9)
- [x] GST returns in government formats: GSTR-1 (B2CL ₹1L from Aug 2024, exports, cdnur, nil, Table 13), GSTR-3B, e-invoice INV-01 — PR #136, live 12 Nov
- [x] Leave engine complete (audit score 88)
- [x] Payroll statutory engine, ECR, Form 16 Part B (audit: verified correct)
- [x] Row-level security fail-closed, refresh token rotation (audit: verified)

## Built, waiting

PR #221 (`claude/trial-and-approvals`, label full-tests): owner to merge on GitHub, then deploy (migration `20261204090000_demo_pipeline`, platform DB, adds 4 nullable columns). Contents:
- Trial reminder emails to the account owner (7, 3, 1 days before; once at the end)
- People approval emails (waiting, overdue, handed on, decided)
- Workspace, Billing: Change the plan (Move to People, add/remove app, seats: a ticket to sales) and Stop renewing / Keep the plan (owner only); Attendance's Today line pointing to it
- Ops demo pipeline: owner, follow-up date, source (utm/referrer); Mine / Follow up today / Nobody's yet; Home counts follow-ups due
- clor.in: JSON-LD (Organization, WebSite, SoftwareApplication), a sharing picture per product, CSP enforced in `website/public/_headers`


## Stage 0 — stop the bleeding (audit: about 2 weeks)

- [x] Timed jobs see their data when Cloud Scheduler wakes them — PR #218, live 12 Nov (rel-1ef7878)
- [x] `/signup` starts a 14-day dated trial, not free forever — PR #218, live 12 Nov
- [x] "Start free trial" lands on Sign in — fixed: `app.clor.in/start` answers 200 on the live app (checked 12 Nov)
- [x] Production behind main — released through #215 on 12 Nov. Still missing: scripted release with notes and a CHANGELOG entry
- [ ] Release record: a script that builds, tags and writes release notes (audit P0 8)
- [x] People / Attendance boundary: Attendance alone opens only Employees, Org Structure, Documents, Announcements, Requests, Approvals in People (owner's list) — PR #218, live 12 Nov
- [x] Employee app: money, engagement, referrals need People; tabs hidden for Attendance-only — PR #218, live 12 Nov
- [x] Attendance free on any plan with People (never pay twice) — PR #218, live 12 Nov
- [x] "Upgrade to People" for an Attendance customer: Workspace, Billing, Move to People (a ticket to sales) and a line on Attendance's Today — PR #221, waiting
- [ ] Hide the Attendance menu for People customers
- [x] Uptime checks every 5 min (api.clor.in/health, app.clor.in, clor.in) and email alerts to the owner: site down, database down, API 5xx > 5 in 5 min, any Cloud Scheduler job failing (job tick, nightly copies) — Cloud Monitoring, 12 Nov. API errors also in Error Reporting and the ops Alerts page (#215)
- [ ] Alerts to the owner's phone (Google Cloud app push or SMS) — owner to choose
- [ ] **Owner:** GSTIN; prices in ops.clor.in; PAN in ops; lawyer on terms and privacy

## Stage 1 — private beta, 3–5 free design partners (audit: weeks 3–8)

- [ ] Invoice tax computed on the server: subtotal, CGST/SGST/IGST and place of supply recomputed, not trusted from the browser — `server/src/routes/invoices.ts:446-452` (audit P0 4)
- [ ] Admin 2FA and payroll step-up on by default; today a user with no authenticator skips step-up — `server/src/services/stepUp.ts:84`
- [ ] Enforce CSP on the app (`public/_headers:15` is Report-Only). clor.in has an enforced CSP — PR #221, waiting
- [ ] SSO session bound to its company, not the whole account — `server/src/routes/sso.ts:227-283`
- [ ] Android push for approvals. Approval emails done — PR #221, waiting
- [ ] Payroll: EPS exclusions (58+, joined after Sep 2014 above ₹15k) — `statutory/engine.ts:170-176`
- [ ] Payroll: ESI contribution period (cover holds to end of Apr–Sep / Oct–Mar) — `engine.ts:211-219`
- [ ] Payroll: full and final notice pay (now ₹0 at `finalSettlement.ts:187`), TDS, s.10(10)/10(10AA), post to Books
- [ ] Support desk, 20 help articles, onboarding checklist, Excel import templates
- [ ] Nightly CI green 7 days running
- [ ] Terms say CLOR "does not currently charge" (`packages/shell/legal/documents.jsx:264`) — update once prices are set; lawyer review

## Stage 2 — paid pilot, 10–20 customers (audit: weeks 9–16)

- [ ] Published price book; dunning; per-employee usage limits. Trial-ending reminders and self-service stop/keep plan done — PR #221, waiting (renewal invoices already email the owner)
- [ ] Manual UPI / bank payment with Mark paid, GST invoice from CLOR's own Books (PR #198 / #208, other session)
- [ ] GSTR-3B with reverse charge and 2B-gated ITC; reverse charge flag on bills (`schema.prisma:287`)
- [ ] P&L and balance sheet by period, comparatives, Schedule III (server statements partly in #137)
- [ ] TDS register on the server (now in the browser, `features/tds/tdsSync.js`)
- [ ] Rule 3(1) edit log with before/after values; a failed audit write blocks the change (`middleware/auditMutations.ts`)
- [ ] Editable roster grid (bulk assign, publish, coverage); OT rates by day type and caps; multiple breaks; comp-off expiry
- [ ] People reports with filters and charts; letters issued by event
- [ ] Bigger DB pools or a pooler; payroll run as a background job with `createMany`; email outbox with retry (`services/mailer.ts:231-300`)
- [ ] Payroll EDLI and admin charges computed (`defaults.ts:58`); Labour Code 50% wage rule
- [ ] Mask PAN and bank numbers in payroll lists, reveal one with step-up (`routes/payrollEmployees.ts:148-209`)
- [ ] Named second person for incidents and releases; sub-processor list
- [ ] Two case studies and customer logos on clor.in

## Stage 3 — public launch (audit: weeks 17–24)

- [ ] Razorpay or Cashfree checkout with subscriptions (`billing/gateway.ts:76-93`) — owner has no gateway yet
- [ ] Published SLA, 30+ help articles, CA partner programme
- [ ] Hosted CI, branch protection, credentials off the Mac
- [ ] PAN and bank encrypted at rest; security questionnaire pack; ISO 27001 plan
- [ ] greytHR, Keka and Tally migration guides; comparison pages on clor.in (JSON-LD and per-product sharing pictures done — PR #221, waiting)
- [ ] Hindi employee app; native iOS

## Smaller findings (any time)

- [ ] Cloud Run settings in the repo (timeout ≥ 300s, min/max instances); `DEPLOY.md` and `BACKUP-AND-RESTORE.md` still describe the retired VM
- [ ] Migrations run at every container start with runtime credentials; a bad one crash-loops all instances (seen 12 Nov). Move to a pre-deploy Cloud Run Job
- [~] Alert when a background job fails: done 12 Nov (a failing job makes the tick answer 500, which the scheduler alert catches). Still open: a job that keeps timing out, or stops running, raises nothing
- [ ] Idempotency keyed by user and company, not the Authorization header (`middleware/idempotency.ts:23`)
- [ ] E-invoice calls: queue, retry, timeout (`services/einvoice.ts:367`)
- [ ] zod validation on the 47 route files without it, employee portal first
- [ ] Readers identified only by printed serial: per-reader IP allow-list (`routes/iclock.ts`)
- [ ] UPI pay page reflects `?err=` text: use fixed codes (`routes/payRequests.ts:238`)
- [ ] Separate encryption key, not `JWT_SECRET` fallback (`services/mailer.ts:52`)
- [ ] Leave day counts are Float: Decimal(6,2) (`prisma/people/schema.prisma:688-878`)
- [ ] Keyboard path for clickable rows in Payroll and Attendance (`useListKeys` in the Shell)
- [ ] Bundle size: charts chunk 1.15 MB, Accounting chunk 1.54 MB, 418 KB CSS
- [ ] Design contract: 56 raw palette classes, 25 off-contract radii, 63 raw hex colours, `toFixed(2)` amounts without Indian grouping
- [ ] E2E tests for Books, Payroll, sign-up and clor.in
- [ ] Public "See a sample company" per product
- [ ] People form field names simpler (Launch Review)
- [ ] Close old PR #129 (off-site backup) — replaced by #216
- [x] Ops demo requests: owner, follow-up date, lead source; sales role could not move a request in the console (fixed) — PR #221, waiting
