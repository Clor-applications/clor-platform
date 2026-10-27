# Clor People — Workforce | Consolidated Master Specification

**Document:** WF-UX-1.0 • **Date:** 26 Oct 2026 • **Status:** pending — not code-complete or tested

This master contains the same contracts as `specs/` so an agent can read just one specification before cross-checking CSVs and visual assets.


---

# WF-00 — Scope, architecture and non-negotiables

## Product definition
`People` is the app; `Workforce` is the navigation module; `Employee Directory` is its default screen. A worker can exist with no authenticated platform User. An employee may participate in one or more employment episodes; a company name alone must never be treated as a cross-tenant worker identity.

## Ownership boundaries
| Area | Source of truth | Workforce UI responsibility |
|---|---|---|
| Login / session / company switch / app access | Clor platform shared shell + API | Consume existing context, do not implement separately |
| Canonical worker identity and employee mapping | Existing People IDs + agreed thin Workforce Core contract (target) | Preserve stable identifiers, surface controlled mappings |
| Rich person/HR profile / employment history / manager changes | People | Authoritative HR CRUD, authorization, effective-date history |
| Time punches, device health, shifts, clock events | Attendance | Only authorized summary/deep links when subscribed |
| Leave ledger | Existing shared People/Workforce leave path (canonical ownership to be reconciled) | Link to Leave & Holidays, no duplicate balances |
| Salary, payroll run, final settlement | Payroll | Show references only with entitlement; never calculate or edit finalized pay |
| Documents | People + R2 signed access layer | Secure versioned upload, review and download |
| Audit and approval inbox | Platform audit/workflow plus People product events | Record timelines and contextual action statuses |

## Current system guardrails (per 23 Oct archive audit; recheck live)
- Shared shell examples: `packages/shell/Shell.jsx`, `session.jsx`, `registry.js`, `appHosts.js`; People manifest and existing People screens already exist.
- Node/Express/TypeScript API and separate Prisma models for Platform, People and Payroll. Attendance product code currently uses People database in audited snapshot; do NOT assert physically independent DB.
- Persisted `Org` currently represents legal company. Do not replace with `Company` by global search/replace.
- Historical audit identified fail-open RLS if tenant context absent and partial subscription/seat/SoD enforcement. **WF release cannot be certified until platform gates are independently verified.**
- Review up-to-date source before deciding employee route, IDs, enum names, API path, or migration.

## In scope
Directory; search/filters/saved views; employee details; personal/contact/emergency fields; job/employment/organization; documents; effective-dated events; add/edit/drafts; transfers/promotion/manager/status change; archive/reactivation; controlled import/export/bulk; record timeline; permissions; responsive UX; keyboard and networking/error states; QA and evidence.

## Out of scope / integrations
Recruitment pipelines, performance, learning, AI, payroll calculations, biometric ingestion, independent leave ledger, app billing management, new tenant/auth architecture. If needed, create a separately approved ADR and delivery ticket rather than ship under Workforce.

## Vertical-slice implementation policy
WF-00 is read-only: compare latest PRD + current HEAD + migration history + deployed behavior. Build path-by-path EXISTS/PARTIAL/ABSENT/CONFLICT matrix with screenshots. Wait for Tenant Platform gate evidence before writes that touch scope/authz models. For each feature: UX contract → API/data mapping → authorization test → UI → test → visual diff → evidence.

## Terminology rules
`Workforce` visible module label; `Employee` record type and natural language in page names; `Employee ID` company-specific identifier; `User` is login principal; `Person/Worker` only when established in approved source; `Employment` is episode/assignment, not equivalent to User. Keep established API/DB nomenclature unless explicitly approved.


---

# WF-01 — Navigation, page ownership, route inventory

## Split-sidebar contract
1. **Global rail:** the shared graphite Clor app-switching rail (Books/People/Payroll/Attendance/future apps subject to entitlements).
2. **People navigation panel:** user-facing entries `Overview`, `Workforce`, `Organization`, `Lifecycle`, `Leave & Holidays`, `Workflows`, `Documents`, `Reports`, `Settings`. Preserve the current shell's authoritative navigation configuration; avoid adding duplicate route groups.
3. **Top shell bar:** one company switcher, existing global actions, notification/user menus. No second company selector in local sidebar.
4. **Page workspace:** title, short task-specific subtitle, compact contextual actions, permitted responsive content.
5. **Workforce subsections:** tabs `Directory`, `My Team` (only if user has team scope), `Saved Views`, `Pending Actions` (only if workflows support it). These are internal tabs/routes, **not additional global/sidebar app modules**.

## Canonical UI routes — proposals, not existing-endpoint claims
| ID | View | Proposed client route | Page owner | Entry/exit |
|---|---|---|---|---|
| WF-101 | Directory | `/people/workforce` | People | Sidebar Workforce → list |
| WF-102 | My Team | `/people/workforce/team` | People | Visible with manager/delegated scope |
| WF-103 | Saved Views | `/people/workforce/views` | People | Personal/shared view management |
| WF-104 | Employee profile | `/people/workforce/:employeeId` | People | Row click; browser Back restores list |
| WF-105 | Profile section | `/people/workforce/:employeeId/:tab` | People | Tabs: overview/personal/employment/organization/documents/history/activity |
| WF-106 | Create employee | `/people/workforce/new` | People | Add Employee, guarded wizard |
| WF-107 | Edit employee | `/people/workforce/:employeeId/edit` | People | Authorized Edit, unsaved guard |
| WF-108 | Change operation | `/people/workforce/:employeeId/actions/:action` | People | Manage employee contextual action |
| WF-109 | Import | `/people/workforce/import` | People | Import wizard and job result |
| WF-110 | Bulk jobs | `/people/workforce/bulk/:jobId` | People | Batch statuses / per-row results |
| WF-111 | Audit detail | `/people/workforce/:employeeId/activity/:eventId` | People/platform | Authorized diff and context |
| WF-112 | Not found / unauthorized | shared shell fallback | Shared shell | Correct 403/404 semantics |

