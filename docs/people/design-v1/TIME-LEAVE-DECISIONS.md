# Time & Leave: how it works in each subscription, what we build, and why

Source: `Clor_People_Time_Leave_Repo_Aligned_2026-10-26.zip` (owner, 26 Oct 2026), used as
reference, not as a spec. Filter: CLOR sells to small businesses first: often one owner
doing HR, payroll and attendance with one sign-in. Every idea was checked against the code
on `claude/people-build-03ca03` (`de5ed3a`), not the research's commit `0bdc855`, which
predates the Workforce and Organization modules.

## One engine, two doors

Leave, holidays, balances and the day record are **one set of tables** in the People
database (`LeaveType`, `LeaveRequest`, `LeaveAllocation`, `LeaveAdjustment`, `Holiday`,
`AttendanceRecord`) and **one API** (`/orgs/:orgId/attendance/leave/*`, `/holidays`,
`/me`, the employee app's `/api/portal/leave`). People and Attendance are two doors onto
it. Neither app copies the other's data, so they can never disagree.

| | People only | Attendance only | People + Attendance |
|---|---|---|---|
| Who uses it | Owner/HR running leave and holidays | Operator running readers, shifts, days | Both, one company |
| Employee list | People's Workforce | Attendance's People section (the same `Employee` rows) | One list |
| Leave, balances, holidays | People → Time & Leave | Attendance → Leave, Settings → Leave Policy, Holidays | Same records from either app |
| Weekly offs that leave skips | The company's **working week** (People → Time & Leave settings) | Shifts | Shifts; the working week is the fallback for anyone with no shift |
| A day's record | Written by leave approval (On leave) and the basic check-in | Readers, phone punch, corrections, leave | Same |
| Who decides leave | HR, or the manager (Attendance rules' leave approval setting) — the same rule in every mode | Same | Same |
| Payroll days | Payroll → Run → *From leave*: approved unpaid leave is loss of pay | Attendance month summary (already counts leave) | Attendance month summary; *From leave* refuses (`USE_ATTENDANCE`), so leave is never counted twice |
| Month close | Not offered (no Attendance) | Attendance → Close Month; leave in a closed month is refused | Same as Attendance only |
| Employee app | Leave, balance, holidays, My details | Plus clock-in, corrections, month review | Everything |
| Permissions | `ATTENDANCE::Leave Requests`, `Leave Types`, `Holidays`, `My Attendance`, `Employee Portal` (wire keys unchanged) | Same keys | Same keys |

Server gate for every shared route: `hrOrAttendanceRouteOk` (either app switched on and
bought). Attendance-only routes (shifts, readers, overtime, month close) keep
`attendanceRouteOk`. Proven by `hrLeave.test.ts` (People only), `payrollFromLeave.test.ts`
(People + Payroll, and the refusal with Attendance on).

### What was wrong with the modes (found in this review)

| # | Mode | Problem | Fix |
|---|---|---|---|
| M1 | People only | Roles & Access hides the whole Attendance section when Attendance is not bought, and leave, holiday and employee-app rights live there. The owner could give a custom HR role no leave rights at all; only the presets carried them. | The role editor shows those five rights as their own **Time & Leave** section whenever People *or* Attendance is offered. Wire keys unchanged. |
| M2 | People only | Shifts are Attendance's, so a People-only company cannot say Saturday is off. Leave counted every Saturday of a five-day company as a leave day: balances over-charged, unpaid leave over-deducted. | A company **working week** (days off, which Saturdays) in People → Time & Leave settings. It is the default for anyone with no shift, in every mode; with Attendance, shifts still win. |
| M3 | All | A team-scoped role (Team Manager, "own records only") saw every person's leave, balances, ledger and register, and could approve outside their team. Workforce already scoped every People read. | Leave reads and decisions use the same `teamScope`; outside it reads as absent. |
| M4 | Both | Two separate leave UIs (People `timeOff/*`, Attendance `screens/Leave*`) over one API, with different names for the same thing ("Leave Applications" / "Leave Requests"). | **Closed 27 Oct 2026.** The Time & Leave screens live in `packages/ui/src/timeOff/` and both apps load the same files: Attendance's rail has Leave Overview, Leave Requests, Leave Calendar, Leave Balances, Leave Register, Stand-Ins; Daily Operations has Attendance Requests (was Corrections: missed punch, WFH, on duty, permission on one list); Settings has Leave Policy, Working Week, Leave Year End, Request Rules. Attendance's old `LeaveRequests`, `LeaveBalances`, `LeaveTypes` and `AttendanceRequests` screens are deleted. The page header's first crumb is the app the screen is open in (`data-app` on the document). |

## The module

**Time & Leave** on People's rail (was "Leave & Attendance"). It answers: **who is away,
what is waiting for me, and how many days does each person have — and why.**

| Screen | Why it is there |
|---|---|
| Overview | Away today, waiting (oldest first, with how long), back this week, balances lapsing at the period end. The owner's morning question on one page. |
| Requests | Decide what is waiting. Server-paged and searched; each request shows the days charged and skipped, the balance before and after, who else is away, and its history. |
| Calendar | Who is away in a month, by department; private leave types show as "Away". |
| Balances | Everyone's days; one person's ledger line by line ("Why this number?"); add, take away or pay out with a reason. |
| Register | The period's statutory-style register: opening, credited, changed, taken, paid out, lapsed, closing. |
| Attendance | Everyone's days, read only (the day record leave writes, and readers' when Attendance is on). |
| My leave, My days | The signed-in person's own. |
| Settings → Leave Policy, Holidays, Working week | Set up once. |

## Adopted from the research

| Research item | In our code | Built as |
|---|---|---|
| TLA-002, TL-084 People-only and custom-role matrix; company/manager scope | M1, M3 above | Time & Leave rights section; `teamScope` on every leave read and decision; tests per mode |
| AUT-05, TL-041, TL-031 Preview before submit: dates counted, skipped, sandwich, balance after | The count happened only on save; HR and employees saw a number, never which dates | `POST /leave/requests/preview` (no write): each date counted or skipped and why (weekly off, holiday name, sandwich), balance before/after, policy problem, overlap, who else is away; used by HR's form and the employee app |
| TLA-008, TL-033 Leave crossing the leave-year end | Refused with "split it at …" | The preview shows the split; saving creates one request per period, linked (`groupId`), in one transaction |
| TL-045 Request history | Fields existed, never shown | Request drawer: asked (by whom, for whom), manager approved, decided with note, cancelled |
| TL-097 Audit every decision | Approve, reject, cancel, balance set, period change wrote no audit row | `recordAudit` on each |
| TLA-011, TL-101, TL-035 Sensitive leave privacy | Reason shown to every viewer, calendar included; reason forced (min 3 chars) | A leave type can be **private** (sick, medical, maternity): the reason is optional, and shown only to people who decide leave, never on the calendar or to the team |
| TLA-012, TL-100 500-row cap, no paging | `take: 500` | `limit/offset/q/status/leaveTypeId/departmentId` with a total and per-status counts; old callers (no `limit`) unchanged |
| TLA-015, TL-027 Policy preview | None | Leave Policy shows what the type gives five real people this period (newest joiner, longest serving, someone on probation…) before saving |
| TL-036 Leave on behalf names the requester | `requestedByUserId` stored, never shown | Shown in the history: "Entered by HR for …" |
| Reject with a reason (prohibited pattern: hidden reasons) | Note optional on reject | A rejection needs a reason; the employee app shows it |
| TL-085, TLA-006 Payroll counts leave once | Already true (table above) | Kept; test added for the half-day + Attendance-on paths stays green |
| TL-092, TL-095 Forms keep input, warn before discard | Old drawers | Shared Drawer dirty guard, PopupSelect, DatePicker (Workforce standard) |
| TL-046 (part), TL-052 (part) Tell people, without spam | Leave events went to webhooks only | One notice per leave: a new request to whoever decides it, a decision or cancellation to the person, HR when a manager passes it on; private leave says "leave" |
| TL-101 Private leave stays private everywhere | — | Private types hidden from non-readers in balances, ledger and register; never written into the day record's note |

## Declined, and why

| Idea | Reason |
|---|---|
| Readers, ADMS, certification, offline punch queue, reader recovery (TL-001..012) | Attendance's capture engine; not People's |
| Shifts, rosters, rotations, swaps, coverage rules (TL-053..064) | Attendance (scheduling). People gets only the working week (M2) |
| Overtime, comp-off grants (TL-065..074) | Attendance |
| Month close waivers, snapshots, payroll receipt (TLA-001, TL-079..083) | Attendance close + Payroll; their own modules |
| Policy versions with future effective dates (TL-039) | A small firm changes a leave type a few times ever; the engine already refuses a financial edit to a type in use and asks for a new type, which keeps history exact. A new type from the old one's settings is one click (built) |
| Delegation, escalation, quiet-hours digests (TL-046, TL-047, TL-086) | Approval rules and manager-step rerouting exist (Organization); a digest engine is a platform job |
| Partial approval, coverage requests, recurring leave (TL-048..050) | No small-business signal; the research marks them P2 |
| Hourly leave / permissions (TL-030) | Needs a minutes ledger across the day engine; P2 |
| Timezone per site (TLA-013) | India only today; IST stays explicit in `compute.ts` |
| AI copilot (TL-102) | Later, once explanations exist to ground it (this module builds them) |
| Reminders to employees before days lapse (TL-052) | The overview lists lapsing days for HR in the period's last two months; a per-employee reminder waits for the platform's digest and quiet-hours work, so it does not become one more notice |
| Reject reason enforced by the server | People and the employee app require it; Attendance's own screen (not rebuilt here) and the public API still send none, so the server keeps it optional until those move to the shared screens |
| 102-row backlog, 90 test rows | Templated; used as a checklist, not a plan |

## Waiting for other modules

| Module | What |
|---|---|
| Attendance | Leave and request screens now shared (M4, closed). Holidays after a mid-month move (already listed). Month close hard stops vs waivers (TLA-001), provisional day (TLA-004), reader trust (TLA-005), overnight shift + leave (TLA-003). |
| Payroll | Payroll receipt of a frozen attendance snapshot (TL-081/082). |

## Question for the owner

People-only companies can check in and out from People (founder, 22 Oct 2026). With
Attendance sold separately for capture, is a web check-in in People intended to stay?
Running as: kept, unchanged.

## Advanced build (owner's direction, 27 Oct 2026)

Owner: automate credits on any day of the month, different allocation by employee type, custom
leave workflows, automation, balances, half-day flow, WFH and On Duty requests, attendance requests,
edit and cancel before and after approval, and the shared manners of every module (field
suggestions, pickers that close, Enter saves, success and failure toasts, audit and history).
Checked against our own research (competitor help docs, app-store and forum complaints, Indian
leave law; `TIME-LEAVE-RESEARCH.md`) and against the code.

### What the research says users suffer from, ranked

1. Phone check-in that fails and punishes (Attendance module). 2. Wrong balances fixed by hand.
3. Regularisation broken or capped too hard. 4. Loss of pay that does not match payroll.
5. Slow support. 6. Set-up too complex (leave year, law). 7. Phone app weaker than web.
8. Rigid approvals: no leave on behalf, no edit or cancel after applying, no stand-in.
9. Notice floods or silence. 10. Balances hard to read or forecast.

### Owner's items, what exists, what we build

| Owner's item | Already in the engine | Built now |
|---|---|---|
| Credit on any day of the month (22nd, not 1st or last) | `creditOn: START / END / DAY`, `creditDay` 1–28 (`leaveAccrual.ts`); the policy form has it | Shown plainly on the form ("Credited on the 22nd of each month") and on the ledger; tried on five people before saving |
| Different allocation by employee type (full-time vs intern vs contract) | A type is *open to* chosen employee types only; different days meant a second type | **Entitlement rules** on one type: `annualDays` by employee type and by years of service (tenure slabs), with the type's days as the default. One "Casual leave", 12 for staff, 6 for interns, 15 after 3 years |
| Probation | `availableAfterDays` (usable after N days) | Per type: during probation, **hold** (credits start at confirmation, from the type's start), **accrue but lock** (credits build, usable at confirmation), or **accrue** as normal. Confirmation moves the person onto the full entitlement, prorated |
| Custom leave workflows | One chain for all leave (HR / manager / manager then HR), set in Attendance rules | Per leave type: its own chain, **auto-approve** when under N days and the balance covers it, a **stand-in** approver while the manager is away (dated, set by HR or the manager), and **hand on to HR** when a step waits longer than N days. No second workflow engine: the same three shapes, applied per type |
| Automation | Monthly credits are computed, not run; no year-end process | **Year-end preview and run**: carry forward (days or %, with a cap), pay out the rest or lapse it, per type, previewed per person, run once with an undo until the first request of the new period. **Reminders**: one morning digest per approver of what waits, nothing per request. **Hand-on** after N days. **Balance-lapsing** notice to the person 30 days before the period end |
| Leave balances | Ledger, period register, "Why this number?" | Balance **as of a date** and **projected to the period end** (credits still to come minus booked leave), on the ledger and the employee app |
| Half-day flow | First or second half of one day | Kept; plus **Permission hours** (short leave: 1–4 hours, capped per month, not from the balance, marked on the day) |
| WFH, On Duty, attendance requests | Missed-punch corrections (`AttendanceRequest`, reason codes FORGOT_PUNCH, READER_DOWN, ON_DUTY, WRONG_SHIFT), overtime and comp-off requests | **Attendance requests** of four kinds on one list and one approval: **Missed punch** (correction, as now), **Work from home**, **On duty** (client visit, travel: place and note), **Permission** (hours). WFH and On duty mark the day *present* with its kind on the record, never leave. Each kind has a monthly quota and a back-date window in settings; the employee app shows used and left. One queue for HR and for managers |
| Edit and cancel, before and after approval | Cancel pending any time; approved before it starts; after it starts HR cancels | **Edit** a waiting request (dates, half day, reason) with the same preview; an edit resets the manager's step. **Cancel** rules kept, plus **came back early**: shorten an approved leave that has started, from the employee app (HR approves) or by HR, so only the days taken are charged. Every change in the request's history |
| Comp-off | From recorded rest-day work, into a comp-off leave type | Kept; for a People-only company with no punches, HR **grants** comp-off for a date worked (an adjustment with the date), with the same expiry |
| Holidays | Company and location holidays; optional holidays shown | **Restricted holidays**: a quota of N a year; the person picks from the optional list in the employee app; counted on the day, not from a leave balance |
| Set-up | Indian types one click away | **State starting points**: Karnataka, Maharashtra, Tamil Nadu, Delhi, Factories Act and the OSH Code default, each a set of types with the law's days, and the national and festival holidays to pick from. Starting points, never rules: the owner edits them |
| Field suggestions | None in Time & Leave | Reasons (leave, missed punch, WFH, On duty), places for On duty, leave type names: `SuggestInput` on the company's own words first |
| Pickers close, Enter saves, toasts | Mixed | Every drawer: Enter in the last field saves, Escape asks when dirty, a picker closes on choice and on click outside, success and failure toasts in the shared words |
| Audit and history | Decisions audited (this module) | Every create, edit, cancel, manager step, grant and year-end run in the audit log; a **History** tab on the request drawer and on each person's leave (the ledger) |

### Declined, and why

| Idea | Reason |
|---|---|
| Quarter-day and hourly leave from the balance | Permission hours cover the Indian habit (a few hours off, capped); hourly balances need a minutes ledger across the day engine. P2 |
| Approval steps by leave duration (two steps above 5 days) | Per-type chain and auto-approve under N days give the same control for a 1–50 firm without a rules table |
| Skills-based cover, coverage rules, roster forecasting | Attendance's scheduling; no small-business signal |
| WhatsApp or e-mail notices | Platform notification channels; this module sends the notices, the platform delivers them |
| Geofence and selfie on On duty | On duty lifts the site rule for that day; capture stays Attendance's |

### Build order

1. Engine: entitlement rules (employee type, tenure, probation), per-type chain with auto-approve, stand-in and hand-on, year-end run with preview, balance as of a date and projected. Tests for each.
2. Request lifecycle: edit, came back early, history; attendance requests (missed punch, WFH, On duty, permission) with quotas; comp-off grant; restricted holidays.
3. Screens: Leave Policy (entitlements, workflow, probation), Year end, Attendance requests list and drawer, the employee app's requests, Settings → Request rules, state starting points; suggestions, Enter, pickers, toasts, History everywhere.
4. Audits from owner, employee, manager, HR, IT angles; automation and workflow audit; fix all; browser checks on desktop and phone for every screen.

### Decisions taken while building (27 Oct 2026, owner: decide and go on)

| Question | Decision | Why |
|---|---|---|
| Does a stand-in see the team they cover? | Yes, in Time & Leave only: the leave scope is the person's own team plus the teams they stand in for today. Workforce scope is unchanged | They are asked to decide; they must see what they decide. Nothing else of the team's opens to them |
| Who approves "came back early"? | Nobody: the person (or HR) shortens the leave at once and the approver is told | The person is at work and the punches show it; a second approval would only delay the balance coming back |
| What is a hand-on? | The manager's step marked as taken by nobody, with "Handed on to HR" in the history; HR decides | No new state, no new table; the story says what happened |
| What does the year-end run do? | Pays out the days that would lapse, for encashable types, as adjustments Payroll lists; carry-forward and lapse are computed by the engine as before | The engine already carries and lapses on its own; a run that rewrote balances would double count |
| Who gets auto-approval? | A person's own request only, within the type's limit and their balance; HR entering leave for someone still goes through the chain | The rule exists to spare the manager a two-day casual leave, not to skip checks on entries made for others |
| Entitlement by service: when does a slab apply? | From the first period that starts after the service is reached (read at the period start or joining, whichever is later) | A balance that jumps mid-year is the "wrong balance" complaint |
| Restricted holidays: approval? | None, within the quota; the day becomes a holiday for that person once picked, and can be dropped until it has passed | A quota is the control; an approval on top is the kind of step users complain about |
| WFH and On duty: leave or attendance? | Attendance requests; the day is present with its kind; monthly quotas and a back-date window the owner sets | Personio's split and Keka's quotas; never charged to a leave balance |

| One code per leave type? | Yes, within the company, case-insensitive: a second type with a code already in use is refused (`LEAVE_TYPE_CODE_TAKEN`) on create and on edit; "Make a new type from this" starts with the code blank; a state's set skips a type whose name or code is already in the list | Codes print on payslips and reports, so two types sharing one would read as the same; found in the browser check, 27 Oct 2026 |
| A service slab crossed this period: do past periods re-earn? | No: each period is earned at what it gave then (`annualDaysFor` in the accrual engine); the carry-in of a person crossing three years stays what their first two years gave | Second audit, 27 Oct 2026: the balance that jumped by the slab's difference per past year |
| Entitlement rules on a type in use? | Allowed: they apply from the start of the current leave period (`LeaveType.entitlementsFrom`); earlier periods keep the type's own days, requests and balances stay. The days a year, accrual, carry and sandwich still need a new type | The owner's headline item: "6 for interns" on the existing Casual leave, without splitting history |
| A stand-in's step: whose is it? | The stand-in's: `managerApprovedById` is theirs, the note says "(stood in for X)", and they cannot take HR's step after it even with whole-company scope; their queue and digest show the teams they cover | Second audit: the step was written as the absent manager's, which hid who decided and let a company-wide stand-in take both steps |
| A waiting request changed to another type? | Its own waiting days come back to the type and period they were charged to, nothing to the new type | Second audit: the old days were given back to every part, whatever its type |
| Half-day WFH or On duty with no punches? | Present by the request, with its kind; with punches the day is worked out from them | A People-only company has no punches: a half day there was an absent day and a loss of pay |
| Leave approved over approved WFH or On duty? | Refused, the same as the other way round: cancel the WFH first, or reject the leave. The leave rule (auto-approve) does not refuse: the request waits for a person and its story says why | One rule both ways; a rule that refuses a sick day over a brief clock-in was worse than one that waits |
| The hand-on clock | Runs from the request, or from its last change; the notice and the list say "handed on", not "manager approved" | Second audit |
| Year-end undo after Payroll listed a pay-out | Refused until the earning is cancelled there, as for one encashment deleted by hand | Second audit: an orphan earning otherwise |
| Naming a stand-in | Takes the right to approve leave (it hands an approval on) | Second audit: a read-only role could delegate anyone's approvals |
| Lapsing days | Each person told once, 30 days before the period end, with the types and days (the year end's pay-outs left out) | Was documented, not built |
| Probation HOLD or LOCK with no end date on the person | Treated as confirmed (ACCRUE): the rule has no date to go on; the Employment tab is where the date belongs | A rule that locked everyone without a date would lock long-serving staff whose probation was never recorded |
| Attendance and People share the Time & Leave screens (27 Oct 2026) | One build under `packages/ui/src/timeOff/`; each app's `screens.js` re-exports them. What differs per app is in `timeOff/shared.js` (the crumb). | Two UIs over one API had already drifted (Attendance's rejected without a note, listed WFH rows as corrections). One file cannot drift from itself. |
| The people picker and field suggestions come from the leave engine | `GET /attendance/employees` opens to anyone who may see days, leave or requests, inside their team scope, under `hrOrAttendanceRouteOk`; `GET /attendance/suggestions?field=leaveReason\|requestReason\|place` serves the same words People's `/people/suggestions` does (one service, `services/attendance/suggestions.ts`). | People's `/people/employees` and `/people/suggestions` need the People subscription; a company with Attendance alone must still pick a person and get suggestions. |
| Several attendance requests decided at once | The Waiting tab has a checkbox column for whoever may approve; the bar takes one note, Approve, Reject (needs the note). `POST /requests/bulk-review` runs each through `decideRequest`, so a WFH span is marked WFH, a manager-first chain is kept, and the answer says how many were handed on to HR. | A Monday's missed punches are decided together. The old bulk route wrote punches for every kind: a WFH approved in bulk became a 00:00 punch day. |

## Statutory leave (31 Oct 2026, from TIME-LEAVE-MARKET-RESEARCH.md P0 gaps G1–G3)

Every rule is opt-in on a leave type; the migration only adds defaulted columns, so existing types and balances do not move. Nothing here is legal advice: the figures come from the research doc's secondary sources.

| Question | Decision | Why |
|---|---|---|
| Earned leave by days worked (G1): when is it credited? | `accrualBasis: PER_DAYS_WORKED`. One day per `perDaysWorked` worked in the **previous** period, credited on this period's first day, when that period's days reach `minDaysWorked`. A fraction of half a day or more is a whole day | OSH Code s.32 and Factories Act s.79 allow the leave "during the subsequent calendar year" for work in the year before; s.79 rounds half up |
| What is a day worked? | With Attendance: PRESENT 1, HALF_DAY 0.5 (WFH and On duty are present). Holidays, weekly offs, absences and leave do not earn. Paid leave counts towards the threshold only | s.79 Expl. 1 deems maternity leave and last year's earned leave worked for the 240-day count but earns no leave on them; counting every paid leave day errs to the worker |
| People only, no punches | Working days by the working week and holidays, joining to leaving, less approved leave (earning) or less unpaid leave (threshold). "How is this worked out?" on the ledger says so | The owner's brief |
| Not modelled | Lay-off days, the Factories Act two-thirds rule for joiners, the adolescent rate (1 per 15), restricted holidays in the fallback | Not in the research's P0; listed so nobody assumes otherwise |
| OSH carry-forward (G3) | `oshCarry`: carry up to `carryForwardMax` plus the days of the type asked for and REJECTED by a person (not the system) in the period; what is over is paid out by the year end's run, encashment switched on or not | The research: "refused leave carries forward without limit", excess encashed. Mandatory or on demand conflicts in the sources; we pay at the run, which HR previews and can undo |
| Maternity as one request | The 60-day span is per type: `maxDaysPerRequest` above 60 (up to 182) is the span. `countsCalendarDays` charges every date. `availableAfterBasis: DAYS_WORKED` checks `availableAfterDays` (80) against days worked in the 12 months before the leave starts, paid leave included | Code on Social Security ch. VI. The Code counts to the expected delivery date; we count to the leave's first day. ESIC payment is a note in the form, not modelled |
| State sets | Numbers unchanged; the confirm dialog names the figure to check (KA/DL/TN carry limit, MH and Factories/OSH flat earned leave). New starting points: Earned Leave (OSH Code) 1/20 after 180, carry 30, OSH carry on; Earned Leave (Factories Act) 1/20 after 240, carry 30 | "Do not change the existing defaults silently" |
| Register in the prescribed form (G2) | Leave register → Print register: one worker a page, days worked, per type opening, earned, changed, availed with dates, refused with dates, paid out, lapsed, closing, signature lines, "format based on OSH Form XX / Factories Form 15" | The forms' own columns were not read (the research is secondary), so the page says "based on" |
