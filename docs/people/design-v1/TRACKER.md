# People design v1 tracker

Gates: G1 Functional · G2 Visual · G3 Implementation · G4 Acceptance. A step is DONE only with evidence for all four.
Status: TODO · IN PROGRESS · DONE · BLOCKED (owner decision).

| Step | Item | G1 | G2 | G3 | G4 | Status | Evidence |
|---|---|---|---|---|---|---|---|
| A | Source audit, mapping, plan | ✓ | – | – | – | DONE | `00-SOURCE-AUDIT-AND-PLAN.md` |
| A.1 | Security fixes found by the audit (hashes, write scope, bulk loop) | ✓ | – | ✓ | ✓ | DONE | 934cc38, 2d6f285 |
| 00.1 | Rose palette: graphite rail, canvas/ink, reduced motion, dark tokens | ✓ | ✓ | ✓ | ✓ | DONE | `palette.test.js`, `design-rules.test.js` 8/8; `evidence/00.1/` |
| 00.2 | Shell params in URL, People mobile tabs, boundary retry | ✓ | ✓ | ✓ | ✓ | DONE | `split-navigation.test.js` (4 new); browser: `s.*` params survive load, company switch clears them; `evidence/00.2/`. Note: the shell's desktop breakpoint is 1100px (spec says 1024); kept, since the spec says to preserve the shared collapse behaviour |
| 00.3 | SearchField, DatePicker, Tabs, Alert, ErrorState, ActivityTimeline, breadcrumb | ✓ | ◐ | ✓ | ◐ | IN PROGRESS | `people-design-components.test.jsx` 13/13 (debounce, Enter, Escape, IME, tab keys, date parse/min/grid keys, error kinds, redaction, filters). Visual and acceptance evidence come when screens use them (01.x) |
| 00.4 | Drawer and Modal focus/dirty fixes | ✓ | ✓ | ✓ | ✓ | DONE | `people-design-components.test.jsx` (3 new): focus returns, Escape closes an inner date picker first, dirty scrim/backdrop ignored, Escape asks before discarding. Full web suite 54 failing, all Accounting/baseline (main reported 57) |
| 00.5 | DataTable | ✓ | ◐ | ✓ | ◐ | IN PROGRESS | `people-design-components.test.jsx` (3): server sort with aria-sort, 25/50/100 paging, row click vs controls, keyboard row menu, page selection, columns and density. Visual and 375px proof with EMP-01 |
| 00.6 | Application state kit | ✓ | ◐ | ✓ | ◐ | IN PROGRESS | `useRequest` (first load, background refresh keeping data, slow flag, failure keeping data, newest answer wins, cancel), `useOnlineHint`, `ErrorState` kinds, `Alert`; test in `people-design-components.test.jsx`. Each state shown on EMP screens in 01.x |
| 01.1 | Backend: sort/filters/counts, version + 409, preferred name, ID suggestion, drafts, server export | ✓ | – | ✓ | ✓ | DONE | `peopleWorkforce.test.ts` 5/5; neighbours 55/55; route gate 0 violations |
| 01.2 | EMP-01 Directory, EMP-12 Saved views | ✓ | ✓ | ✓ | ✓ | DONE | `workforce/Directory.jsx`: server search/filter/sort/paging in the URL, counts strip, live banners, filters drawer, columns, row menu (keyboard: arrows, Escape returns), bulk bar and result drawer, audited export, saved views, Pending actions tab (`/workforce/pending`). `evidence/01/desktop-01`, `desktop-06-pending-actions`, `mobile-0[12]`, `landscape-01`, `zoom200-01`, `state-429` |
| 01.3 | EMP-02 Add Employee wizard | ✓ | ✓ | ✓ | ✓ | DONE | `workforce/AddEmployee.jsx`: every employee field over four steps; pickers narrow by parent; review lists every field; all 38 saved and checked in the DB. Leave guard in the app (sidebar, Back, company switch). `evidence/01/desktop-03`, `desktop-05-leave-guard`, `desktop-08-wizard-review`, `zoom200-02` |
| 01.4 | Record page, EMP-03..06 | ✓ | ✓ | ✓ | ✓ | DONE | `workforce/EmployeeRecord.jsx`: section edits (409 compare, network retry, focus handoff), transfer with impact, designation, type, suspend and reactivate (one allowed move, reason required), probation extend and confirm, record leaving, rehire (stint 2). All run in the browser. `evidence/01/desktop-0[24]`, `desktop-09-transfer`, `desktop-10-record-leaving`, `zoom200-03` |
| 01.5 | EMP-07 Documents, EMP-08 History | ✓ | ✓ | ✓ | ◐ | IN PROGRESS | History compare on two dates (`desktop-07`); journey one line per field; employment history no longer doubled by an instant approval (test). Documents register restyled (`desktop-13`). Signed document links (WF-24) wait on the main session's R2 work |
| 01.6 | EMP-09 Activity | ✓ | ◐ | ✓ | ✓ | IN PROGRESS | `/employees/:id/activity` + ActivityTimeline + comments; redaction tested in `peopleWorkforce.test.ts`. Platform AuditLog now carries the request id (migration `20261027100000_audit_correlation`); Activity adds what it recorded that the change log does not (D-V8) |
| 01.7 | EMP-10 Import, EMP-11 Bulk results | ✓ | ✓ | ✓ | ✓ | DONE | `workforce/ImportEmployees.jsx` (upload, map, check, review, results, undo, reports); browser: 3-row file checked, 1 imported, undone. Bulk result drawer with skipped download |
| 01.8 | Mobile, company switch, accessibility | ✓ | ✓ | ✓ | ◐ | IN PROGRESS | No sideways scroll at 375, 768, 812×375, 900, 720×450 (200% zoom). Keyboard walk: menus, drawers, section edit. Cross-company test over every new endpoint. Not done: automated contrast/axe audit |
| 01.9 | Completion report | | | | | TODO | |

