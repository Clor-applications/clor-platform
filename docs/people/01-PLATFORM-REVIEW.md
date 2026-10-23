# People: platform review before the build

Reviewed: 24 Oct 2026, commit `0d054e5` on `claude/people-build-03ca03` (cut from the tenant-security branch).

**Scope (owner, 24 Oct 2026):** People is the main app for this build. Attendance and the modules shared across apps (leave, holidays, portal, imports) are out of scope here and will be fixed separately. Where People touches them, this pack records only the interface People needs, never a change inside them.
Method: read the People, Attendance, Payroll and platform code; read every earlier People document; ran the People-related server tests. Every claim below has a file reference or an evidence ID (`PEV-*`, listed in [09-EVIDENCE-REGISTER.md](09-EVIDENCE-REGISTER.md)).

This document answers one question: **what is already true, so the plan builds on it instead of rebuilding it?**

---

## 1. Summary in ten lines

1. People already has a working core: one employee record, a directory, a six-tab profile, org lists, a reporting line, change history, joining and leaving checklists, documents with expiry reminders, a compliance calendar, a data-health check, privacy requests, a breach register and anonymisation.
2. There is **one Employee table** for the whole product (`server/prisma/people/schema.prisma:36`). Attendance lives in the same database. Payroll holds `employeeId` as a plain id. This is the right shape; the plan keeps it.
3. Leave is HR's (founder, 22 Oct 2026). One leave engine serves People and Attendance (`server/src/routes/leave.ts`, `services/attendance/leaveBalances.ts`).
4. Nine "registers" (jobs, candidates, goals, training, announcements, events, HR cases, assets, benefits) share one generic table with a JSON `details` field (`PeopleRecord`, schema:1806). They are lists, not features.
5. **Missing completely:** custom fields and forms, a general approval engine (delegation, escalation, due times), policy library with acknowledgements, letter templates, confidential (POSH) cases, legal entities and establishments, employment episodes for rehires, real effective dating, and a change log with before and after values.
6. **People cannot yet explain a decision.** Changes are recorded as labels without before/after values, effective dates are not enforced, and nothing links a change to the policy version behind it. This is the gap "Why this happened" (Trace) must close inside People first. (The attendance-to-payroll link is parked for the cross-app fix.)
7. Seven code paths create employees, with different side effects (section 4). Payroll's path skips People's history, checklists and reader push.
8. Events are unversioned webhooks sent after the write, not a transactional outbox (`services/attendance/webhooks.ts:234-242`).
9. Twelve defects and risks found (section 5). Two touch sensitive data: any role with `PEOPLE::Employees::VIEW`, including the Attendance Manager preset, can open every employee document; anonymisation leaves personal data in registers and notes.
10. Baseline tests: 137 People-related tests, all pass when the database has free connections (`PEV-001`, `PEV-002`).

---

## 2. Test baseline

| Run | Files | Tests | Result | Evidence |
|---|---|---|---|---|
| 20 People-related suites, parallel | 20 | 137 | 131 pass, 6 fail | `PEV-001` |
| The 3 failing files again, one at a time | 3 | 40 | 40 pass | `PEV-002` |

All six failures were `Too many database connections opened: FATAL: remaining connection slots are reserved` (local Postgres shared with other sessions running tests). None is a code defect. Suites run: people, peopleHire, peopleHome, peopleWorkspace, checklists, dataHealth, dataExport, anonymiseEmployee, hrConnections, hrLeave, hrWorkflowFixes, leave, leaveAccrual, leavePeriod, payrollEmployeeDelete, payrollFromLeave, portalHrCases, tenantIsolation, tenantBackstop, tenantScope.

**Not tested anywhere today:** document access by role, effective dating, rehire episodes, import field loss, breach email selection, any browser end-to-end journey (`docs/audit-report-2026-10-20.md`: zero browser e2e tests).

---

## 3. What exists, area by area

Status: **Built** = works end to end. **Part** = some of it. **None** = not started.

Shorthand: `P` = `server/src/routes/people.ts`, `E` = `packages/ui/src/personnel/Employees.jsx`, `S` = `server/prisma/people/schema.prisma`, `svc/` = `server/src/services/people/`.