**Routing compatibility:** Inspect existing `/people/employees` or similar routes. Preserve deep links with aliases or redirects; never break old links or call new URLs without a migration plan. Actual route and API paths must be confirmed in the live repo before implementation.

## Screen ownership and no duplication
- Overview app page: company-level general operations; no duplicate copy of the full directory.
- Workforce: employee identity, status, core records, role-scoped HR actions.
- Organization: manage departments, designations, teams, org-chart policy; Workforce can select/link but does not duplicate organization administration.
- Lifecycle: configurable onboarding/offboarding workflows; Workforce profile may initiate/deep-link.
- Documents: central document policies/library; Workforce profile contains files relevant to this employee.
- Leave & Holidays: leave balances and calendars; profile may display a lightweight authorized summary/deep link only.
- Attendance/Payroll: consumers, not duplicated modules inside Workforce.

## Navigation behavior
- Active local sidebar item `Workforce` remains selected throughout employee profile/form/import routes.
- Browser Back returns to previous page with directory's query/filter/sort state and scroll position where feasible.
- Company switch is atomic: clear selected employees, close drawers and menus, invalidate company-scoped cached queries and field-level grants, return to an authorized route.
- Unsaved edit guard on internal tab, browser navigation and company switching; strong exception for irreversible operations.
- Save success gives explicit link/route to employee profile; no duplicate toast/navigation.
- Responsive sidebar uses existing shell collapse behavior; don't invent a third sidebar.


---

# WF-02 — Design language and reusable components

## Visual direction
Precise enterprise directory + warm people-first details: neutral graphite, paper-like surfaces, restrained People rose accent. Keep the shared Clor shell and Attendance icon family. No bright all-over tinted cards, gratuitous empty space, repeated overview tiles, gradients or illustrations that hide essential data.

| Token | Proposed value / behavior |
|---|---|
| `--people-accent` | `#A45761` (approval target; check contrast for each text usage) |
| `--ink` | `#232226` |
| `--canvas` | `#F6F4F2` |
| `--surface` | `#FFFFFF` |
| `--border` | `#E6E2E0` |
| `--muted` | `#6B6670` |
| `--danger`, `--success`, `--warning` | derive contrast-tested semantic tokens from shared Clor system |
| Spacing | Base 4px units; 8px typography/field alignment rhythm, 16–24px section separation |
| Focus | 2px discernible focus outline; not removed for aesthetic reasons |
| Radius | shared shell / Attendance primitives, about 8–12px for cards and form controls |
| Motion | restrained 120–180ms; respect `prefers-reduced-motion` |
| Typography | reuse current Clor font and icon set; do not inject an unrelated font package |

## Component contracts
| Component | Responsibilities / states |
|---|---|
| `GlobalAppRail` / `PeopleNav` | existing shell identity and independent collapse/scroll; visible permission rules |
| `PageHeader` | breadcrumb, headline, concise subtitle, max one emphasized CTA + overflow actions |
| `MetricStrip` | narrow actionable counters, source/definition tooltip, skeleton, hidden when misleading |
| `DataTable` | a11y headers, server pagination/sort, selection, density, columns, row menu, virtualization if needed |
| `EmployeeIdentityCell` | avatar/initials, name, ID, permitted contact; graceful no-photo |
| `FilterToolbar` | search, chips, filter trigger, presets, Reset; keyboard accessible |
| `FilterDrawer` | multi-group selection, Apply/Reset, draft vs applied query, mobile full sheet |
| `SavedViewMenu` | named personal/shared view, owner, visibility, URL-compatible restoration |
| `StatusPill` | status semantic colors; never communicate by color only |
| `FormField` | label, required/optional, helper, error, disabled, readonly, skeleton |
| `AsyncCombobox` | anchored popover, typeahead, keyboard, async loading/empty/retry; correct overlay lifecycle |
| `DateControl` | localizable date input, parsed/validated timezone-neutral dates, format help |
| `FormWizard` | steps, draft, previous/next, review, footer actions, focus error summary |
| `Sheet`/`Dialog` | focus trap only for modal overlays, safe close, disclosure of unsaved edits |
| `RecordTabs` | URL-addressable active tab; logical keyboard navigation |
| `EventTimeline` | action class, actor, timestamp, reason, field diff, sensitivity redaction |
| `DocumentItem` | file status/version/expiry, access-safe preview and download |
| `InlineNotice` | specific error or caution and remedy; no generic scare banners |
| `Toast` | short confirmation, optional Undo only where server supports reversal |
| `Skeleton` | preserve final layout dimensions, no shimmer with reduced motion |
| `ErrorBoundary` | contextual fallback, retry and support trace ID, safe state restoration |

## Component geometry proposals
Desktop main content maximum width should expand for tables, not be constrained to a narrow marketing-content width. Typical header height 64–84px, search field 36–40px, row density comfortable 48–56px or compact 40–44px, minimum touch target 44px on mobile. Use existing shared sidebar widths, not hard-coded new global-rail widths.

## Visual acceptance tests
- Directory at 1440×900 and 1280×800: no oversized gaps, readable columns and contextual actions.
- Profile at 1440 and 1024: sticky tabs, audit panel only when width allows; no nested horizontal scroll.
- Mobile 360×800, 390×844: cards readable, no clipped labels or horizontal overflow, keyboard not obscuring form footer.
- CSS scale/zoom at 200%, forced contrast, dark theme where supported, reduced motion; controls remain usable.
- Screenshots compared to actual Attendance shell; design mockup dimensions alone are not acceptance criteria.


---

# WF-03 — Workforce Directory (WF-101 / WF-102 / WF-103)

