# Workforce audit, 26 Oct 2026

Six views: employee, manager, IT/security, owner (small business, also HR
and payroll), CEO, HR manager. Three independent read-only reviews of the
code, then each finding checked before fixing. Status: **Fixed** (commit),
**Open**, **Later** (belongs to another module, with where).

## Security and scope (IT view)

| # | Finding | Status |
|---|---|---|
| S1 | Export with `ids` replaced the team-scope filter: a team lead could export anyone | Fixed `c31f88a` |
| S2 | Statutory read, identity edit and reveal ignored team scope | Fixed `c31f88a` |
| S3 | Import "update existing" edits with only CREATE, no scope, skips job-change approval | Fixed `c31f88a` |
| S4 | Routes without team scope: overview, data health, headcount, checklists, task list and tick, notes, documents, probation review/decide, data requests, anonymise | Fixed `c31f88a` |
| S5 | Data Health named confidential documents to anyone with Employees VIEW | Fixed `c31f88a` |
| S6 | Employee save: version checked before the lock, and skippable | Fixed `c31f88a` |
| S7 | Linking a login: no unique index (race), self-link allowed | Fixed `c31f88a` |
| S8 | Import creates departments and lists without the Org Structure grant | Fixed `c31f88a` |
| S9 | Import undo: hard delete, no payroll-history check, no version check, can run twice | Fixed `c31f88a` |
| S10 | Help-desk migration copied rows without `SET clor.bypass` (likely copied nothing) | Fixed `c31f88a` |
| S11 | Checklist start can run twice concurrently | Fixed `c31f88a` |
| S12 | xlsx reader: unbounded column index, no inflate cap, spread over rows | Fixed (security batch 2) |
| S13 | Search text and ids stored raw in the export audit | Fixed `c31f88a` |
| S14 | Export includes the mobile though the comment said no personal contact: comment corrected (an owner needs the contact list; export has its own grant) | Fixed (security batch 2) |
| S15 | Raw database error text in import results; duplicate warnings name people outside scope | Fixed (security batch 2) |
| S16 | Import writes no audit entry | Fixed `c31f88a` |
| S17 | change-impact names any manager id in the company | Fixed: a manager outside the viewer's team is "the new manager", and whether they can sign in is not said |
| S18 | Structure links not checked against the company; loops deeper than one level | Fixed (security batch 2) |
| S19 | Contractor import: update with CREATE only; a duplicate mid-file gives a 500 | Fixed (security batch 2) |
| S20 | Formula-escaped phone (`'+91…`) in "rows to fix" fails re-import | Fixed (security batch 2) |

## Employee and manager view

| # | Finding | Status |
|---|---|---|
| E1 | Employee app has no screens for People self-service (my details, change request, accept, policies) | Fixed |
| E2 | Portal "Ask HR" writes to the old store the Help Desk does not read | Fixed `c31f88a` |
| E3 | "Ask to read" a document is a dead end: no Accept in the employee app | Fixed |
| E4 | Employees VIEW returns everyone's personal data (DOB, address, personal phone, notes, reader PIN) | Fixed (lifecycle batch) |
| E5 | Portal change request asked for more information strands the employee; rejected ones vanish | Fixed |
| E6 | Data requests visible to a team lead | Fixed `c31f88a` |
| E7 | Probation review on anyone, and on yourself | Fixed `c31f88a` |
| E10 | A scoped manager can edit their own HR record directly | Fixed: a team lead's own record changes through the employee app; HR edits it as ever |
| E11 | A request with no possible approver approves itself | Fixed |
| E12 | Manager approver without the approve grant stalls the request | Fixed |
| E13 | Employee never sees their own type, hours, probation, contract end, manager | Fixed |
| E14 | Photo and bank details not requestable by the employee | Photo fixed (HR approves, shown as the picture). Bank details: Later, Payroll (its bank-change path applies the first details at once, so it is not a safe HR-approved route) |
| E15 | HR sees a blank requester on portal requests | Fixed |
| E16 | Approved resignation not traceable to its request | Fixed |
| E17 | Document upload/replace not in Activity | No change needed: Activity lists every document from the document table (upload and new version included) |
| E19 | Screen permissions differ from their routes (Documents, Org Chart) | Fixed (headcount and words batch) |
| E20 | "Reports to" link opens "not available" for a scoped manager | Fixed: the name shows; it opens only when the record is in the viewer's scope |
| E22 | Two open requests on one field; approval overwrites later HR edit | Fixed |
| E23 | Self-edit settings promise "three days" whatever the rule says | Fixed |