| Area | Status | What is there | Evidence |
|---|---|---|---|
| Employee record and directory | Built | Cards or list, search, status tabs, filters, headcount cards, CSV/XLSX export. **Screen loads at most 500 people, no paging.** | E:111-399, E:150; P:306-352 |
| Add / edit employee | Built | Basics, placement, employment, attendance, personal sections. Server checks every master id and reporting loops. | E:870-1111; P:53-164 |
| Bulk import | Part | CSV up to 1000 rows, dry run, per-row errors, creates missing masters. Create only, no update. Skips checklists and reader push. Drops phone (sends `workPhone`, server reads `phone`). | P:655-760; `apps/attendance/src/screens/DataImport.jsx:47` |
| Employee profile | Built | Drawer: About, Work, History, Checklist, Notes, Documents. Masked PAN/bank read from Payroll. | E:410-652; P:229-255 |
| Change history and rehire | Part | Append-only `EmploymentEvent`, 13 tracked fields, effective date stored as a label only. No future-dated changes, no "as of" view. Rehire reuses the same row; Rehire button sends no rejoin date; a rejoin date overwrites the first joining date. | `svc/employmentHistory.ts:20-186`; E:453; `server/src/routes/personnel.ts:222` |
| Org lists | Part | Departments (nested), designations, job roles, employee types, work types, locations, business units, grades, cost centres. **No legal entity or establishment.** Cost centres exist twice (People table and Payroll's accounting `OrgMaster`). | P:777-882; S:171-253, 1826-1874; `server/prisma/payroll/schema.prisma:78-79` |
| Reporting line and org chart | Part | One manager per person, loop check, collapsible outline. No dotted lines, no positions, no history. | P:146-164; `apps/people/src/screens/OrgChart.jsx` |
| Joining and leaving checklists | Built | Company templates (owner role, due days), started automatically on create, leave, rehire and hire. Owners are roles, not named people. | `svc/checklists.ts:27-153` |
| Probation | Part | `probationEndDate`, a Home reminder, a checklist item. No confirm or extend action. | `svc/home.ts:64-65` |
| Transfers and promotions | Part | Edit, or bulk transfer (Attendance screen only), both recorded in history. No request or approval, no pay link. | `personnel.ts:236-269` |
| Leaving | Part | Last day, 6 leaving types, reason; reader access removed; leaving checklist; webhook. Settlement is Payroll's. No resignation request, no notice workflow. | `personnel.ts:170-203` |
| Documents | Part | Upload up to 5 MB (stored in the database), 6 kinds, expiry, employee-visible flag, byte-checked type, daily expiry reminders. **No classification, versions, acknowledgement or letter templates.** | P:956-1033; `svc/documentReminders.ts:43-79` |
| Policies and acknowledgements | None | Only the privacy notice has a read receipt. | `server/src/routes/portal.ts:893-912` |
| Requests and approvals | Part | Leave and attendance corrections only: HR, Manager, or Manager then HR, with a check against approving your own record. No general engine, delegation, due times or escalation. | `server/src/services/attendance/approvalChain.ts`; `server/src/services/makerChecker.ts` |
| Help desk (HR cases) | Part | Register with category, priority, due date. Employee can raise one from the portal (max 10 open). No assignee, conversation, attachments or due-time tracking. | `svc/workspace.ts:16`; `portal.ts:354-383` |
| Confidential cases (POSH) | None | Only a compliance-calendar deadline. | `svc/compliance.ts:78,125` |
| Compliance calendar | Built | PF, ESIC, TDS, 24Q, Form 16, PT by state, bonus, POSH deadlines worked out from company data, plus custom ones; owner, reference, evidence file. Not state-aware beyond PT. | `svc/compliance.ts`; P:562-595 |
| Privacy | Part | Data requests (access, correction, erasure, nominee, grievance, consent withdrawal), breach register with 72-hour tracking, anonymisation. Retention only for selfies, locations and reader events. | P:1039-1110; `server/src/routes/dataProtection.ts:156-225` |
| Data health | Built | Duplicates, shared phone/email, missing joining date/code/department, reader id, unmatched punches, negative leave, Payroll PAN/UAN/ESIC/bank/PT/salary gaps. | `svc/dataHealth.ts` |
| Reports | Part | Current workforce snapshot and export, joiners, leavers, birthdays. No "as of a date" headcount, no attrition. | `apps/people/src/screens/PeopleReports.jsx` |
| Custom fields and forms | None | Register fields are fixed lists. | `svc/workspace.ts:9-17` |
| Workflows | None | Only fixed triggers (checklists, webhooks). | n/a |
| Employee self-service | Part | Portal inside Attendance: leave, corrections, documents, cases, announcements, privacy, payslips, tax, manager approvals. **No profile self-edit.** | `server/src/routes/portal.ts` |
| Registers (9 kinds) | Part | One list-and-form screen per kind, per-kind permission, module switch, version check on save, audit. "Hire" turns a candidate into an employee. | `server/src/routes/peopleWorkspace.ts`; `apps/people/src/screens/workspaceConfig.js` |
| Notifications | Part | Joined, left, document expiring, HR case, data request, breach (bell and email). | `svc/documentReminders.ts` |
| Change audit | Part | Generic middleware logs the redacted request body, not before and after values. History writes are outside the change's transaction and swallow errors. | `server/src/middleware/auditMutations.ts:16,61-71` |

---

## 4. Who owns what today

| Data or job | Owner in code today | Notes and evidence |
|---|---|---|
| Employee identity, status, placement | People (`Employee`, schema:36) | One table. Codes unique per company (schema:156). |
| Sign-in link to a person | `Employee.userId`, set by matching email | No unique constraint (`services/attendance/days.ts:197-212`). |
| Company, account, users, roles, subscription | Platform (`server/prisma/platform/schema.prisma`: Account :42, Org :60, User :149, Subscription :818) | ADR-010: company admin is a platform workspace. |
| Punches, shifts, processed days, corrections, month close | Attendance (tables in the people database) | `services/attendance/*`. Month close writes `AttendanceMonthLock` and a versioned `AttendanceMonthSnapshot` (`services/attendance/readiness.ts:115-121`). |
| Leave types, credits, ledger, requests | One engine, used by People and Attendance | `routes/leave.ts`; screens in both apps call `/attendance/leave`. |
| Salary, payslips, deductions, statutory pay, settlement | Payroll (`EmployeePayrollProfile`, `SalarySlip`, `FinalSettlement`) | Bank and PAN live in Payroll; People reads them masked. |
| Journals | Accounting, posted only through `services/payroll/accounting/client.ts` | Journal first, then receipt; retry reuses an orphaned journal. |
| Projects and timesheets | **Does not exist** | Only a "coming" tile (`server/src/constants/appCatalog.ts:31`). |

**Seven ways an employee gets created:**

| Path | File | History | Checklist | Reader push | Notification |
|---|---|---|---|---|---|
| People form | `routes/people.ts:393` | yes | yes | yes | yes |
| Import | `routes/people.ts:728` | yes | **no** | **no** | no |
| Hire a candidate | `routes/peopleWorkspace.ts:91` | yes | yes | no | no |
| Payroll form | `routes/payrollEmployees.ts:258` | **no** | **no** | **no** | **no** |
| Public API | `routes/publicApi.ts:190` | varies | no | no | webhook |
| Unknown person at a reader | `services/attendance/readerSync.ts:78` | no | no | n/a | no |
| Pull from greytHR / Keka / Zoho | `services/hr/sync.ts:135` | no | no | no | no |

Payroll's create also writes the person and the payroll profile in two databases without one transaction, and its update writes department and designation text without the matching ids (`payrollEmployees.ts:319-333`).

**Parked for the cross-app fix (not in this build):** the items below were seen while tracing ownership. They are recorded so they are not lost, and are not People work.

**Attendance to payroll today:** closing a month locks it and saves a snapshot. Payroll's import reads live figures, does not require the month to be closed, and does not store which snapshot it used. Reopening a month does not check whether payroll already used it (`routes/attendance.ts:759`). `AttendanceMonthConfirmation` (the employee's own confirmation) is never read by payroll.

