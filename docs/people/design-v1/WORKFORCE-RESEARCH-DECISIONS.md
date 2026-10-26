# Workforce: what we took from the deep-research addendum, and why

Source: `Clor_Workforce_Deep_Research_2026-10-26.zip` (owner, 26 Oct 2026).
Filter applied: Clor sells to **small businesses first**: often one owner
doing HR, payroll and attendance with one sign-in. The research was written
for 20–300 person firms with HR teams; every idea was checked against the
current code and against that owner's day.

## Adopted (built)

| Research idea | What it meant in our code | Built as |
|---|---|---|
| Change impact: say "will update / needs action / not connected / unknown", never invent consequences | The transfer preview claimed "Attendance told" and "Payroll told"; neither app listens for the transfer. It claimed Payroll would apply the new state's Professional Tax; Payroll deducts PT for the state on the payroll profile, so a Bengaluru → Pune move kept deducting Karnataka PT | Preview lines are Needs you / Follows by itself / To check / Nothing to do, from what each app actually reads. PT can be set in the same step (now, or a task when the move waits). `97e0542` |
| Purpose-specific readiness ("ReadyCheck") with direct fixes | Already existed as Data Health, on a company screen the owner rarely opens | "Before payday" on each employee's record, from the same checks, with Fix links to the tab or to Payroll |
| Readable, effective vs recorded history; no raw values | Activity showed `blank → 2026-10-26`, `SUSPENDED → ACTIVE` | Values in words server-side; history rows show effective and recorded dates |
| Export: chosen scope and columns, server-built, audited | Ticked-row export was built in the browser, unaudited | Export panel; server catalogue without statutory fields |
| Bulk "visible page" vs "all matching" made explicit | Only the page could be selected | Select all N matching |
| WCAG 2.2 AA engineering target, axe scans | Not run | axe-core: 0 violations on 15 screens |

## Already present (no new work)

- Not-applicable / snooze with a reason: Data Health snooze (HLTH-03).
- Requester ≠ approver: approval engine refuses own requests.
- No-login workers, rehire as a new stint, as-of records, cycle checks.

## Not adopted, and why

| Idea | Reason |
|---|---|
| Per-subscriber delivery receipts dashboard | For our size the apps read the employee record live from the same database; nothing waits in transit to track. Revisit if Payroll or Attendance ever run separately. |
| Separate Action Queue module | Pending actions + Before payday + Data Health cover it without a new screen. |
| 117-row backlog, 70 "P0"s | Templated (15 distinct outcomes, one acceptance line for every row); not a plan. |
| Proposed `/people/workforce/...?companyId=` API | The company comes from the path and a server-checked header; never the query. |
| AI scoring, investor deck work | Out of Workforce; deck needs pilot data first. |

## Gaps the research missed that matter to our customer

Contract labour (workers through a contractor, CLRA registers), muster roll,
biometric device enrolment, probation and notice tracking. Clor already
models contractors and reader IDs; future Workforce work should start there
rather than from the research backlog.
