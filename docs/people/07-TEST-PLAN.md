# Clor People: test plan

Version 1.0 · 24 Oct 2026. Companion sheet: `PEOPLE-TEST-SHEET.xlsx` (house format from `docs/NEEV-TEST-CASES.xlsx`: one sheet per area, columns `# | Area | Test case | Before you start | Steps | What must happen | Pri | New | Result | Remark`, Result dropdown Pass / Fail / Blocked / N/A, P1 rows shaded).

Every requirement id in [02-PRD.md](02-PRD.md) has at least one row here and in the sheet. A row's **Result** is filled only with evidence under `docs/people/evidence/<ID>/` and a `PEV-*` entry.

---

## 1. Layers

| Layer | Where | Runs | Counts (planned) |
|---|---|---|---|
| Unit | `server/src/__tests__/people/*.test.ts`, pure service functions | every commit | ~90 |
| API and database | same folder, Supertest against the app on a per-run Postgres as `clor_app` (existing `vitest.config.ts`) | every commit | ~160 |
| Cross-company | `peopleRls.test.ts`, one test per new table and route, pattern `tenantIsolation.test.ts` | every commit | ~45 |
| Web unit | `apps/people/src/**/*.test.jsx` (jsdom), `test/design-rules.test.js`, `test/people-navigation.test.js` | every commit | ~40 |
| Browser journeys | in-app browser against the dev server; scripted later as `test/people-journeys.spec` | per phase exit and before release | 5 journeys, ~60 steps |
| Manual sheet | `PEOPLE-TEST-SHEET.xlsx` | pilot and release | ~140 rows |
| Security evaluations | AI eval set (AIG-06), permission and injection cases | before Ask is on | 1 report |
| Operations | backup restore, privacy request demo | before release | 2 recorded runs |

Local runs: `cd server && npx vitest run src/__tests__/people --no-file-parallelism` (the shared local Postgres ran out of connections in the baseline; CI has its own database).

---

## 2. Synthetic workforce generator (TEST-GEN)

`server/src/__tests__/fixtures/syntheticWorkforce.ts`. Deterministic from a seed. Produces, per company: establishments in 2 to 4 states; 20 to 300 people across employment types (permanent, fixed-term, contractor, intern), grades, departments; joiners and leavers per month; rehires; transfers between states; probation ends; documents with expiries (some past); conflicting policies; a policy change mid-month; people with missing UAN or PAN; a POSH committee that fails one rule; requests from roles that must be refused; two companies with the same PAN on different people. No real names or numbers: names from a word list, identifiers from valid-format generators.

Used by every API test group and by the browser journeys (seeded company "Meridian Facilities Pvt Ltd", 120 people, KA + MH + TN).

---

## 3. Automated tests by requirement

Format: `file › test` and what fails before the change.

### Foundations
| Req | Test | Fails before |
|---|---|---|
| FND-01 | `peopleRls.test.ts › <Table> returns nothing without a company` (×N tables), `› company A never sees company B` | table missing |
| FND-02 | `peopleEffectiveDating.test.ts › change dated next month is not applied today`, `› applied once on its date`, `› job re-run is a no-op` | change applies at save (R-04) |
| FND-03 | `› directory as of 1 Apr matches history` | no asOf |
| FND-04 | `peopleChangeLog.test.ts › writes before and after`, `› change and log fail together`, `› sensitive field logs redacted`, `› update on ChangeLog is refused` | log has no before/after (R-10) |
| FND-05 | `peopleOutbox.test.ts › event written in the same transaction`, `› delivered after a simulated crash`, `› same eventId delivered twice has one effect`, `› envelope has all seven fields` | no outbox |
| FND-06 | `peopleEpisodes.test.ts › rejoin opens episode 2`, `› first joining date unchanged`, `› rejoin without date is refused` | R-03 |
| FND-07 | `peopleEstablishments.test.ts › work state from establishment`, `› home address edit is not a transfer` | R-07 |
| FND-08 | `people.test.ts › form, import and hire produce the same history, plan and event` | import skips plan |
| FND-09 | `peopleRls.test.ts › same PAN in two companies stays two people` | — |