**Events today:** 17 unversioned webhook names (`services/attendance/webhooks.ts:26-44`), signed, retried at 1, 5, 30, 120 and 720 minutes. Sent after the write, so a crash between write and send loses the event. `HrOutbox` is a real outbox, but for punches only.

---

## 5. Defects and risks found

Severity: **High** = wrong data reaches the wrong person, or loses legal history. **Medium** = wrong or lost data, no exposure. **Low** = friction.

| ID | Severity | Finding | Evidence | Fix lives in |
|---|---|---|---|---|
| R-01 | High | Any role with `PEOPLE::Employees::VIEW` can open every employee document, including ones hidden from the employee. The Attendance Manager preset has that permission. No document classification exists. | `server/src/routes/people.ts:1019-1024`; `server/src/constants/permissionCatalog.ts:679` | Checklist PC-DOC-02 |
| R-02 | High | Anonymisation skips `PeopleRecord` (candidate email and phone, HR cases, goals), checklist notes, data-request text and history notes. | `server/src/services/anonymiseEmployee.ts:63-112` | PC-PRV-04 |
| R-03 | High | Rehire: button sends no rejoin date; a rejoin date overwrites the original joining date. Service history for gratuity is lost. | E:453; `personnel.ts:222` | PC-LIFE-06 |
| R-04 | Medium | Effective dates are labels. A change dated next month applies today. | `svc/employmentHistory.ts`; P:433-448 | PC-CORE-04 |
| R-06 | Medium | Payroll's employee create skips history, checklists, reader push and notifications; its update can split department text from department id. | `routes/payrollEmployees.ts:258,319-333` | PC-CORE-06 |
| R-07 | Medium | Home-address state is tracked in history as "Work state" with a Professional Tax note. | `svc/employmentHistory.ts:25,77` | PC-CORE-05 |
| R-09 | Medium | Breach emails go to `personalEmail` or `workEmail`; the form saves personal email in `email`, so some people get nothing. | E:1064 | PC-PRV-05 |
| R-10 | Medium | Employee edits are audited as a redacted request body, not before and after. History writes are outside the change's transaction. | `server/src/middleware/auditMutations.ts:61-71` | PC-CORE-03 |
| R-11 | Low | Directory loads at most 500 people; "Reports to" picker lists only the current status tab. | E:150, E:388, E:1012 | PC-CORE-07 |
| R-12 | Low | Permission gaps: HR Manager preset cannot open People's own leave screens (they need `ATTENDANCE::Leave Requests`); Data Protection gated by `ATTENDANCE::Employee Portal`; checklists, compliance and data health ride on `PEOPLE::Employees`. | `permissionCatalog.ts:630-652` | PC-ACC-02 |

