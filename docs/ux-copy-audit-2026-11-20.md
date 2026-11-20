# UX copy audit — whole platform (20 Nov 2026)

Scope: clor.in website, shell and shared UI, Workspace, People, Attendance, Payroll, Ops console,
server messages and emails. Books is out of scope (other developer). About 375 findings in total.
Every high-severity item below was checked against the source on 20 Nov 2026.

Two server findings were handled separately.
They are not listed here.

## Fix status (20 Nov 2026)

Each finding is ticked off, one by one, in a checklist per area. A ticked line is fixed; an
unticked line says why it was left.

| Area | Checklist | Fixed | Left |
|---|---|---|---|
| Website | [website.md](ux-copy-audit/website.md) | 61 | 1 |
| Shell and shared UI | [shell-ui.md](ux-copy-audit/shell-ui.md) | 67 | 4 |
| Workspace | [workspace.md](ux-copy-audit/workspace.md) | 64 | 4 |
| People | [people.md](ux-copy-audit/people.md) | 74 | 3 |
| Attendance | [attendance.md](ux-copy-audit/attendance.md) | 76 | 0 |
| Payroll | [payroll.md](ux-copy-audit/payroll.md) | 65 | 1 |
| Ops | [ops.md](ux-copy-audit/ops.md) | 64 | 1 |
| Server and emails | [server.md](ux-copy-audit/server.md) | 75 | 1 |

Left for the owner to decide:

- Books-only copy in shared components ("Retry", "Select Branch", "Reset"): Books is kept as it is.
- "Users & access" and "Billing & seats": the owner's names, kept.

## What is already good

- No "Submit", "OK"-only dialogs (one exception below), "Dear User" or "Kindly" anywhere.
- CLOR is spelled in capitals in almost every place (three exceptions below).
- Indian English is mostly consistent; money uses ₹ with en-IN grouping.
- Newer server copy ("No such X.", "Say why.", "Reload it.") is plain and good. People confirm
  dialogs (about 40) nearly all name the action and its consequence.

## Fix first (cross-app, verified)

