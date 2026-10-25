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
