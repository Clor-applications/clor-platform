# People app through the HR team's month (audit, 27 Oct 2026)

- **Reader:** the person doing HR in a company of 1–50 staff. Usually the owner or an office manager, not an HR professional.
- **Method:** read-only walk of `apps/people/manifest.jsx`, the screens it loads (`apps/people/src/screens.js`), the shared screens in `packages/ui/src/{timeOff,personnel}` and the server routes they call. No code was changed and no browser run was made. Click counts come from reading the code: count them again in the browser before quoting them.
- **Not repeated here.** These are already written down, so this audit links to them instead:
  - [TIME-LEAVE-CLOSURE-AUDIT-2026-10-28.md](../TIME-LEAVE-CLOSURE-AUDIT-2026-10-28.md): O-01..O-12
  - [TIME-LEAVE-MARKET-RESEARCH.md](../TIME-LEAVE-MARKET-RESEARCH.md) §(b): G1..G21
  - [WORKFORCE-AUDIT-2026-10-26.md](../WORKFORCE-AUDIT-2026-10-26.md)
  - [ORGANIZATION-AUDIT-2026-10-26.md](../ORGANIZATION-AUDIT-2026-10-26.md)
  - [TRACKER.md](../TRACKER.md) "Waiting for other modules"
- **Severity:**
  - **S1:** statutory, or money paid wrongly.
  - **S2:** costs HR an hour or more a month, or sends them out of CLOR for a routine job.
  - **S3:** friction.
  - **S4:** words or polish.

## 1. Journey table

"Effort" counts clicks and screens for one person, starting from People → Home.