| # | Where | Problem | Fix |
|---|---|---|---|
| 1 | `packages/shell/Shell.jsx:1946` | Lapsed-subscription banner gives a personal address: a personal address instead of support | "Write to support@clor.in." |
| 2 | `packages/shell/Shell.jsx:1945`, `server/src/services/subscriptions.ts:108`, `:140`, `apps/admin/src/screens/AdminHome.jsx:410`, `BillingPreview.jsx:121` | Raw subscription status in sentences ("is past_due", "is payment overdue") | One status-to-sentence map: "Your payment is overdue. Pay the open invoice to keep your apps working." |
| 3 | `packages/ui/src/components/ui/notify.js:59` | Shared confirm defaults to "Are you sure?" / "Confirm" / "Cancel" | Make `title` and `confirmLabel` required; default the keep button per action |
| 4 | `packages/ui/src/timeOff/MyDays.jsx:125`, `packages/ops/kit.jsx:111` | Two "Cancel" buttons with opposite meanings (cancel leave, cancel subscription, cancel invoice) | Keep side reads "Keep request" / "Keep subscription" / "Keep invoice" |
| 5 | `apps/admin/src/screens/SettingsRoles.jsx:253` | Delete role: "Please confirm" / "Delete this role?" / "Yes, continue" | "Delete the role {name}?" / "People who hold it lose what it allowed." / "Delete role" |
| 6 | `apps/people/src/screens/Privacy.jsx:211` | Erase personal data confirm says only "This cannot be undone." | Say what is erased and what stays (pay and statutory records); button "Erase personal data" |
| 7 | `apps/payroll/src/screens/PayrollPayments.jsx:616` | "Mark the rest paid" moves money with no confirm | Confirm "Mark N people paid, ₹X?" with button "Mark N paid" |
| 8 | `apps/payroll/src/screens/PayrollCompliance.jsx:981` | Payroll staff edit PF, LWF and income tax rates as raw JSON | Named fields, as PT already has |
| 9 | `packages/ops/Payments.jsx:359`, `:492` | Live-payments switch says money moves "once checkout is built"; customers already pay online | "Customers who pay an invoice online pay real money into CLOR's account." |
| 10 | `packages/ops/Invoices.jsx:138`, `Procurement.jsx:47` | "Nothing unpaid" / "None outstanding" shown while still loading | Show no count line until the data arrives |
| 11 | `packages/ops/Lists.jsx:350`, `:398`, `:454`; `Customers.jsx:352`, `:391`, `:393` | Raw codes (APP_NOT_SUBSCRIBED), "402 if called", "legacy fail-open", set-intersection notation shown to the owner | Use the plain `REASON` words already in `kit.jsx:42`; "Not on their plan"; "Older account, every app open" |
| 12 | `server/src/middleware/errors.ts:28` | Raw Zod text ("Invalid input: expected string…") reaches users from 56 routes | Run issues through `words()` in `middleware/validate.ts` |
| 13 | `server/src/services/sms.ts:160`, `:171` | Sign-in screen shows "MSG91 did not send it: …" and "Save it again in the operator console" | "We could not send the code by text message. Use your authenticator app or a recovery code." |
| 14 | `server/src/routes/users.ts:111` (50 places), `middleware/tenantContext.ts:166`, `middleware/rbac.ts:175`, `middleware/auth.ts:106` | "orgId mismatch", "No access to org", "Permission denied", "Invalid/expired token" | Three sentences: switch company; ask an administrator to change your role; "You have been signed out. Sign in again." |
| 15 | `apps/admin/src/screens/AccountActivity.jsx:240` | Raw JSON in the Audit log | Labelled rows for known fields |
| 16 | `apps/admin/src/screens/AdminHome.jsx:113` | Time-of-day greeting on Home (banned) | Title "Home" |
| 17 | `apps/attendance/src/screens/MyAttendance.jsx:47` | Failed punch: "Could not clock." | "Your punch was not recorded. Check your connection and try again." |
| 18 | `apps/attendance/src/portal/EmployeePortal.jsx:125`, `:128`; `packages/ops/InvoiceSettings.jsx:64` | Wordmark "Clor" | "CLOR" |
| 19 | `apps/people/src/workforce/AddEmployee.jsx:274`, `ImportEmployees.jsx:61`, `screens/HelpDeskSettings.jsx:104`, `PrivateCases.jsx:307` | "needs the Employees create permission" / "needs the Users grant" | "You do not have access to add employees. Ask an administrator to allow it in Roles & permissions." |
| 20 | `website/src/pages/Pages.jsx:725`, `:735`, `:769` | Refund page covers on-premise licences and a free tier; the site offers neither | Owner decision: remove, or state the offer exists (text is kept word for word for payment providers) |
| 21 | `website/src/pages/Demo.jsx:278` vs `Pricing.jsx:74` vs `Demo.jsx:169` | Trial length 30 days, plan value, and 14 days | Read from the published plan, or "on a free trial" |
| 22 | `website/src/pages/Pages.jsx:146`, `:188` | "Request a demo" opens the contact form | Link to `/demo`, or "Write to us about your firm" |

## Fix as a class (one change fixes many)

1. **Error helper (about 600 call sites).** `String(e?.message || 'Not saved.')` appears in every app:
   Attendance 207, Payroll 131, People 114, Workspace 77, Ops 56, shell/UI 73. It shows the raw server
   text, and the fallback ("Not done.", "Not sent.", "Failed to …", "That did not work.") gives no cause
   or next step. One shared `errorWords(e, 'save the shift')` that returns
   "Could not save the shift. Nothing was changed. Try again." and keeps server text as detail.
2. **Global server fallbacks** (`server/src/middleware/errors.ts`): "Server error", "Already exists",
   "Validation error: …" become real sentences with the request reference.
3. **Status and enum fallbacks (about 50).** `STATUS[x] || x` prints PENDING_APPROVAL, MONTHLY_CTC,
   UNREGISTERED, `past_due`. Fall back to a humanised word; add one shared status map per domain.