## Page hierarchy (top to bottom)
1. Breadcrumb `People / Workforce` (short, not two separate headings).
2. `Workforce` title; subtitle `Manage employees and employment records for [selected company]` (only if company context is already in top shell, avoid a duplicate selector).
3. Right actions: primary `Add Employee` if create permission, secondary `Import` and `Export` via button/overflow, optional `More`.
4. Slim operational strip: Total, Active, Joining, On Leave, Exiting; only show counters with authoritative definitions and available data. Never invent numbers.
5. Route-specific tabs: `Directory`, `My Team` (scoped), `Saved Views` (where feature exists), `Pending Actions` (where supported).
6. Search+filters+view toolbar, followed immediately by table. Pagination and result count at bottom.

## Default columns and per-column actions
| Column | Display | Sort/filter rule | Sensitivity |
|---|---|---|---|
| selection | checkbox incl. select-visible | selection only | company/scope protected |
| Employee | avatar, full name, secondary permitted work email | server sort/name search | email may be field-limited |
| Employee ID | company-scoped employee number | exact/prefix search | avoid exposing globally |
| Department | label, historical-aware current assignment | filter | company scope |
| Designation | current official job title | filter | company scope |
| Manager | manager display name + direct link where allowed | filter/search | team scope |
| Location | workplace/branch label | filter | company/branch scope |
| Employment type | full-time, contractor, etc, canonical source enums | filter | company scope |
| Joining date | localized display, stable date value | sort/range | approved roles |
| Status | human label with semantic pill | filter | company scope |
| Actions | ellipsis dropdown | action guards | server enforce |

Defaults may hide lower priority columns on narrower screens. Configure display/order/density per user and view; do not expose a field through column customization when field policy forbids it. Column menu includes Search columns, Reset default, checkboxes and reorder if existing toolkit supports it.

## Search contract
- Main search placeholder `Search name, employee ID, or work email` where those are authorized; no promises of fuzzy/smart search unless indexed and supported.
- Debounce 250–400ms; Enter commits current search. Clear × resets query without resetting unrelated filters.
- Server never searches inaccessible employee rows; response count derived from same authorized scope.
- URL query must omit sensitive search values if organization policy forbids persistence; no query string that includes government IDs or personal phone.
- Search non-results show active terms/filters and Clear Filters. Hidden field matches must never leak in counts.

## Filter contract
Status, department, designation, location, manager, employment type, joining date range, and only approved custom fields. Drawer header `Filters`, group search as needed, draft selection, bottom `Reset` / `Cancel` / `Apply`. Outside click closes only when no unsaved draft; otherwise prompts Discard / Keep editing. Applied chips removable individually; toolbar Clear all. Group dependent options must reflect company/role; no `All companies` cross-tenant leak.

## Saved views
Personal default; shared views only with explicit permission. Persist owner, query representation, sort/order/visible columns/density. Save As asks name and visibility, validates duplicate names in owner scope, warns if selected columns are no longer authorized. A revoked employee scope must affect viewed rows despite old saved query. Defaults can be renamed or removed only according to owner policy.

## Row interactions
- Clicking row body enters employee profile; checkbox/ellipsis/button click must not also navigate.
- Ellipsis actions: View, Edit, Change Manager, Transfer, Designation Change, Document, View Activity, Archive/Reactivate according to allowed state and permission. Disabled action may show a reason if safe; no decorative menu.
- Hover: subtle tint or rule, actions available to keyboard and touch. Tab moves through interactive cells appropriately.
- Selection: select visible page by default; optional explicit `Select all matching` requires server-generated batch scope and clear count. Changing company always clears selection.
- Bulk bar: `N selected` + authorized bulk actions + Clear selection; invalid/noneligible rows produce per-row results.

## Pagination/performance
Server sorting + cursor/offset consistent with API contract; 25/50/100 size choices only if service supports. Preserve list state with browser Back; avoid fetching every tenant employee on initial load. For large lists, no DOM-based client-only sorting pretending to sort the full dataset. Optimistic updates only with rollback and version check.

## Directory empty/error specifics
New company: invitation to Add / Import (permission gated). No matched results: clear filters. Forbidden: show access restriction without hint of hidden workers. Error loading: retry preserves query. Slow load: retain last known valid data with freshness indicator and read-only actions when stale. Mobile: identity-focused cards; filters via bottom sheet; no screenshot of a shrunken table.

## Directory acceptance probes
D1: same name in two accounts cannot leak via search/pagination/count. D2: filter URL of company A after switch to B is revalidated. D3: disabled action cannot be invoked by API. D4: selected rows from page 1 not silently treated as all matches. D5: changing sort returns stable results across pages. D6: Back restores query, active tab and appropriate scroll. D7: screen reader announces selection count. D8: saved view after role revoke does not reveal columns/rows.


---

# WF-04 — Employee profile and tabs (WF-104/105)

## Header
Breadcrumb `People / Workforce / [employee name]`; back to Directory preserves query. Identity avatar or initials, full name, internal employee number, designation, department, location, manager, status. Never put sensitive IDs, full DOB, bank info or personal document numbers in header. Actions Edit, More, permitted quick workflow; no duplicate profile summary cards.

## Tab contract
| Tab | Key sections | Actions | Important states |
|---|---|---|---|
| Overview | Employee identity, employment summary, organizational assignment, work contacts, actionable alerts | Edit allowed sections, View team, View documents | incomplete profile, joining, suspended, exited |
| Personal | legal/preferred name, contact channels, addresses, emergency contact, approved demographics and identity fields | Request correction/verified edit, add contact | masked sensitive, consent, missing, forbidden |
| Employment | employment episode, status, start/end, type, grade, probation/confirmation, work agreement references | change employment, confirmation via workflow | missing episodes, conflicting effective dates |
| Organization | department, designation, primary and dotted-line manager, location, branch, cost center if enabled | transfer, change manager/designation | invalid manager/circular reference |
| Documents | versioned uploads, type/status, expiry, last review, source | upload, preview, replace, review, download | expired, quarantined, access denied |
| History | time-sliced employment events (effective date vs recorded date), promotions, transfers, status changes | compare snapshots, export if permitted | retroactive correction, backdated event |
| Activity | immutable event timeline with actor, timestamp, field diff and comments/workflow entries | filters, pagination, add comment if allowed | redacted values, unavailable event |

