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
Standard pass on older Workforce screens (26 Oct): Policies, Help Desk, Help Desk settings, Private Cases, Approval Rules, Privacy, Onboarding & Exit, Documents, Custom Fields, Letters, Self-Edits, the register screen (Assets, Benefits and the other registers) and Employment Types / Work Modes / Company (legal) now follow the Workforce list and drawer pattern. No browser `prompt()` left; approval conditions name real items; DataTable empty state fixed. Time Off screens still to do with the Time module.
Second research pack (repo-aligned, 26 Oct) checked item by item: `ORGANIZATION-RESEARCH-2-RECONCILED.md` (chart scope and as-of, delete with dependents, retired links, rename in one save, seat-on-retired-team check, direct vs sub-department counts fixed; then R024 arrow-key tree, R043 1,000-person timing and two-level start, R056 move preview finished — nothing open).
Field suggestions (owner rule 26 Oct 2026, for every app; DESIGN.md "Text fields suggest what already exists"): shared `SuggestInput` (packages/ui) + `GET /people/suggestions?field=` (city, state, country, relation, workLocation, department, designation, emailDomain, reason, budgetRef, branch, branchAddress). Wired in People: hire form (work email, relationship), record (work email, city, state, country, relationship, work address), job-change and bulk reasons, structure names (company's own + common names, "already in the list"), work site name/address from branches, budget reference, branch code/city, policy titles. Deliberately none: phones, personal emails, IDs, home addresses, help-desk subjects, private cases. Other apps (Accounting, Attendance, Hiring, …): still to roll out.
Open question to the owner: rename "Job role" (to avoid confusion with access roles) — answer pending.

## Code review of Workforce and Organization (26 Oct 2026)

Two independent reviews (server, screens) of `c302c25..de5ed3a`. Fixed: compliance registers limited to record keepers over the whole company; auditor grants and retention take named fields only (no forged grantor); the person a request is about never decides it; bulk change skips a team lead's own record and checks the new manager; withdraw and rehire clear the old resignation and waiver; branch delete refuses with people filed there; private-case steps logged with their actor and references retry on collision; committee members and obligation owners must be users of the company; pending actions filtered to the team before the cap (`d87f9c6`, `peopleReviewFixes.test.ts`). Screens: unsaved section edits ask first, Add employee shows a refused save on Review, rehire offers only working managers, private searches never saved in views, export of ticked rows capped, tags save one at a time, SuggestInput closes on Tab, DataTable phone cards and past-the-end pages (`0638c21`). Left as is: merge moves people outside one transaction (a re-run finishes it); the readiness scan on every profile view (speed only). Known failing before this work: `test/fields-share-one-style.test.js` (AddEmployee photo input, SuggestInput input).

## Time & Leave module (started 26 Oct 2026)

Read first: `TIME-LEAVE-DECISIONS.md` (how it works per subscription, scope, reasons).

| Step | State | Where |
|---|---|---|
| T.0 Decisions and subscription modes | DONE | `TIME-LEAVE-DECISIONS.md` |
| T.1 Server: scope, private leave, preview, split, paging, request story, overview, policy preview, working week, audit | DONE | `f91b006`, `timeLeave.test.ts` (9), leave suites green |
| T.2 Screens: Overview, Leave requests (drawer, Enter leave with preview) | DONE, browser-checked 1366 and 390 | `TimeOverview.jsx`, `LeaveRequests.jsx`, `people-time-leave-requests.test.jsx` |
| T.3 Leave Policy (private, try on five people), Working week, Roles editor Time & Leave section | DONE | Built in `1dad729`; tests `people-time-leave-settings` 6, `permissionKeys` 7, `permissionMatrix` 1; row corrected in the closure audit (28 Oct 2026) |
| T.4 Employee app leave preview, manager reject reason; Calendar, Balances, Register, My days, Attendance, My leave to the standard | DONE, PARTLY TESTED | Built in `bdd6853`. Untested: employee-app leave preview, portal leave reject without a note, web tests for Calendar/Balances/Register/My days/Team attendance (closure audit) |
| T.5 Audit (owner, employee, manager, HR, IT, automation) and fixes | DONE | `7382ced`: half-day pay, private leave in every route, manager then HR separation, split decided as one, scoped notices, audit rows, waiting counts |
| T.6 Advanced build: engine | DONE | `f1b827a`: entitlements by employee type and service, probation HOLD/LOCK, per-type chain, auto-approve, stand-ins, hand-on job, digest, year end, edit, came back early, comp-off grant, restricted holidays, request history (`timeLeave.test.ts` 24) |
| T.7 Advanced build: attendance requests (missed punch, WFH, On duty, permission) | DONE | `f1b827a`: `services/attendance/requests.ts`, quotas and back-date windows, one queue, `attendanceRequests.test.ts` 9 |
| T.8 Advanced build: screens, employee app, state starting points, suggestions | DONE | `57216b5`, `3ac61e1`: Leave Policy rules, Year end, Stand-ins, Attendance requests, Request rules, My days requests, My leave, employee app requests and holidays; web tests 9 files, 58 |
| T.9 Browser checks | DONE | 1366 and 390 px: overview, requests (change, came back early), balances (as of, projected, comp-off), policy rules and in-use refusal, year end, stand-ins, working week, request rules, attendance requests (enter, approve, day marked WFH), employee app (ask WFH, restricted holiday pick, my requests) |
| T.10 Second audit and close | DONE | Independent audit of the advanced build: 16 findings, all closed (slabs by period, rules on a type in use from this period, stand-in as themselves, edit by type, half-day WFH present, leave over WFH refused, the rule waits instead of refusing, hand-on clock, stand-in queue and digest, lapse notice, year-end undo guard, stand-in right, comp-off save, approve while with the manager, picked holidays in WFH days); one code per type; tests `timeLeave.test.ts` 31, `attendanceRequests.test.ts` 11; decisions in `TIME-LEAVE-DECISIONS.md` |
| T.11 Attendance app on the shared engine | DONE | Time & Leave screens moved to `packages/ui/src/timeOff/`, Attendance's rail and Settings rewired to them, its old leave and Corrections screens deleted; bulk decide on Attendance Requests through `decideRequest`; people picker and suggestions served by the leave engine for a company with Attendance alone; tests `attendanceRequests.test.ts` 15, `people-attendance-requests.test.jsx` 6, `split-navigation.test.js` updated |
| T.12 Post-merge closure audit | DONE (code); 2 release gates with the owner | `TIME-LEAVE-CLOSURE-AUDIT-2026-10-28.md`: 20 findings fixed (job wake-up on Cloud Run, employee-app audit lines, append-only audit, no deciding one's own requests/balances, overtime and corrections atomic, month reopen with reason, holidays/overtime/payroll-taken days frozen). Open: Cloud Scheduler setup, OSH earned-leave by days worked, Payroll reading the snapshot, shift edits in closed months. Market research: `TIME-LEAVE-MARKET-RESEARCH.md` |

## Session 28–29 Oct 2026: People look, audits, ERPNext gaps, Time batch 1

Read this first if you pick People up from here. **Nothing below is committed.** The owner's live app runs from
`/private/tmp/clor-people-latest-20261028` (web 5186, API 4002 via `.claude/launch.json` entries `owner-web` / `owner-api`);
edit there, not in a worktree. That folder sits on `e24d7c6` with about 220 changed or new files; put it on a named branch before
committing, and only when the owner asks. People-only styling is keyed on `data-palette='sky'`; Payroll and the other apps are unchanged.

### Look and navigation (owner-approved, see memory notes people-palette-not-blue, people-nav-2026-10-28, people-ui-direction)

| Item | State | Where |
|---|---|---|
| Brand D, light theme only: Indigo `#232A66`, Marigold `#F5A623`, Lilac `#E9E5F4`; each colour has one job (headings and figures indigo, marigold for the open item and counts, lilac for hover) | DONE | `packages/ui/src/people.css` (People CSS split out of `index.css`, imported in `main.jsx`) |
| White work area, Cotton `rgb(250 246 238)` on the sidebars and side panels only | DONE | `people.css` |
| Icons: option C, Phosphor two-tone (indigo line, lilac fill, marigold fill on the open module/screen/tab); buttons use Fluent Regular line icons | DONE | `apps/people/manifest.jsx` (`duo()`, `iconSet: 'duo'`, `lineIcons: 'fluent'`), `colorSwap.jsx`, `lineIcons.js` (92 files import icons from it) |
| Navigation and names: Home · People · Organisation · Time · Talent · Workplace · Reports · Settings, sentence case, one Approvals inbox, inline Approve | DONE | `manifest.jsx`, `Approvals.jsx`; tests `people-navigation`, `split-navigation` |
| Back returns to where you came from (e.g. Workforce → Settings → save → Back lands on Workforce) | DONE | `packages/shell/Shell.jsx` (`cameFrom`, `noteOrigin`, hub-child back link, `updateParams` replaces history on hub children) |
| Even column widths on every list (no column above ~40% of the table), short columns one line, tables wider than the page scroll inside it | DONE | `packages/shell/wideTables.js` (`fitColumns`, CAP 0.4), `people.css` `[data-fit]` rules |
| Side panels with useful facts beside lists (approvals, employees, documents, assets, salary revisions, designations, change history, Who's away, talent and workplace registers) | DONE | `packages/ui/src/components/list/SidePanel.jsx` (`withSidePanel`), `apps/people/src/panels.jsx` |
| Phone: 44px targets, 16px inputs, 12px text floor, contrast fixes | DONE | `people.css` |
| Still wide beside its panel: Help desk table scrolls sideways at 1440px | OPEN | optional: narrow the panel for 7–9 column tables |

### Audits and fixes (server)

People code audit (caveman review, full audit, "bugs and all risks") — fixed and tested: policy document visibility in the employee app; help desk team scope (`desk.ts`, `peopleDesk.ts`, `inbox.ts`), attachments removed with a case moved; workspace records scoped to the team on GET/PUT/DELETE (`peopleWorkspace.ts` `recordScope`); private cases hide the complainant; leave: shortening one's own leave only from today, probation lock, maker-checker on import and auto-approve, atomic split, re-check on reject, year-end counts pending; leave rule HR fallback; attendance request HR step under the lock; approval engine `approveFinal` under an advisory lock with `finishStalled` recovery. Tests: `leaveAuditFixes.test.ts`, `peopleDesk`/`peoplePolicies` tests, web `people-audit-guards.test.jsx`.

### ERPNext comparison (29 Oct) and what was picked

People already matches or beats ERPNext HR on leave (accrual, carry forward incl. OSH, sandwich, notice, back-date, eligibility, comp-off, encashment, optional holidays, auto-approve, year end), attendance (grace, half/full-day thresholds, overtime, late penalty, rotations, geofence, readers, month lock, night shift, request types) and the approval engine (steps by manager/manager's manager/person/role/HR, conditions, due days, remind/hand-on, delegates, versions, nobody approves their own). Picked gaps, in build order:

| # | Feature | State |
|---|---|---|
| 0 | Half day at either end of a longer leave (owner-reported: the forms offered a half day only when first day = last day) | DONE |
| 1 | Shift change request | DONE |
| 2 | Leave block dates (ERPNext Leave Block List) | DONE |
| 3 | Grant leave to many (ERPNext Leave Control Panel) | DONE |
| 4 | Carried days expire after N days of the period | DONE |
| 5 | Import attendance from Excel (check before saving) | NEXT (batch 2) |
| 6 | Punch window before/after a shift; auto-pick shift by first punch | NEXT (batch 2) |
| 7 | Reminders: birthday, work anniversary, holiday, monthly leave balance | TODO |
| 8 | Alert rules builder (N days before/after any date field, tell a person or role) | TODO |
| 9 | Help desk auto-assign in turn | TODO |
| 10 | Custom request types made by HR (own fields, approval rule, one inbox) | TODO |
| 11 | Employee form setup (standard fields required/optional/hidden) | TODO |
| 12 | Shift swap between colleagues | TODO |
| 13 | Partially paid leave | TODO (low) |
| W1–W5 | Approval workflow upgrades: send back for changes (People approvals already have "Ask for more" + reply), one rules screen for attendance/overtime requests (leave already uses the LEAVE rule), amount condition, approve from the notice, "what happens next" timeline on every request | PAUSED by the owner in favour of the list above; W5 timeline was the next one planned |
| — | Left out on purpose: vehicle log, daily work summary, staffing plans, skill maps, referrals, KRA templates, travel forms, energy points, server scripts | — |

### Batch 1 as built (29 Oct)

- **Half day at either end.** `startHalf` / `endHalf` on a leave request (multi-day only); the server saves such a day as a half-day row of its own, linked by `groupId` like a period split, so balances, approval, calendar and payroll read it unchanged. `server/src/routes/leave.ts` (`rowsOf`, `planLeave` per-period running balance, create and edit), shared picker `packages/ui/src/timeOff/HalfDayChoice.jsx` (`halfDayBody`, `leaveSpan`, `HalfDayNote`) in Enter leave, My leave and the employee app. Tests `leaveHalfDays.test.ts` (9), web leave tests.
- **Shift change request.** New attendance request kind `SHIFT_CHANGE` (off by default; Settings → Attendance request types), up to 31 days, must change the shift on at least one day; approved, it writes a `TemporarySchedule` (wins over every other schedule) and re-scores days already gone; cancelled, the schedule is removed and the days re-scored. Columns `AttendanceRequest.shiftId`, `temporaryScheduleId` (migration `20261105090000_shift_change_requests`). `services/attendance/requests.ts` (`applyShiftChange`, `rescoreDays`, `shiftChoices`), `days.ts` `withNames` adds `shiftName`; UI in `AttendanceRequests.jsx`, `RequestRules.jsx`, `MyDays.jsx`, employee app `EmployeePortal.jsx`. Tests `shiftChangeRequests.test.ts` (3), `people-attendance-requests.test.jsx` (+1).
- **Leave block dates.** Table `LeaveBlock` with tenant policy (migration `20261105100000_leave_blocks`, registered in `__tests__/globalSetup.ts`); company or departments, all or some leave types, named people still allowed; checked when leave is asked or changed (problem `LEAVE_BLOCKED`), not when HR enters it. `services/attendance/leaveBlocks.ts`, routes `/attendance/leave/blocks` (Leave Types VIEW/EDIT), screen Settings → Leave block dates `packages/ui/src/timeOff/LeaveBlocks.jsx`. Tests `leaveBlocks.test.ts` (3), `people-leave-blocks.test.jsx` (3).
- **Grant leave to many.** `POST /attendance/leave/adjustments/bulk` (whole-company roles; `preview: true` answers who and who is skipped: left, not eligible, your own balance; same grant twice in a minute refused). Button on Leave balances, `packages/ui/src/timeOff/BulkGrant.jsx`. Tests `leaveBulkGrant.test.ts` (3), `people-bulk-grant.test.jsx` (1).
- **Carried days expire.** `LeaveType.carryExpiresAfterDays` (migration `20261105110000_carry_expiry`); carried days are used first, what is left lapses that many days after the period start and does not carry again; shown in "Why this number?". `services/attendance/leaveAccrual.ts` (`lapsedIn`), `leaveBalances.ts` (`takenBefore`), Leave policy field. Tests `carryExpiry.test.ts` (4).
- All three migrations are applied to the owner's dev database (`npx prisma migrate deploy --schema prisma/people/schema.prisma`).

### Tests left behind by the Talent move, fixed (29 Oct)

Hiring, goals and training moved from the workspace registers to Talent tables (`routes/peopleTalent.ts`, `TALENT-DECISIONS.md`); seven server test files still used `/workspace/recruitment|candidates|performance`. Rewritten to the Talent routes: `peopleWorkspace`, `peopleHire`, `peopleOffers`, `peopleHome`, `peopleChangeLog`, `modules`; `peopleTalent` (one-on-ones) now gives the peer an employee file so it checks "not your report" (403), not "link your sign-in" (409).

### Test state and how to run

- Postgres allows 100 connections. Stale dev servers from other sessions filled it on 29 Oct (`clor_people_build`, `clor_logoutcheck`); the owner stopped them. If tests fail with "too many clients" / "remaining connection slots are reserved", check `pg_stat_activity` first; it is not the code.
- Broad server run: `cd server; bash -c 'F=$(grep -lE "request-rules|/requests|leave/|attendance|people/" src/__tests__/*.ts); npx vitest run $F'` (150 files, ~10 min). Before the Talent test fixes: 1063 passed, 6 failed (all the Talent-move tests above).
- People web tests: 30 files, 179 passed (`npx vitest run` over `test/*people*`, `*portal*`, `*time*`, `*leave*`, `*attendance*`, navigation and palette files). The full web suite has 52 older failures outside People (accounting, axe-core missing, quiet-emphasis CRM files).

### Next

1. Batch 2: import attendance from Excel; punch window and auto shift by first punch.
2. Then reminders, alert rules, help desk auto-assign, custom request types, employee form setup, shift swap.
3. Approval workflow upgrades W1–W5 when the owner returns to them.
4. Commit on a named branch when the owner asks (no employer names in commits; see memory).

### Handover, 29 Oct 2026 16:35 IST — next session starts here

- **Code:** branch `claude/people-live`, pushed. [PR #50](https://github.com/Clor-applications/clor-platform/pull/50) into `main` is open (Auto-fix on). Worktree `/private/tmp/clor-people-latest-20261028` is the owner's live app (web 5186, API 4002). Head `0b10e5e` at handover; check `git log` for later commits.
- **CI runs on the owner's Mac**, not GitHub's machines (org billing blocks GitHub-hosted jobs): self-hosted runner `suresh-mac` (`~/actions-runner/clor-platform`, launchd service, labels `self-hosted, clor-mac`), its own Postgres 16 on port 5433 (300 connections). Workflows use `runs-on: [self-hosted, clor-mac]` (commit `c1c2bd9`, from `claude/ci-on-mac`; notes `docs/CI-ON-MAC.md`). One runner, so jobs queue; `verify` takes ~35 min.
- **CI state at handover:** on `c1c2bd9`, `verify` failed only `rlsFailClosed` (268/269 files passed). Fixed in `0b10e5e`: the `LeaveBlock` policy and the 14 Talent tables' policies now fail closed (new migration `20261105120000_talent_rls_fail_closed`, applied to the dev DB and registered in `__tests__/globalSetup.ts`); the public apply link saves under its company (`runInTenant` in `routes/peopleTalentApply.ts`). `audit` and `secrets` finished on `0b10e5e`; `verify` was running, due ~17:05 IST. First job next session: `gh pr checks 50 --repo Clor-applications/clor-platform`; fix anything red.
- **Local results before handover:** full People/attendance/leave/payroll/portal server run 149 files, 1081 tests passed; RLS, Talent, portal and leave-block tests 59/59 after the RLS fix; lint 0 errors, typecheck, migration drift, builds, `npm audit`, gitleaks all pass. People web tests 179 passed.
- **Other work saved the same day (unmerged, nothing on `main` changed):** main checkout's 59 uncommitted edits → `claude/main-checkout-pending` (`30b1b27`; its working copy still holds them); WIP commits on `claude/leave-rules-gaps`, `claude/ui-density`, `claude/attendance-optional-features`, `claude/audit-run-results-43c1cf`. Local `main` is at `1b8eaec` (22 Oct), behind `origin/main`.
- **After PR #50 merges:** change `CLAUDE.md` "Where People work stands" and memory note `people-latest-code` to say `main`, not `claude/people-live`; fast-forward local `main` only when its checkout's 59 edits are dealt with (they are saved on `claude/main-checkout-pending`).
- **Then build:** batch 2 — import attendance from Excel (check before saving), punch window before/after a shift, auto-pick shift by first punch. Then items 7–13 in the ERPNext table above.
- **Owner rules that apply:** People styling only under `data-palette='sky'`; plain words, sentence case; finish modules with tests and browser checks without asking; no employer names in commits or files; commit when asked, push only when asked (Auto-fix covers PR #50 fixes).