## Owner, CEO and HR view

| # | Finding | Status |
|---|---|---|
| O1 | Contract / internship end: no reminder, no Data Health check, person stays Active and paid | Fixed (lifecycle batch) |
| O2 | Probation that ended without confirmation disappears from filter, header and Home | Fixed (lifecycle batch) |
| O3 | No contract filter or end-date columns; Home to-dos open the unfiltered list; bell links ignore the person | Fixed (lifecycle batch) |
| O4 | Total / Active count future joiners; Home month in UTC | Fixed (headcount and words batch) |
| O5 | No CEO picture: joined/left this month, by department and type, attrition | Fixed (headcount and words batch) |
| O6 | Rehire keeps old probation, confirmation and contract dates; no rehire step | Fixed (lifecycle batch) |
| O7 | Leaving drawer says "left" for a future date; wrong defaults for contract staff | Fixed (lifecycle batch) |
| O8 | No "End after probation" on screen | Fixed (lifecycle batch) |
| O9 | No Renew contract action | Fixed (lifecycle batch) |
| O10 | Changing employment type does not ask for or clear the dates | Fixed (lifecycle batch) |
| O11 | Nothing editable after leaving; no cancel leaving | Fixed (leaving, bulk, probation length batch) |
| O12 | Three place fields (Location, Work site, Work location) | Fixed (headcount and words batch) |
| O13 | Record and Transfer show lists the company has not set up | Fixed (headcount and words batch) |
| O14–15 | Words: Establishment/Work site, Seat/Position, Reports to/Manager, Job roles | Fixed (headcount and words batch) |
| O16 | Import rejects dd/mm/yyyy and "Male" | Fixed (import and screens batch) |
| O17 | Import cannot carry manager or work site | Fixed (import and screens batch) |
| O18 | Import has a review step that repeats the counts plus a confirm | Fixed (import and screens batch) |
| O19 | Onboarding & Exit calls every non-joining task "Leaving"; raw dates | Fixed (import and screens batch) |
| O20 | Bulk change: few fields, no date, "None" can blank departments | Fixed: Location (was refused by the server), Hours, Work mode, Work site added; department never cleared in bulk; an effective date (a later day waits on each record as an upcoming change; hours change from today) | 
| O21 | Data Health snooze uses a browser prompt | Fixed (import and screens batch) |
| O22 | No default probation length; no next steps after hiring | Fixed (leaving, bulk, probation length batch) |
| O23 | Tag colours mix with #000 (dark mode) | Fixed (leaving, bulk, probation length batch) |
| D24–28 | DESIGN.md: extra primary buttons, lists in cards, drawer descriptions, 20px figures, page spacing, raw dates | Fixed |
| O29–30 | Words and small fixes (Stint, four names for onboarding, Suspended on hire, Home shortcut) | Fixed |

## Later (other modules)

| Finding | Module |
|---|---|
| Attendance summary and reports read the current location for every day of the month | Attendance (TRACKER, Waiting for other modules) |
| Leave "from confirmation" and probation/hours conditions | Leave |
| Bank details asked for from the employee app | Payroll (TRACKER, Waiting for other modules) |

## Final audit: automation and workflows (26 Oct 2026)

Two more independent reviews, one of what CLOR does by itself, one of every path a record can take. Commits: `eed1b38`, `c5ff5b6`, merge `6b22423` (automation, `5574560`), and the follow-up below.

### Automation