## Field rendering rules
- Single source of truth for each value. Summary tiles deep-link to owning tab rather than duplicating editing forms.
- Every editable section shows `Edit` only for permitted actor and fields. Save server-side validation; auto-merge never silently overwrites newer values.
- Work email vs personal email clear labels and independent privacy controls. Missing is shown as `Not provided` with Add action only when authorized.
- Identity documents show masked last characters where approved, otherwise no value. No government IDs in browser local storage, URLs, analytics, logs or client error messages.
- Dates: locale-aware display, no inferred timezone shift for date-only fields. History states effective date and recorded-on separately.
- Employee with no login has `Portal access not linked` (or existing equivalent), not an error or forced platform account.

## Right-context rail or drawer
At wide desktop widths, optional contextual `Recent activity` or `Action required` (not another copy of profile fields). On smaller widths it becomes a tab/drawer; must never squeeze main profile forms. Do not repeat company switch in profile.

## Unsaved editing / conflict
Per-section dirty state. On 409 conflict show server version and local proposed change, allow authorized compare/reload/resubmit; no blind last-write-wins for employment or sensitive fields. When archive, edit, or company membership revoked during page viewing, disable stale actions, clear restricted cached data and route to safe fallback.

## Profile acceptance probes
Open deep link under wrong company → 404/403 without identity leakage. Manager sees permitted direct reports, not all records. General HR user cannot inspect identity documents via DOM or API. Unauthorized tab cannot retrieve hidden fields in preload. A backdated manager change appears in history without retroactively rewriting approval decisions. Mobile tabs remain keyboard/voice-accessible and fit 360px.


---

# WF-05 — Add/Edit Employee: forms, fields, validation, step flows

## General contract
Use existing Clor form stack and validators. Create via four steps: **1 Personal → 2 Employment → 3 Organization → 4 Review**. Edit uses tab/section scoped editing rather than forcing the create wizard, unless schema changes warrant a guided update. Form uses labels above controls, controlled validation, standardized date picker, 1 column mobile, up to 2 columns desktop, bottom sticky action bar.

## Field rules (suggested contract; reconcile PRD and live schema)
| Step | Field | UI type | Validation | Privacy |
|---|---|---|---|---|
| Personal | legal first/last name | single-line input | trim, nonempty according to policy, Unicode names; max length per model | ordinary HR |
| Personal | preferred name | single-line optional | no unsupported characters ban | ordinary HR |
| Personal | work email | email optional/conditional | syntax, conflict policy, case-insensitive normalized search; not universal mandatory | work contact |
| Personal | personal email | email optional | verify consent/visibility; not used for dedupe by itself | restricted |
| Personal | phone and country | tel with country selector | E.164 where possible, allow local business rules | restricted by policy |
| Personal | DOB/gender | date/select conditional | no impossible dates; required only when lawful and configured | sensitive |
| Personal | address / emergency contacts | structured repeatable address/contact | relationship and numbers optionally validated; only relevant circumstances | sensitive |
| Employment | employee number | text or configured sequence | unique in **legal company** and episode policy, server enforced | ordinary HR |
| Employment | type/work arrangement | configured select | one of company-authorized options | ordinary HR |
| Employment | joining date | date | legitimate employment date range, effective-date checks | ordinary HR |
| Employment | end / probation date | conditional date | chronological consistency and policy | restricted HR |
| Employment | employment status | configured state | guarded transitions, cannot free-text create | restricted HR |
| Organization | department | search combobox | scoped active department, historical valid if backdated | ordinary HR |
| Organization | designation | search combobox | valid company job role, effective date | ordinary HR |
| Organization | branch/location | scoped select | company/branch access; policy | company scope |
| Organization | manager | async employee lookup | not self; no cycles; only valid scoped candidates | record scope |
| Organization | grade/cost center | conditional select | configured mapping; no silent cross-app default | restricted HR |
| Review | consent/policy acknowledgment | checkboxes when required | explicit text/version evidence | policy sensitive |

Additional government/bank/medical fields are not automatically added; map approved fields and permissions from source PRD. No explicit universal validation rejecting workers without app login.

## Form states and exact actions
`Cancel`: if dirty → discard dialog; else navigate back. `Back`: go to previous step without resetting. `Save Draft`: persist through approved draft endpoint with explicit state and TTL/access policy; if unsupported, omit rather than fake. `Continue`: validate current step, focus first invalid field + show summary. `Create Employee`: validate all steps server-side, use idempotency key and one in-flight request, show progress, then success detail link. `Edit`: mark changed values, explicit Save/Cancel, show pending workflow for fields needing approval. `Enter` in text input is not submit for a multi-step form; `Enter` in focused button may activate it.

## Validation UX
Validate obvious syntax on blur; server is authoritative. Inline error immediately under field with icon + plain text, status red border + accessible description. If multiple errors show top anchor summary with field links. Async selector with loading, no results, denied and retry states. Keyboards: inputmode=email/tel/numeric where appropriate; press Escape closes selector without wiping field.

## Draft/unsaved consistency
- Optional draft persisted to server only with approved endpoint and entitlement; optional encrypted local buffer must avoid highly sensitive fields.
- Offline transient input remains in memory; no promise of offline submission if backend is required.
- Tab close, browser Back, company switch triggers unsaved guard; no silent loss.
- Partial network save failure retains values; retry must be idempotent.
- Competing update 409 shows clear compare/reload. `Cancel` when draft saved distinguishes `Discard unsaved changes` vs `Delete saved draft`.

## Creation business logic to verify
Allow record without a User; prevent duplicate employee numbers in same company; check multi-company/multiple employment scenario according to active data model; never dedupe on same human name alone. If auto-numbering configured, server allocates under transaction; do not predict next ID client-side.


---

# WF-06 — Employee operations and effective-dated history

