# Clor People: build checklist

Version 1.0 · 24 Oct 2026 · House format from `tenant-platform-upgrade-2026-10-23/FIX_CHECKLIST.md`.

**A row is DONE only when all four hold:**
1. **Fixed** — the change is in a named commit on `claude/people-build-03ca03`.
2. **Test** — an automated test that fails before and passes after (file › test name).
3. **Browser** — checked in the running app with a screenshot or network capture under `docs/people/evidence/<ID>/`, or `n/a (server-only)` with the reason.
4. **Evidence** — a `PEV-*` row in [09-EVIDENCE-REGISTER.md](09-EVIDENCE-REGISTER.md).

Status: `TODO` · `IN PROGRESS` · `DONE` · `LIVE` (needs production) · `DEFERRED` (with reason) · `PARKED` (cross-app fix, not this build).
Requirement ids are from [02-PRD.md](02-PRD.md); defects `R-*` from [01-PLATFORM-REVIEW.md](01-PLATFORM-REVIEW.md).

---

## Batch 0 — Pack and baseline

| ID | Fix | Test | Browser | Status |
|---|---|---|---|---|
| PC-000 | Review, PRD, contract, words, compliance, checklist, test plan, decisions, evidence written under `docs/people/` | n/a (documents) | n/a | DONE (PEV-001..006) |
| PC-001 | Baseline People suites run and recorded | 20 files / 137 tests | n/a | DONE (PEV-001, PEV-002) |

## Batch 1 — Foundations (phase 1)

