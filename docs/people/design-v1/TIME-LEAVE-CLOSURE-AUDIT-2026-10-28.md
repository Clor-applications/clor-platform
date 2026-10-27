# Time & Leave: post-merge closure audit (28 Oct 2026)

- **Baseline:** PR #40 merged, `main` at `62cb797`.
- **Branch:** `claude/time-leave-closure`.
- **Method:** five independent read-only reviews, each re-checked against the code before anything was changed:
  - tracker reconciliation
  - audit-record durability
  - subscription × role matrix
  - month close, payroll and migrations
  - market and statute research
- **Rule:** nothing below is "done" without a test or a command that shows it.
- **Market comparison:** in [`TIME-LEAVE-MARKET-RESEARCH.md`](TIME-LEAVE-MARKET-RESEARCH.md), covering 12 products, Indian statute and the automation standard.

**Verdict: not 100% complete.**
- Every P0 that could be fixed in code is fixed and tested.
- Two release gates need the owner. Production must be woken by Cloud Scheduler (setup is a GCP change), and a statutory decision on earned leave is still open.
- Several P1 items need Payroll to change how it reads Attendance.

All of these are listed under "Release gates" and "Open, with the reason".

## Release gates

| Gate | State | Evidence |
|---|---|---|
| G1 Server suite green | See "Test evidence" | `cd server && npx vitest run` |
| G2 Time & Leave web tests green | Pass | `npx vitest run test/people-time-leave-*.test.jsx test/people-attendance-requests.test.jsx test/my-leave-preview.test.jsx test/split-navigation.test.js` |
| G3 Background jobs run in production | **Code done; production setup waits for the owner** | `server/src/__tests__/internalJobs.test.ts`. Production: `DEPLOY.md` → "Background jobs on Cloud Run" (secret, `gcloud scheduler jobs create`). |
| G4 No one decides their own request, balance or pay-out | Pass | `timeLeave.test.ts` › closure audit; `attendanceRequests.test.ts` › closure audit |
| G5 Every financially significant action leaves an audit line that cannot be edited | Pass for the paths fixed below; remaining P2 paths are listed | `attendanceRequests.test.ts` (employee-app audit, append-only) |
| G6 Closed or paid periods do not move | Pass: Attendance close, holidays, overtime, payroll-taken days. **Open: shift and schedule edits** (P1, below) | `timeLeave.test.ts` › closed month; `payrollFromLeave.test.ts` › payroll run locked |
| G7 Subscription × role matrix | Pass for the gaps found; untested cells are listed | `hrLeave`, `leave`, `timeLeave`, `attendanceRequests` |
| G8 Statutory leave rules (OSH Code earned leave) | **Open: owner decision** | `TIME-LEAVE-MARKET-RESEARCH.md` §(b) P0 |
| G9 Browser evidence | Taken this audit for the changed screens (see "Browser checks") | Screenshots in the PR |

## Findings

**Priority:**
- **P0:** money, pay or audit evidence silently wrong, or a whole function not working in production.
- **P1:** a control a reviewer or inspector expects.
- **P2:** correctness at the edges.
- **P3:** polish.

### Fixed in this branch