## Standard operation pattern
Entry from employee profile More / directory row action → summary of current state → proposed change form → applicable impact/reason/effective date → permitted checker/approval route → confirmation → event in Activity and effective-dated History → integration outbox as appropriate. If approval pending, do not change authoritative effective state prematurely.

| Action | Required inputs | Validation & approvals | Outcome |
|---|---|---|---|
| Change Manager | new manager, effective date, reason optional per policy | self/cycle checks, company scope, approval if policy | effective-dated reporting relationship; pending approval re-evaluation |
| Transfer Department | destination dept/location/branch where needed, effective date, reason | active scoped values, mapping continuity, transfer permission | old and new assignment snapshots |
| Change Designation / Promotion | new title/grade, effective date, reason | work level and payroll impact detection, applicable approval | employment event; downstream proposal only |
| Change Employment Type | new type, start/effective date, supporting agreement | policy, date overlap, legal approval | new episode/version if model warrants |
| Probation / Confirmation | confirm/extend, reason, effective date | workflow, due date, reviewer separation | durable decision; never auto-confirm by timer alone |
| Set Status | allowed next state, effective date, reason | state-machine enforcement, impact notice | audit & lifecycle handoff |
| Archive/Reactivate | confirmation, reason, scoped permission | retention, payroll/attendance references, appropriate reversible state | hide from active default without hard-delete |
| Rehire | prior worker reference, new employment episode | dedupe/mapping rules, no ID overwrite | preserve historical episode |
| Link Portal User | verified identity, authorization | proof of ownership and access policy | user↔employee association, audit |

## History design
Show chronological employment timeline with effective date and recorded timestamp. Group events by employment episode; supporting attachments visible only to permitted users. Include `Compare before/after`, origin `HR/manual/import/integration`, approval status, event reason, related workflow ID. Distinguish job history from technical system audit. Retroactive corrections append a correcting event, never rewrite past event secretly.

## State transition requirements
Status names and allowed transitions **must come from approved PRD and existing enums**, not guessed hardcoded UI lists. UI filters out impossible destinations but server independently rejects them. Any locked payroll period must not be retroactively mutated; downstream payroll adjustments are proposed with source version and human approval.

## Failure cases
Manager selected then changes company before submit: reject and require new scoped lookup. Target dept archived: field error. Same employee edited by another HR admin: 409 compare state. Workflow submitted with no approver: safe pending escalation queue, not silent autoapproval. Partial downstream outage: People change remains auditable, integration status pending/retry rather than pretending Payroll updated.


---

# WF-07 — Import, export, bulk operations

## Import wizard screens
1. **Upload:** dropzone + browse, CSV/XLSX types only if supported; template download, file size and privacy warning.
2. **Map columns:** preview first N rows and source→target mapping. Required fields prominent; users can `Ignore column`. No guessing hidden data types without review.
3. **Validate:** server-side dry run; duplicated employee number, missing manager, invalid dates, unauthorized columns, invalid company/branch, schema value mismatch and repeated rows. Group errors, filter `Errors only`, downloadable error report.
4. **Review:** `N ready / N invalid / N duplicates`, allowed merge/skip policy, back navigation preserving mapping, explicit confirm.
5. **Processing:** job ID, percentage when reliably tracked, completed/skipped/failed counts; refresh safe and resumable.
6. **Results:** row-level reference and exact error, downloadable authorized result and retry failed if safely idempotent.

### Import policies
Do not silently create cross-company workers. Dedupe using defined tenant/company/worker constraints; never merge solely by name or email. Sensitive fields require matching import permission and encryption handling. Dry run cannot mutate. Processing transaction boundaries documented. Per-row success means committed, not just queued. Duplicate upload retries use hash/idempotency logic without suppressing legitimately corrected files.

## Export
Scope `Selected` / `Current filtered view` / `All authorized employees` with exact row estimate. File fields selected from **field-level authorized** column catalog, sensitive export requires explicit grant and audit. Show export job progress, expiry and controlled download (signed short-lived URL or authorization proxy). No spreadsheet formula injection: escape exported values beginning `=`, `+`, `-`, `@` where applicable. Keep protected data out of filenames and notification payloads.

## Bulk
Selection mode `Visible page` vs (if supported) `All matching` with clear scope preview; bulk action authorization evaluated per record on server. Confirm impact with count and approval. Ineligible rows skipped or fail with reasons; no false all-success. Effective date applies only to semantically consistent bulk updates. Results include job ID, counts, retriable failed rows. Audit event per changed record plus grouped batch identifier. Never hard-delete employee history.

## Cases
Unexpected file column, BOM/UTF-8, empty file, >configured file size, duplicated columns, CSV formula content, malicious file, cancelled upload, tab reopened, partial job failure, stale membership grant mid-job, exception in row 200 of 500, old mapping after schema change, jobs scoped to wrong company, export expires/revoked.


---

# WF-08 — ERPNext-style record audit, activity, comments

## Goal
Record-level **Activity & Audit Trail** like a modern ERP document timeline, backed by immutable server events and scoped audit service; not created by comparing unsaved frontend objects. Workplace operations must remain explainable with effective vs recorded time.

## Canonical event proposal (map onto existing AuditLog / EmploymentEvent)
```json
{
  "eventId":"uuid",
  "accountId":"server-verified",
  "orgId":"server-verified-legal-company",
  "product":"people",
  "objectType":"employee",
  "objectId":"stable-current-employee-id",
  "eventType":"employee.designation.changed",
  "actor":{"kind":"user|system|service","id":"principal-id","displayName":"safe-label"},
  "recordedAt":"ISO-8601 UTC timestamp",
  "effectiveDate":"YYYY-MM-DD (if business event)",
  "correlationId":"request-or-workflow-id",
  "batchId":"optional",
  "status":"applied|proposed|approved|rejected|failed",
  "reason":"safe-note-or-redacted",
  "changes":[{"field":"designationId","from":"safe-name-or-mask","to":"safe-name-or-mask"}],
  "metadata":{"source":"ui|import|worker|integration","version":1}
}
```
**Illustrative envelope only; do not create competing tables or copy raw PII into metadata.** Use existing actor/ID/status schema if present, with ADR for missing fields.

