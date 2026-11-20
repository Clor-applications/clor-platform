# Design audit: whole platform against DESIGN.md (20 Nov 2026)

Maturity: L1 (DESIGN.md, "the calm register"; no Figma library). Scope: shell and shared UI,
Workspace, Ops console, People, the employee portal, Payroll, Attendance. Books, printed
documents and wording (audited the same day, `docs/ux-copy-audit-2026-11-20.md`) are out.
Read-only: nothing was changed. Counts are from grep and approximate.

## Summary

Colour discipline is good: almost no raw palette classes or hex in app chrome. Most of the drift
comes from **shared CSS and shared components that still carry the pre-19 Nov rules**, so one fix
there corrects many screens. The four biggest classes:

1. Old shared defaults: list shell boxed in a card, empty state with an illustration, uppercase
   labels, 16px section heads, 64px bar and 80+192px menu, app-colour washes.
2. Formatting: dates as dd/mm/yyyy or ISO, money rounded to whole rupees, ₹0 instead of "—".
3. Tiles and tags: figure tiles on list pages and at zero; tags on expected rows; exceptions
   never sorted first.
4. Approvals and primaries: primary "Approve" per row or card instead of tick and cross.

## Fix first: shared layer (one change, many screens)

| # | Rule broken | Where | Fix |
|---|---|---|---|
| S1 | No box around a list | `DocumentListShell.jsx:204` boxes by default (1 of ~45 callers opts out) | Plain is the default |
| S2 | Empty state: no illustration, 12px hairline block | `Primitives.jsx:253` `EmptyState`/`ListEmpty` (~118 files) | Drop art on lists, one line, one button |
| S3 | Sentence case, no tracking | `.ui-t-label`, `.ui-kpi-label`, `.ui-section-label`, `.ui-eyebrow`, `.pt-tile-label`, `.people-kpi-label` (~40 uses) | Remove uppercase and letter-spacing |
| S4 | Section 17/24 600 | `.ui-t-sec` 16px (77 uses), `.ws-h2` 16px, `people.css` 17px at 700 | One rule in `rnd.css` |
| S5 | Shell 56px bar, 216px menu, 36px items 14/500 | `rnd.css:328`, `:448`, `:550`, `:613` | Match DESIGN.md Layout |
| S6 | App colour has four jobs | `--tint` washes in ~45 CSS rules + 15 JSX (suggest options, pager, tabs, chips, icon tiles); bulk bar filled (`picks.css:444`); Ops staff bar (`ops.css:84`) | Hover grey + check; neutral bars |
| S7 | Dates in words | `formatDateIn` defaults to dd/mm/yyyy (`utils/dates.js:48`); ~10 local `shownDate` in Payroll; ~9 raw ISO in Attendance | One `dateWords()` everywhere |
| S8 | Money: two decimals, "—" at zero, true minus | `wholeRupees` (~13 Payroll files, 5 People), `rupees()` drops `.00`, `ops/money.js:12`, ~57 ₹0 cells | One money cell formatter |
| S9 | Focus 3px ring at 28% | 2px outline (`rnd.css:286`), fields 3px at 18% | One focus rule |
| S10 | Dialog 420px, 12px radius, no blur | 384px (`Toaster.jsx:143`), radius forced 8px (`index.css:6172`), blurred scrims | Fix the shared dialog |

## Per app: P1

**Workspace and Ops**
- Workspace Home keeps the 16 Nov glass look: 28–40px title at 800, glass cards with shadows,
  gradients, glass button, art stage, more than four figures (`ws-overview.css`, exempted at
  `workspace.css:3580`).
- Figure tiles on list pages and at zero: Ops Access refused (`Lists.jsx:373`), Subscriptions
  (`Deals.jsx:295`), Ops Home and Insights zeros, Workspace "Waiting on you" 0. Ops never uses
  `CountLine`.
- "Active"/"On" tags on every normal row in ~25 places (Members, Users, Branches, Companies,
  Security, SSO, Credentials, Ops Customers, Payments, Tickets, Limits). `ExceptionTag` used 0
  times; three local `StatusPill`s.

**People and employee portal**
- Portal: lists in cards, ~19 stacked cards on Me, no 24px title per tab (only the sign-in
  page has an h1, at 20px). ~60 `ui-card` uses.
- Portal team approvals: primary "Approve" per card (`EmployeePortal.jsx:1571`), a tag on items
  that are all waiting.
- Tags on expected rows in ~15 lists (portal pages; Talent `Pill` maps: Referrals, Reviews,
  Plans, Openings).
- `exceptionsFirst` used 0 times in People.

