# Clor People design v1 — source audit, mapping and implementation plan

First deliverable for `CLOR_PEOPLE_DESIGN_SPEC_v1.md` (owner, 26 Oct 2026). Scope: **Module 00 (design system and app shell)** and **Module 01 (Workforce / Employees, EMP-01..12)**. Nothing in this document has been redesigned yet. Branch `claude/people-build-03ca03`, synced with `main` at 5d140e9.

Reconciled against `docs/people/02-PRD.md` v1.1 (24 Oct 2026), the latest PRD in the repo. **The owner said a newer PRD will be attached; when it arrives, section 6 is re-checked before Module 01's schema is declared final.**

---

## 1. What I fixed while auditing (security, not redesign)

Found by the audit, small, and exposing data, so fixed and tested before planning:

| Commit | Problem | Fix and proof |
|---|---|---|
| 934cc38 | Every employee list, record, create and update response carried `portalPasswordHash`, `portalSetupHash` and `portalSetupExpires` to anyone with Employees VIEW | Stripped server-side; `hasPortalPassword` and `portalSetupPending` say whether one is set. `personnel.test.ts` › "secrets" |
| 2d6f285 | A role limited to its own team could edit or delete anyone in the company, and withdraw any scheduled change by id | Out-of-scope people read as absent (404); a withdrawal must belong to the employee in the URL. `peopleScope.test.ts` |
| 2d6f285 | Bulk "Reports to" only blocked self-reporting, so it could create a reporting loop | Bulk skips anyone it would put in a loop, with the reason. `peopleDirectory.test.ts` |
| 064084f | Two People navigation tests failing on main's web suite | Title Case labels; help desk is P0 core, not an Engage module |

---

## 2. Source audit — Module 00 (shell, tokens, components)

### 2.1 App shell (`packages/shell/Shell.jsx`, `splitNav.js`)

| Spec | Today | Verdict |
|---|---|---|
| Dark graphite app rail + light People sidebar | Split rail + panel exist (`.ui-split-rail`, `.ui-split-panel`). Rail is **light grey** for rose; only the Blaze palette (Attendance) paints it graphite (`--rail-graphite`) | **Reuse**; add the graphite rail rules to the rose palette (colour tokens only, as Blaze does) |
| Top bar: company switcher once, search, notifications, profile | All present once. Company switcher is a native `<select>`; search opens ⌘K palette; bell; profile opens a page | **Reuse** as is |
| Collapse behaviour | Desktop: panel hides, saved in `localStorage['clor.splitPanel']`. Tablet: panel overlays with scrim. Mobile: sheet + bottom tab bar | **Reuse**; People sets `mobileTabs` (it has none, so it gets the first four screens) |
| Deep links (record tabs, preserved state) | Screen in `?open=`; Back works. **`params` (e.g. `{ id }`) live in React state only, not the URL** | **Gap (shared)**: shell must write params to the query so a record and its tab survive Back and refresh |
| Error boundary per page | `ScreenBoundary` per screen; root boundary | **Reuse**; add a Retry action |
| Command search | `CommandPalette` exists; shell passes screens/apps only, no `searchRecords` | **Gap**: optional employee lookup (permission-scoped) — proposed for Module 01, see 7.2 |

### 2.2 Tokens (`packages/ui/src/index.css`)

| Token | Spec | Actual | Plan |
|---|---|---|---|
| Primary | `#A45761` | `#A45761` (rose) | Matches |
| Surface | `#FFFFFF` | `#FFFFFF` | Matches |
| Canvas | `#F6F4F2` | `#F3F3F0` | Set in the rose palette block |
| Ink | `#232226` | `#18181B` | Set in the rose palette block |
| Spacing | 8px rhythm | `--space-1..7` = 4/8/12/16/24/32/48 | Matches |
| Radius | (spec silent) | 4px everywhere; DESIGN.md says 8/12 | **Keep 4px** — OD-06 keeps Accounting's geometry; `test/palette.test.js` forbids palettes changing geometry. Flagged as a DESIGN.md inconsistency for the owner |
| Dark theme | Required | **Forced off platform-wide** (`useTheme.js`, `index.html data-theme="light"`); dark token blocks exist but are unused | **Owner decision D-V1** |
| Reduced motion | Required | 17 per-component blocks, no global rule | Add one global rule; transitions already 120/140/200ms |

### 2.3 Components (`packages/ui`)