4. **ISO dates (about 30).** Toasts, drawer titles, confirm titles ("Close 2026-11?"), approval emails
   (`toISOString().slice(0, 10)`), CSV exports. One date formatter, "20 Nov 2026".
5. **Confirm buttons that say "Yes, …" (about 30)** in Payroll (19), Attendance (4), People, shell.
   Verb plus object: "Delete shift", "Approve pay run".
6. **Empty states (about 70)** that say "None", "Nobody", "Nothing here", "None here", or are built
   from a lowercased tab name ("No to decide revisions", "Nobody no salary"). One line on what appears
   here, and the add button when the page has one.
7. **Figure tiles instead of a count line.** Attendance 19 screens, Payroll 16, several Workspace and
   People lists. Ops count lines keep zero clauses ("0 open · 0 urgent").
8. **Title Case and uppercase.** `screens.js` titles in People and Attendance ("Audit Logs",
   "Roles & Access", "Users & Security", "Email Notifications"), `ColumnFilters.jsx`, CSS
   `text-transform: uppercase` on 8 website classes and `.pc-facts dt` in People.
9. **Bracketed rupee sign left after PR #367.** Payroll 10, People 3.
10. **Developer words.** payload, POST/JSON, heartbeat, driver, epoch, snapshot, hash, row, grant,
    entitlement, fail-open, operator, worker, correlation ID. Concentrated in
    `apps/attendance/src/screens/AttendanceDevices.jsx` and `packages/ops/Customers.jsx`/`Lists.jsx`.

## One word per thing (decisions to make once)

The audit found these concepts written several ways. Suggested choice first.

| Concept | Use | Instead of |
|---|---|---|
| Accounting app | Books | Accounting (Workspace 8, shell 5, People 1, server 1) |
| Sign in | sign in / sign-in | login, log in, "Please login" |
| Company | company | org, organisation, tenant (keep "account" for the billing owner) |
| Second sign-in step | two-factor sign-in, authenticator app | two-step sign-in, 2FA |
| Email | email | e-mail (about 45 places), mail |
| Administrator | administrator | admin, Account Admin |
| Approvals page in People | Inbox | Approvals |
| Saying no | Reject / Rejected | Not approved, Refuse, Decline, Turn down |
| Undo a request | Withdraw | Cancel, Take back |
| Punch | punch in / punch out | clock in, check-in, mark attendance |
| Geofence | punch area | work site, site |
| Correcting a day | correction | attendance fix, attendance request, regularise |
| Attendance hardware | reader | device, terminal, machine |
| Pay run | pay run | payroll run, salary run |
| Payslip | payslip | salary slip, wage slip (and rename the "Salary slips" menu) |
| Net | net pay | take-home, net payable |
| Bank file | bank file | advice file |
| Posting | post to accounts | post to books, clear into the books |
| Overdue | Overdue | Past due, Payment due, Payment late |
| Request reference | Request ID | Correlation ID, Error code |
| Audit page in Ops | Staff audit log | operator log |
| Employee self-service | employee app | employee portal |
| Help menu | Help and support | Help and contact |
| Number words | 6-digit, 8 characters | six-digit, eight characters |
| Pick from list | Choose … | Select … |
| Retry | Try again (action), Reload (page) | Retry, Refresh |

## Menu name against page title

- People: "Roles & permissions" → "Roles & Access"; "Users & security" → "Users & Security";
  "Audit logs" → "Audit Logs"; "All reports" → "Reports"; "All settings" → "Settings".
- Attendance: "Employee portal access" → "Employee Portal Access"; "Audit logs", "Users & security",
  "Roles & access", "Email notifications" all Title Case; "Punch transactions" and "Punches" are one
  screen; "Mobile punches" page says "phone punches"; "Device enrollment" (US spelling, page says enrolment);
  "Organization" (US spelling).
- Payroll: "Overview" → "Payroll"; "Setup" → "Set up Payroll"; "Pay calendar" page says "Payroll periods";
  "Salary slips" page says "payslip".
