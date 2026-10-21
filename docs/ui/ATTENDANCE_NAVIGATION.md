# Attendance navigation (21 Oct 2026)

Navigation-only reorganisation of Clor Attendance: names, groups and order.
No screen, API, permission or data changed. Every screen key (`?open=<key>`)
that existed before still opens the same screen, and highlights its new place.

Source of truth: `apps/attendance/manifest.jsx` (`modules`, `nav`, `screens`).
Guarded by `test/split-navigation.test.js`.

## Primary sidebar

| # | Module | Rail key (unchanged) |
|---|---|---|
| 1 | Overview | `today` |
| 2 | People | `personnel` |
| 3 | Readers | `device` |
| 4 | Attendance | `attendance` |
| 5 | Reports | `reports` (new) |
| 6 | Settings | `system` |
| – | Me (self-service, at the foot of the rail) | `me` |

**Me** is kept because employees without admin rights use it for their own
days and leave; removing it would remove that access.

## Secondary navigation

**Overview:** Dashboard

**People**
- Directory: Employees, Contractors
- Employment Changes: Resignations, Transfers
- Organization: Departments, Designations, Locations & Sites
- Access: Employee Portal Access

**Readers**
- Monitoring: Reader Health, Sync Monitoring, Reader Logs
- Devices: All Readers, Device Enrollment
- Punch Data: Punch Transactions, Unmatched Punches, Employee ID Mapping
- Other Punch Sources: Mobile Punches

**Attendance**
- Daily Operations: Attendance Records, Exceptions, Corrections
- Scheduling: Schedule Calendar, Shifts, Shift Assignments, Department Schedules, Temporary Schedules, Shift Rotations
- Leave: Leave Requests, Leave Balances
- Time Management: Overtime & Comp-Off
- Period Closing: Employee Confirmations, Month Close

**Reports**
- Overview: Attendance Insights
- Attendance: Daily Attendance Register, Monthly Attendance Summary, Attendance Calendar, Late Arrivals & Early Exits, Absence Report
- Workforce: Department Attendance, Employee Attendance History
- Time & Leave: Overtime Report, Leave Report
- Devices: Reader Activity
- All Reports: Report Catalogue

**Settings**
- Organization: Attendance Setup, Work Sites, Work Site Check
- Work Policy: Attendance Policy, Weekly Off Policy, Overtime Policy, Leave Policy, Holidays
- Integrations: Integrations
- Access & Security: Single Sign-On
- Data Management: Import Data, Export Data
- Privacy: Data Protection, Data Requests

**Me:** My Attendance, My Leave

## Mapping