### People records and organisation
| Req | Test |
|---|---|
| CORE-01 | `people.test.ts › pages 2,000 people`, `› export has 2,000 rows`, `› bulk update writes one correlation id`, `› reports-to picker lists every status` |
| CORE-02 | `› duplicate phone needs a reason` |
| CORE-03 | `peopleSelfService.test.ts › phone change waits for HR when the setting says so`, `› saves directly otherwise` |
| CORE-04 | `peopleStatutory.test.ts › bad PAN refused`, `› masked by default`, `› reveal needs step-up`, `› reveal writes AccessLog`, `› People never imports payrollPrisma` (static) |
| CORE-05 | `people.test.ts › manager response has no Statutory tab` |
| CORE-06 | `› timeline ordered, grouped by stint, every row has whyId` |
| CORE-07 | `peopleImport.test.ts › preview lists 3 bad rows`, `› commit creates 197`, `› update mode changes not duplicates`, `› undo removes 197 and their events`, `› undo after 24h refused` |
| CORE-08 | `peopleCustomFields.test.ts › HR-only key absent for manager`, `› version kept on edit` |
| ORG-01..04 | `peopleOrg.test.ts › delete in use blocked`, `› chart as of shows old manager`, `› dotted manager`, `› seat filled and open` |

### Lifecycle
| Req | Test |
|---|---|
| LIFE-01 | `peopleInvites.test.ts › token works once`, `› expires in 14 days`, `› sees only own data`, `› lands as RETURNED until checked` |
| LIFE-02 | `peoplePlans.test.ts › tasks have named owners`, `› IT task overdue appears on IT Home` |
| LIFE-03 | `peopleProbation.test.ts › confirm sets confirmedOn and event`, `› extend asks new date`, `› end needs leaving case` |
| LIFE-04 | `peopleChanges.test.ts › KA to MH lists differing rules and creates review tasks`, `› nothing written to Payroll`, `› schedules on approval` |
| LIFE-05 | `peopleLeaving.test.ts › resignation creates plan and scheduled event`, `› LEFT on last day`, `› separated event sent once`, `› letters issued` |
| LIFE-06 | see FND-06 |
| LIFE-07 | `peoplePlans.test.ts › done from email link is logged` |
| LIFE-08 | `peopleDocuments.test.ts › permit expiring creates tasks`, `› expired shows on profile and Health check` |

### Documents, policies, approvals, desk, private cases
| Req | Test |
|---|---|
| DOC-01 | `peopleDocuments.test.ts › Attendance Manager cannot list or open HR-only` (fails today), `› employee sees EMPLOYEE_VISIBLE only`, `› CONFIDENTIAL needs its own permission` |
| DOC-02..07 | `› v1 kept after replace`, `notifications.test.ts › one reminder per threshold`, `peopleLetters.test.ts › appointment letter fields and template version`, `peopleAcknowledgements.test.ts › 2 pending with reminder`, `› link expires in 5 minutes`, `› test malware file refused`, `› KA service certificate due in 7 days` |
| POL-01..06 | `peoplePolicies.test.ts › employee sees applicable only`, `› as of shows old version`, `› MH contractor sees MH policy`, `› acceptance task per person`, `› draft hidden`, `› overlapping policies flagged` |
| APR-01..07 | `peopleApprovals.test.ts › each request type routes through engine`, `› grade change adds HR head step`, `› overdue hands on`, `› stand-in receives`, `› self approver skipped`, `› list sorted by due with Overdue`, `› two submits one request` |
| DESK-01..06 | `peopleDesk.test.ts › portal request reaches HR`, `› internal note hidden`, `› queue and resolve-by`, `› reopen day 8 refused`, `› move leaves only "Moved"`, `› template cites policy version` |
| PRIV-01..06 | `peoplePrivateCases.test.ts › owner without membership gets 404`, `› named member excluded`, `› evidence open logged`, `› search, export and ask return nothing`, `› report has counts only`, `› committee under half women warns` |

### Compliance, privacy, health, why, reports, AI
| Req | Test |
|---|---|
| COMP-01..06 | `peopleCompliance.test.ts › edit creates version, old readable`, `› MH shop brings MH items`, `› no percentage field anywhere`, `› state transfer review tasks`, `› unchecked rule shows banner`, `› employee register export fields` |
| PRV-01..07 | `peoplePrivacy.test.ts › new notice version re-asks`, `› erasure keeps payroll with reason`, `› past retention in review list, nothing deleted`, `anonymiseEmployee.test.ts › nothing left anywhere` (fails today), `dpdp.test.ts › only-email person gets breach notice` (fails today), `› auditor access ends on time and cannot open a profile`, `› access log lists viewers` |
| HLTH-01..04 | `dataHealth.test.ts › every item has reason`, `› snooze returns on date`, `› headcount as of matches log` |
| TRACE-01..05 | `peopleWhy.test.ts › seven items on a promotion`, `› pre-history shows unknown line`, `› correction carries change id`, `› pay link hidden without Payroll permission`, `› old policy version kept after change` |
| RPT-01..03 | `peopleReports.test.ts › export matches screen`, `› schedule honours filters`, `› manager export has no statutory columns` |
| AIG-01..06 | `peopleAi.test.ts › refused when off`, `› setting change audited`, `› one log row per answer`, `› no write path reachable` (static), `› cross-company retrieval empty`, eval report |
| ASK-01..05 | `peopleAsk.test.ts › cites policy version for the person`, `› six fields present`, `› cannot answer when no policy`, `› non-approved report refused`, `› pay of others refused` |
| FORM-02..05 | `peopleForms.test.ts › FORM-03a..j` (one per behaviour), `› form mapping status is refused at publish`, `› contract-end trigger fires once` |