## Timeline UI
Record tab `Activity` with tabs/filters `All activity`, `Field changes`, `Approvals`, `Documents`, `Comments`, actor/date. Each event shows icon, action, named authorized actor, local display time with full timestamp tooltip, effective date when different, expandable before→after diff, reason, related workflow, actor/source. Infinite pagination only if stable cursor and focus preserved. Comments have their own visual tone, edit/delete policy, and must not be editable audit system events.

## Difference from Employment History
**History** = semantic employment snapshots as-of date (designation/manager/department/status); **Activity** = who did what, when and via which workflow including rejected actions, exports, and reads only where policy requires. Do not treat comment or failed request as an effective employment change.

## Integrity and privacy
- Events are written server-side within transaction or durable outbox; ensure created/updated record is not committed without corresponding required audit evidence.
- No normal user can delete/rewrite system events. A legal privacy redaction may hide content while preserving system evidentiary metadata under approved retention policy.
- Field-level privacy permissions apply to past and current values. No raw ID docs, bank details, passwords, portal PINs, personal address or email in unrestricted diff, log, notification, support trace, or export.
- Deleted/revoked employee record URL must not reveal an otherwise hidden audit entry; export guard rechecks entitlement at download.
- Import/bulk operations correlate batch IDs and exact target records; event deduplication prevents retry spam.
- UTC storage; local display and original timezone; dates never inferred from naive local times.
- Audit retention and DPDP mapping require counsel/policy approval, not implied certification.

## High-value tests
A1: create/edit/transfer/approval leaves expected event in timeline. A2: same request replay does not duplicate event. A3: viewing with lower permission masks both before and after. A4: actor becomes inactive: historic display remains stable without granting access. A5: unrelated company cannot retrieve event via guessed event ID. A6: no timeline entry when transaction rolled back; failed attempt logged through applicable security audit instead. A7: comments do not rewrite system event. A8: backdated event shows recorded/effective separately.


---

# WF-09 — Mobile, tablet, responsive details

## Breakpoint strategies (implementation may adapt to existing design system)
- ≥1280px: global rail + local sidebar visible; table expands in available workspace; optional profile context rail.
- 1024–1279px: keep shell behavior from shared Clor; no hard-coded content minimum width that causes horizontal page scrolling.
- 640–1023px: collapse People navigation as shared shell intends; table prioritized columns; filters in sheet.
- <640px: compact People header; Workforce list cards; full-screen edit/import steps; bottom-sheet filters; minimum 44px tap targets where practical.

## Mobile directory card
First line name + status; secondary line Employee ID, designation; department + location; ellipsis with permitted actions; tapping card navigates except inner controls. Search remains easy to access. Filters show active chip count; bottom `Apply (N results)` only when reliable count available. Bulk selection enters explicit `Select` mode; never hide controls in hover-only overlay.

## Mobile profile
Sticky or scrollable tabs `Overview, Personal, Employment, Organization, Documents, History, Activity`. Header compact with back, employee name/ID, More. Sensitive personal data masked. Each section uses labelled rows with meaningful overflow actions. `Edit` may open full-screen form; audit lives in one full tab instead of cramped right context rail. Consider sticky CTA only if it cannot cover fields when virtual keyboard opens.

## Mobile forms
One field per line, grouped section titles, expand search selectors as bottom sheets/full-screen list; clear keyboard-friendly labels, `Next` input action where appropriate, in-step validation, sticky footer that adapts to on-screen keyboard and safe areas. `Back` retains entered values. Photo/document upload from browser capability only; respect denial/cancellation and don't promise native camera integration unless supported.

## Accessibility / ergonomics
- Android/iOS browser testing, 360×800 and 390×844 as minimum references, landscape and 200% text scaling.
- Labels stay visible on focus; tappable error links; document upload can be operated without drag/drop.
- VoiceOver/TalkBack focus order, keyboard tab order and sheet dismissal tested.
- Virtualized lists announce loading / item count; avoid expensive avatar image loading on metered networks.
- Offline page retains read-only previously loaded information only according to storage/privacy policy; no sensitive caching by default.

## Browser/mobile events
Rotate phone mid-wizard → state intact. Keyboard opens near bottom CTA → field scrolled above keyboard. Switch app away/back → no duplicate submit. Poor 3G network → skeleton then recoverable Retry. Pull-to-refresh if implemented uses real API; no implicit destructive reset. Company switched on desktop while mobile tab still open → server reauthorizes next request and cache invalidation triggers.


---

# WF-10 — Keyboard, hover, state machine, failures, accessible UX

## Interaction map
| Interaction | Expected response | Edge case |
|---|---|---|
| Hover interactive row | subtle highlight; no column shift | touch devices never rely on hover |
| Click outside combobox | dismiss suggestions; preserve typed value per control policy | nested calendar click must not count as outside |
| Press Escape | dismiss top-most popup; focus returns to trigger | unsaved modal does not discard data silently |
| ArrowDown / ArrowUp in listbox | move active option | virtualized option IDs available to AT |
| Enter in combobox | select active option, close and announce | IME composition must not accidentally select |
| Enter in search | commit search | no form submit |
| Enter in textarea | newline | not submit |
| Enter in multistep text field | never create employee implicitly | focused Next button still works |
| Tab / Shift+Tab | logical focus order | modal trap only for modal dialog |
| Click row checkbox | select only | must not open profile |
| Clear input | clear itself, re-query as appropriate | other filters intact |
| Open second menu | dismiss incompatible first menu | prevent overlay stacking |
| Save repeated click | single request/idempotency | show loading/disabled not frozen |
| Close dirty edit | confirm Discard / Stay / Save Draft if supported | browser unload protection where available |
| Switch company | clear scoped list, selected rows, caches, drawers, events | fail closed on stale token |
| 409 conflict | present comparison, allow review/reload | no silent overwrite |
| 401 expired | login/recover authorized draft state | no leaking content to other session |
| 403 denied | restricted screen, safe backlink | no hidden record hints |
| 404 missing | friendly not found | no sensitive difference vs unauthorized |
| 429 rate limited | preserve filters/draft, obey Retry-After | avoid retry storm |

