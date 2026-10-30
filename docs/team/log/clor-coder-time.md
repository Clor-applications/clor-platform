# clor-coder-time — work log

## 2026-10-30 10:40 IST — People / Time — PR #74 review fixes
- Did: encashment amount hidden from anyone without Payroll adjustments VIEW; wages by Payroll's gratuity mark (basic+DA) or the salary structure's fixed components (gross), rounded once, open month of today, the person's branch; stand-ins decide overtime in the bulk route and decideOvertime (and see it in the employee app); manager-only chain refuses HR approval while a manager is active; Home headline counts the whole inbox; employee-app department audience by id; central government calendars split into Delhi 2027 (17, Annexure I) and outside Delhi (14 compulsory, para 2), checked against the scanned DoPT memo (Ram Navami 15 Apr 2027); holiday import race answers 409; content radii 12px.
- Evidence: server timeDepth 19 passed; attendance, bulkDecideAndAudit, payrollFromAttendance, selfService, timeLeave, hrInbox, portalEmployeeApp, peopleWorkspace, hrWorkflowFixes, routeManifest 114 passed. Web 21 files 86 passed + PeopleOverview, HolidayDrawers. Screens home-headline-1440, calendar-central-1440.
- Next: back to review.
- Blocked on: nothing.

## 2026-10-30 07:30 IST — People / Time — batch 5, time depth (gaps 17–20, 22, phone top bar)
- Did: field punches and overtime in the one Approvals inbox (new kinds PUNCH, OVERTIME, bulk routes, Home to-dos), phone punch on People's My attendance, web employee app manager list shows punches and overtime, plus month review (confirm or dispute) and overtime requests. Holidays per branch with built-in calendars (national 2027 from DoPT OM 12/2/2023-JCA; Karnataka, Maharashtra, Telangana own day only, the states' 2027 lists not published yet). Leave paid out valued on the policy's pay base (basic, basic+DA or gross ÷ 26 or 30, last approved payslip) and sent to Payroll as a draft earning. Announcement audience (everyone, departments, branches, locations, people) enforced in the employee app and People. Per-person days override and restricted-holiday picks view. Top bar fits below 390 px.
- Evidence: server `timeDepth.test.ts` 17 passed; hrInbox, fieldPunchReview, peopleWorkspace, routeManifest, attendanceHolidayMove, hrWorkflowFixes, portalEmployeeApp, auditCoverage, portal, leaveRules, timeLeave, modules, notifications all passed (148 tests). Web: timeOff, people, attendance, payroll adjustments, shell 86 passed. Screens in `docs/people/design-v1/evidence/time-depth/`.
- Next: hand to review; state 2027 lists to be imported when the states publish them.
- Blocked on: nothing.