| ID | Requirement | Source | Before | Gap | P | Fix | Retest | Final |
|---|---|---|---|---|---|---|---|---|
| C-01 | Automation runs on Cloud Run | `server/src/index.ts`, every `start*` job | Jobs ran on in-process timers. Production `clor-api` has no min instances (scales to zero), CPU only during requests, no Cloud Scheduler (checked with `gcloud run services describe`). | Hand-on, digest, lapse notice, dated changes, outbox, reminders run only by chance. | P0 | `services/jobRegistry.ts` + `POST /api/internal/jobs/tick` (token, 404 when unset). Each job registers its tick and interval and runs at most once per interval per instance. The lease still stops two instances. A job that throws makes the call 500 so the scheduler retries. Catch-up comes from the database. | `internalJobs.test.ts` (9): runs once, retries next wake, lease held elsewhere, token, 404, 500 on failure | Code done; production setup in DEPLOY.md (gate G3) |
| C-02 | Employee-app actions are audited | `routes/portal.ts` `who()` → `portal:<id>`; `AuditLog.createdByUserId` FK to `User` | Every portal audit insert failed on the foreign key, and the helper swallowed it. | Manager approvals from the app, and every employee ask, edit and cancel, left no audit line. | P0 | Migration `20261028090000_audit_log_actor_append_only` drops the FK. The audit screen names `portal:`, `system` and `api:` actors. | `attendanceRequests.test.ts`: CREATE and APPROVE lines carry `portal:<id>`; the screen shows "Boss (employee app)" | Fixed |
| C-03 | Audit lines cannot be changed | `AuditLog` | Plain table: update and delete allowed. | Evidence editable. | P1 | Append-only trigger; only a closed company's purge deletes, under `clor.purge`. | Update and delete refused with `append_only` | Fixed |
| C-04 | A failed audit write is not hidden | `services/auditTrail.ts` | `audited = true` was set before the write. | A failed line also switched off the generic log. | P1 | Flag set only after the line is written. | Covered by `auditMutations.test.ts` | Fixed |
| C-05 | Nobody decides their own attendance request | `services/attendance/requests.ts` `decideRequest`, bulk-review | Owner, HR, a manager or a stand-in could approve their own WFH, on-duty, permission or missed punch. | Self-dealing. | P0 | Refused (`OWN_RECORD`) unless the company's maker-checker setting allows it, or nobody else can decide (one-person company). That case is written as `SELF_APPROVED`. | Closure-audit tests (owner alone allowed and audited; a second approver makes it refused; bulk too) | Fixed |
| C-06 | A stand-in never decides their own request | `services/attendance/standIns.ts` `managerStepBy`, `teamDecidedBy` | A reportee named stand-in for their manager approved their own leave and WFH in the employee app. | Self-dealing. | P0 | `managerStepBy` returns null for oneself; one's own requests are left out of one's queue. | Employee-app test: not in the queue, 403 on own, 200 on a colleague's | Fixed |
| C-07 | Own leave balance, pay-out and comp-off are someone else's call | `routes/leave.ts` allocations, adjustments (incl. ENCASH), comp-off | A team manager or HR could raise or encash their own balance. | Money to self. | P0 | `ownBalanceRefused` applies the company maker-checker setting. | Refused with `MAKER_CHECKER` while a colleague can approve; the colleague can | Fixed |
| C-08 | Overtime and comp-off decisions are atomic, checked and audited | `services/attendance/selfService.ts` `decideOvertime` | Four separate writes; no PENDING claim; no closed-month check; comp-off written into the allocation (calendar year, overwritable); no audit. | Double credit, a closed month's pay moving, no evidence. | P0 | One `peopleWrite` claimed by status. `assertMonthOpen`. Comp-off is a dated `LeaveAdjustment` in the leave period of the day worked, once per day whichever way it was asked. Day history and audit line. Own request refused. | `selfService.test.ts` (credit is one adjustment); closure tests | Fixed |
| C-09 | Missed-punch approval is atomic | `requests.ts`, `corrections.ts` | Day write, status and history were three commits with no claim. | Two approvers both write the day; a failure leaves it half-done. | P1 | One transaction claimed by status, as WFH already was. Webhook after commit. | `attendance.test.ts` corrections (approve twice → 409) | Fixed |
| C-10 | Month reopen is controlled | `routes/attendance.ts` reopen | No reason, no audit, no check that the month was closed. | Silent reopen after payroll. | P1 | Reason required (`REASON_NEEDED`); audit line with who closed it and when; close is audited with its snapshot version. Attendance screens ask for the reason. | `attendanceMonthLock.test.ts`, closure test | Fixed |
| C-11 | A closed month's payable days stay put | holidays create, edit, delete; single overtime approval | Not guarded. | Loss of pay changes after close. | P1 | `holidayMonthsOpen`, `assertMonthOpen` | Closure test (holiday add, move, delete; overtime) | Fixed |
| C-12 | Days Payroll has taken stay put, in every mode | `services/attendance/days.ts` `assertMonthOpen(…, employeeId)` | People-only had no protection; leave could be approved or cancelled into a locked or paid run. | Payslip and leave disagree. | P1 | `payrollTaken()`: an APPROVED, LOCKED, PAID or POSTED run covering the day for that person refuses the change (`PAYROLL_TAKEN`). Covers every day write, leave approval, cancel and shorten. | `payrollFromLeave.test.ts` (cancel and approve refused in the locked period; next month fine) | Fixed |
| C-13 | The manager does not reject after handing to HR | `leave.ts` reject, `portal.ts` | Reject had none of approve's checks. | Manager overrides HR's step. | P1 | `HR_STEP` on reject once the manager's step is taken. | Closure test | Fixed |
| C-14 | Company policy is changed company-wide only | `leave.ts` POST, PUT, DELETE types | A team role with Leave Types rights changed policy. | Policy by a team lead. | P1 | `wholeCompany` as for settings and working week. | Closure test | Fixed |
| C-15 | Private leave stays private in the type list | `GET /leave/types` | Company-wide count per private type ("Maternity: 1"). | Disclosure. | P1 | Counts within the reader's scope; null for a private type unless the reader reads private leave. | Closure test | Fixed |
| C-16 | One's own leave entered through HR routes keeps the employee rules | `POST`/`PUT /leave/requests` | `onBehalf: true` always. | Notice and back-date rules skipped for oneself. | P2 | `onBehalf` only when the person is somebody else. | Code review; existing tests unchanged | Fixed |
| C-17 | The old correction routes follow the shared rules | `portal.ts` `/corrections/:id` (PUT, cancel; used by Android) | Wrote the row directly: any kind, no quota or window, no history, no audit. | Untracked changes. | P2 | Missed punch only, through `editRequest` / `cancelRequest`. | Employee-app test | Fixed |
| C-18 | Hand-on never writes over a decision | `leaveJobs.ts` | `update` by id after a read. | A decision in between is overwritten. | P2 | Claim with `updateMany` on PENDING, unchanged, no manager step; `HAND_ON` audit line by `system`. | Closure test | Fixed |
| C-19 | A wake call never runs a daily job each time | `jobLease` lets its own holder retake (outbox needs that) | — | Daily jobs every 10 minutes. | P0 (found while fixing C-01) | Per-instance interval gate in the registry. | `internalJobs.test.ts` | Fixed |
| C-20 | Screens offer only what the server allows | `StandIns.jsx`, `WorkingWeek.jsx`, `RequestRules.jsx`, `YearEnd.jsx`, `LeaveCalendar.jsx`, Enter leave | Buttons for a read-only or team role; the calendar failed without Holidays; Enter leave failed without Leave Types. | 403s after a click; broken screen. | P2 | Controls follow the right and the scope. Holidays are optional on the calendar. Leave enterers may read the types. Own request says so in the drawer. | `people-time-leave-advanced.test.jsx` (stand-ins, two cases) | Fixed |

