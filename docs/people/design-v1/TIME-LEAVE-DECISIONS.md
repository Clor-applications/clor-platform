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
| M4 | Both | Two separate leave UIs (People `timeOff/*`, Attendance `screens/Leave*`) over one API, with different names for the same thing ("Leave Applications" / "Leave Requests"). | People's rebuilt screens are the shared ones; names agree. Attendance's own screens are not rebuilt here (Attendance module), see "Waiting". |

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
| Attendance | Its own Leave Requests / Leave Balances / Leave Policy / My Leave screens should reuse People's shared ones (M4). Holidays after a mid-month move (already listed). Month close hard stops vs waivers (TLA-001), provisional day (TLA-004), reader trust (TLA-005), overnight shift + leave (TLA-003). |
| Payroll | Payroll receipt of a frozen attendance snapshot (TL-081/082). |

## Question for the owner

People-only companies can check in and out from People (founder, 22 Oct 2026). With
Attendance sold separately for capture, is a web check-in in People intended to stay?
Running as: kept, unchanged.