## State inventory
Initial loading skeleton; refresh retaining last known non-sensitive data; truly empty; filtered no results; loading filter options; no search matching; image fallback; missing employee avatar; permission-hidden action; disabled by unsubscribed module; offline hint; actual API unreachable; server error with reference ID; 401 expired session; 403 forbidden; 404; 409 conflict; 422 validation; 429 throttle; upload rejected/scan pending; import in progress/partial failure; export expired; save optimistic rollback; realtime stale data; background job failed; deactivated employee; missing integration entitlement. Each state needs explicit copy, CTA, retry policy and preservation statement.

## Error templates
- **No internet connection:** `Check your connection and try again.` Buttons `Retry`, optional `Back`; don't claim no internet from `navigator.onLine` alone.
- **Slow connection:** `Still loading employee records…` show skeleton or retained list, without timeout guess. Button Retry only if idempotent.
- **Could not save:** `Your changes have not been saved. They are still available in this form.` Button `Try again` and cancel with guard.
- **Permission restricted:** `You don’t have access to this employee record.` `Back to Workforce`.
- **No employees yet:** `Add the first employee to start your workforce directory.` `Add Employee` only when authorized.
- **No matches:** `No employees match these filters.` `Clear filters`.
- **Conflict:** `This employee record was updated elsewhere. Review changes before saving.` `Compare`, `Refresh`.

## Visual/accessibility acceptance
WCAG 2.2 AA target: 4.5:1 for normal text (exceptions per standard), visible focus, semantic labels, aria-expanded and aria-controls, field help `aria-describedby`, live regions for save/loading, keyboard-close dialogs, adequate pointer target spacing. No inaccessible disabled-tooltip-only actions; errors describe how to resolve. Skeleton animations disabled under reduced motion. Prevent layout shift when status badges or inline errors appear.

## Performance guidance
Use targeted queries; avoid fetching all personnel, document metadata or audit trail on first directory render; lazy-load profile tabs. Reasonable loading response; no invented performance SLA. Instrument real-user metrics and error/latency thresholds agreed in testing. Reduce avatars on low bandwidth and cache only policy-allowed data.


---

# WF-11 — Authorization, privacy, audit and product integration

## Server authorization chain
`Authenticate → Resolve Account + Org from trusted session/membership → Verify People subscription/entitlement → Verify named app grant → Authorize action → Apply company/branch/team/employee/field scope → Enforce approval workflow → Perform + Audit`.

UI hiding a menu is not authorization. Every read/list/count/search/export/background job/attachment fetch/event lookup has its own effective guard. Admin of another product ≠ People administrator. A company's owner ≠ automatic employee medical/bank record viewer. CA firm staff may only see client company records via approved delegated grants.

## Proposed permission capabilities (map to existing permission catalog)
| Capability | Example policy names (illustrative) | Scope |
|---|---|---|
| directory read | `people.employee.list/read` | selected company and granted employee scope |
| employee create/edit | `people.employee.create/update` | company + allowed fields |
| personal restricted view | `people.employee.sensitive.read` | per classification and explicit need |
| document upload/download | `people.employee.document.write/read` | document type, employee, company |
| employment change | `people.employee.change.submit/approve` | workflow context and separation of duties |
| archive/reactivate | `people.employee.archive` | guarded high-risk permission |
| import/export | `people.employee.import/export` | row and field scope, job/grant expiry |
| audit read/export | `people.audit.read/export` | record event and per-field redaction |
| saved shared view | `people.directory.view.share` | view ACL, org scope |

## Roles (sample UX personas, not automatic backend role creation)
People Admin, HR Operator, Manager, Employee Self-Service, Auditor (read-only limited scope), delegated CA staff with explicit per-client People grant. Role names alone never grant access; use actual scoped permission assignments. People supports no-login employees; self-service is separately authenticated/linked.

## Security negative testing
- User A for Account 1 cannot see Account 2 through guessed employee ID, company switch query or export job ID.
- One account with Company A and B: HR with only A cannot list or download B records.
- Manager without sensitive read cannot view old/new values in audit diff, export, or preloaded JSON.
- Unsubscribed People account cannot invoke People route even if hidden button is pasted into API.
- CA firm Books-only delegate cannot view People employee records for client.
- Revoke membership/role in another session invalidates list/profile/document/signed URL access appropriately.
- Untrusted background job/company parameter must not bypass RLS; any privileged maintenance path is separately audited.

## Document privacy
Use R2 through authorized API and short-lived signed requests; private object keys tenant-bound. Storage upload validates MIME/signature/file size, scan strategy and access classification; never create public object URLs for PII. Download URL expiry, revocation and logging required. Existing `Employee.devicePassword`/portal secrets must never be displayed/exported/audited in cleartext.

## Cross-app integration
Workforce UI owns HR employee detail, People employment event and manager structure. Attendance owns raw punches and device interactions; Payroll owns salary and final calculations. If app not subscribed, show `Connect Attendance` / `Requires Payroll` only through authorized product upgrade/deep link, without fake absence values. Never cross-join other product DB tables in UI; route through authorized APIs/events with versioning. Preserve employee IDs, avoid moving Attendance tables merely for conceptual diagram purity.

## Privacy/compliance note
Data minimization, purpose-limited collection, role-based retention, consent/notice workflow, export and audit redaction are mandatory design concerns. Statutory and DPDP conformity require a separate current legal review; this spec is not legal certification.


---

# WF-12 — API/UI contracts to reconcile (NOT confirmed endpoints)