| # | Step | Solved? | Where | Effort | Outside-CLOR work | Sev |
|---|---|---|---|---|---|---|
| 1.1 | First run: knowing what to set up and in what order | **No** | Home `PeopleOverview.jsx:100`: an empty company sees "All caught up". The Settings hub `PeopleSettings.jsx` lists about 30 pages with no order and no progress. | Unknown. HR has to find about 8 pages under Settings (Company, Departments, Branches, Leave Policy, Working week, Holidays, Request rules, Employee Portal Access). | Asks the vendor or a CA what to do first | S2 |
| 1.2 | Import staff from Excel | Yes, well done | Workforce → Import `ImportEmployees.jsx` (upload, map, dry run, results, undo; `WORKFORCE-AUDIT` O16–O18) | About 6 clicks plus fixing the file | Cleans up the sheet first | S3 |
| 1.3 | A second employee import with a different column set | Confusing | Settings → Import Data `apps/attendance/src/screens/DataImport.jsx:37` ("Employees": 8 columns, no manager, branch or type) | Same | — | S3 |
| 1.4 | Opening leave balances when going live mid-year | Partly | `leave.ts:430` imports "Days for the year" (`DataImport.jsx:89`). There is no "balance as of a date". | 1 import, or 2 if past leave is also imported | Works out "year's days" from closing balance + taken in Excel | S2 |
| 1.5 | State leave set | Yes (figures: see G1 and O-02) | Leave Policy, "Start from your state's rules" `LeavePolicy.jsx:62-69` | 2 clicks | Checks the figures with a CA | S1 (known) |
| 1.6 | Working week and holidays | Yes | `WorkingWeek.jsx`; Holidays `apps/attendance/src/screens/Holidays.jsx` (spreadsheet import, by Area) | About 12 holidays × 4 clicks, or 1 import | Types the state's holiday list from the gazette | S3 |
| 2.1 | Add a joiner | Yes | Workforce → Add `AddEmployee.jsx:33`: 4 steps, about 38 fields; the joining checklist starts by itself (`routes/people.ts:1022`) | About 8 clicks plus the fields | — | — |
| 2.2 | Offer letter | Partly | Record → Documents → "Issue a letter" `Employees.jsx:2137,2223`; kinds in `services/people/letters.ts:17` | About 5 clicks. Needs an employee record before an offer exists. | The pay annexure in Excel or Word ("set out in the attached annexure", `letters.ts:48`); signature on paper; sending by e-mail or WhatsApp | S2 |
| 2.3 | PAN, UAN, ESIC, bank, PF nominee | **Not in People** | People only shows them masked; they belong to Payroll (`routes/people.ts:65,352`, `payroll/statutoryRead.ts:11`). The joiner invite collects only personal fields (`lifecycle/invites.ts:28`). The nominee is not stored anywhere. | A second app (Payroll), or none in a People-only company | Form 2, the ESIC declaration and bank proof on paper (the checklist item at `checklists.ts:38` says so) | S1 |
| 2.4 | Documents | Yes | Record → Documents (upload, who can see, expiry reminders) | About 4 clicks per file | Scans on a phone | S3 |
| 2.5 | Onboarding checklist | Yes, automatic | `services/people/checklists.ts:31-38`; Home "Your tasks"; ticking from an e-mail (`peopleTaskLinks.ts`) | 1 click per task | Tasks are plain text. "Give the employee app activation code" does not open the screen that does it. | S3 |
| 2.6 | Employee app access | Partly | Settings → Employee Portal Access `PortalAccess.jsx:160,305`: codes are "shown this once"; an SMS invite returns the link "which HR sends by hand" (`invites.ts:58`) | About 5 clicks across 2 places (record "Invite to complete profile", then Settings for codes) | Prints the codes or sends them on WhatsApp | S2 |
| 3.1 | Approvals queue | Split | Home → Approvals `Approvals.jsx:27` (profile, job, leaving, letters…); Time → Leave Requests; Time → Attendance Requests; Help Desk | 4 queues, 4 screens. Bulk exists only on Attendance Requests (`AttendanceRequests.jsx:187`). | — | S2 |
| 3.2 | Home's to-do count | Partly | `services/people/home.ts:58-93` counts leave, checklists, data health, probation, contracts, help desk. It leaves out People approvals and attendance requests. | — | — | S2 |
| 3.3 | Who is away | Leave only | Time → Overview (`leave.ts:1547`, approved leave only); Calendar `LeaveCalendar.jsx:47-48` (leave and holidays) | 1–2 clicks | WFH and on-duty people are missing from both. HR asks on WhatsApp. | S3 |
| 3.4 | Attendance exceptions | Not in People | People has a read-only grid `TeamAttendance.jsx:162-164` (Present / Leave / Absent counts). Exceptions live in the Attendance app. | — | People-only companies: a WhatsApp group or a register | S2 |
| 3.5 | Employee questions | Yes | Help Desk with reply and resolve times (`home.ts:84-88`); "Ask HR" in the employee app (`WORKFORCE-AUDIT` E2) | 2 clicks | — | — |
| 4.1 | Leave register | Yes (yearly) | `LeaveRegister.jsx:36-73`, by leave period, with export. Statutory print form: O-03. | 2 clicks | — | S1 (known O-03) |
| 4.2 | LOP to payroll | Yes (by mode) | People + Payroll: Payroll → Run → From leave (`payrollRuns.ts:469`). With Attendance, Attendance's summary is used. Reconciliation: O-06, G6, G7. | About 3 clicks, in the Payroll app | Nothing in People shows a person's LOP for the month to check against | S2 |
| 4.3 | Month close | Attendance app only | `apps/attendance/src/screens/MonthClose.jsx`. People-only has no close, by design (`TIME-LEAVE-DECISIONS.md`, modes table). | — | — | S3 |
| 5.1 | Registers inspectors ask for | **Mostly missing in People** | `GET /people/compliance/registers/employees` and `/registers/leave` (`peopleCompliance.ts:79,85`) **have no screen calling them** (grep finds no caller). The muster roll is in Attendance only (`attendanceReports.ts:40`). Wage registers are in Payroll. | — | Built in Excel before the inspection | S1 |
| 5.2 | Statutory deadlines | Yes | Insights → Compliance and Compliance Calendar; Home "Statutory deadlines" | 2 clicks | Filing still happens on the government portals | — |
| 5.3 | Maternity leave | **Broken for the real case** | Type in `LeavePolicy.jsx:59` (182 days, `sandwich` not set). One request is capped at 60 calendar days (`leave.ts:48,578`). Weekly offs are skipped without sandwich (`leave.ts:79-119`). | 26 weeks have to be entered as 4 requests. The 182-day balance is used up as about 36 calendar weeks. | Hand-tracks the 80-day eligibility, the child count (26 or 12 weeks) and whether ESIC pays | S1 |
| 6.1 | Exit checklist | Yes, automatic | `checklists.ts:42-48` (plus assets held, `:156-160`); Record → More → leaving (`EmployeeRecord.jsx:157`) | About 4 clicks | Exit interview on paper | — |
| 6.2 | Final settlement link | Partly | Payroll `finalSettlement.ts`. People has no link to it (grep finds no "settlement" in `apps/people/src`); a checklist task points to it (`checklists.ts:48`). | Switches to the Payroll app | — | S3 |
| 6.3 | Leave encashment on exit | **Over-pays by default** | `finalSettlement.ts:118` adds every paid, active type (CL, SL included) and **ignores the type's `encashable` flag**. The text tells HR to "Remove it if this leave is not encashable" (`:126`). | 1 delete per non-encashable type, per leaver | — | S1 |
| 6.4 | Relieving and experience letters | Yes | `letters.ts:17` RELIEVING, EXPERIENCE, SERVICE_CERT (the service certificate due date is from state law) | About 5 clicks each | Signed on paper | S3 |
| 7.1 | Carry forward and lapse | Yes, automatic | Engine plus Settings → Leave Year End `YearEnd.jsx:16-22,87` (pay out lapsing days, undo) | 2 clicks | — | S1 (known G3) |
| 7.2 | Holidays for next year | Partly | `Holidays.jsx`: no "copy last year", no state national list. NFH minimum: G4. | About 12 holidays × 4 clicks, or 1 import | Types the list | S3 |
| 8.1 | Who changed what, for one person | Yes | Record → History ("Every change and why") and Activity (`EmployeeRecord.jsx:234-235`) | 2 clicks | — | — |
| 8.2 | Who changed what, company-wide | Opens another app | Settings → Audit Logs opens Workspace (`screens.js` `AuditLogs` → `OpenInCompanyAdmin`); Organization → Changes for structure | 3 clicks and an app switch | — | S4 |