### Open, with the reason

| ID | Requirement | Source | Current | Gap | P | Why not here | Next step |
|---|---|---|---|---|---|---|---|
| O-01 | Production wake-up configured | GCP project `clor-apps-511409` | Cloud Scheduler API off; no `JOBS_TOKEN` | C-01 is inert until set up | P0 | Enabling an API, creating a secret and a scheduler job changes production infrastructure; it needs the owner's go-ahead | Run the DEPLOY.md commands (≈ 5 minutes; the first 3 scheduler jobs per billing account are free) |
| O-02 | Earned leave by days worked (OSH Code: 1 per 20 days worked after 180; Factories Act 240) | `leaveAccrual.ts` (calendar-based) | Accrual by calendar; state starting points use flat figures | Statutory for factories and, from 21 Nov 2025, OSH establishments | P0 (statutory) | Which Act applies is per company; the default sets must change with legal sign-off | Add an accrual basis "per N days worked" reading the day record; correct the state sets after review |
| O-03 | Leave register in the prescribed form (OSH Form XX, state forms) | `LeaveRegister.jsx` | Right numbers, no printable statutory form | Inspection format | P0 (statutory) | Form layouts need the rules text checked | Printable per-worker leave book |
| O-04 | Payroll reads the closed month's snapshot, not live rows | `payrollRuns.ts:382-455`, `readiness.ts` | Live `periodRows`; snapshot only named | Figures can drift from the snapshot | P1 | A Payroll change ("coordinate with Payroll") | Payroll takes rows from the latest snapshot when the month is closed and stores the version on the run |
| O-05 | Shift, assignment, rotation and schedule edits respect closed months | `services/attendance/scheduleGuard.ts`; `attendance.ts` shifts and assignments; `scheduling.ts`; `leave.ts` working week | **Fixed** (`fix/shift-guard`): each write works out its dates and is refused (409 `ATTENDANCE_MONTH_CLOSED`) when they touch a closed month. A shift's or rotation's rules have no effective date, so they are refused while a closed month uses them; the working week takes an `effectiveFrom` (earlier weeks kept in `AttendanceSettings.workingWeekEarlier`); the default shift is refused while any month is closed. Tested in `scheduleMonthLock.test.ts` | — | — | — | — |
| O-06 | LOP reconciliation (leave vs days vs payroll input) | none | No check | Drift goes unseen | P1 | Lands in Payroll's readiness tower | A per-person check in readiness that blocks lock on mismatch |
| O-07 | Notices are not lost | `notifications.ts` sendNotice; `attendance/notices.ts` | **Fixed:** leave and request notices (and the digest and lapse jobs) are outbox events written with the change, retried on the backoff, marked `failedAt` after the last try (`GET /internal/outbox/failed`); `Notification.dedupeKey` (unique per person) stops a second send; reason-only edits ask nobody again; an own cancel of approved WFH/on duty tells the approver; withdrawn leave reaches the approver through `reviewedByUserId` or approversOf | — | P2 | — | `noticeOutbox.test.ts` |
| O-08 | Before/after values on allocation, adjustment delete, working-week and period changes; per-row year-end undo | `leave.ts` | After only | Reconstructing a change needs the row history | P2 | — | Add `before` to those audit lines |
| O-09 | Leave created for a closed month is refused at ask time | `leave.ts` planLeave | Accepted, then unapprovable | Dead requests | P3 | — | Check `closedMonths` in planLeave/validate |
| O-10 | Android parity (WFH, on duty, permission, leave preview, edit, shorten) | `native/attendance-android` | Leave and missed punch only | Mobile gap | P2 | Separate app | Call the shared portal routes |
| O-11 | Night shift + leave (TLA-003), provisional day (TLA-004), per-day reader trust (TLA-005) | — | Not built | Deferred Attendance features | P2 | Attendance module, not Time & Leave defects | Attendance backlog |
| O-12 | Indexes on `attendanceRequestId`, `workedOn`, `yearEndId`; DB-level one code per type; CI migrate-diff | migrations | App checks only | Scale, races | P3 | — | One follow-up migration plus a CI step |