**Payroll and Attendance**
- Attendance Today: six tiles with coloured 3px bars, tinted chips, 28px figures, zeros
  (`AttendanceToday.jsx:212`). Payroll Overview: eight figures, shown at zero. Tiles above the
  slips list (`PayRuns.jsx:517`) and on ID mapping.
- Tags on every row: Loans ("Being recovered"), Attendance records (status + validated + trust),
  Devices, Transactions (raw IN/OUT). `exceptionsFirst` used in 1 of 16 tagged lists.
- Approvals: primary Approve without icon (Loans), text-only Approve (Attendance records).

## P2 (clear, local)

- **Off-scale type:** ~100 CSS sizes at 11/15/16/18/20/26/28/36px; ~30 `text-lg`/`text-xl`/`text-2xl`
  for figures; `.ui-t-page` 28/36; Ops console title weight 800; 121 `font-medium` outside menus.
- **Cards around tables and forms:** ~49 `ui-card overflow-hidden` around Payroll and Attendance
  tables; 12 forms boxed in cards; `FormSection` is a tinted card, not a heading over a 2px rule.
- **Total rows:** none on the slips register; journal total at 500; `.ui-total-row` 16/20 with no rule.
- **Several primaries per screen:** Workspace Support access (per row), Ops Pricing, Payments.
- **Confirmations as drawers:** `ReasonDrawer` 42 times in Ops.
- **Control heights:** compact 28 (spec 32), phone 48 (spec 44), chips ~28px pills (spec 32 at 8px).
- **Charts:** week bars in `--act`, Today chart in `--cat-1`; ink first.
- **Phone:** no two-line row anywhere outside People's `DataTable card=`; 52 columns just hidden;
  portal controls at 36px except on Me; tab labels 11px.
- **Pickers:** 147 raw `<select>` in Payroll/Attendance, 37 in shared UI; `FilterSelect` exists only
  in Workspace's `wsKit`.
- **Motion:** 200ms surfaces, 320ms enter, row stagger up to 240ms (spec 120/150/180, numbers still).
- **Rail ground** `#F3F3F0` (`rnd.css:53`): owner asked for it 17 Nov; DESIGN.md (19 Nov) says white.

## P3 (polish)

Radii off 8/12 (~30 shared, plus 2/3/4/6/10/18px in apps); shadows on flat panels; blur on the org
chart legend; tinted selection rows; `--fg-subtle` used for real information (~45 rules); a leftover
`prefers-color-scheme: dark` block (`index.css:3932`); dead decorative CSS (`.ui-ambient`,
`.ui-float`, `.ui-tilt3d`, `.ui-hero-wash`, `KpiTiles`, `.att-kpi*`); "Loading…" text in place of
skeletons in the portal (~27 places).

## Component gaps (need your approval before building)

DESIGN.md names these but no shared component exists, so each screen hand-rolls it:

| Gap | Type | Used by | Proposed |
|---|---|---|---|
| G1 Tick and cross approval buttons | New | People, Payroll, Attendance, Workspace, portal | `ApproveActions` in `packages/ui` from People's `ui-decide-btn` |
| G2 Phone two-line row | New | Every wide table | A `twoLine` mode on the shared table: name left, key amount/state right |
| G3 Section heading over a 2px rule | Update `FormSection` | All forms | Replace the tinted card |
| G4 Total row | New style | Payroll, Reports | Bold over a rule, in the table component |
| G5 Money and date cells | New helpers | Every table | `moneyCell()`, `dateWords()` |
| G6 Page header with count line and one primary | Promote | Workspace `PageHead` (in `wsKit`) | Move to `packages/ui`, use in Ops |
| G7 Searchable select | Promote | `FilterSelect` (in `wsKit`) | Move to `packages/ui` |

Also unused shared parts that should be used: `ExceptionTag` (0 in Workspace/Ops), `exceptionsFirst`
(2 callers in total), `CountLine` (0 in Ops), `SuggestInput` (0 in Workspace/Ops), `EmptyState`
and skeletons (0 in the portal).

## Good (models to copy)

- `CountLine` and `ExceptionTag` (shared); the menu and table rules in `rnd.css`.
- Payroll **Bank changes**, Attendance **Data requests**, Workspace **Invitations** and **Invoices**,
  People **Approvals** and **Organisation overview**: count line, flat list, tags only on
  exceptions, tick and cross, dates in words.

## Suggested order

1. Shared layer S1–S10 plus gaps G1, G5, G7 (one PR each; most screens improve at once).
2. Tiles and tags per app (P1 lists above), using `CountLine`, `ExceptionTag`, `exceptionsFirst`.
3. Workspace Home and the employee portal (largest single-screen rework).
4. Phone two-line rows (DESIGN.md migration step 5) with G2.
5. P2 type, cards and controls; then P3 clean-up.