| Spec component | Exists | Gap to close in Module 00 |
|---|---|---|
| PageHeader | `Primitives.jsx` PageHeader (`title, description, actions`) | Add optional breadcrumb |
| DataTable | Pieces: `useColumnFilters`, `ColumnHeader`, `Pagination`/`usePaged`, `useGridView` + `GridControls` (column chooser, `BulkBar`), `ResizableTables` | **Compose one `DataTable`**: server pagination 25/50/100, sort, column visibility/order/density, selection + bulk bar, mobile card list. Mount resizing (today only in Accounting) |
| SearchField | `ListSearch` | Add debounce, clear button, Enter, Escape |
| Select / Combobox | `PopupSelect` + `useListboxKeys` + `useDismissable` (keyboard, outside click, type-ahead) | Reuse; add async (server) options for manager/employee pickers via `useRemoteSearch` |
| DatePicker | **None** — 91 native date inputs | **Build** shared DatePicker: typed entry, min/max, calendar, en-IN format, does not close parent drawer |
| FormField | `docs/index.jsx` Field, `FieldError`, `FieldErrorSummary`, `useFieldErrors` | Link hint/error with `aria-describedby`; required marker |
| Drawer | Focus trap, Escape, scrim, portal | **Return focus on close**; set overlay layer context for nested popovers; footer slot; refuse scrim-close when dirty |
| Modal | Trap, focus return, Escape | Option to not close on outside click when dirty; footer slot |
| Tabs | `StatusTabs`, `.ui-tab` | **Build record Tabs**: arrow keys, `tabpanel`, URL-synced, permission-hidden |
| StatusBadge | `StatusBadge` → `StatusPill` + `statusRegistry` | Add People statuses (Joining, On notice, Suspended, Left); pass `reason` through |
| ActivityTimeline | CSS only (`.ui-timeline`) | **Build** component: actor, role, time, event type, field diffs, filters |
| Toast / Alert | `notify`, `confirmDialog`, Toaster | **Build inline Alert/Banner** (ref-2 document and onboarding banners use it) |
| Skeleton / EmptyState | `SkeletonRows`, `TableSkeleton`, `EmptyState` (new/filtered, clear filters, routes) | Reuse |
| ErrorState | Shell's private `ScreenState` | **Extract shared ErrorState**: offline, API unavailable (with reference id), 401, 403, 404, 409, 429, save failed, slow |
| CommandSearch | `CommandPalette` | Reuse (see 7.2) |
| Icons | Fluent colour icons via `colorIcon` in both Attendance and People; chrome icons Lucide | Reuse. Spec says "Lucide-style matching Attendance": Attendance uses the same Fluent colour set, so People keeps it (D-01) |

---

## 3. Source audit — Module 01 (employee domain)

### 3.1 Data (`server/prisma/people/schema.prisma`, model `Employee`)

- **Name:** `name`, `firstName`, `lastName`. **No preferred name** (PRD CORE-02 and spec both ask for it).
- **Contact:** `email`, `workEmail`, `personalEmail`, `phone`, `workPhone`, address lines, city, state, country, PIN.
- **Emergency:** one contact (name, phone, relation).
- **Employment:** `code` (unique per company, optional, never generated), `employeeTypeId`, `workTypeId`, `jobRoleId`, `dateOfJoining`, `probationEndDate`, `confirmedOn`, `contractEndDate`, `status` (ACTIVE, ON_NOTICE, LEFT, SUSPENDED), `contractorId`.
- **Organisation:** department, designation (job position), business unit, grade, cost centre, reporting and dotted manager, branch, area ("Location"), establishment, team, seat.
- **Sensitive:** in `EmployeeIdentity` (Aadhaar last 4, passport, work permit) and Payroll (PAN, UAN, ESIC, bank via `statutoryRead`), masked; reveal needs authenticator and is logged.
- **Concurrency:** **no version, no If-Match, no 409 on stale edits.**
- **Drafts:** **no draft employee.**

### 3.2 APIs (`server/src/routes/people.ts`)

| Capability | Today | Gap |
|---|---|---|
| List | `q` (name, code, emails, phone, designation, department text), filters (status, department, position, type, work type, unit, grade, cost centre, direct manager, tag, `asOf`), `limit` ≤ 500, `offset`, `total` | No sort param; no location or joining-date range filter; no status counts endpoint; manager filter is direct reports only |
| Create | Zod validation, structure checks, duplicate check (email, phone, code → 409 DUPLICATE with reason override), manager loop check | No employee-ID suggestion; no draft |
| Update | Same checks, effective-dated scheduling, job-change approval rule, change impact | No duplicate check on update; no concurrency check |
| Bulk | One field, ≤ 2,000, one correlation id (70173cd) | Result not stored (no per-record result export) |
| Import | Mapping, create/update, dry-run preview with row results, undo 24h, ≤ 1,000 rows | Per-row results not stored; no "download failures" |
| Export | **Client-side only** from loaded rows | Must be server-side, permission-checked and audited |
| Saved views | Own/shared, maker-only edit (70173cd) | No "update view"; UI restores only some filters |

