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
