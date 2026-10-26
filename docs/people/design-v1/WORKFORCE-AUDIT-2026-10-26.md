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
| S17 | change-impact names any manager id in the company | Open (low) |
| S18 | Structure links not checked against the company; loops deeper than one level | Fixed (security batch 2) |
| S19 | Contractor import: update with CREATE only; a duplicate mid-file gives a 500 | Fixed (security batch 2) |
| S20 | Formula-escaped phone (`'+91…`) in "rows to fix" fails re-import | Fixed (security batch 2) |

## Employee and manager view

| # | Finding | Status |
|---|---|---|
| E1 | Employee app has no screens for People self-service (my details, change request, accept, policies) | Open |
| E2 | Portal "Ask HR" writes to the old store the Help Desk does not read | Fixed `c31f88a` |
| E3 | "Ask to read" a document is a dead end: no Accept in the employee app | Open |
| E4 | Employees VIEW returns everyone's personal data (DOB, address, personal phone, notes, reader PIN) | Fixed (lifecycle batch) |
| E5 | Portal change request asked for more information strands the employee; rejected ones vanish | Open |
| E6 | Data requests visible to a team lead | Fixed `c31f88a` |
| E7 | Probation review on anyone, and on yourself | Fixed `c31f88a` |
| E10 | A scoped manager can edit their own HR record directly | Open |
| E11 | A request with no possible approver approves itself | Open |
| E12 | Manager approver without the approve grant stalls the request | Open |
| E13 | Employee never sees their own type, hours, probation, contract end, manager | Open |
| E14 | Photo and bank details not requestable by the employee | Open |
| E15 | HR sees a blank requester on portal requests | Open |
| E16 | Approved resignation not traceable to its request | Open |
| E17 | Document upload/replace not in Activity | Open |
| E19 | Screen permissions differ from their routes (Documents, Org Chart) | Open |
| E20 | "Reports to" link opens "not available" for a scoped manager | Open |
| E22 | Two open requests on one field; approval overwrites later HR edit | Open |
| E23 | Self-edit settings promise "three days" whatever the rule says | Open |

## Owner, CEO and HR view

| # | Finding | Status |
|---|---|---|
| O1 | Contract / internship end: no reminder, no Data Health check, person stays Active and paid | Fixed (lifecycle batch) |
| O2 | Probation that ended without confirmation disappears from filter, header and Home | Fixed (lifecycle batch) |
| O3 | No contract filter or end-date columns; Home to-dos open the unfiltered list; bell links ignore the person | Fixed (lifecycle batch) |
| O4 | Total / Active count future joiners; Home month in UTC | Open |
| O5 | No CEO picture: joined/left this month, by department and type, attrition | Open |
| O6 | Rehire keeps old probation, confirmation and contract dates; no rehire step | Fixed (lifecycle batch) |
| O7 | Leaving drawer says "left" for a future date; wrong defaults for contract staff | Fixed (lifecycle batch) |
| O8 | No "End after probation" on screen | Fixed (lifecycle batch) |
| O9 | No Renew contract action | Fixed (lifecycle batch) |
| O10 | Changing employment type does not ask for or clear the dates | Fixed (lifecycle batch) |
| O11 | Nothing editable after leaving; no cancel leaving | Open |
| O12 | Three place fields (Location, Work site, Work location) | Open |
| O13 | Record and Transfer show lists the company has not set up | Open |
| O14–15 | Words: Establishment/Work site, Seat/Position, Reports to/Manager, Job roles | Open |
| O16 | Import rejects dd/mm/yyyy and "Male" | Open |
| O17 | Import cannot carry manager or work site | Open |
| O18 | Import has a review step that repeats the counts plus a confirm | Open |
| O19 | Onboarding & Exit calls every non-joining task "Leaving"; raw dates | Open |
| O20 | Bulk change: few fields, no date, "None" can blank departments | Open |
| O21 | Data Health snooze uses a browser prompt | Open |
| O22 | No default probation length; no next steps after hiring | Open |
| O23 | Tag colours mix with #000 (dark mode) | Open |
| D24–28 | DESIGN.md: extra primary buttons, lists in cards, drawer descriptions, 20px figures, page spacing, raw dates | Open |
| O29–30 | Words and small fixes (Stint, four names for onboarding, Suspended on hire, Home shortcut) | Open |

## Later (other modules)

| Finding | Module |
|---|---|
| Attendance summary and reports read the current location for every day of the month | Attendance |
| Leave "from confirmation" and probation/hours conditions | Leave |