## 2. Top 12 HR gaps, ranked by time lost a month (20 people)

The model company: 20 staff, about 1 joiner and 1 leaver a month, about 25 leave requests and 15 attendance requests a month, 1 maternity case every 2 years, and a labour inspection or PF/ESI query once a year. Hours are estimates.

**1. Four queues for one inbox (about 2 h/month, S2).**
- Problem:
  - A manager or HR clears Approvals, Leave Requests, Attendance Requests and Help Desk separately (3.1).
  - Home's count leaves out two of them (`home.ts:58-93`).
  - Bulk decide exists only on Attendance Requests. G14 already covers bulk for leave.
- Fix:
  - One "Waiting for me" list on Home → Approvals, filled from all four sources.
  - One row type with type, person, dates and age. The row opens the existing drawer.
  - Bulk approve on the rows that allow it.
  - Add `attendanceRequests` and `peopleApprovals` to `homeTodos`.

**2. Statutory numbers are not in People (about 1.5 h per joiner, S1).**
- Problem:
  - PAN, UAN, ESIC and bank live in Payroll (2.3). A People-only company cannot record them at all.
  - The joiner invite does not ask for them.
  - The PF nominee (Form 2) and ESI family details are stored nowhere.
  - HR collects them on paper and types them into a second app.
- Fix:
  - Let the joiner invite (`invites.ts:28`) collect PAN, UAN (or "none yet"), bank and nominee.
  - Route bank through Payroll's approval once Payroll settles TRACKER "Waiting for other modules".
  - In a People-only company, store them in People.
  - Add a Nominee section to Personal.

**3. Employee app access is handed out by hand (about 1 h/month, S2).**
- Problem:
  - Codes are "shown this once" to print or read out (`PortalAccess.jsx:305`).
  - SMS invites return a link for HR to send themselves (`invites.ts:58`).
  - Forgotten passwords repeat the whole process.
  - It lives under Settings, away from the joiner's record.
- Fix:
  - Send the activation code with the invite (e-mail now; SMS or WhatsApp when a provider exists).
  - Put "Give employee app access" on the record's More menu and in the bulk bar.
  - Make the checklist item at `checklists.ts:34` open it.

**4. Inspection registers are not available to print (about 4–6 h a year in a crunch, about 0.5 h/month, S1).**
- Problem:
  - The employee register and the leave register routes exist (`peopleCompliance.ts:79,85`), but nothing on screen calls them.
  - The muster roll is Attendance-only.
  - A People-only company has nothing to hand an inspector.
- Fix:
  - A "Registers" page under Insights listing register of employees, leave (O-03), muster roll (from the day record when Attendance is off) and wages (link to Payroll).
  - Each register can be printed or exported for an establishment and a range.

**5. Offer letters are only half done (about 45 min per joiner, S2).**
- Problem:
  - An offer needs an employee record first.
  - There is no pay or CTC merge field: the annexure is left to Excel (`letters.ts:25,48`).
  - There is no send, accept or sign step.