### Deferred by design (not defects)

- **Hikvision and other reader trust rules, night shift, provisional day:** Attendance backlog (O-11).
- **Five payroll research items:** separate research (memory: people build scope).
- **Accounting test failures on `main`:** owner, 28 Oct 2026, "accounting will do later". Another developer has local Accounting work; those files were not touched.

## Tracker reconciliation (T.0–T.11)

| Row | True state | Note |
|---|---|---|
| T.0 | Done (doc) | 27 decisions have no test; listed in the reconciliation report and folded into O-items where they matter |
| T.1 | Done, verified | Audit rows now tested (C-02) |
| T.2 | Done; Overview has no web test | — |
| T.3 | **Done and unit-tested; the row was stale** (written as IN PROGRESS in `1dad729` and never updated) | Leave Policy private + try on five people, Working week, Roles editor section: code and passing tests exist |
| T.4 | **Built; partly tested; the row was stale** | Employee app preview and portal leave reject-without-note have no test; Calendar, Balances, Register, My days, Team attendance have no web test |
| T.5–T.8, T.10 | Done; untested sub-claims noted in the reconciliation | — |
| T.9 | Claim only, no artefact | Browser checks for this audit are attached to the PR |
| T.11 | Done, verified | — |

## Test evidence

Server suite and web suite results on the branch head are recorded in the PR description, with exact counts. Commands:

```sh
cd server && npx vitest run
npx vitest run
```