Workflow tests (spec §8): 1 directory round trip · 2 wizard back keeps fields · 3 invalid save then one submit · 4 network failure keeps input · 5 designation change on timeline · 6 company switch leaks nothing · 7 mobile with touch and keyboard.

## Workforce package (owner, 26 Oct 2026)

The owner sent `Clor_People_Workforce_Complete_Package.zip` with "remaining module finish everything".
It is filed under `workforce-package/` and refines Module 01 as **Workforce**: the visible label
`Employees` becomes `Workforce`; employment operations (WF-12..14), the import wizard, export
scopes, bulk jobs (WF-15..17), and an audit timeline with comments (WF-18..19) join the scope.
Its acceptance list `workforce-package/checklists/workforce_acceptance.csv` now carries a status per WF id
(VERIFIED only with a passing test or browser check; PARTIAL says what is missing). Its "stop at each phase" rule is overridden by the owner's
instruction to finish everything; each phase still lands with tests and evidence.

## Decisions in force (26 Oct 2026)

Owner said "start building" (relayed by the main session) without answering D-V1..D-V9, so each runs on its recommendation until the owner says otherwise — the same rule as D-02..D-10 (OD-10).

| ID | Running as |
|---|---|
| D-V1 | People dark tokens built and contrast-tested; the platform theme switch stays light-only |
| D-V2 | Spec's 7 profile tabs; Statutory is a permission-gated section of Personal; Requests and Tasks as Overview "Open items" |
| D-V3 | Work relationship = Employee type + Contractor; no new field |
| D-V4 | People's rail graphite, colour tokens only in the rose palette |
| D-V5 | Canvas `#F6F4F2` and ink `#232226` in the rose palette only |
| D-V6 | Radius stays 4px (Accounting geometry) |
| D-V7 | Shell writes screen params to the URL (shared change, told to the main session) |
| D-V8 | Platform AuditLog gains a correlation id (platform migration, told to the main session) |
| D-V9 | Directory banners from live Data Health and checklist counts, dismissible per user |

## Waiting for other modules (Workforce audit, 26 Oct 2026)

Found while closing Workforce; each belongs to the module named and is the first thing to do when that module is built. Workforce already records what they need.

| Module | What | Why it is not done in Workforce | What done looks like |
|---|---|---|---|
| Attendance | Holidays after a mid-month move. The monthly summary (`server/src/services/attendance/days.ts`, `holidaysFor`) and reports (`server/src/routes/attendanceReports.ts`) read the person's current location for every day of the month. Someone moved from Bengaluru to Pune on 15 Oct gets Pune's holidays for all of October. | The fix is in how Attendance picks the location per day. | Each day uses the location the person had that day, from employment history (`employeeAsOf` / `EmploymentHistory`). A test with a move on the 15th: holidays before it from the old location, after it from the new. |
| Payroll | Bank details asked for from the employee app. | Payroll's bank-change path (`services/payroll/bankChanges.ts`, `routeBankUpdate`) applies a first bank account at once with no approval. A request screen on top of it would be unsafe until Payroll decides the rule. | Payroll decides: does a first account need HR approval, is a change held until the next pay run. Then the employee app asks, and HR approves through the same requests. |

## Organization module (started 26 Oct 2026) — handoff state