All paths below are **interface sketches**. Agent must map to existing People router names, `Org`/Account context resolver, Prisma models, field-permission service and versioning scheme. DO NOT generate duplicate endpoints just because a path appears here.

| UI operation | Suggested contract shape | Guard + behavior |
|---|---|---|
| Directory list | `GET /people/employees?search&cursor&sort&filters` | authorized rows, permitted columns and count; no client scope trust |
| Directory statistics | `GET /people/employees/summary` | as-of timestamp, count definition, scope parity |
| Filter options | `GET /people/employees/filters` | only company-valid and role-visible values |
| Create | `POST /people/employees` | schema validation, server ID, idempotency, atomic audit |
| Profile | `GET /people/employees/:id` | field redaction, ETag/version, current episode |
| Edit | `PATCH /people/employees/:id` | version/If-Match, per-field authz, audit |
| Employment history | `GET /people/employees/:id/employment-events` | effective timeline, scoped pagination |
| Activity events | `GET /people/employees/:id/audit` | redaction and actor access; stable cursor |
| Employment change | `POST /people/employees/:id/changes` | workflow/approval checks and source version |
| Import dry run | `POST /people/employees/import/validate` | no writes, scoped field mapping |
| Import commit | `POST /people/employees/import` | resumable background job, idempotency |
| Export | `POST /people/employees/export` | async authorized job, secure download |
| Bulk operation | `POST /people/employees/bulk` | per-record authz + partial-result report |
| Documents | existing People document endpoints | object ACL and signed expiring access |

## Responses / error envelope proposal
```json
{
  "data": { "id": "stable-employee-id", "version": 12 },
  "meta": { "companyId": "server-resolved-company", "asOf": "UTC" },
  "error": null
}
```
Errors must include machine code (`VALIDATION`, `FORBIDDEN`, `CONFLICT`, `RATE_LIMIT`, `UNAVAILABLE`), safe message, optional `fieldErrors`, optional support `traceId`, no raw SQL stack or tenant-private info. Reuse existing API envelope in source over this sketch.

## Concurrency and idempotency
Mutating requests should accept expected version or `If-Match`; 409 on mismatch with accessible resolution. Creation/import/bulk should use an idempotency mechanism or dedupe ledger. Make `Save` disable during in-flight request, but never rely on UI-only duplicate prevention.

## Data model facts to recheck
Source audit saw People `Employee`, `Department`, `JobPosition`, `EmployeeType`, `EmployeeDocument`, `EmploymentEvent`, `PeopleRecord`, `BusinessUnit`, `Grade`, `CostCenter`, `EmployeeNote`. Do not assume new Worker/Employment tables already exist. If schema normalization is approved, use backward-compatible mapping and preserve all existing payroll/attendance references.

## Testing fixtures
Two accounts; 2 companies in one account; employee without user; employee rehire; duplicate company employee number; manager chain cycle; private identity document; HR operator and manager partial access; CA delegated user with Books-only; queued and rejected employment operation; old payroll snapshot; document expired URL; concurrent profile writes; 500-employee import with bad rows.


---

# WF-13 — Functional/visual QA and evidence gates

## Gate WF-00 — Source audit (read only)
Pin live git SHA and PRD version; manifest People routes, screens, models, company selectors, permission and product guards, imports, audit and integrations. Snapshot current UI desktop/mobile. Map each workbook item to EXISTS/PARTIAL/ABSENT/CONFLICT/PROPOSED. List blockers, compatibility routes, migrations and return before coding dependent data/auth changes.

## Gate WF-01 — Shell + design system
Existing global app rail preserved across Books/People/Payroll/Attendance; People local nav label Workforce; exactly one company switcher; responsive collapse test; no duplicate sidebar route for employee forms.

## Gate WF-02 — Directory
Page data matches current account/company/employee scope; filters and selections work, sensible performance at scale, mobile cards, saved views and bulk toolbar working when supported. Hover/focus/keyboard correct; empty/offline/retry views tested.

## Gate WF-03 — Profile
Tabs deep-link, independent field visibility, sensitive masking, no duplicated panels, async documents/activity properly authorized, employment history effective-dated.

## Gate WF-04 — Forms
Field map reconciled against approved PRD/model; creates employee without platform login, uniqueness and date rules; server validation; dirty/409 conflict; retries safe; no accidental Enter creation.

## Gate WF-05 — Employment operations
Manager changes and transfers respect hierarchy/approval, preserve historical validity; archive does not hard-delete; payroll and attendance references unchanged. Failure and partial event publishing tests.

## Gate WF-06 — Import/Export/Bulk
Dry-run works; row-level validation and idempotent processing, restricted fields absent from unauthorized exports; cross-company job downloads denied; formula injection prevented.

## Gate WF-07 — Audit
Every material successful change yields actor/action/date/effective-date/diff in server event; failed attempts follow security policy; events are scoped/redacted; no client-only history.

## Gate WF-08 — Responsive + states
1440 desktop, 1024 tablet, 390 & 360 mobile, 200% zoom, keyboard-only, VoiceOver/TalkBack where available. 401,403,404,409,422,429, 500/503, offline/slow, import partial and upload failure states. No hidden state that destroys unsaved input.

## Gate WF-09 — Security and regressions
Run positive and negative account/company/app/user/field/document/event tests and shared shell regressions; RLS/entitlement/maker-checker Tenant Platform dependencies proven. Attendance biometric/punch ingestion and Payroll reference regression preserved.

## Gate WF-10 — Signoff & rollout
Evidence register has commit/PR, executed test command and output, reviewer, date, exact screenshot, residual risks. Fix critical a11y/security issues, document rollback/flag, no destructive production migration without staging+approved rehearsal. Completion only when evidence verified.

## Evidence definition
Screenshot alone = visual evidence only; cannot mark functional tasks done. A generated design asset = concept. Code presence = implementation candidate, not deployed behavior. A passing unit test with mocks = limited evidence, not backend authorization coverage. Any checkbox remains TODO without explicit verifiable test artifact.