### 3.3 Audit and activity

- **People `ChangeLog`:** one row per changed field, before/after, redaction at write time, source, actor, correlation id, request id, decision id. Append-only by trigger and RLS.
- **Platform `AuditLog`:** one row per request from `auditMutations` middleware; redacted body; no correlation id, no actor role, no before/after; skips system/portal actors; no immutability trigger. Read at `/audit` with company scope only; `Audit trail::EXPORT` never enforced (export is client-side).
- **Existing timelines:** `/history` (employment events), `/journey` (ChangeLog Employee rows grouped by stint, with Why), `/why/:key`.
- **Missing for EMP-09:** typed events (create/update/archive/approve/reject/import/export/upload/comment), document uploads and notes not in ChangeLog, comments not distinct, actor role not stored, viewer-side field redaction, server export with permission.

### 3.4 Current UI (`packages/ui/src/personnel/Employees.jsx`, one 2,100-line file)

- **Directory:** cards/list toggle; loads every row then filters on the client; status tabs; 4 filters; selection + bulk drawer; saved views select; client export; import.
- **Record:** a **drawer**, not a page; tabs About, Work, History, Journey, Checklist, Notes, Documents; open record not in the URL.
- **Form:** one drawer (Basics, Where they work, Employment, Attendance and readers, Personal, Tags); duplicate-reason and effective-date panels.

---

## 4. Page and component mapping (EMP-01..12)

Route model: EMP pages are **screens** (`?open=`); profile sections are **record tabs** (`?open=employee&id=…&tab=…`, needs the shell params fix).

| ID | Becomes | Route / tab | Reuses | New or extended | Status today |
|---|---|---|---|---|---|
| EMP-01 Directory | Full-page list per ref-2/ref-3: header + 4 counts, tabs (Directory, Saved views), search, Filters drawer, Columns, list/grid toggle, table, row actions, pagination, alert banners | `?open=employees` + filter/sort/page state in the URL | DocumentListShell (header), EmptyState, StatusBadge, PopupSelect | DataTable, SearchField, Filters drawer, Alert banner, server sort/filters/counts | Partial |
| EMP-02 Add Employee | Full-page 4-step wizard per ref-1 | `?open=employeeNew` (`&draft=…`) | FormField, FieldErrorSummary, PopupSelect | Stepper, DatePicker, sticky action bar, server draft, ID suggestion, review checks | Missing (single drawer form) |
| EMP-03 Overview | Profile header + Overview tab: summary sections + Quick actions (Change manager, Transfer, Update employment, Add document, View history) | `?open=employee&id=&tab=overview` | StatusBadge, Avatar | Record page template, Tabs | Partial (drawer) |
| EMP-04 Personal | Contact, address, emergency, identity (masked, gated), custom fields; section edit | `tab=personal` | Statutory reveal flow, custom fields | Section-edit pattern with 409 handling | Partial (About tab) |
| EMP-05 Employment | Type, ID, joining, probation (confirm/extend), status, scheduled changes, effective-dated edit | `tab=employment` | Probation actions, scheduled changes, change impact | Effective-date edit drawer | Partial (Work tab) |
| EMP-06 Organization | Department, designation, location, establishment, team, seat, manager, dotted manager, direct reports; Change manager | `tab=organization` | `checkManager` loop check | Change-manager drawer with scope check | Partial (Work tab) |
| EMP-07 Documents | Existing documents tab restyled: upload with classification, versions, expiry, letters, acknowledgements | `tab=documents` | `EmployeeDocuments` | Upload failure/retry state | Exists |
| EMP-08 History | Employment history + Journey (stints, Why) | `tab=history` | `Journey`, `WhyPanel`, `/history` | Merge into one effective-dated view | Exists (two tabs) |
| EMP-09 Activity | ERPNext-style timeline: field diffs, uploads, approvals, comments, imports, exports; filter by type | `tab=activity` | ChangeLog, approvals, AccessLog | `/employees/:id/activity` endpoint, ActivityTimeline, comments | Missing |
| EMP-10 Import | Existing import as a full-page wizard: upload, map, validate/preview, process, results + failures CSV | `?open=employeeImport` | `ImportDrawer` logic, `/import` routes | Stored per-row results | Partial |
| EMP-11 Bulk Operations | Selection toolbar → bulk drawer → result screen (successes/failures separately, export) | from EMP-01 | `/employees/bulk` (70173cd) | Stored batch result + result view | Partial |
| EMP-12 Saved Views | Directory tab "Saved views": list own + shared, apply, rename, share (with permission), delete | `?open=employees&view=…` | `/saved-views` (70173cd) | "Update view", share permission | Partial |