### Non-functional
| Req | Test |
|---|---|
| NFR-01 | `peopleRls.test.ts` (all) |
| NFR-02 | `peoplePerf.test.ts › directory first page under 1 s with 2,000`, `› profile under 800 ms` |
| NFR-03, 08 | `test/design-rules.test.js` (tokens, radii, shadows, ≥12px, People override block absent) |
| NFR-05 | `apps/people/src/screens/*.test.jsx › renders loading, empty, error, no-permission, offline` |
| NFR-06 | FND-04 tests |
| NFR-07 | `peopleRetention.test.ts › logs under 1 year never in deletion review` |

---

## 4. Browser journeys (PC-E2E-01..05)

Each recorded step by step with screenshots in `docs/people/evidence/PC-E2E-0n/`.

| # | Journey | Steps (summary) | Must happen |
|---|---|---|---|
| E2E-01 | New hire | Add person (joining next Monday) → send invite → open invite as joiner at 375 px → fill details, upload ID, accept policy → HR checks → joining plan shows IT, manager, Payroll tasks with names → IT ticks laptop from Home → day one: status Active | Every step leaves a Timeline row with Why?; outbox shows `created.v1`; no raw palette class on any screen (design test) |
| E2E-02 | Transfer KA → MH | Start a change → compare → impact lists holiday, PT state, leave policy → send → manager approves → HR head approves → scheduled → run job → applied | Why? on Office shows two approvals and rule version; Payroll untouched; review tasks exist |
| E2E-03 | Leaving | Employee resigns in Me → manager approves → leaving plan with hand-back list → last day job → Left → relieving letter PDF | `separation_scheduled.v1` then `separated.v1` once; settlement due date = LWD + 2 working days |
| E2E-04 | Expiring permit | Seed permit 30 days out → job → tasks and Health check item → upload renewal → item fixed | One reminder per threshold |
| E2E-05 | New obligation and private case | Add rule version → obligations appear for MH establishments → policy review task → publish → employees asked to read; then employee files a private case → owner (non-member) gets 404 → member sees deadlines | No score anywhere; case absent from search and export |

Plus the signature journey (PRD §8.1) as **E2E-06 (pilot)**: runs end to end only when PI-01 and AI-01 exist; until then the test asserts the panel says which evidence is missing.

---

## 5. Manual sheet (summary; full rows in the xlsx)

| Sheet | Rows | P1 rows |
|---|---|---|
| 1. Setup and organisation | 12 | 4 |
| 2. People and profile | 18 | 8 |
| 3. Joining, changes, leaving | 22 | 10 |
| 4. Documents and letters | 12 | 5 |
| 5. Policies and approvals | 16 | 6 |
| 6. Help desk and private cases | 14 | 8 |
| 7. Compliance and privacy | 16 | 10 |
| 8. Why and health | 10 | 4 |
| 9. Access and security | 14 | 14 |
| 10. Design and screens | 8 | 2 |

P1 = money, legal, access or data loss. "New" column marks rows built in this round and never exercised.

---

## 6. Release evidence (gates in PRD §13)

| Gate | Evidence to record |
|---|---|
| 1 Cross-company | `peopleRls.test.ts` green, count of tables and routes covered |
| 2 Actor and history | FND-04 tests; a sample ChangeLog export |
| 3 Other apps keep working | full `server` suite green on the People branch |
| 4 Retries and duplicates | FND-05, APR-07 tests |
| 5 Restore and privacy demo | restore script output; a PRV-02 request walked through, screenshots |
| 6 Ask evaluations | AIG-06 report |
| 7 AI cannot write | static test output |
| 8 Rules checked | COMP-05 report: every seeded rule with a checker's name |
| 9 No real data | TEST-GEN seed used in every environment; attestation |
| 10 Paid-grade infrastructure | provider and backup configuration recorded |