- Workspace: "Home" has no title (greeting instead); "Accountants" → "Accountant access".
- Copy that names menus that do not exist: "Personnel", "Work sites", "Sync status", "Portal access"
  (Attendance); "Approvals", "Talent" (People); "Settings → Payroll → Payroll periods" (Payroll);
  "Company → Branches", "Users", "Billing" (Workspace); "operator log", "Jobs & workers" link text (Ops).

## Per app: next ten after the list above

### Website (`website/src`)
- `Pricing.jsx:57` renders "For up to 10 users. No charge for more users." Fix: "Includes 10 users. Extra users are free."
- `Pages.jsx:86` "There is no bundle to buy" while Pricing shows bundles.
- `Home.jsx:72` "File GSTR-1 and GSTR-3B": confirm CLOR files to the portal, or say "prepared".
- `Blocks.jsx:33` "See CLOR with your own company's figures" while the demo uses a sample company.
- `Product.jsx:99` "Projects joins them when it is ready" also shows on the Timesheet page.
- `routes.jsx:23` meta says "small Indian companies"; positioning is corporate offices.
- `Sections.jsx:56` sample invoice pairs CLOR's legal name with a made-up GSTIN.
- `team.js` reads as generic bio copy ("empower", "simpler, smarter and more affordable"); rewrite whole file.
- `Nav.jsx:84` "Employee portal"; product copy says "employee app" 11 times.
- `Demo.jsx:216` "People who work there" → "Number of employees".

### Shell and shared UI (`packages/shell`, `packages/ui`)
- `ErrorBoundary.jsx:23` "Something went wrong" + "check the last change" + raw exception text.
- `Shell.jsx:1459` appends server text in brackets to the not-on-plan message.
- `Shell.jsx:1702` "Nothing selected." dead end.
- `SignUp.jsx:37` validation written as noun fragments ("Tell us who you are."); `Start.jsx:287` does it right.
- `ShownOnce.jsx:21` "CLOR keeps only a hash".
- `ColumnFilters.jsx:454` button "OK"; whole file Title Case.
- `CommandPalette.jsx:38` Books placeholder ("Search invoices, customers…") is the default for every app.
- `Primitives.jsx:197` tooltip "Unregistered status: …" is a debug note.
- `TwoFactorGate.jsx:111` "Two-step sign-in" under a "two-factor" title.
- `NotificationBell.jsx:94` "1 thing waits for your answer".

### Workspace (`apps/admin/src/screens`)
- `PlanChange.jsx:270`, `:400` and `InvoiceDrawer.jsx:29` show raw errors in the seat and payment drawers.
- `PlanChange.jsx:305` "Add 3 users" creates an invoice; put the amount on the button.
- `SettingsUsers.jsx:315` and six more: "Failed to create user" etc.
- `SettingsUsers.jsx:419` "Remove {name}?" / "Remove"; say the seat is freed and it can be undone.
- `SecuritySettings.jsx:37` "Access token lifetime (minutes)".
- `AuditTrail.jsx:24` "People & Attendance" as one app.
- `AdminHome.jsx:42` role names differ from Members ("Account Owner" vs "Owner").
- `AccountOverview.jsx:138` "Monthly run rate"; `:436` invents a plan called "Full" on load failure.
- `Companies.jsx:222` calls members "seats".
- `Integrations.jsx:40` "User provisioning (SCIM)" vs "Directory sync" elsewhere.

### People (`apps/people/src`)
- `screens/Approvals.jsx:193` every Inbox decision fails with raw text or "Not done.".
- `money/Expenses.jsx:174` "Not paid." with no word on whether Payroll got anything.
- `time/LateMarks.jsx:52`, `:98` "Not applied." / button "Apply November" (cuts leave and pay).
- `workforce/EmployeeRecord.jsx:188` "Not deleted."; say why (Payroll has used it) and the alternative.
- `screens/PeopleOverview.jsx:384` button "HR cases" opens "Help desk".
- `screens/Approvals.jsx:500` unmapped field keys shown raw ("costCenter").
- `workforce/OfferDrawer.jsx:97` "Position" holds a designation.
- `screens/Registers.jsx:116` "Establishment" vs "Work site".
- `organization/StructurePage.jsx:295` "People are filed under {noun} once there is one to file them under." on 13 lists.
- `workforce/EmployeeRecord.jsx:402` "Login" under a "CLOR sign-in" heading.