Checklist, Notes and Journey tabs that exist today: Checklist moves to Employee lifecycle (Module 03) and appears on Overview as open tasks; Notes become **comments** on the Activity tab; Journey joins History.

---

## 5. Gaps against the spec that need backend work (Module 01)

1. **Server-driven directory:** sort (name, ID, department, designation, joining date, status), location and joining-date filters, `pageSize` 25/50/100, status counts endpoint, manager subtree filter.
2. **Optimistic concurrency:** `version` integer on Employee (incremented by the one write path); `If-Match`/`expectedVersion` on update → **409 STALE** with the current record.
3. **Preferred name** field (PRD CORE-02). Legal name stays `firstName`/`lastName`/`name`.
4. **Employee drafts:** `EmployeeDraft` table (per user, per company, JSON payload, expires 30 days), RLS; create-from-draft deletes it. Real, authorised, not decorative.
5. **Employee ID:** server suggests the next code from the company's pattern (e.g. `EMP-0042`); still editable; uniqueness checked live.
6. **Activity endpoint:** `/employees/:id/activity` merges ChangeLog (all entities for the person), approval steps, document uploads/deletes, imports, exports, comments; typed events; viewer-side redaction by grant; paged; export behind a new `PEOPLE::Employees::EXPORT`-style check and itself audited. Built on ChangeLog + platform AuditLog via correlation id — **no new audit store**.
7. **Comments:** `EmployeeNote` becomes the comment source on the timeline; notes stop being hard-deletable (soft delete, logged).
8. **Uploads and deletes of documents** write ChangeLog rows (they only hit AuditLog today).
9. **Server export** of the directory (CSV/XLSX) with permission and an audit row.
10. **Stored bulk and import results** (per record) for the partial-failure screen and its export.
11. **Platform `AuditLog`:** add correlation id (and actor role) so People can join it. **This touches the platform schema — coordinate with the main session first.**

---

## 6. Reconciliation with PRD v1.1

| Topic | PRD | Spec | Proposal |
|---|---|---|---|
| Profile tabs | CORE-05: Overview, Job, Timeline, Documents, Requests, Tasks, Statutory; tabs hide without permission | Overview, Personal, Employment, Organization, Documents, History, Activity | **D-V2**: use the spec's 7 tabs. Statutory becomes a gated section on Personal (hidden without the grant, as CORE-05 requires). Requests and Tasks appear on Overview as "Open items" and in Module 05 |
| Add person fields | CORE-02: number, legal + preferred name, joining date, employment type, team, establishment, location, manager, status; duplicate check on email, phone, **PAN** | Spec wizard steps; "work relationship"; emergency contact | Wizard carries all CORE-02 fields. Duplicate check on PAN is not possible in People (PAN lives in Payroll) — kept as email/phone/code, flagged. **D-V3**: "work relationship" maps to Employee type + Contractor (no new field) |
| Directory | CORE-01: paging past 500, bulk update writes one change per person, export 2,000 rows | Server pagination 25/50/100, column settings, saved views | Compatible; server pagination replaces "load everything" |
| Timeline | CORE-06 Journey with Why | History + Activity | Journey → History tab; Activity is the audit timeline |
| Import | CORE-07 done | EMP-10 wizard | Restyle only + stored results |
| Self-service, statutory reveal, custom fields | CORE-03/04/08 done | Personal tab | Kept, restyled |
| Forms (FORM-03 draft/resume, conflict) | Phase 3 | Draft + 409 | Brings FORM-03 items 1 and 9 forward for the employee form only |

---

## 7. Decisions needed from the owner

