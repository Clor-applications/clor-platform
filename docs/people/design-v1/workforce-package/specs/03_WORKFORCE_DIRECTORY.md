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
