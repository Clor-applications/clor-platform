# People: workflow and automation gap research, 30 Oct 2026

By `clor-researcher`, for the product manager. Read-only research. CLOR state was read from `origin/main` at `727cc38d`.

**Method.** For CLOR: the backend-vs-screen audit (`docs/people/design-v1/FEATURE-UI-AUDIT-2026-10-30.md`), `apps/people/manifest.jsx`, every People, leave and attendance route file, `server/src/services/people/**`, the People and Payroll Prisma schemas, and the job services (`services/people/lifecycle/jobs.ts`, `services/attendance/leaveJobs.ts`, `services/jobRegistry.ts`).

For Frappe HR (GPL-3.0): `frappe/hrms` `develop` at `1d62bdb` (28 Oct 2026). I read `hooks.py` (`scheduler_events`, `doc_events`), the DocType JSON of about 60 doctypes, the shipped Notification fixtures, and the controllers for reminders, auto attendance, encashment, earned leave, exit interview, employee advance and full and final. For ERPNext: `erpnext/hooks.py` on `develop`. No code or text was copied. The behaviour is described in my own words.

For the commercial products, I used public help centres and product pages only. No sign-ins, no trials, no app inspection.

**Use of the `reverse-engineer-anything` skill.** The skill was loaded. Its REA binary, packaged-app and runtime tools don't apply here: Frappe HR is a complete source repository, and the skill itself says to use ordinary repository tools in that case. The commercial products may only be studied through public pages. What I used from the skill was its staged investigation method: a question checklist, evidence per answer, and observed vs inferred vs unknown. Cells marked *(unverified)* rest on public marketing pages or on my own reading, not on a help article I opened.