| ID | Question | Recommendation |
|---|---|---|
| **D-V1** | Dark theme is forced off for the whole platform. Turn it on for People only, or platform-wide? | Build and test People's dark tokens now; keep the switch off until a platform-wide decision, because the shell, Accounting and Attendance share the chrome |
| **D-V2** | Profile tabs: spec's 7 or PRD CORE-05's 7? | Spec's 7, with Statutory as a gated section on Personal |
| **D-V3** | "Work relationship" — new field or Employee type + Contractor? | Existing fields; no new concept |
| **D-V4** | Rail colour: make People's rail graphite like Attendance's? | Yes, colour tokens only, via the rose palette |
| **D-V5** | Canvas `#F6F4F2` and ink `#232226` for People only (rose palette) or platform-wide? | People only (palette tokens), so other apps don't shift |
| **D-V6** | Radius: DESIGN.md says 8/12px, code uses 4px (Accounting geometry, OD-06) | Keep 4px for this build; fix DESIGN.md or the code later as one platform decision |
| **D-V7** | Record deep links need a shared shell change (params in the URL) | Do it in the shell, coordinated with the main session; it benefits every app |
| **D-V8** | Platform AuditLog needs a correlation id column so Activity can join it | Add it (platform migration), coordinated with the main session |
| **D-V9** | Banners in ref-2 ("5 employees missing documents", "8 pending onboarding") | Build them from Data Health and checklists (real counts, dismissible per user); not mock |

---

## 8. Annotated implementation plan

Each step ends with tests, screenshots and a commit. A module is not marked done until all four gates have evidence (tracker: `TRACKER.md`).

### Module 00 — design system and shell

| Step | Work | Gate evidence |
|---|---|---|
| 00.1 | Rose palette: graphite rail, canvas/ink tokens (D-V4, D-V5); global reduced-motion rule; dark tokens prepared (D-V1) | `palette.test.js`, contrast check, screenshots light (dark if approved) |
| 00.2 | Shell: params in the URL (D-V7); People `mobileTabs`; ScreenBoundary Retry | Back/refresh test on a record tab |
| 00.3 | Components: SearchField, DatePicker, record Tabs, Alert, ErrorState, ActivityTimeline, PageHeader breadcrumb | Vitest + keyboard tests (Esc, Enter, arrows, outside click, IME) |
| 00.4 | Fix Drawer (focus return, nested popovers, dirty guard, footer) and Modal (no outside close when dirty) | Focus tests |
| 00.5 | DataTable composed from existing pieces: server paging, sort, columns, density, selection, bulk bar, mobile cards, resizing | Table tests; 375px no horizontal scroll |
| 00.6 | State kit: skeleton/background refresh/slow/offline/API failure (ref id)/401/403/404/409/429/save failed/partial bulk/upload failed | One story per state |

### Module 01 — Workforce / Employees

| Step | Work | Gate evidence |
|---|---|---|
| 01.1 | Backend: sort/filters/counts, `version` + 409, preferred name, ID suggestion, drafts, server export (audited) | Server tests incl. tenant isolation per new table |
| 01.2 | EMP-01 Directory + EMP-12 Saved views (URL state, Filters drawer, Columns, banners D-V9) | Workflow test 1; 2,000-row first page < 1 s |
| 01.3 | EMP-02 Add Employee wizard (steps, draft, review, duplicate, one submit) | Workflow tests 2 and 3 |
| 01.4 | Record page: header, Tabs, EMP-03..06 with section edit, Change manager, effective dates, 409 handling | Workflow tests 4 and 5 |
| 01.5 | EMP-07 Documents and EMP-08 History restyled into the record | Screens |
| 01.6 | EMP-09 Activity: endpoint, typed events, comments, redaction, export permission (D-V8) | Permission tests: manager vs HR vs auditor |
| 01.7 | EMP-10 Import page and EMP-11 Bulk results (stored, exportable) | Partial-failure test |
| 01.8 | Mobile pass (cards, sheets, 44px targets), company switch clearing, a11y audit | Workflow tests 6 and 7; WCAG 2.2 AA checks |
| 01.9 | Requirement-by-requirement report with screenshots (desktop, tablet, mobile) | Gate 04 |

### Folded in from earlier work on this branch

- Saved views and bulk update (70173cd) become the backend of EMP-11/EMP-12.
- Trace (67e0e39): Why panel and decision records feed History; the "Raise a correction" action stays on History.
- Privacy (daf496d): the access log feeds Activity for statutory reveals and confidential opens.
- The old drawer, form and directory are replaced screen by screen; their behaviour (duplicate reason, effective dates, approval rule, change impact, probation, invites, leaving, rehire) is kept.

### Not in this scope

Recruitment, Performance, Learning, AI modules, Modules 02–10, and any change to Attendance or Payroll behaviour.