**Parked (cross-app, fixed separately):**

| ID | Severity | Finding | Evidence | Fix lives in |
|---|---|---|---|---|
| R-05 | Medium | Payroll imports live attendance and records no snapshot version. | `routes/payrollRuns.ts:400,442-451` | Cross-app fix (Trace in People reads whatever Payroll records) |
| R-08 | Medium | Import drops phone and skips checklist and reader push. | `apps/attendance/src/screens/DataImport.jsx:47`; P:659 | Cross-app fix (shared import screen) |

Earlier lists that still apply (not re-verified line by line in this review): tracker gaps G1-G14 (`docs/people-app-tracker-2026-10-23.md`); no format checks for PAN, UAN, ESIC, IFSC; PT, LWF and Shops & Establishments not state-aware; payroll PAN and bank numbers stored in plain text (`docs/compliance/COMPLIANCE_AUDIT.md`); A-50/A-51 (staff writes without audit rows) and A-35 (fail-closed row-level security, in progress on the main branch).

---

## 6. Platform pieces the build will reuse

See section 6 notes in [03-IMPLEMENTATION-CONTRACT.md](03-IMPLEMENTATION-CONTRACT.md) for how each is used.

| Piece | What exists | Gap for People | Evidence |
|---|---|---|---|
| Tenant scope | Every Prisma client sets `clor.org_id` per transaction. `outsideTenant(reason, fn)` for cross-company reads, `enterTenant(orgId)` for token routes. `peopleWrite()` adds a per-company advisory lock. | Row-level security still lets an unset company through (A-35, being fixed on the main branch). New People tables must use the fail-closed policy shape. | `server/src/utils/tenantScope.ts:70-173`; `server/src/utils/peoplePrisma.ts:39-52` |
| Sign-in and company context | `requireAuth` (JWT, live session, 5 s cache), `requireTenantContext` (company from header, membership, branch, admin 2FA). | None for People. | `server/src/middleware/auth.ts:44`; `server/src/middleware/tenantContext.ts:35` |
| Permissions | `MODULE::Resource::ACTION`, actions VIEW, CREATE, EDIT, DELETE, APPROVE, EXPORT. Presets, guards against granting more than you hold. Field levels exist (`filterFieldsByLevel`) but only invoices use them. | **No field restrictions on People resources. No department, team or manager scope on admin routes** (manager scope only in the portal). | `server/src/constants/permissionCatalog.ts:197-221,460`; `server/src/services/access.ts:155,171,214` |
| Step-up and 2FA | 15-minute step-up token; TOTP; admin 2FA policy. | Reuse for revealing masked identifiers and for confidential cases. | `server/src/services/stepUp.ts`; `server/src/services/totp.ts` |
| Audit | `recordAudit` to platform `AuditLog` (entity, action, message, metadata JSON, user). Middleware logs every People write with a redacted body. | No before/after columns, no correlation id, no database guard against edits or deletes. | `server/src/services/auditTrail.ts:12`; `server/prisma/platform/schema.prisma:352-372` |
| Approvals | Amount-threshold rules for invoices; separation of duties (`makerChecker`); fixed leave chain. | **No general engine; no delegation, due time or escalation.** | `server/src/services/approvals.ts`; `server/src/services/makerChecker.ts:54,81` |
| Notifications | Bell (permission-routed, per-kind mute, de-duplicated) and email through an outbox with retries; code templates with merge fields. | No WhatsApp, SMS or push. No company-edited templates. | `server/src/services/notifications.ts`; `server/src/services/mailer.ts`; `server/src/constants/emailTemplates.ts:167-216` |
| Files | Bytes in Postgres, 5 MB cap, type checked by bytes, served inline. | No object storage, no expiring links, no malware scan, no versions. | `server/src/services/fileType.ts:28-44`; `server/prisma/people/schema.prisma:1265` |
| Background jobs | Database lease with fencing and heartbeat; 13 `setInterval` schedulers in the API process. | No queue. Worker registry and tenant scoping of workers marked PARTIAL. | `server/src/services/jobLease.ts:135`; `server/src/index.ts:51-71`; `tenant-platform-upgrade-2026-10-23/NON_HTTP_WORKERS.md` |
| Search | Case-insensitive `contains`. Command palette in the shell. | No full-text search, no pgvector in the app database. | `server/src/routes/people.ts:328-334` |
| AI | One role suggester behind `TYPESAFE_API_KEY`. | No AI gateway, no retrieval. Local Docker has `pgvector` and `ollama` containers, not wired to CLOR. | `server/src/services/roleSuggestion.ts` |
| Shell | Manifest per app: modules, groups, nav items with `permission`, `feature`, `parent`; gated by subscription, permission and module switch; `WriteGuard` makes screens read-only. | None. | `packages/shell/registry.js:34`; `packages/shell/Shell.jsx:440-442,893` |
| UI parts | `PageHeader`, `StatusPill`, `EmptyState`, `Drawer`, `Modal`, `FormSection`, list parts (`DocumentListShell`, `StatusTabs`, `Pagination`, `ExportButton`), `MasterFormPage`, `DocumentForm`, `SettingsHub`. | The five primitives in `DESIGN.md` do not exist under those names. **No timeline, comparison, evidence drawer or conversation component.** | `packages/ui/src/components/ui/Primitives.jsx`; `packages/ui/src/components/list/` |
| Employee app | Native Android app (Kotlin) for punch, leave, approvals, payslips, documents, privacy, all on `/api/portal`. Capacitor wrappers for accounting, attendance, payroll. | No People screens in the employee app (no profile, requests, policies). | `native/attendance-android`; `server/src/routes/portal.ts:165-194` |
| Tests | Server: 184 files on real Postgres, one database per run, as the non-superuser `clor_app`. Web: jsdom; design-rule tests read the source. | **No browser end-to-end tests.** `apps/people` has no tests of its own. | `server/vitest.config.ts:39`; `test/design-rules.test.js` |