| Existing name | Route (`?open=`) | New name | New group | New module | Status |
|---|---|---|---|---|---|
| Today | `today` | Dashboard | – | Overview | Renamed |
| Employees | `employees` | Employees | Directory | People | Regrouped |
| Contractors | `contractors` | Contractors | Directory | People | Regrouped |
| Resignations | `resignations` | Resignations | Employment Changes | People | Regrouped |
| Transfer | `transfer` | Transfers | Employment Changes | People | Renamed |
| Departments | `departments` | Departments | Organization | People | Kept |
| Positions | `positions` | Designations | Organization | People | Renamed |
| Areas | `areas` | Locations & Sites | Organization | People | Renamed |
| Portal access | `portalAccess` | Employee Portal Access | Access | People | Moved from System |
| Reader health | `readerHealth` | Reader Health | Monitoring | Readers | Renamed |
| Sync status | `readerSync` | Sync Monitoring | Monitoring | Readers | Renamed |
| Reader logs | `deviceLogs` | Reader Logs | Monitoring | Readers | Renamed |
| Readers | `readers` | All Readers | Devices | Readers | Renamed |
| Enrolments | `enrolments` | Device Enrollment | Devices | Readers | Renamed |
| Transactions | `transactions` | Punch Transactions | Punch Data | Readers | Renamed |
| Unmatched punches | `unmatched` | Unmatched Punches | Punch Data | Readers | Renamed |
| ID mapping | `idMapping` | Employee ID Mapping | Punch Data | Readers | Renamed |
| Phone punches | `phonePunches` | Mobile Punches | Other Punch Sources | Readers | Renamed |
| Records | `records` | Attendance Records | Daily Operations | Attendance | Renamed |
| Exceptions | `exceptions` | Exceptions | Daily Operations | Attendance | Kept |
| Corrections | `requests` | Corrections | Daily Operations | Attendance | Kept |
| Schedule calendar | `scheduleCalendar` | Schedule Calendar | Scheduling | Attendance | Renamed |
| Shifts | `shifts` | Shifts | Scheduling | Attendance | Kept |
| Employee schedule | `shiftAssignments` | Shift Assignments | Scheduling | Attendance | Renamed |
| Department schedule | `departmentSchedule` | Department Schedules | Scheduling | Attendance | Renamed |
| Temporary schedule | `temporarySchedule` | Temporary Schedules | Scheduling | Attendance | Renamed |
| Rotations | `rotations` | Shift Rotations | Scheduling | Attendance | Renamed |
| Leave requests | `leaveRequests` | Leave Requests | Leave | Attendance | Renamed |
| Leave balances | `leaveBalances` | Leave Balances | Leave | Attendance | Moved from Leave setup |
| Overtime & comp-off | `overtime` | Overtime & Comp-Off | Time Management | Attendance | Renamed |
| Employee confirmations | `confirmations` | Employee Confirmations | Period Closing | Attendance | Moved from Reports group |
| Month close | `monthClose` | Month Close | Period Closing | Attendance | Moved from Reports group |
| Register | `register` | Daily Attendance Register | Attendance | Reports | Moved to Reports |
| Month summary | `summary` | Monthly Attendance Summary | Attendance | Reports | Moved to Reports |
| Calendar | `calendar` | Attendance Calendar | Attendance | Reports | Moved to Reports |
| Reports & registers | `reports` | Report Catalogue | All Reports | Reports | Moved to Reports |
| (new) | `reportInsights` | Attendance Insights | Overview | Reports | New: monthly trends, departments, most late/absent |
| (catalogue report) | `reportLateEarly` | Late Arrivals & Early Exits | Attendance | Reports | New link to existing report |
| (catalogue report) | `reportAbsent` | Absence Report | Attendance | Reports | New link to existing report |
| (catalogue report) | `reportDepartment` | Department Attendance | Workforce | Reports | New link to existing report |
| (catalogue report: Time card) | `reportTimecard` | Employee Attendance History | Workforce | Reports | New link to existing report |
| (catalogue report) | `reportOvertime` | Overtime Report | Time & Leave | Reports | New link to existing report |
| (catalogue report) | `reportLeave` | Leave Report | Time & Leave | Reports | New link to existing report |
| (catalogue report: Punches per reader) | `reportReaderPunches` | Reader Activity | Devices | Reports | New link to existing report |
| Setup | `setup` | Attendance Setup | Organization | Settings | Renamed |
| Work sites | `sites` | Work Sites | Organization | Settings | Moved from Employee portal |
| Site check | `siteCheck` | Work Site Check | Organization | Settings | Renamed |
| Holidays | `holidays` | Holidays | Work Policy | Settings | Moved from Attendance |
| Attendance rules | `rules` | Attendance Policy | Work Policy | Settings | Moved from Attendance |
| (new view) | `weeklyOffPolicy` | Weekly Off Policy | Work Policy | Settings | New screen over each shift's weekly offs (NV-03) |
| (new view) | `overtimePolicy` | Overtime Policy | Work Policy | Settings | New screen over shift overtime starts and the overtime rules (NV-04) |
| Leave types | `leaveTypes` | Leave Policy | Work Policy | Settings | Moved from Attendance |
| Integrations | `integrations` | Integrations | Integrations | Settings | Kept |
| Single sign-on | `sso` | Single Sign-On | Access & Security | Settings | Renamed |
| Import | `dataImport` | Import Data | Data Management | Settings | Renamed |
| Export | `dataExport` | Export Data | Data Management | Settings | Renamed |
| Data protection | `dataProtection` | Data Protection | Privacy | Settings | Moved from Personnel |
| Data requests | `dataRequests` | Data Requests | Privacy | Settings | Moved from Personnel |
| My attendance | `me` | My Attendance | Self-Service | Me | Renamed |
| My leave | `myLeave` | My Leave | Self-Service | Me | Renamed |

A named report is the Report Catalogue opened on that report
(`initialReport`), so there is still one catalogue and one way to run a report.

## Covered inside an existing screen (no separate menu entry, to avoid duplicates)

| Proposed item | Where it already lives |
|---|---|
| Shift Policies | Set on each shift (Shifts) |
| Punch Policies | Attendance Policies ("Readers and phone punches") |
| API Credentials, Webhooks | Integrations (API keys, webhooks sections) |
| API / Middleware, Local Connectors (punch sources) | Integrations (on-site connectors) |
| File Imports (punch source) | Import Data |
| Employee Portal Settings | Employee Portal Access |
| Data Retention | Data Protection (retention table) |
| Scheduled Exports | Each report's "Scheduled" section in the Report Catalogue |
| Connect a Reader | "Add reader" on All Readers |
| Location Attendance | The Location filter on every report and on Attendance Insights |
| Attendance Exceptions (report), Synchronization Failures (report) | Exceptions screen; Sync Monitoring and Reader Health |

## Planned — not implemented

Pending Actions, Activity, Device Commands (screen), Approvals (combined
inbox), Leave Calendar, Timesheets, Shift Report, Punch Reconciliation,
Saved Reports, Roles & Permissions (in Attendance), Audit Logs. None has a menu entry or a placeholder page.

## Page titles

Each Attendance screen's own title now uses its menu name, in the platform's
sentence case for headings (Attendance records, Sync monitoring, Attendance
policies, ...). Screens shared with People or Accounting (Employees,
Departments, Designations, Locations & Sites, Single Sign-On) keep their
titles, so those apps do not change.