**Already in flight (excluded from ranking):** holidays per branch/state, field punches and overtime in the inbox, encashment amount to Payroll, announcement audience, shift swap, custom request types, hourly leave (PR #47), and the Talent rebuild.

---

## 1. Matrix: workflows, automations and modules × CLOR status

Status: **Have** = backend and screen exist. **Partial** = some of it exists (the gap is named). **Missing** = not found in `origin/main`. **Flight** = in a batch being built now.

Source key, Frappe HR: `H:` = `https://github.com/frappe/hrms/blob/develop/hrms/` + path. Commercial links are listed under the table (K1, G1, …).

### A. Core HR and lifecycle

| # | Workflow / automation | Seen in | CLOR status | CLOR evidence / gap |
|---|---|---|---|---|
| A1 | Onboarding plan from template, tasks to owners, reminders | H: `hr/doctype/employee_onboarding`; P2; Z1 | Have | `services/people/checklists.ts`, `lifecycle/jobs.ts` (daily digest of due tasks) |
| A2 | Candidate → employee pre-boarding portal (forms, documents before day 1) | Z3; H: `employee_onboarding` (from Job Offer) | Have | `peopleJoin.ts` join token, `JoinInvite`, `JoinStatutory` |
| A3 | Offer letter with accept/decline link | H: `job_offer`; K/G letters | Have (UI partial) | `peopleLetters.ts` offers, `/people/offer/:token` |
| A4 | Probation review, confirm/extend | Keka/greytHR *(unverified)* | Have (form being added) | `ProbationReview`, `lifecycle/probation.ts` |
| A5 | Promotion / transfer with effective date, history | H: `employee_promotion`, `employee_transfer` | Have | `JOB_CHANGE` request type, `ScheduledChange`, effective dating |
| A6 | Resignation request by employee, multi-level review, withdraw | G2 (resignation workflow); K3 | Have | `portal /me/resign`, `LEAVING` request type, withdraw |
| A7 | Separation plan (tasks per owner, asset return lines) | H: `employee_separation`; K3; P2 | Have | `checklists.ts:51-166` (handover, exit interview task, one task per held asset) |
| A8 | **Exit interview questionnaire** sent to leaver, answers stored, retained/exit decision | H: `hr/doctype/exit_interview` + HR Settings questionnaire web form; Notification "Exit Interview Scheduled" (1 day before); G1 (F&F blocked until exit details filled) | Partial | Only a checklist task titled "Exit interview" (`checklists.ts:52`). No questionnaire, answers or reasons analytics |
| A9 | **No-dues / clearance sign-off** per department before F&F | K3; H: `full_and_final_asset` | Partial | Asset return tasks exist. No sign-off record gating settlement, no "dues owed by employee" capture |
| A10 | Full and final statement (payables + recoverables), paid within 2 working days | H: `full_and_final_statement` (pulls salary slip, gratuity, expense claims, leave encashment as payables; advances, loans, assets as receivables); G1; K4 | Partial | Payroll `FinalSettlement` with `dueDate` = 2 working days (`server/prisma/payroll/schema.prisma`). No link from the leaving plan (audit gap 15), no advance/expense lines (those modules don't exist) |
| A11 | Relieving / experience letter on last day | G/K letters *(unverified)* | Have | `letters.ts` (blocked for ABSCONDED etc., `letters.ts:227`) |
| A12 | **Absconding / unauthorised absence**: detect, notices, deemed leaving | none of the six does this well *(unverified)* | Partial | `ABSCONDED` is a leaving type (`leaving.ts:47`). No detection, no notice letters, no settlement hold |
| A13 | Salary withholding during notice or absconding, release later | H: `payroll/doctype/salary_withholding` | Missing | Payroll lane |
| A14 | Birthday / work-anniversary greetings (daily) | H: `controllers/employee_reminders.py` (daily, settings toggles); Rippling date triggers (R1) | Partial | Shown on People overview (`PeopleOverview.jsx`). No scheduled greeting or notice |
| A15 | Holiday reminders in advance (weekly/monthly digest to each employee) | H: `employee_reminders.py` weekly/monthly | Missing | Holidays exist. No advance reminder |
| A16 | Document expiry reminders | Zoho/Keka *(unverified)* | Have | `documentReminders.ts`, `DocumentExpiry` migration |
| A17 | Policy publish + acknowledgement + reminder | Personio P1 (signature requests); Zoho e-sign Z1 | Have | `peoplePolicies.ts` versions, acknowledgements, remind |
| A18 | E-signature on letters/contracts | Z1 (e-sign flow action); P1 | Partial | Click-to-accept (`acknowledgements.ts`). No Aadhaar eSign / DSC |
| A19 | Grievance with type, against whom, resolution | H: `employee_grievance` | Have | Help desk + `PrivateCase` (POSH, grievance committee) |
| A20 | Employee referral with bonus status | H: `employee_referral` | Partial | Candidate source "referral" (`talent/hiring.ts`). No referral bonus tracking |
| A21 | Job requisition / staffing plan with budget, vacancy check on offer | H: `job_requisition`, `staffing_plan`, HR Settings "Check Vacancies On Job Offer Creation" | Partial | `Seat`, `Team` and `SEAT_REQUEST` approval exist. No budget/vacancy check on offer *(inferred)* |
| A22 | Interview reminder + daily feedback reminder | H: `scheduler_events.all` `send_interview_reminder`, daily `send_daily_feedback_reminder` | Flight (Talent) | Not found in `talent/hiring.ts` |
| A23 | Job opening auto-closes on its closing date | H: daily `close_expired_job_openings` | Flight (Talent) | Not found |
| A24 | Skill map, training needs from skills | H: `employee_skill_map`, `designation_skill` | Missing | Low value for 1–20 |
| A25 | Pulse / engagement surveys, eNPS | K5 (Pulse); Z3 Jumpstart (surveys) | Missing | |
| A26 | Recognition / praise wall | Keka *(unverified)* | Missing | |
| A27 | No-code workflow builder: trigger → condition → email/field update/webhook/task, time-based | Z1, Z2; R1; P1, P2 | Partial | Approval rules with steps, due days, remind/hand-on (`approvals/engine.ts:46`), checklists, webhooks/outbox. No general "when X then Y" recipes |
| A28 | Approval escalation when a step is overdue | Darwinbox SLA/escalation D1; Keka K1 | Have | `StepSpec.overdue` REMIND / HAND_ON; `leaveJobs.ts` `runLeaveRuleDues` |
| A29 | IT/app deprovisioning on leaving, device return tracking | R2, R3 | Partial | Reader (door) access revoked, sessions ended (`leaving.ts`). Asset return tasks. No third-party app list |

### B. Time and leave

| # | Workflow / automation | Seen in | CLOR status | CLOR evidence / gap |
|---|---|---|---|---|
| B1 | Auto attendance from punches (half-day/absent thresholds, late/early flags) | H: `shift_type.py` hourly `process_auto_attendance_for_all_shifts` | Have | `services/attendance/daysWorked.ts`, Shift late/half-day fields |
| B2 | Auto mark absent after a buffer | H: `shift_type.py` absent buffer days | Have *(inferred)* | Day explain + exceptions (`attendanceInsights.ts`) |
| B3 | **Late-mark penalty rules** (e.g. N lates = half day; regularisation limit per month) | G3, G4 (attendance policy penalty rules, finalize and deduct penalty) | Partial | `lateCount` computed (`attendanceCompute.test.ts:139`). No penalty rule or deduction |
| B4 | Regularisation / missing-punch request | G3; Keka | Have | `attendance/me/requests`, reason `FORGOT_PUNCH` (`corrections.ts:9`) |
| B5 | **Missing-punch nudge** to the employee the same evening/next morning | greytHR/Keka *(unverified)* | Missing *(inferred)* | No job found that tells the employee |
| B6 | WFH / on-duty request | H: `attendance_request` (Work From Home / On Duty) | Have | Attendance request types, `ON_DUTY` |
| B7 | Shift request / shift roster rotation auto-creation | H: `shift_request`, `shift_schedule_assignment` hourly | Have | `ShiftRotation`, `shift-change-requests` migration |
| B8 | Shift assignment auto-expiry | H: daily `mark_expired_shift_assignments_as_inactive` | Have | Dated assignments |
| B9 | Comp-off request for holiday work → leave credit | H: `compensatory_leave_request` | Have | `leave/comp-off` |
| B10 | Earned leave monthly accrual | H: daily `allocate_earned_leaves` | Have | `leaveAccrual.ts` (OSH-code accrual) |
| B11 | Allocation expiry, carry forward | H: `process_expired_allocation` | Have | carry-expiry migration, year end with undo |
| B12 | Auto leave encashment at expiry | H: `generate_leave_encashment` (draft on expiry if HR setting on) | Flight | encashment to Payroll batch |
| B13 | Leave block dates | H: `leave_block_list` | Have | `leave/blocks` |
| B14 | Bulk leave allocation by filters (control panel) | H: `leave_control_panel` | Have | `allocations/import`, policies |
| B15 | Backdated leave restriction by role | H: HR Settings "Restrict Backdated Leave Application" | Partial *(unverified)* | not confirmed |
| B16 | Self-approval prevention | H: HR Settings "Prevent self approval" | Have | engine: requester never decides own step |
| B17 | Overtime slip → payroll | H: `overtime_slip`, Shift "Allow Overtime" | Flight | OT rules/requests exist (`attendanceInsights.ts`) |
| B18 | **Project / client timesheets**, billable hours, approval | Z4; K6; H: ERPNext `Timesheet` + `salary_slip_timesheet` | Missing | No timesheet in People or Books |
| B19 | Women night-work consent per person, checked when assigning a night shift | Indian law, none of the six seen | Partial | Obligation `IN-OSH-WOMEN-NIGHT` (`complianceRules.ts:41`). No per-person consent record or shift check |

### C. Money flows that start in People

| # | Workflow / automation | Seen in | CLOR status | CLOR evidence / gap |
|---|---|---|---|---|
| C1 | **Expense claim** (receipt, category, approver, sanctioned vs claimed, pay via payroll or bank) | H: `expense_claim` (+ Payment Entry/Journal hooks); K1, K2; Z (Zoho Expense); D1 | Missing | Books has `Expense` (company spend), not employee claims. No People/Payroll claim |
| C2 | **Employee advance** (travel/imprest): request, pay, settle against claims, recover the balance from salary | H: `employee_advance` ("Repay Unclaimed Amount from Salary" via Additional Salary); K1 | Missing | |
| C3 | **Salary advance / loan request by the employee**, multi-level review, EMI from salary | G5, G6 (loan workflow, ESS apply/withdraw) | Partial | Payroll `PayrollLoan` + installments + approve (`payrollLoans.ts`) is HR-entered. No employee request in the employee app |
| C4 | Travel request (itinerary, costing, funding) | H: `travel_request`; D1 | Missing | Fold into C1/C2 |
| C5 | Vehicle / fuel log feeding claims | H: `vehicle_log` | Missing | Low |
| C6 | Retention bonus with reminder 14 days before | H: `retention_bonus` + Notification "Retention Bonus" (14 days before) | Missing | Payroll adjustments exist; no dated reminder |
| C7 | Incentive / additional salary / arrears / payroll correction | H: `employee_incentive`, `additional_salary`, `arrear`, `payroll_correction` | Have (Payroll) | `payrollAdjustments.ts`, `revision.ts` |
| C8 | Gratuity rule (slabs, eligibility years) | H: `gratuity_rule` | Partial (Payroll) | Gratuity in `finalSettlement.ts`. Rule config not checked |
| C9 | Statutory bonus (Payment of Bonus) computation | not in the six as a workflow *(unverified)* | Missing (Payroll) | No 8.33% / ₹21,000 logic found |
| C10 | Tax declaration + proof submission by employee | H: `employee_tax_exemption_declaration`, `..._proof_submission` | Partial (Payroll) | `payrollTaxDeclarations.ts` is HR-side. No employee self-entry route found |
| C11 | Flexible benefits claim | H: `employee_benefit_application/claim`; D1 *(unverified)* | Missing | Later |

### Commercial source list

- **K1** Keka, advances in Expenses & Travel: https://help.keka.com/hc/en-us/articles/39946779166865-Using-Advances-in-Expenses-Travel. Also *How can employees raise expense claims*: https://keka.freshdesk.com/support/solutions/articles/84000385665
- **K2** Keka, expense & travel policies: https://keka.freshdesk.com/support/solutions/articles/84000389322
- **K3** Keka, Employee exits overview: https://help.keka.com/admin/employee-exits-on-keka-overview. Also *Initiate the exit*: https://keka.freshdesk.com/support/solutions/articles/84000383276
- **K4** Keka, Processing a F&F settlement: https://keka.freshdesk.com/support/solutions/articles/84000389087
- **K5** Keka, Pulse: https://help.keka.com/hc/en-us/articles/39946787507857-Launching-and-Managing-Pulse-for-your-Organisation
- **K6** Keka, timesheet approval: https://help.keka.com/admin/admin-help/how-to-manage-timesheet-approval
- **G1** greytHR, final settlement process: https://www.greythr.com/help-admin/payroll/employee-final-settlement-process/
- **G2** greytHR, resignation workflow: https://greythr.com/blog/greythr-introduces-resignation-workflow
- **G3** greytHR, attendance policy (status criteria, penalty and regularisation rules): https://www.greythr.com/help-admin/attendance-settings/create-attendance-policy-rules/
- **G4** greytHR, regularisation limits: https://greythr.freshdesk.com/support/solutions/articles/1060000066234. Also *Deduct attendance penalty*: https://www.greythr.com/videos/how-to-admin/deduct-attendance-penalty-payroll-processing
- **G5** greytHR, manage employee loans: https://www.greythr.com/help-admin/payroll/manage-employee-loans
- **G6** greytHR, apply for a loan (ESS): https://www.greythr.com/help-ess-web/salary-activities/apply-loan-greythr-ess
- **Z1** Zoho People, workflow automation: https://help.zoho.com/portal/en/kb/people/administrator-guide/common-settings/articles/workflow-zoho-people
- **Z2** Zoho People, email alerts / field updates: https://help.zoho.com/portal/en/kb/people/administrator-guide/common-settings/articles/email-alerts and https://help.zoho.com/portal/en/kb/people/administrator-guide/common-settings/articles/field-updates-zoho-people
- **Z3** Zoho People, onboarding portal: https://help.zoho.com/portal/en/kb/people/administrator-guide/onboarding-service/articles/new-onboarding-portal-for-candidate-and-employee-onboarding. Also Jumpstart (surveys): https://www.zoho.com/people/jumpstart.html
- **Z4** Zoho People, timesheets: https://help.zoho.com/portal/en/kb/people/administrator-guide/timesheets/overview/articles/timesheet-service-overview
- **D1** Darwinbox, travel & expense (policies by grade/city tier, approvals with SLAs and escalations; marketing page): https://explore.darwinbox.com/lp/travel-expense-management-software. Also https://darwinbox.com/blog/darwinbox-launches-travel-module. *Darwinbox help centre is behind login, so its workflow builder and flexi benefits are unverified.*
- **R1** Rippling, Workflow Studio (triggers on any employee data, date triggers): https://www.rippling.com/workflow
- **R2** Rippling, offboarding (scheduled access revocation): https://www.rippling.com/blog/how-rippling-runs-it-ensuring-smooth-offboarding
- **R3** Rippling, alert on an unreturned device: https://www.rippling.com/use-cases/alert-it-terminated-employee-device-not-returned
- **P1** Personio, the Automations area: https://support.personio.de/hc/en-us/articles/360019768298
- **P2** Personio, workflow components: https://support.personio.de/hc/en-us/articles/16599105162909

---

## 2. Missing and partial items: how each works, and the Indian angle

Format per item: **Trigger · Steps · Who acts · Approvals · Notices/escalation · Scheduled job · Law.**

### C1 Expense claims (Missing)
- **Trigger:** an employee spends company money (travel, client meeting, courier, fuel).
- **Steps:** photo of the bill → category, amount, date, optional project/client → submit. The approver sanctions the full or a reduced amount, with a reason. Sanctioned claims are paid either with the next salary as a non-taxable reimbursement line, or straight away by bank/UPI recorded in Books.
- **Frappe HR:** claimed vs sanctioned amounts. Payment Entry and Journal hooks mark the claim paid or partly paid. Advances are set off inside the claim.
- **Who acts:** employee, manager, owner/accounts.
- **Approvals:** reuse `approvals/engine.ts`. Add an amount condition (e.g. above ₹5,000 → owner), as Keka's "different chain above a limit" does.
- **Notices:** submitted, approved, paid. Overdue step uses REMIND/HAND_ON as today.
- **Scheduled job:** the existing approval dues job. A monthly "unclaimed advances" digest.
- **Law:**
  - Reimbursement of actual business expense backed by bills is not salary, so it is not taxed as a perquisite.
  - **GST:** input tax credit is available only when the invoice names the company's GSTIN. Prompt for "bill in company name?" and pass the GSTIN and tax to Books, so ITC can be claimed (CGST Act s.16). Blocked credits under s.17(5) include food and beverages, with exceptions. Flag the category rather than auto-claiming.
  - **DPDP:** bills can carry personal data. Keep under the existing retention rules.

### C2 Employee advance (Missing)
- **Trigger:** a trip or a site purchase is planned.
- **Steps:** request with purpose and amount → approve → pay (Books payment) → later claims settle against it → the balance is returned, or recovered from salary as a payroll deduction.
- **Frappe HR:** the unclaimed balance can be recovered through Additional Salary. Keka has a receipts deadline after the advance.
- **Who acts:** employee, manager/owner, accounts.
- **Scheduled job:** receipts due X days after the trip, with a reminder. Then the owner decides whether to recover from salary.
- **Law:**
  - Deductions from wages are limited to the heads the wage law allows, and to 50% of wages in a period (Code on Wages 2019 s.18, in force since 21 Nov 2025).
  - Recovery of an advance is a permitted head. Recovery needs a written record, so keep the approval record as proof.

### C3 Salary advance / loan request by the employee (Partial)
- **Trigger:** an employee needs money before payday.
- **Steps:** amount, reason, preferred instalments in the employee app → the approval rule runs (manager → owner) → on approval a `PayrollLoan` is created with a schedule preview (that endpoint already exists) → EMI comes off each payslip → the balance is pulled into F&F if the person leaves.
- **greytHR:** reviewers by level, employee withdraw, history.
- **Notices:** decision; "last instalment next month".
- **Law:**
  - The 50% deduction cap applies (Code on Wages s.18).
  - Interest-free or concessional loans above ₹2 lakh in aggregate are a taxable perquisite (Income-tax Rules, rule 3(7)(i); medical loans are exempt). Show a warning above ₹2 lakh. *Check whether this rule number moved under the Income-tax Act 2025 rules.*

### A8 Exit interview questionnaire (Partial)
- **Trigger:** the leaving is approved. The questionnaire goes out N days before the last day (Frappe HR's notification fires 1 day before the interview date).
- **Steps:** a short form in the employee app: reason picklist, rehire-able, free text, optional anonymous to the manager. HR records the outcome: "retained" or "exit confirmed". Retained cancels the leaving through the existing withdraw.
- **Who acts:** leaver, HR/owner.
- **Scheduled job:** reminder if the form isn't filled by 2 days before the last day.
- **Law:** none mandatory. **DPDP:** state the purpose on the form and keep answers under retention rules.

### A9 / A10 No-dues sign-off and the F&F 2-working-day clock (Partial)
- **Trigger:** the last working day approaches.
- **Steps:** each owner (manager: handover; IT/assets: returned; accounts: advances, loans and claims open) marks clear, or records an amount owed. These lines feed Payroll `FinalSettlement` as recoverables or payables. On the last day, Home shows "Final settlement due by <date>".
- **Who acts:** manager, asset owner, accounts, owner.
- **Escalation:** the day before the due date, and on the due date, to the owner.
- **Law:**
  - Code on Wages 2019 s.17(2): wages due on resignation, removal, dismissal or retrenchment are paid within two working days. Codes in force from 21 Nov 2025; central rules reported notified in May 2026, *to be checked against the gazette*.
  - Gratuity within 30 days of becoming payable (Payment of Gratuity Act s.7, carried into the Code on Social Security).
  - Fixed-term employees qualify for pro-rata gratuity after 1 year (Code on Social Security).
  - Don't withhold the statutory dues pending no-dues. Recover only permitted deductions.

### A12 / A13 Absconding (Partial)
- **Trigger:** N consecutive unapproved absent days (company setting, commonly 3–8). Detected from the attendance data CLOR already computes.
- **Steps:**
  1. Owner gets "X has been absent 3 days with no leave".
  2. One click sends notice 1: report back or explain by a date, by email/WhatsApp/post, recorded.
  3. Notice 2.
  4. Owner decides: record leaving as ABSCONDED (the type exists) on the date set by the standing orders/policy. Hold the settlement until contact, but keep it computed.
- **Who acts:** owner/HR.
- **Scheduled job:** daily absence-streak check.
- **Law:**
  - Termination for misconduct needs a show-cause opportunity (natural justice; model standing orders under the IR Code 2020 treat continuous unauthorised absence as misconduct). *Exact days per the state/central model standing orders is uncertain and needs a lawyer's check.*
  - Wages earned are still due. Use salary withholding only as an accounting hold, not forfeiture.

### B3 Late-mark and regularisation-limit rules (Partial)
- **Trigger:** the month's attendance is computed.
- **Steps:** policy, e.g. "every 3 late marks beyond 10 minutes = half day off leave, or LOP if no balance"; "max 3 regularisations a month". The penalty appears in the month readiness view with "waive" per person. It feeds payable days, which the payroll-readiness endpoint already produces.
- **greytHR:** penalty rules inside the attendance policy, deducted at "finalize".
- **Approvals:** waiver by manager/owner.
- **Notices:** the employee sees "2 late marks this month; the 3rd costs half a day". This is a nudge, not a surprise.
- **Law:**
  - Deduction for absence is permitted, proportionate to the period absent (Code on Wages s.18/s.19).
  - Many states' Shops & Establishments rules require the deduction to follow displayed rules. Show the policy text in the employee app (policies with acknowledgement exist).
  - A fine for lateness, as distinct from deduction for absence, needs a notified list of acts and limits. Don't build "fines".

### B5 Missing-punch nudge (Missing, inferred)
- **Trigger:** shift ended plus X hours, with an IN punch and no OUT, or no punch on a working day with no leave.
- **Steps:** a notice to the employee: "Forgot to punch out? Tap to fix". This opens the existing regularisation with `FORGOT_PUNCH` pre-filled.
- **Scheduled job:** hourly, alongside the existing attendance jobs.
- **Law:** muster roll accuracy. The registers CLOR already produces get cleaner.

### A14 / A15 Birthdays, anniversaries, holiday heads-up (Partial / Missing)
- **Trigger:** daily, plus weekly or monthly.
- **Steps:** a morning notice to the team ("Today: Ravi's birthday, Asha's 2nd work anniversary"), and to the person themselves. A weekly "holidays this week" digest per employee, using their own branch's holidays once the branch-holidays batch lands.
- **Frappe HR:** separate toggles for birthdays, anniversaries and holidays, with the holiday frequency weekly or monthly.
- **Law, DPDP:** the date of birth is personal data. Make greetings opt-out per person, and show day and month only, never the year.

### B18 Timesheets to invoice (Missing)
- **Trigger:** a service business (CA, agency, IT services, consultant) bills by time.
- **Steps:** a daily or weekly log against client → project → task, billable flag → weekly submit → manager approves → Books "bill unbilled hours" creates the invoice lines.
- **Keka and Zoho:** approval chains per project, auto-submit at a scheduled time.
- **Frappe/ERPNext:** a Timesheet can feed both a sales invoice and a salary slip for hourly staff.
- **Law:** none. GST invoice rules apply on the Books side (SAC code per service).

### A27 Ready-made automations, not a builder (Partial)
- **Trigger:** any of the events CLOR already emits (`OutboxEvent`, `people.employee.*`), plus date fields.
- **Steps:** a "Reminders & automations" screen listing about 15 recipes with on/off and one or two parameters each:
  - birthday notice
  - probation ends in 15 days
  - document expires in 30 days
  - leaver's final settlement due
  - no punch today
  - retention bonus in 14 days
  - contract end date in 30 days
  - and the rest
- Zoho, Rippling and Personio sell builders. For 1–20 people a builder is too much. Recipes give 90% of the value.
- **Scheduled job:** one daily runner via `jobRegistry`.

### B19 Women night-work consent (Partial)
- **Trigger:** a woman is assigned a shift touching 7 pm–6 am.
- **Steps:** the shift assignment checks for a consent document on file. If there is none, the assignment is blocked or warned, with a link to "ask for consent" through the existing ask-to-accept flow.
- **Law:** OSH Code 2020 s.43 (consent and safeguards). State conditions vary, e.g. TN (already a rule in `complianceRules.ts:39`).

### C9 Statutory bonus, C10 tax proofs, A13 salary withholding, C6 retention bonus (Payroll lane, listed for hand-off)
- **Statutory bonus:**
  - The Payment of Bonus Act 1965 applies to establishments with 20 or more persons. Its provisions are now in the Code on Wages (Chapter IV).
  - Eligible: salary up to ₹21,000/month and 30 working days in the year.
  - Minimum 8.33%, maximum 20%.
  - Calculated on ₹7,000 or the minimum wage, whichever is higher.
  - Paid within 8 months of year end.
  - Relevant only at 20+ people, so it sits at the top of CLOR's range.
- **Tax proofs:** employee self-entry of the declaration in April, and proofs in January–February, in the employee app. The HR verify routes already exist.

### Lower-value missing items (no detail needed now)
Pulse surveys (A25), praise wall (A26), skill map (A24), referral bonus (A20), job requisition budget check (A21), travel itinerary (C4), vehicle log (C5), flexi benefits (C11), app deprovisioning list (A29), Aadhaar eSign (A18).

---

## 3. Ranking for 1–20 person Indian businesses (impact ÷ effort)

Impact: H/M/L for how often a small owner hits it, and how much money or legal risk it carries. Effort: S (reuses existing engine/screens), M, L.

| Rank | Item | Impact | Effort | Why |
|---|---|---|---|---|
| 1 | C1 Expense claims (+ C2 advances inside) | H | M | Every small business reimburses weekly, today over WhatsApp photos and cash. Also feeds GST ITC into Books, which no HR product does natively |
| 2 | C3 Salary advance / loan request in the employee app | H | S | Very common in Indian SMBs. Payroll loans and the approval engine exist, so it only needs the request screen and an effect |
| 3 | A9/A10 No-dues + F&F 2-day clock on Home | H (legal) | S | The two-working-day rule is new and easy to miss. The pieces (tasks, `FinalSettlement.dueDate`) exist but aren't joined |
| 4 | B3 Late-mark and regularisation-limit rules | H | M | The most-asked attendance policy in Indian small firms. CLOR already counts lates |
| 5 | B5 Missing-punch nudge | M-H | S | Fixes the month-end mess at the source. The job and regularisation exist |
| 6 | A12 Absconding workflow | M-H | M | Frequent in retail, manufacturing and services staff. Today it's paper letters and guesswork. No competitor does it well, so it's a differentiator |
| 7 | A27 Ready-made automations screen (recipes) | M | M | One place that makes CLOR feel "it reminds me". Groups A14/A15, C6, contract end, probation |
| 8 | A14/A15 Birthdays, anniversaries, holiday heads-up | M | S | Cheap delight for small teams. Lands as the first recipes of #7 |
| 9 | A8 Exit interview questionnaire + reasons | M | S | Small, gives the owner "why people leave" in one view |
| 10 | B18 Timesheets → Books invoice | M (service firms: H) | M-L | Strong CLOR-only angle: hours to GST invoice in one product. Larger build, so last |

Next after the top 10: B19 night consent check (S, legal), C10 tax proof self-entry (Payroll), C9 statutory bonus (Payroll, 20+ only), A13 salary hold (Payroll), A25 pulse (later).

### How CLOR can do each better or simpler

1. **Expenses.**
   - Phone-first: the camera opens straight away, and amount and date are read from the bill (OCR later; manual first).
   - One approver by default: the owner.
   - "Pay with salary" or "Paid now" toggles. "Paid now" posts a Books payment and expense with GSTIN and tax for ITC.
   - Plain words: "Spent for work", "Approved ₹1,850 of ₹2,000: parking had no bill".
2. **Salary advance.**
   - The employee sees "You can ask up to ₹X (half your monthly pay)", computed from the 50% cap.
   - The owner approves from a notification. The EMI preview shows the payslip impact.
3. **Leaving clock.**
   - One leaving page with a countdown banner: "Final pay due Thu 6 Nov (2 working days)".
   - The no-dues list shows money owed both ways on one line each.
   - Greyed "Pay now" until it is computed, never blocked by no-dues.
4. **Late marks.** A policy in one sentence: "Every [3] late marks after [10] min = [½ day] from [leave, else unpaid]". A live preview of who it hits this month (reuse rules/simulate). Waive with a reason.
5. **Missing punch.** A notice with a single "Fix" button that pre-fills the time. The manager approves in the inbox, with the evidence (punch photo or geo) shown.
6. **Absconding.** CLOR spots the streak itself. The two notices are generated from letter templates and the send is recorded with proof. The decision is one screen with the timeline. Plain wording, no legalese in the UI.
7. **Automations.** A list of plain sentences with switches ("Tell the team on someone's birthday"), not triggers or conditions. Each shows "last ran / next run / who got it".
8. **Greetings.** Opt-out per person. No year shown.
9. **Exit questionnaire.** 5 questions, takes 2 minutes on a phone. Reasons roll up in the People report.
10. **Timesheets.**
    - The week grid on the phone shows yesterday's suggestion: the same projects as last week.
    - "Bill these hours" creates a Books draft invoice with the SAC code and the client's GST state.

---

## 4. Build-ready acceptance criteria (top 10)

Each is written so the product manager can lift it into `*-DECISIONS.md`. Roles: Employee (E), Manager (M), HR, Owner (O). All screens are phone-first at 390×844 and follow DESIGN.md.

### 4.1 Expense claims (with advances)
1. E can create a claim from the employee app: one or more lines (date, category, amount, bill photo/PDF, note, optional client/project), saved as draft or submitted.
2. Each line has a "Bill in company name with GSTIN" toggle. When on, the GSTIN and tax amount are captured. Categories under GST s.17(5) (e.g. food) show "credit usually not available".
3. Submitting runs the org's approval rule for a new request type `EXPENSE_CLAIM`. Conditions support amount `gt`. Default rule: manager, then owner above ₹5,000 (editable).
4. An approver can sanction less than claimed per line, with a required reason. E sees claimed vs approved.
5. On final approval O/HR chooses **Pay with salary**, which adds a non-taxable reimbursement line to the next open payroll run, or **Paid now**, which creates a Books payment, and an expense with ITC data where the GSTIN is set. Status moves to Paid.
6. Advances:
   - E can request an advance (purpose, amount, expected date) through the same rule.
   - When paid, later claims can be set against it.
   - After a configurable "settle by" date, the open balance shows on O's Home with **Recover from salary**, which creates a payroll deduction within the 50% cap, or **Mark returned**.
7. Open advances and unpaid approved claims appear as lines in the leaver's final settlement.
8. Notices: submitted (to approver), decided (to E), paid (to E), advance settle-by reminder (to E, then O). Overdue steps use the existing REMIND/HAND_ON.
9. Reports: claims by month, category and person. CSV export.
10. Permissions: E sees own claims only. M sees the team's. Accounts/HR see all. Bills follow document retention.
11. Tests: approval paths, partial sanction, both payment routes, the cap on recovery, F&F lines, tenant isolation.

### 4.2 Salary advance / loan request
1. E can request from the employee app: amount, reason, instalments (1–24). Shows "most you can ask" and the EMI preview, using the existing schedule-preview endpoint.
2. A new request type `SALARY_ADVANCE` goes through approval rules (default: owner).
3. Final approval creates the `PayrollLoan` with that schedule, effective from the next open run. Rejection gives a reason.
4. If the instalment would breach 50% of the month's wages together with other deductions, the run caps it and carries the rest forward, with a note on the payslip.
5. Above ₹2,00,000 aggregate interest-free, HR sees a perquisite warning.
6. E can withdraw while pending. E sees the outstanding balance in the employee app.
7. The outstanding balance appears in the final settlement automatically.

### 4.3 Leaving: no-dues and the final-pay clock
1. When a leaving is recorded, the plan gets a **Clearance** section with one line per owner: manager (handover), each held asset (from the register), accounts (open advances, loans, claims, with amounts pulled in automatically).
2. Each line can be marked **Clear** or **Owes ₹X / Owed ₹X** with a note. The amounts become lines on the Payroll `FinalSettlement`.
3. From the last working day, Home (O and HR) shows "Final pay for <name> due <date>" using `FinalSettlement.dueDate`, with a link to the settlement.
4. The day before the due date and on the due date, O gets a notice if the status isn't Paid. After the due date it shows as overdue on Home and in Compliance.
5. Clearance never blocks computing or paying the statutory dues. An uncleared line shows as a warning only.
6. The relieving letter is offered when the settlement is Paid (except for ABSCONDED and similar, as today).

### 4.4 Late-mark and regularisation-limit rules
1. Attendance settings add rules:
   - late marks: count after [grace] minutes; every [N] marks = [½ / 1] day; take from [leave type order, else unpaid]
   - early exits counted the same way, optional
   - regularisations: max [N] a month
2. A preview lists who would be affected this month (reuse `rules/simulate`).
3. The month readiness view lists penalties per person with **Waive** (reason required, logged). Penalties feed payable days and the payroll-readiness output.
4. E sees the running count in My attendance ("2 of 3 late marks; next one costs ½ day") and the policy text.
5. A regularisation beyond the limit is refused with a plain message. HR can still enter one on E's behalf.
6. Rule changes are versioned. A closed month keeps the version it was closed with.

### 4.5 Missing-punch nudge
1. A job runs hourly. For each working-day shift that ended more than [2] hours ago (default) with an IN and no OUT, or no punch with no leave or holiday, E gets one notice per day: "No punch-out yesterday: fix it".
2. The notice opens the regularisation form pre-filled (date, `FORGOT_PUNCH`, the shift end as the suggested time).
3. Next morning M gets a digest of the team's unfixed days.
4. It can be switched off per org. It is not sent to people on leave, holiday, week-off or a field day already covered by a field punch.

### 4.6 Absconding
1. A setting holds the streak (default 5 working days of unapproved absence).
2. Daily job: when someone hits the streak, O/HR get "X absent N days without leave" with **Send notice**, **Mark leave**, or **Ignore (reason)**.
3. **Send notice** generates notice 1 from a letter template and sends it to the email/phone on file. It is recorded with time, channel and a copy. Notice 2 is offered after [7] days.
4. After the last notice, **Record as absconded** records the leaving with type ABSCONDED, a chosen last working day and the notice evidence attached. Normal close-out follows.
5. The final settlement is computed. Paying it can be put on **Hold** with a reason, which shows on Home until released. Earned wages are never zeroed.
6. If the person returns, the case closes with a note and no leaving.

### 4.7 Ready-made automations
1. A new Settings screen lists recipes, each a plain sentence with a switch and at most two parameters. First set:
   - birthdays (team / self)
   - work anniversaries
   - holidays this week
   - probation ends in [15] days
   - contract ends in [30] days
   - document expires in [30] days
   - final pay due
   - missing punch
   - retention or other dated payment in [14] days
2. Each recipe shows the last run, the next run and the recipients of the last run.
3. All recipes run from one daily job registered in `jobRegistry`. They are idempotent per day and person (dedupe key like the existing notices).
4. The org can choose channels per recipe: in-app, email, and WhatsApp when available.

### 4.8 Birthdays, anniversaries, holiday heads-up
1. Each person can opt out of being announced (employee app, Privacy).
2. The morning notice to the person's team (or the whole company if it has 20 or fewer people) names birthdays and anniversaries. The year is never shown.
3. Weekly (Monday) or monthly (1st), each E gets "Holidays this week/month" from their own holiday list, using branch holidays once that batch ships.

### 4.9 Exit interview questionnaire
1. When a leaving is approved, E gets a short form in the employee app, due [2] days before the last day:
   - primary reason (picklist)
   - would you come back (Y/N/maybe)
   - what would have kept you
   - note to the owner
   - optional "hide from my manager"
2. HR/O record an outcome: **Exit confirmed** or **Retained**. Retained withdraws the leaving through the existing flow.
3. One reminder if it isn't filled. The checklist task "Exit interview" ticks itself when submitted.
4. The People report shows leavers by reason and month.
5. Answers carry a retention period. Only HR/O can see them.

### 4.10 Timesheets → Books invoice
1. An org can turn on Timesheets (feature flag). Projects link to a Books customer, with a billable flag and an hourly rate.
2. E logs time per day per project/task on a phone week grid. "Copy last week" is available.
3. Weekly submit → M approves (bulk) through the approval rule `TIMESHEET`. A rejection is sent back with a reason.
4. In Books, **Bill unbilled hours** for a customer and period creates a draft invoice with lines per project/person or summarised, an SAC code from the project, and rate × hours. Billed hours are locked.
5. Report: hours by project, person, billable vs non-billable.
6. Optional: hours for hourly-paid staff feed payable hours in Payroll (later).

---

## 5. ERPNext non-HR workflows and automations that Books may lack (list only, for later)

From `erpnext/hooks.py` `scheduler_events` (develop) and Frappe core features. The "Books signal" is a file-count grep in `apps/accounting/src` and `server/src` (non-People/Payroll), so it is **not verified**.

**Accounting**
- Bank transaction rules evaluated hourly (auto-categorise bank lines). *No signal in Books.*
- Process Statement of Accounts: scheduled emailing of customer statements. *No signal.*
- Exchange-rate revaluation daily/weekly/monthly. *Weak signal.*
- Deferred revenue/expense posting, monthly. *1 hit.*
- Asset depreciation auto-posting daily. *Books has `FixedAsset`; 4 hits.*
- Auto-create the next fiscal year.
- Ledger health checks daily.
- Invoice status refresh (overdue) daily.
- Subscriptions (recurring billing) with a daily process. *Books has a recurring scheduler.*
- Budgets with actual-vs-budget controls. *1 hit.*
- Accounting period close / lock. *1 hit.*
- Dunning. *Books has a WhatsApp/email collection schedule.*

**Stock**
- Auto reorder (material request when below the reorder level), daily. *11 hits.*
- Repost item valuation every 15 minutes or hourly.
- Serial/batch maintenance status.
- Landed cost voucher. *No signal.*

**Buying / selling**
- Quotation and supplier quotation auto-expire.
- Supplier scorecards.
- Material request → RFQ → PO chain. *Material request: 2 hits.*
- Pricing rules. *19 hits.*
- Blanket orders.

**CRM**
- Opportunity auto-close.
- Email campaigns to leads.
- Appointment expiry.

**Projects**
- Project status update reminders and collection.
- Task auto-overdue.
- Project billing summary daily.
- Timesheet billing (see B18).

**Support**
- Issue auto-close.
- SLA failure marking hourly.

**Assets**
- Asset maintenance schedule and log status.

**Automation engine (Frappe core)**
- **Workflow**: states, transitions, roles and conditions on any document.
- **Notification**: on new, save, submit, value change, or N days before/after a date field; to fields, roles or owner; email, SMS or system.
- **Assignment Rule**: round-robin or load-balanced assignment with conditions.
- **Auto Repeat**: recurring copies of any document, emailed.
- **Auto Email Report**.
- **Email Digest**.
- **Webhooks**.
- **Server Scripts / scheduled scripts**.
- **Energy points**.

The pattern worth borrowing for Books later is a "N days before/after a date field" notification. CLOR People's recipes (§4.7) can share one engine with Books for due dates on invoices, bills, TDS and GST.

---

## Unverified / limits

- Darwinbox's help centre is behind login. Darwinbox cells rest on marketing pages and case studies. Its workflow builder and flexi benefits are unverified.
- Rippling cells rest on product and marketing pages, not help.rippling.com articles.
- Several "Seen in" cells marked *(unverified)* are general product knowledge, not a page I opened (Keka praise, greytHR letters, Darwinbox SLA detail).
- CLOR statuses come from reading code, not a browser run. B2 (auto-absent), B5 (no missing-punch job), B15 (backdated restriction) and A21 (vacancy check) are inferences.
- Legal points are taken from the statutes and law-firm summaries:
  - the date the labour codes came into force (21 Nov 2025)
  - the date the central rules were notified (reported 8 May 2026)
  - the exact days for absconding under model standing orders
  - whether rule 3(7)(i) still applies under the new Income-tax Act
  
  Check each against the gazette or official text before building.
- No ERPNext Docker was run, so behaviour is read from source, not observed.