### Attendance (`apps/attendance`)
- `portal/EmployeePortal.jsx:290` "Could not sign in." on the portal's first screen.
- `screens/PhonePunches.jsx:291` unmapped refusal code and raw server text.
- `screens/AttendanceDevices.jsx:769` "Load last payload"; `:453` POST/JSON; `:1278` driver/API/pull.
- `screens/AttendanceDevices.jsx:1175` "Last pull failed: {raw error}".
- `screens/AttendanceToday.jsx:17` reader status "Late checking in" reads as a late employee.
- `screens/Geofences.jsx:90` page "Punch areas", button "New site".
- `screens/MonthSummary.jsx:44` confirm "Close 2026-11?".
- `screens/OvertimeRequests.jsx:96` toast "…overtime on 2026-11-14 is approved."
- `screens/MonthClose.jsx:170` "Snapshot 2 kept for Payroll."
- `screens/OvertimeRequests.jsx:164` empty state "None".

### Payroll (`apps/payroll/src`)
- `screens/PayRuns.jsx:778` "Approving fixes these figures" reads as "repairs".
- `screens/PayRuns.jsx:759` send-back uses `window.prompt`; empty reason accepted.
- `screens/PayrollPeriods.jsx:129` raw server text is the whole body of a confirm.
- `screens/FinalSettlements.jsx:352` "Mark paid" when the employee owes the company.
- `screens/FinalSettlements.jsx:293`, `BankChanges.jsx:80` "Not done.".
- `screens/PayrollOverview.jsx:156` points to a Settings path that does not exist.
- `components/round66.jsx:36` "{name} salary is held" (missing possessive).
- `screens/SalaryStructures.jsx:664` "40% of MONTHLY_CTC".
- `screens/PayrollReports.jsx:646` columns "People / Employees / Employer" (count beside amount).
- `screens/SalaryRevisions.jsx:213` "No to decide revisions".

### Ops (`packages/ops`, `console/web`)
- `StatusPage.jsx:224`, `SavedReplies.jsx:90` native `window.confirm` (OK/Cancel) for public changes.
- `Payments.jsx:710` "Subscription past_due".
- `Customers.jsx:534` "Row-level security… organization's ID".
- `OpsConsole.jsx:201` menu "Entitlement denials" → "Access refused".
- `Tickets.jsx:83` "Owner" means three things in Ops.
- `Pricing.jsx:661` "Done" does not say nothing is saved yet.
- `Deals.jsx:261` CSV writes ISO dates and "month"/"year".
- `Alerts.jsx:48` "0 open · 0 urgent · 0 not acknowledged".
- `Tickets.jsx:71` "…waiting on CLOR. Nice."
- `console/web/src/Pulls.jsx:78` "Merge" runs with no confirm.

### Server and emails (`server/src`)
- `constants/emailTemplates.ts:39`, `:54` password and email-confirm subjects do not name CLOR.
- `routes/auth.ts:846` reset email opens "Hello name@company.in,".
- Expiry line written six ways across templates; no consistent sign-off.
- `services/people/approvals/engine.ts:848`, `desk.ts:328`, `outsideAccess.ts:29` ISO dates in bell and email.
- `documentReminders.ts:142` "(1 days)", "(0 days)".
- `routes/account.ts:262` "Role must be OWNER, ADMIN, BILLING_ADMIN or MEMBER."
- `routes/portal.ts:1270` and similar: "kind must be OVERTIME or COMP_OFF."
- `routes/people.ts:483` camelCase keys in a message.
- `routes/governance.ts:605` "The accounting app".
- `routes/leave.ts:1509` "Only 1 days … are left".

## Not covered

- Books, and screens People and Attendance load from `packages/ui` beyond what the shell audit read.
- `packages/shell/helpGuides.js` (939 lines), legal documents, `i18n/hi.js`.
- Server-written text shown as-is in Payroll run checks and Ops alerts; Ops-edited email overrides.
- Agents read most files through a string extract; multi-line JSX sentences may have been missed.