- Fix:
  - Offer from a candidate or from a draft hire.
  - Merge `ctc`, `monthlyGross` and the salary structure lines from Payroll when it is on (otherwise typed on the letter).
  - Send through the joiner invite with an Accept button that records the date. The Accept pattern already exists for documents (`WORKFORCE-AUDIT` E3).

**6. Month-end LOP is not visible in People (about 1 h/month, S2).**
- Problem:
  - `TeamAttendance.jsx:162-164` shows Present, Leave and Absent. It has no LOP column, no paid-days column and no export.
  - HR checks the payroll input against nothing. This is the "how", not the check itself (O-06 covers the check).
- Fix:
  - Add Unpaid leave, Absent and Payable days columns plus export to Time → Attendance for the month. These are the same numbers `from-leave` gives Payroll.
  - Show "Payroll took these on <date>" once a run has locked.

**7. Exit encashment pre-fills non-encashable leave (about 20 min per leaver, plus over-payment risk, S1).**
- Problem: `finalSettlement.ts:118` loops over every paid type, ignoring `encashable` and `maxEncashDays`.
- Fix:
  - Filter to `t.encashable` and cap at `maxEncashDays`.
  - For an OSH or Factories earned-leave type, always include it (G9).
  - Add a "Final settlement" link on a leaver's record and in the checklist task.

**8. Maternity cannot be entered properly (about 2 h per case and statute at risk, S1).**
- Problem:
  - One request is capped at 60 days (`leave.ts:48`). Weekly offs are skipped, so 182 "days" ≈ 36 weeks.
  - There is no 80-day eligibility check, no 26/12-week choice by child count, no expected delivery date, and no "paid by ESIC" flag that would tell Payroll the employer does not pay.
- Fix:
  - A "calendar days" counting mode per type (sandwich-like, also used by OSH leave), turned on for Maternity.
  - Lift the span cap for such types, to the type's `maxDaysPerRequest`.
  - A maternity drawer that asks for the expected date and child number, checks 80 days worked, and marks ESIC-covered staff as unpaid by the employer.

**9. Reports are one flat list (about 1 h/month, S2).**
- Problem: Insights → "Workforce Report" (`PeopleReports.jsx`) is the employee list with Joined and Left columns.
- Fix: add the reports listed in §3. Most are queries over data already held (`headcount.ts`, the leave ledger, checklists).

**10. Day 1 has no path (a one-off of about 4–6 h, spread over the first months, S2).**
- Problem: An empty company sees "All caught up" (`PeopleOverview.jsx:100`). The Settings hub has no order.
- Fix:
  - A "Set up People" list on Home until it is done: company and branch, departments, import staff, leave policy (state set), working week, holidays, opening balances, employee app.
  - Each item is done when its data exists, and it hides itself at the end.

**11. Imports that need Excel arithmetic (about 2 h at go-live, S2).**
- Problem:
  - The opening balance takes "days for the year", not "balance today" (1.4).
  - There are two employee imports with different columns (1.2 and 1.3).
- Fix:
  - Add a column "Balance on (date)". The server sets the allocation so that the balance on that date matches.
  - Remove the Employees kind from Settings → Import Data and point it at Workforce → Import.

**12. Next year's holidays and who is away (about 30 min/month plus a yearly hour, S3).**
- Problem:
  - Holidays: no "copy last year" and no state national list.
  - Away today and the calendar ignore WFH and on duty (3.3).
- Fix:
  - "Copy <year> holidays to <year+1>" (dates for review), plus a state list of the four national days.
  - Show approved WFH and on-duty days on Overview and the Calendar as their own tags.

## 3. Missing reports and bulk actions

**Reports (Insights).** None of these exists in People today.

| Report | Why HR needs it | Data already there |
|---|---|---|
| Register of employees (print, by establishment) | Inspection | `complianceRules.ts:262` (no screen) |
| Muster roll for People-only | Inspection | Day record (`AttendanceRecord`) |
| Joiners and leavers for a date range, with reason | PF/ESI returns, owner review | `headcount.ts`, separation events |
| Headcount by month (12 months), attrition | Owner, bank or investor asks | `headcount.ts` |
| LOP and paid days by person for a month | Payroll check (gap 6) | `from-leave` logic |
| Leave taken by type and department, absenteeism | Owner review | Ledger |
| Leave balances on a date, exportable | Settlement and year-end planning | `LeaveBalances.jsx` (no export) |
| Probation, contract and document expiry due in N days | Monthly planning | `home.ts`, Data Health |
| Open onboarding and exit tasks by owner | Chasing | `checklists.ts` |
| Missing statutory data (PAN, UAN, ESIC, bank, nominee) as a list | Before payroll | Data Health (shown on screen, no export found) |
| Birthdays and work anniversaries for the month | Small-company culture | Overview only shows 30 days |
| Help desk volume and response times | Owner | `deskRequest` |