| ID | Req | Fix | Test | Browser | Status |
|---|---|---|---|---|---|
| PC-UI-01 | OD-06, D-01 | People CSS override block removed (`index.css` 6415-6764, 59 selectors); shared `[data-palette='rose']` added; manifest `palette: 'rose'`; dark-theme graphite rules no longer carve People out; `DESIGN.md` per-app accent rule | `test/palette.test.js` › "People has no app-scoped styling" (fails before: 59 matches; passes after), › "Attendance wears Blaze, People wears Rose" | `evidence/PC-UI-01/`: Accounting invoices vs People Home and Employees, light and dark; `measurements.md` shows equal title (24/700), body (13px) and control radius (4px), rose `--brand` in both themes | DONE (PEV-015) |
| PC-FND-01 | FND-01 | Every table this build adds (EmploymentEpisode, ChangeLog, OutboxEvent, LegalEntity, Establishment, ScheduledChange, EmployeeIdentity, AccessLog) has the fail-closed policy with FORCE, applied in the test setup before the people `rls_fail_closed` line | `peopleRls.test.ts` › one test per table: policy shape read from `pg_policy`, company B reads and updates nothing of company A's (8 tests) | n/a (database) | DONE (PEV-023) |
| PC-FND-02 | FND-02, R-04 | `ScheduledChange` (fail-closed RLS); a job field with a future `effectiveFrom` on the form is stored, shown on the record as "Changes on" with Withdraw, and applied on its day by `people-scheduled-changes` (lease, every 10 min) through the one write path, once per run id; the rest of the form saves now | `peopleEffectiveDating.test.ts` › "waits on the record, shows as changes on, and is applied on its day once", "can be withdrawn before its day; a date in the past applies at once" (fails before: applied at save) | `evidence/PC-FND-02/01-changes-on-record.jpg`: Arjun Shah, Changes on 01/12/2026 Establishment None → Pune shop, Withdraw; database shows PENDING and no establishment yet | DONE (PEV-021) |
| PC-FND-03 | FND-03 | `?asOf=YYYY-MM-DD` on the directory and the profile: job fields rolled back through history, later joiners left out, later leavers shown as they were. Org chart and headcount as-of come with ORG-03 / HLTH-04 | `peopleEffectiveDating.test.ts` › "the directory shows where each person was, and who was not yet there", "someone who has left shows as they were" | n/a (API; the as-of picker is a phase-2 screen) | DONE (PEV-021) |
| PC-FND-04 | FND-04, R-10 | `ChangeLog` (one line per changed field: before, after, who, why, source, correlation id; sensitive fields redacted) written in the same transaction as the employee row; append-only trigger (`20261024140200_change_log_append_only`); fail-closed RLS | `peopleChangeLog.test.ts` (5 tests) › "the change and its log fail together", "nothing edits or removes a line" (fails before: no table) | n/a (server-only; Why? panel reads it in phase 3) | DONE (PEV-020) |
| PC-FND-05 | FND-05 | `OutboxEvent` written in the change's transaction; `people.*.v1` names; nine-field envelope; worker under a lease every 5 s with 1/5/30/120/720-minute back-off, then parked with the error; in-process handler registry (`onPeopleEvent`) for Attendance, Payroll and webhooks | `peopleOutbox.test.ts` (3 tests) › "is delivered after a restart, to every handler, once", "a handler that fails is tried again later" | n/a (server-only) | DONE (PEV-020) |
| PC-FND-06 | FND-06, LIFE-06, R-03 | `EmploymentEpisode` (one row per stint, fail-closed RLS, migrations `20261024130000_employment_episodes` + `_rls`, backfilled for every person); `Employee.firstJoiningDate` (never moves) and `currentEpisodeSeq`; leaving closes the stint, rejoin needs a date after the last day and opens the next stint in one transaction; every create path opens stint 1 through `recordJoined`; history API returns `episodes`; UI asks "Rejoin on" and the History tab lists stints | `peopleEpisodes.test.ts` (4 tests) › "a rejoin needs a date, opens stint 2 and keeps the first joining date" (fails before: 200 with no date; passes after: 400 `REJOIN_DATE_REQUIRED`) | `evidence/PC-FND-06/`: left person with the rejoin date field, the confirm dialog, History tab with Stint 1 (08/09/2024–30/09/2026, resigned) and Stint 2 (01/11/2026–now) | DONE (PEV-018) |
| PC-FND-07 | FND-07, ORG-01, R-07 | `LegalEntity` (PAN masked) and `Establishment` (type, state, registrations) as structure lists with typed fields; `Employee.establishmentId`, `establishment` and `workState` on every row; history tracks the establishment (not the home state) as the transfer with the state's rules named; Settings cards and the form's Establishment select | `peopleEstablishments.test.ts` (3 tests) › "their work state is its state, and moving them is recorded as a transfer" (fails before: home-address edit recorded as Work state) | `evidence/PC-FND-07/01-establishments-list.jpg`: two establishments created in the browser | DONE (PEV-021) |
| PC-FND-08 | FND-08, R-06 | `services/people/employees.ts`: `createEmployee` / `updateEmployee` are the one write path (row + change log + outbox in one transaction, then history); the form, the import and Hire use it. Payroll's own create path is parked (PX-07) | `peopleChangeLog.test.ts` › "the form, the import and a hire leave the same trail" | n/a | DONE (PEV-020) |
| PC-FND-09 | FND-09 | No cross-company identity match: the same passport and Aadhaar digits in two companies are two people with no link; identity rows fail closed | `peopleStatutory.test.ts` › "never links people across companies because an identifier matches" | n/a | DONE (PEV-022) |
| PC-CORE-01 | CORE-01, R-11 | The directory pages through everyone 500 at a time until the server total is reached; "Reports to" lists everyone, not the open tab. Saved views and bulk update follow in phase 2 | `peopleEffectiveDating.test.ts` › "pages to the end and counts them all" (620 people) | n/a (seeded company has 40; the page loop is exercised by the test) | PARTLY (PEV-021): paging and picker done; saved views, bulk update TODO |
| PC-CORE-04 | CORE-04, FND-09, PRV-07 | `PEOPLE::Statutory Details` grant (V, E); People keeps `EmployeeIdentity` (Aadhaar last four only, passport, work permit, statutory category, each with expiry or from-date) with format checks; PAN, UAN, ESIC and bank read masked through Payroll's `statutoryRead.ts`; `POST …/statutory/reveal` needs the grant and a fresh authenticator code (`STEP_UP_REQUIRED` / `TWO_FACTOR_SETUP_REQUIRED`) and writes an append-only `AccessLog` row; identifier edits logged as changed without values. No link across companies on a matching identifier | `peopleStatutory.test.ts` (4 tests) › "need the Statutory Details grant", "a reveal needs a fresh authenticator code, returns one value, and is logged", "never links people across companies" | `evidence/PC-CORE-04/`: masked values saved; Show refused without an authenticator with the plain-words message | DONE (PEV-022) |
| PC-CORE-09 | §1 | People reads Payroll's identifiers through `services/payroll/statutoryRead.ts` (Payroll-owned read interface, PI-01), not the payroll client. The one remaining `payrollPrisma` use in `routes/people.ts` is Payroll's own delete guard (`employeeLock.ts`, A-39), which takes a payroll transaction | `peopleStatutory.test.ts` passes through the interface | n/a | DONE (PEV-022) |
| PC-CORE-05 | CORE-05 | The record's Notes and Documents tabs show only with `Employee Notes` / `Documents` VIEW; the Statutory section only with `Statutory Details` VIEW (server answers `visible: false`). The drawer stays a drawer; the full profile page is phase 2 | `peopleStatutory.test.ts` › "need the Statutory Details grant"; `peopleDocuments.test.ts` › Employees-VIEW-only role gets 403 on documents | n/a (owner is admin; gating verified by API tests) | PARTLY (PEV-023): gating done, page layout phase 2 |
| PC-ORG-01 | ORG-01 | Teams; entity and establishment lists; delete blocked in use | `peopleOrg.test.ts` | `evidence/PC-ORG-01/` | TODO |
| PC-ORG-02 | ORG-02 | `Employee.dottedManagerId` (form, Work tab, history, change log, org chart data); a manager change with a future date waits like any job field (FND-02); the chart as of a date reads the history (FND-03) | `peopleScope.test.ts` › "the dotted line is recorded like any other change, and approvals stay with the reporting manager" | n/a | DONE (PEV-023) |
| PC-DOC-01 | DOC-01, R-01 | `EmployeeDocument.classification` (EMPLOYEE_VISIBLE · HR_ONLY · RESTRICTED · CONFIDENTIAL; migration `20261024120000_document_classification` backfills from the old flag, which stays in step for the employee app); new resources `PEOPLE::Documents` and `PEOPLE::Confidential Documents`; document routes check the grant per classification, lists are filtered, a file the caller may not open reads 404; HR User and HR Manager presets updated; UI "Who can see" select. **Deploy note:** roles created before this that relied on Employees VIEW for documents need Documents VIEW granted (presets are written only at role creation) | `peopleDocuments.test.ts` (6 tests) › "a role with only Employees VIEW (the Attendance Manager share) opens no document at all" (fails before: 200; passes after: 403) | `evidence/PC-DOC-01/01-documents-tab-who-can-see.jpg`: Documents tab with the select; owner list 200 | DONE (PEV-017) |
| PC-PRV-04 | PRV-04, R-02 | Anonymisation also clears register entries linked to the person or carrying their address or number (candidate record, HR cases, goals, training: free text replaced, candidate title anonymised), checklist notes, the text of every privacy request, history notes, stint end reasons and the leaving reason; counts returned | `anonymiseEmployee.test.ts` › "erases personal data…" extended (fails before: email and phone still in `PeopleRecord.details`; passes after: 0 hits for email, phone, address) | n/a (server-only; same Data Requests screen) | DONE (PEV-019) |
| PC-PRV-05 | PRV-05, R-09 | Breach notices go to `personalEmail`, then `email` (what the employee form saves), then `workEmail` | `dpdp.test.ts` › "records a breach, tells the affected people…" extended with a person who has only `email` (fails before: sent 1, listed under no-email; passes after: sent 2) | n/a (server-only) | DONE (PEV-019) |
| PC-ACC-01 | §4 | `services/people/scope.ts`: a role marked own-records-only sees itself and everyone whose line (solid or dotted) reaches it; applied to the directory, record, history, documents (register, list, open), statutory and org chart; a stranger reads as absent. `TEAM_MANAGER` preset. A manager with no employee record sees nobody | `peopleScope.test.ts` (4 tests) › "sees themselves and their line, solid and dotted, and nobody else", "a stranger reads as absent" (fails before: whole company) | n/a (API; the manager Home is phase 2) | DONE (PEV-023) |
| PC-ACC-02 | R-12 | Presets COMPLIANCE_OFFICER, IT_ADMIN and EXTERNAL_AUDITOR added; HR User and HR Manager carry the Attendance leave, holiday and My Attendance grants People's leave screens need (HR Manager also Employee Portal). Presets seed for new companies; existing companies add roles by hand | `rolePresets.test.ts`, `defaultRoles.test.ts` (21 pass) | n/a | DONE (PEV-022) |