Read first: `ORGANIZATION-DECISIONS.md` (scope and reasons), `WORKFORCE-AUDIT-2026-10-26.md` (how a module is closed), memory `module-build-method`.
Owner rules in force: research zips are reference; Claude chooses scope. Every page, form, field, button and layout follows the Workforce patterns exactly (lists on the page ground, one primary action top right, drawers, PopupSelect/DatePicker, tokens only, 8/12px radii, plain words, no filler text or captions). Verify every screen in the browser; then audit from product, owner, CEO, employee, HR, manager and IT angles, and a final automation + workflow audit; fix everything.

| Step | State | Where |
|---|---|---|
| O.0 Decisions written | DONE | `a16daaf` ORGANIZATION-DECISIONS.md |
| O.1 Screens | DONE | `b65c04a`: `apps/people/src/organization/{Overview,StructurePage,lists,Branches,Changes,api}.jsx`, OrgChart Departments view, branch on record/hire/transfer/directory, manifest module, Settings trimmed |
| O.2 Server | DONE | `13b6e23` merged |
| O.3 Merge + wire-up | DONE | `b7b7498`: `none` filters for department, branch, manager; chart nodes carry `departmentId`; a sole open branch set on hire and filled once (`fillSoleBranch`) |
| O.4 Deep research → reconcile plan | DONE | `ORGANIZATION-RESEARCH.md`; decisions in ORGANIZATION-DECISIONS "Reconciled" table, all built: manager change moves waiting manager steps (`rerouteManagerSteps`), "Without a manager" tile + `managerId=none`, first person in a new state gives HR a task (`firstInState`), employee Branch reads "Works at", Work sites and Locations under Detailed (`DETAILED` backfill includes `establishment`), chart Print, "Reporting manager" in the employee app. Tests in `peopleOrganization.test.ts` (11) |
| O.5 Browser checks, layout fixes, axe | DONE | 1366 and 390 px, axe 0 violations; findings V1–V8 in `ORGANIZATION-AUDIT-2026-10-26.md` |
| O.6 Audits (multi-angle, then automation + workflow) and fixes | DONE | `ORGANIZATION-AUDIT-2026-10-26.md`: branch retire moves people first (`retireBranch`, platform PATCH refuses with people), branch history under Changes (`logBranch`), head/lead leaving gets a successor task (`successorTasks`), employee app "Works at", approval step order fix |

Server contract the screens use (O.2): `GET /people/organization` → `{company, branches[{id,name,code,city,state,isActive,people}], departments[{id,name,parentId,isActive,headEmployeeId,headName,headLeft,people}], unplaced{noDepartment,noBranch,noManager}, lists{designations,roles,teams,positions,units,grades,centres,areas,sites,types,workModes}, detailed, checks[]}`; structure items carry `headEmployeeId/headName/headLeft` (departments); `POST /people/structure/:kind/:id/merge {intoId, reason}` → `{moved, children, item}`; `PUT /people/structure/:kind/:id {isActive:false, moveTo}` (409 `IN_USE` without moveTo); `GET /people/structure-history?kind&id&limit&before` → `{entries[{id,at,actorName,kind,kindLabel,itemId,itemName,action,changes[{field,label,before,after}],reason}]}`; Data Health area `Structure` checks; employee `branchId` validated, `branchName` returned, list filter `branchId`, import column `branch`; feature `peopleOrgDetail` (off by default, backfilled on for orgs using detailed lists); employee app `terms.departmentHead`.
Module state: Organization closed pending the owner's answer below.
Second research pack (repo-aligned, 26 Oct) checked item by item: `ORGANIZATION-RESEARCH-2-RECONCILED.md` (chart scope and as-of, delete with dependents, retired links, rename in one save, seat-on-retired-team check, direct vs sub-department counts fixed; then R024 arrow-key tree, R043 1,000-person timing and two-level start, R056 move preview finished — nothing open).
Field suggestions (owner rule 26 Oct 2026, for every app; DESIGN.md "Text fields suggest what already exists"): shared `SuggestInput` (packages/ui) + `GET /people/suggestions?field=` (city, state, country, relation, workLocation, department, designation, emailDomain, reason, budgetRef, branch, branchAddress). Wired in People: hire form (work email, relationship), record (work email, city, state, country, relationship, work address), job-change and bulk reasons, structure names (company's own + common names, "already in the list"), work site name/address from branches, budget reference, branch code/city, policy titles. Deliberately none: phones, personal emails, IDs, home addresses, help-desk subjects, private cases. Other apps (Accounting, Attendance, Hiring, …): still to roll out.
Open question to the owner: rename "Job role" (to avoid confusion with access roles) — answer pending.