| # | Finding | Status |
|---|---|---|
| A1 | Leaving took effect on the morning of the last working day | Fixed: the last day is worked; the job leaves them the day after |
| A2 | Someone put on notice without a leaving type never left | Fixed: the job no longer needs a type; an edit cannot put anyone on notice |
| A3 | Setting Left on the form skipped the leaving step | Fixed: refused (USE_LEAVING); Mark as left does it |
| A4 | A leaving manager's team, approvals and tasks stayed with them | Fixed: team moves to the leaver's manager; a manager who left or is suspended is no manager for approvals, tasks and attendance |
| A5 | A linked CLOR login stayed active after leaving | Fixed as a task: HR gets "Turn off X's CLOR sign-in" (CLOR does not turn off a login on its own: it may be someone's admin access) |
| A6 | Reminder jobs stopped reaching new documents past 2,000 old rows | Fixed: filtered in the database and paged |
| A7 | "Notify once" repeated daily once read | Fixed for end-date and licence reminders |
| A8 | A failed dated change was marked applied and lost | Fixed: goes back to waiting; the run carries on |
| A9 | One bad row stopped every leaving and approval reminder | Fixed: per-row handling, logged with the company |
| A10 | Parked events retried every tick and blocked the queue | Fixed |
| A11 | A location move recreated old state-change tasks | Fixed: uses the event's own work sites |
| A12 | Attendance Transfer bypassed scope, approvals, history and dates | Fixed: goes through the bulk path |
| A13 | Dated changes applied to people who left | Fixed: cancelled on leaving; the job skips leavers and managers who left |
| A14 | "Has left" only from the form; ~9 e-mails to an owner hiring alone; overdue approvals reminded once | Fixed: told from every path; no mail to whoever made the plan, one per owner; reminded every 3 working days |
| A15 | Job failures leave little trace | Open (low): an admin view of background jobs belongs to the platform |
| A16 | Edge cases after downtime (merged dates, lease delay) | Open (low) |
| A17 | Birthdays, anniversaries, confirmation-letter task, app invite on hire | Partly: duplicate probation task removed; the rest are conveniences, not gaps |
| A18 | Tasks with someone who cannot act | Fixed for managers who left; a task owner who leaves keeps their tasks (open, low) |

### Workflows

| # | Finding | Status |
|---|---|---|
| W1 | Leaving or delete left dated changes and requests running | Fixed |
| W2 | Suspending someone on notice broke their leaving | Fixed: refused |
| W3 | A failed approval effect left the request stuck | Fixed: closed as not applied, requester and HR told |
| W4 | A manager's leaving stranded their team and approvals | Fixed (see A4) |
| W5 | No way to record an offer withdrawn or a joiner who never came | Fixed: Did not join, no settlement, plan closed, profile links expired |
| W6 | A corrected joining date left service dates behind | Fixed while the first stint is open |
| W7 | The edit accepted any status | Fixed |
| W8 | "Suspend from a later date" applied today | Fixed: status changes are not dated |
| W9 | A suspended person kept door access | Fixed: off the doors while suspended |
| W10 | Old bulk transfer endpoint skipped the rules | Fixed (A12) |
| W11 | Conflicting edits not caught | Fixed: an immediate change over a waiting dated one is refused; two job-change or probation requests cannot wait side by side |
| W12 | A leaver kept their position | Fixed |
| W13 | A former employee could be added as new | Fixed: the duplicate warning says to rehire |
| W14 | Screens counted joiners and leavers differently | Fixed |
| W15 | Notice period not recorded | Fixed: notice days per type, resignation date, waived, shortfall in the separation event |
| W16 | Duplicate-person advice triggered a settlement | Fixed: Duplicate record closes with no settlement |
| W17 | Leaving letters said the wrong thing | Fixed |
| W18 | Rehire kept an old manager and position | Fixed |
| W19 | Probation decided before joining | Fixed |
| W20 | Absconding and death handled like resignation; transfer between companies | Later: show-cause tracking and nominee/heir details belong with the final settlement (Payroll); inter-company transfer is a platform feature |