---

## 7. Design rules that constrain People

From `DESIGN.md` (read in full for this review):

- Product chrome is graphite. "One accent, and it means one thing." Module icons, navigation, buttons and filters use the zinc ramp. Money colours (in, out, attention) are never the accent.
- Five primitives: `PageShell`, `DataTable`, `DocumentView`, `EntryForm`, `SettingsPanel`. A module chooses archetypes; it does not invent layout.
- Two radii (8px clickable, 12px content, pill for pills). Tokens only. One primary action per screen, top right. Status = pill with words, never colour alone. No card in a card.

**What the code actually does:** People sets `palette: 'blaze'` (`apps/people/manifest.jsx:182`), the shared Blaze palette that Attendance also uses: orange `--brand` (235 94 0) with a graphite primary button (`packages/ui/src/index.css:7170-7230`). An older People coral layer (`[data-app='people']`, `index.css:6430-6470`) is still in the file and is overridden. `DESIGN.md` does not mention per-app palettes at all, so the document and the code disagree today.

**Typography and layout (owner, 24 Oct 2026: "keep the same layout as Accounting").** People carries a "second pass" override block (`packages/ui/src/index.css:6535-6785`, 59 `[data-app='people']` selectors, 26 `!important`) that departs from the base scale Accounting uses:

| Element | Accounting (base, `DESIGN.md`) | People override today | Evidence |
|---|---|---|---|
| Page title | 28 / 36, weight 700 | 22px, weight 650 | `index.css:2886-2893` vs `:6618-6622` |
| Section title | 16 / 24, weight 700 | 15px, weight 600 | `:2895-2899` vs `:6641-6645` |
| Body in `main` | 14 / 20 inherited | forced `0.875rem` on `main` | `:6604-6606` |
| Control radius | `--radius-input` / `--radius-btn` (8px) | 6px on inputs and buttons | `:6667-6670`, `:6688-6690` |
| Page heading | shared `.ui-page-heading` band | band removed, radius 0, entity mark hidden | `:6610-6630` |
| Cards | shared tokens | own shadow `0 1px 2px rgb(16 24 40 / .04)` | `:6633-6636` |
| Icons | Lucide mono (Accounting) | Fluent full-colour (`iconSet: 'color'`) | `apps/people/manifest.jsx:183` |

Face is Inter in both (no second family). Decision for this build: **People uses Accounting's layout, type scale, radii and shadows; the override block is removed, not patched** (checklist PC-UI-01). Icons and palette are part of D-01.

**Conflict with the brief:** the brief proposes Burnished Rose (`#A45761`) for People, Acid Chartreuse for Attendance and Deep Aubergine for Payroll. None of these is in the code, and `DESIGN.md` says chrome stays graphite. This needs an explicit owner decision; see D-01 in [08-DECISIONS-AND-RISKS.md](08-DECISIONS-AND-RISKS.md). Until decided, People keeps Blaze.

---

## 8. What this means for the plan

1. **Fix before building on top:** R-01, R-02, R-03, R-04, R-06 and R-10 sit under every new feature (documents, lifecycle, Trace). They are the first rows of the build checklist.
2. **Keep:** the single Employee table, the single leave engine, Attendance's month close and snapshot, Payroll's ownership of money, the module switches, the compliance calendar and data-health checks. They are correct and tested.
3. **Replace:** the generic register for the features that need real behaviour (help desk, assets, hiring). Leave it for the simple lists (announcements, events) until they need more.
4. **Add underneath:** an outbox with versioned events, effective-dated changes with a before-and-after change log, legal entities and establishments, and a small approval engine. Every later module needs these four.
