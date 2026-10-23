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
| PC-UI-01 | OD-06 | Remove People CSS override block `packages/ui/src/index.css:6535-6785`; People renders on Accounting's scale, radii, shadows | `test/design-rules.test.js` (no `[data-app='people']` type or radius overrides) | `evidence/PC-UI-01/`: Directory and a profile beside Accounting's invoice list, same title size and control radius | TODO |
| PC-FND-01 | FND-01 | New tables with fail-closed RLS; migrations added to `globalSetup.ts applyPolicies` | `peopleRls.test.ts` › one test per table | n/a (database) | TODO |
| PC-FND-02 | FND-02 | `ScheduledChange` + `people-scheduled-changes` job; `PUT /employees/:id` with future `effectiveOn` schedules instead of applying (fixes R-04) | `peopleEffectiveDating.test.ts` › "applies on the date, once" | `evidence/PC-FND-02/`: profile shows "Changes on 1 Dec" | TODO |
| PC-FND-03 | FND-03 | `asOf` on directory, profile, org chart, headcount | `peopleEffectiveDating.test.ts` › "reads as of a past date" | `evidence/PC-FND-03/` | TODO |
| PC-FND-04 | FND-04, R-10 | `ChangeLog` before/after in the same transaction; append-only trigger | `peopleChangeLog.test.ts` › "fails together", "cannot be edited" | n/a (server-only) | TODO |
| PC-FND-05 | FND-05 | `OutboxEvent` + worker; versioned names; webhook passthrough | `peopleOutbox.test.ts` › "delivers after restart", "same event once" | n/a (server-only) | TODO |
| PC-FND-06 | FND-06, R-03 | `EmploymentEpisode`; rejoin requires `rejoinDate`, keeps first joining date | `peopleEpisodes.test.ts` › "rejoin keeps 2022" | `evidence/PC-FND-06/`: timeline with two stints | TODO |
| PC-FND-07 | FND-07, R-07 | `LegalEntity`, `Establishment`; `Employee.establishmentId`; work state from establishment; stop tracking home state as "Work state" | `peopleEstablishments.test.ts` | `evidence/PC-FND-07/` | TODO |
| PC-FND-08 | FND-08, R-06 | One `employees.create/update` service used by form, import, hire | `people.test.ts` › "three paths, same effects" | n/a | TODO |
| PC-FND-09 | FND-09 | No cross-company identity match | `peopleRls.test.ts` › "same PAN, two companies, no link" | n/a | TODO |
| PC-CORE-01 | CORE-01, R-11 | Paging past 500; saved views; bulk update; "Reports to" picker across statuses | `people.test.ts` › "pages 2,000" | `evidence/PC-CORE-01/` | TODO |
| PC-CORE-04 | CORE-04 | `Statutory Details` resource; format checks (PAN, UAN, ESIC, IFSC); reveal with step-up; `AccessLog` | `peopleStatutory.test.ts` › "bad PAN", "reveal needs step-up", "reveal logged" | `evidence/PC-CORE-04/`: Show → step-up dialog | TODO |
| PC-CORE-09 | §1 | People reads Payroll only through HTTP (PI-01), not `payrollPrisma` | `peopleStatutory.test.ts` (no payrollPrisma import, lint rule) | n/a | TODO |
| PC-CORE-05 | CORE-05 | Profile page with permission-gated tabs | `people.test.ts` › "manager sees no Statutory tab" | `evidence/PC-CORE-05/` | TODO |
| PC-ORG-01 | ORG-01 | Teams; entity and establishment lists; delete blocked in use | `peopleOrg.test.ts` | `evidence/PC-ORG-01/` | TODO |
| PC-ORG-02 | ORG-02 | Effective-dated reporting line, dotted manager | `peopleOrg.test.ts` › "chart as of" | `evidence/PC-ORG-02/` | TODO |
| PC-DOC-01 | DOC-01, R-01 | `classification` on documents; access by classification ∩ role; migrate `visibleToEmployee` | `peopleDocuments.test.ts` › "Attendance Manager cannot open HR-only" (fails today) | `evidence/PC-DOC-01/`: 403 shown | TODO |
| PC-PRV-04 | PRV-04, R-02 | Anonymise covers registers, notes, checklist notes, request text | `anonymiseEmployee.test.ts` › "nothing left anywhere" (fails today) | n/a | TODO |
| PC-PRV-05 | PRV-05, R-09 | Breach notices to every address field | `dpdp.test.ts` › "person with only email gets it" (fails today) | n/a | TODO |
| PC-ACC-01 | §4 | Team scope on admin routes (`services/people/scope.ts`) | `peopleScope.test.ts` › "manager sees team only" | `evidence/PC-ACC-01/` | TODO |
| PC-ACC-02 | R-12 | New presets COMPLIANCE_OFFICER, IT_ADMIN, EXTERNAL_AUDITOR; HR_MANAGER leave grants; People resources per contract §4 | `permissions.test.ts` | n/a | TODO |