**Bulk actions missing.**
- Leave requests: approve or reject the ones chosen (G14, known).
- People approvals: approve the ones chosen (`Approvals.jsx` has none).
- Leave balances:
  - Add or take away days for the chosen people, with one reason (a festival extra day, a team comp-off after a holiday worked).
  - Export.
- Directory bulk bar (`Directory.jsx:262-263` has only Change and Export):
  - give employee app access
  - issue a letter, such as April increment letters or confirmations
  - start or restart a checklist
  - add a tag
  - send the profile invite
- Holidays: copy a year.
- Probation: confirm the chosen people, with one confirmation letter each.

## 4. Unclear words

| Word now | Where | Problem | Say instead |
|---|---|---|---|
| Employee Portal Access, portal, employee app, activation code, invite | `manifest.jsx` selfService; `PortalAccess.jsx:153`; `checklists.ts:34`; record "Invite to complete profile" | Four names for two things | "Employee app": "Give app access", "Send joining form" |
| Stand-ins | Time → Leave | Means nothing to a new user | "Covers while a manager is away" (label: "Cover for managers") |
| Handed on to HR after, days waiting | `LeavePolicy.jsx:515` | "Handed on" is unusual English | "Send to HR if not decided in (days)" |
| Request rules | Settings | Which requests? | "WFH, on duty and missed punch rules" |
| Permission (a request kind) | `AttendanceRequests.jsx:35` | Clashes with access permissions | "Short leave (hours)" |
| Area / Locations / Work sites / Branches | Holidays (`Holidays.jsx:108`), Organization | Four place words; holidays use "area" | Holidays per Branch, or say "Location (used for holidays)" |
| Leave Policy (screen key `leaveTypes`), Leave Year End and "Year end" | Settings | The title differs from the menu label | Use one name |
| Workforce Report | Insights | It is the employee list | "Employee list (export)" |
| Audit Evidence and Audit Logs | Insights, Settings | Look the same | "Auditor access" and "Change log" |
| "All caught up" on an empty company | Home | Tells a first-day user there is nothing to do | "Start here" setup list |

## 5. What HR would praise

- **Import that forgives.** Dry run, column mapping, dd/mm/yyyy and "Male" accepted, undo, a file of rows to fix (`ImportEmployees.jsx`, `WORKFORCE-AUDIT` O16–O18, S20).
- **Checklists run themselves.**
  - Joining and leaving tasks start on hire and on leaving.
  - Assets held are added to the exit list.
  - Tasks can be ticked from the e-mail.
  - Home shows "Your tasks" (`checklists.ts`, `peopleTaskLinks.ts`).
- **Home says what is late and why.** Missing PAN or UAN that would stop payroll, probation to decide, contracts ended but still paid, assets with leavers, statutory deadlines (`home.ts`).
- **Leave explains itself.**
  - Days charged and days skipped, with the reason.
  - "Why this number?" ledger, policy tried on five real people before saving.
  - Private sick and maternity leave.
  - State starting points (`LeavePolicy.jsx`, `leave.ts:1587`).
- **Year end needs no spreadsheet.** Carry and lapse are automatic, pay-out has a preview and undo, and Overview gives a lapse warning 60 days ahead (`YearEnd.jsx`, `leave.ts:1555`).
- **Nobody approves their own.** Leave, balances, comp-off and attendance requests follow maker-checker, with a one-person-company escape that is audited (closure audit C-05..C-07).
- **Leaving is handled end to end.**
  - Notice owed, served or short.
  - "Did not join" with no settlement.
  - Rehire as stint 2.
  - Relieving and experience letters, and the service-certificate due date from state law (`letters.ts`).
- **History per person.** "Every change and why" and an Activity timeline on the record, append-only audit underneath (C-03).
- **Plain words almost everywhere.** Error messages are sentences ("Say why. They see this with the decision.").