## Batch 2 — Daily work (phase 2)

| ID | Req | Fix | Test | Browser | Status |
|---|---|---|---|---|---|
| PC-CORE-02 | CORE-02 | Add person form fields; duplicate check with reason | `people.test.ts` › "duplicate phone needs reason" | `evidence/PC-CORE-02/` | TODO |
| PC-CORE-03 | CORE-03 | Personal details; self-service change request (D-02) | `peopleSelfService.test.ts` | `evidence/PC-CORE-03/` (375 px) | TODO |
| PC-CORE-06 | CORE-06 | Timeline tab with Why links, grouped by stint | `people.test.ts` › "timeline order" | `evidence/PC-CORE-06/` | TODO |
| PC-CORE-07 | CORE-07 | Import preview, mapping, update mode, undo | `peopleImport.test.ts` › "undo removes 197" | `evidence/PC-CORE-07/` | TODO |
| PC-CORE-08 | CORE-08 | Custom fields with view/edit permission | `peopleCustomFields.test.ts` › "HR-only key absent for manager" | `evidence/PC-CORE-08/` | TODO |
| PC-LIFE-01 | LIFE-01 | `JoinInvite` (token stored hashed, 14 days, one live invite per person; RLS fail closed); HR sends by e-mail (CLOR mails the link) or by phone (HR is handed the link); the public page `/api/people/join/:token` shows only the joiner’s own name, joining date and HR’s note; the joiner fills personal details, uploads documents (stored on the record at once, marked JOINER) and signs the declaration; what they typed waits on the invite as "sent, not checked" and HR is told; "Check and save" on the About tab writes it through the one write path with source SELF_SERVICE and the checker on the log. Page script served as a file because CSP allows no inline script | `peopleInvites.test.ts` (2) › "works once, shows only the joiner’s own data…" | `evidence/PEV-028/` | DONE (PEV-028) |
| PC-LIFE-02 | LIFE-02 | Plans with named owners and due dates; Home To do | `peoplePlans.test.ts` › "each task lands on the named person" | `evidence/PEV-025/` | DONE (PEV-025) |
| PC-LIFE-03 | LIFE-03 | Probation review and decision | `peopleProbation.test.ts` (3) | `evidence/PEV-025/` | DONE (PEV-025) |
| PC-LIFE-04 | LIFE-04, COMP-04 | Changes with comparison, impact list, approval, scheduling | `peopleChanges.test.ts` › "a move from Karnataka to Maharashtra" | `evidence/PEV-026/` | DONE (PEV-026) |
| PC-LIFE-05 | LIFE-05 | `lifecycle/leaving.ts` is the one way someone leaves (form and approved LEAVING request): status, stint closed, history, leaving checklist, readers revoked, `people.employee.separated.v1` with `settlementRequested` in the same transaction. Resignation request from the employee app, hand-back list, letters: TODO | `personnel.test.ts` resign path; `peopleApprovals.test.ts` effects | | PARTLY (PEV-024) |
| PC-LIFE-06 | LIFE-06 | Rejoin flow on new episode | `peopleEpisodes.test.ts` | `evidence/PC-LIFE-06/` | TODO |
| PC-LIFE-07 | LIFE-07 | Task done from Home and email link, logged | `peoplePlans.test.ts` › "the e-mail link ticks the task once" | `evidence/PEV-025/` | DONE (PEV-025) |
| PC-LIFE-08 | LIFE-08 | Document kinds WORK_PERMIT and CERTIFICATE need an expiry date and say what the person may not do once lapsed (`restrictsWork`); at 30 days (or when first seen later) renewal tasks for HR and the manager on the record, once per document; the profile shows a pill from 30 days out and "expired" after; Health check lists lapsed permits (`permit-expired`, Fix soon) | `peopleExpiry.test.ts` › "a work permit needs its date; at 30 days HR and the manager get renewal tasks; lapsed, it shows on the profile and in Health check" | `evidence/PEV-027/` | DONE (PEV-027) |
| PC-DOC-02 | DOC-02 | Versions | `peopleDocuments.test.ts` › "v1 kept" | `evidence/PC-DOC-02/` | TODO |
| PC-DOC-03 | DOC-03 | `EmployeeDocument.expiryStage` records the last threshold announced (60, 30, 7, 0); the daily job announces a document once per stage it has crossed, never once per day; expired documents in Health check (`document-expired`, Tidy up) | `peopleExpiry.test.ts` › "a contract 45 days out is announced at 60, then 30, then 7, then on expiry: four times over 50 daily runs" | n/a (job) | DONE (PEV-027) |
| PC-DOC-04 | DOC-04 | Letter templates and issue to PDF | `peopleLetters.test.ts` › "appointment letter fields and version" | `evidence/PC-DOC-04/` | TODO |
| PC-DOC-05 | DOC-05 | Ask to read and accept; report | `peopleAcknowledgements.test.ts` | `evidence/PC-DOC-05/` | TODO |
| PC-DOC-07 | DOC-07 | Service certificate due days per establishment state | `peopleLetters.test.ts` › "KA 7 days" | `evidence/PC-DOC-07/` | TODO |
| PC-POL-01..06 | POL-01..06 | Policies, versions, applies-to, acceptance, approval, conflict check | `peoplePolicies.test.ts` (6 tests) | `evidence/PC-POL/` | TODO |
| PC-APR-01..07 | APR-01..07 | `services/people/approvals/engine.ts`: one engine for every People request type; versioned rules with ordered steps (manager, manager's manager, named person, role, HR), per-step condition, due time in working days, overdue reminder then hand-on; stand-ins by date; the requester's own step skipped; a decision claimed atomically; double submit with `Idempotency-Key` is one request; effects registered per type (job and profile changes through the one write path or scheduled; leaving through `lifecycle/leaving.ts`). `routes/peopleApprovals.ts`; a job change on the form becomes a request when a rule exists; Approvals screen (waiting for me by due date with Overdue pill, asked by me, steps, approve / reject / ask for more / reply / withdraw). **Rule builder screen: TODO (PC-APR-UI)** | `peopleApprovals.test.ts` (7 tests) › grade-change condition, named approver only, self skipped, stand-in, same key once, reminded then handed on, versions kept | `evidence/PC-APR/01-approvals-screen.jpg` | DONE (PEV-024) except the rule builder screen |
| PC-DESK-01..06 | DESK-01..06 | Help desk tables, thread, queues, times, reopen, move, templates | `peopleDesk.test.ts` (6 tests) | `evidence/PC-DESK/` | TODO |
| PC-FORM-01 | FORM-01 | = PC-CORE-08 | | | TODO |
| PC-EVT-01 | §7 | All `people.*.v1` events emitted from the right places | `peopleOutbox.test.ts` › one test per event | n/a | TODO |

## Batch 3 — Trust and compliance (phase 3)

| ID | Req | Fix | Test | Browser | Status |
|---|---|---|---|---|---|
| PC-TRACE-01..05 | TRACE-01..05 | Why panel, unknowns, correction, pay link (PI-01), decision records | `peopleWhy.test.ts` (5 tests) | `evidence/PC-TRACE/`: panel on a promotion | TODO |
| PC-COMP-01..06 | COMP-01..06 | Rule library with versions and checks, obligations, no score, state review tasks, registers | `peopleCompliance.test.ts` (6 tests) | `evidence/PC-COMP/` | TODO |
| PC-PRV-01..03, 06, 07 | PRV-01..03, 06, 07 | Notices, requests, retention and deletion review, auditor access, access log | `peoplePrivacy.test.ts` | `evidence/PC-PRV/` | TODO |
| PC-PRIV-01..06 | PRIV-01..06 | Private cases, membership, conflict check, deadlines, encryption, exclusion from search/export/AI, committee warnings | `peoplePrivateCases.test.ts` (6 tests) | `evidence/PC-PRIV/`: owner gets 404 | TODO |
| PC-HLTH-01..04 | HLTH-01..04 | Health check items, reasons, snooze, headcount as of | `dataHealth.test.ts` (extend) | `evidence/PC-HLTH/` | TODO |
| PC-RPT-01..03 | RPT-01..03 | Reports as of, saved views, permission filtering | `peopleReports.test.ts` | `evidence/PC-RPT/` | TODO |
| PC-AIG-01..06 | AIG-01..06 | AI controls, logging, no-write gate, retrieval filters, eval set | `peopleAi.test.ts` | `evidence/PC-AIG/` | TODO |
| PC-FORM-02..05 | FORM-02..05 | Form studio, 10 behaviours, protected fields, automations | `peopleForms.test.ts` (FORM-03a..j) | `evidence/PC-FORM/` | TODO (D-05) |
| PC-DOC-06 | DOC-06 | Object storage, signed links, malware hook | `peopleDocuments.test.ts` › "link expires" | `evidence/PC-DOC-06/` | TODO (D-03) |
| PC-NFR-09 | NFR-09 | Backup restore demonstrated | script + register row | `evidence/PC-NFR-09/` | TODO |

## Batch 4 — Pilot

| ID | Req | Fix | Test | Browser | Status |
|---|---|---|---|---|---|
| PC-ASK-01..05 | ASK-01..05 | Read-only policy Ask behind AI controls | `peopleAsk.test.ts` + eval report | `evidence/PC-ASK/` | TODO |
| PC-E2E-01..05 | §8.2 | Five journeys end to end in the browser | `test/people-journeys.spec` (browser) | `evidence/PC-E2E/` | TODO |
| PC-GATE | §13 | Release gates 1-10 recorded | register rows | | TODO |

## Parked (cross-app fix, not this build)

| ID | Finding | Where it will be fixed |
|---|---|---|
| PX-01 | R-05 Payroll imports live attendance, no snapshot version | Payroll pack |
| PX-02 | R-08 Import drops phone; skips checklist and reader push | shared import screen |
| PX-03 | ORG-05 duplicate cost centre list in Payroll | Payroll pack |
| PX-04 | D-07 leave engine path and permissions | shared leave module |
| PX-05 | D-08 leave screen names; Attendance "People" group | Attendance |
| PX-06 | PI-02/03/04, AI-01/03, SH-01 interfaces | Payroll, Attendance, shared leave |
| PX-07 | Non-People employee creation paths (payroll form, public API, reader, HR pull) through FND-08 service | Payroll, public API, Attendance |