## Batch 2 — Daily work (phase 2)

| ID | Req | Fix | Test | Browser | Status |
|---|---|---|---|---|---|
| PC-CORE-02 | CORE-02 | Add person form fields; duplicate check with reason | `people.test.ts` › "duplicate phone needs reason" | `evidence/PC-CORE-02/` | TODO |
| PC-CORE-03 | CORE-03 | Personal details; self-service change request (D-02) | `peopleSelfService.test.ts` | `evidence/PC-CORE-03/` (375 px) | TODO |
| PC-CORE-06 | CORE-06 | Timeline tab with Why links, grouped by stint | `people.test.ts` › "timeline order" | `evidence/PC-CORE-06/` | TODO |
| PC-CORE-07 | CORE-07 | Import preview, mapping, update mode, undo | `peopleImport.test.ts` › "undo removes 197" | `evidence/PC-CORE-07/` | TODO |
| PC-CORE-08 | CORE-08 | Custom fields with view/edit permission | `peopleCustomFields.test.ts` › "HR-only key absent for manager" | `evidence/PC-CORE-08/` | TODO |
| PC-LIFE-01 | LIFE-01 | Invites; token route; HR check | `peopleInvites.test.ts` › "once, 14 days, own data only" | `evidence/PC-LIFE-01/` | TODO |
| PC-LIFE-02 | LIFE-02 | Plans with named owners and due dates; Home To do | `peoplePlans.test.ts` › "IT task overdue on Home" | `evidence/PC-LIFE-02/` | TODO |
| PC-LIFE-03 | LIFE-03 | Probation review and decision | `peopleProbation.test.ts` | `evidence/PC-LIFE-03/` | TODO |
| PC-LIFE-04 | LIFE-04, COMP-04 | Changes with comparison, impact list, approval, scheduling | `peopleChanges.test.ts` › "KA→MH creates review tasks" | `evidence/PC-LIFE-04/` | TODO |
| PC-LIFE-05 | LIFE-05 | Leaving case, plan, hand-back, letters, events | `peopleLeaving.test.ts` › "separated event once" | `evidence/PC-LIFE-05/` | TODO |
| PC-LIFE-06 | LIFE-06 | Rejoin flow on new episode | `peopleEpisodes.test.ts` | `evidence/PC-LIFE-06/` | TODO |
| PC-LIFE-07 | LIFE-07 | Task done from Home and email link, logged | `peoplePlans.test.ts` › "done from link logged" | `evidence/PC-LIFE-07/` | TODO |
| PC-LIFE-08 | LIFE-08 | Expiring permit alerts and profile note | `peopleDocuments.test.ts` › "permit expired shown" | `evidence/PC-LIFE-08/` | TODO |
| PC-DOC-02 | DOC-02 | Versions | `peopleDocuments.test.ts` › "v1 kept" | `evidence/PC-DOC-02/` | TODO |
| PC-DOC-03 | DOC-03 | 60/30/7/0 reminders, once each | `notifications.test.ts` › "one per threshold" | n/a | TODO |
| PC-DOC-04 | DOC-04 | Letter templates and issue to PDF | `peopleLetters.test.ts` › "appointment letter fields and version" | `evidence/PC-DOC-04/` | TODO |
| PC-DOC-05 | DOC-05 | Ask to read and accept; report | `peopleAcknowledgements.test.ts` | `evidence/PC-DOC-05/` | TODO |
| PC-DOC-07 | DOC-07 | Service certificate due days per establishment state | `peopleLetters.test.ts` › "KA 7 days" | `evidence/PC-DOC-07/` | TODO |
| PC-POL-01..06 | POL-01..06 | Policies, versions, applies-to, acceptance, approval, conflict check | `peoplePolicies.test.ts` (6 tests) | `evidence/PC-POL/` | TODO |
| PC-APR-01..07 | APR-01..07 | Engine, rules, due times, hand-on, stand-ins, self-skip, idempotency | `peopleApprovals.test.ts` (7+ tests) | `evidence/PC-APR/`: Approvals list with Overdue pill | TODO |
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
