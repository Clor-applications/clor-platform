# Design System — CLOR

Preview (rendered): https://claude.ai/code/artifact/b5f06c26-a4de-4879-979f-fbb1e88ad45a

## Product Context
- **What this is:** GST accounting and business SaaS for Indian SMEs, expanding from Sales / Purchase / Inventory into Payroll, CRM, Attendance and Projects.
- **Who it's for:** CAs, accountants and SME finance teams who live in the software all day.
- **Space:** Tally, Zoho Books, Vyapar, QuickBooks India. All either dated or generic.
- **Project type:** dense data web application.
- **Memorable thing:** *Serious software for serious work.* Calm, obviously accurate, never shouts. Trust is the product.

## Aesthetic Direction
- **Direction:** Instrument — industrial-utilitarian, refined.
- **Decoration level:** minimal. Typography and spacing carry the page.
- **Mood:** a precision tool. Data is the interface; chrome gets out of the way.
- **Removed:** ambient colour effects (`ui-ambient`) leave product screens. Product chrome stays monochrome.

## Do's and Don'ts

The rules below are stated in full in the sections that follow. This is the
scan-first list — if you read one part of this document before writing a
component, read this one.

### Do

- **Take every colour from a token** in `src/index.css`. Dark mode is a token
  redefinition, so a literal colour is a light-mode-only colour.
- **Set every amount in tabular figures** and align it by what it is, not by
  being a number — see *Value alignment*.
- **Use the shared control height**: 36px, or 28px where a table cell genuinely
  cannot hold 36.
- **Give a status both colour and text.** Colour alone is not a state.
- **Let one screen have one primary action**, top right.
- **Measure before you change geometry.** Every number in this document came
  from the rendered app; an audit that quotes an older draft of this file will
  send you the wrong way.

### Don't

- **Don't use a raw palette class** — `bg-gray-*`, `text-stone-*`,
  `border-slate-*` — anywhere in app chrome. The only exception is a printed
  document (`InvoicePreview`, `ExpenseVoucher`, `DocumentPrintView`,
  `TemplatePreview`), which is black on white on purpose and does not follow
  the theme.
- **Don't nest a card in a card.** A list is the page under one hairline; a
  document earns a surface.
- **Don't introduce a third radius.** 8px clickable, 12px content, `999px`
  pills. The keycap is the one written-down exception.
- **Don't add a Tailwind shadow utility.** Three tokens, and they carry meaning
  — a hard-coded `shadow-sm` does not follow the dark-mode redefinition.
  **57 of them are still in app chrome** (37 in `App.jsx`, the rest spread over
  twelve files; none in the print surfaces). Legacy, counted 2026-09-18, not
  yet migrated — do not add a fifty-eighth.
- **Don't put a hover lift on something that isn't clickable.** A lift is a
  promise.
- **Don't right-align a lone money input** because money is usually
  right-aligned. One field is not a column.
- **Don't reach below 12px type** in app chrome.
- **Don't size a panel row by the window.** The rail takes 224–240px off it
  first — that arithmetic is what put a five-column table in a 383px panel.
- **Don't let a wide table clip.** It scrolls in its own container, or its last
  columns are unreachable and nothing says so.
- **Don't write an arbitrary z-index.** The layer tokens are the whole scale;
  `z-[9999]` is what a number becomes when nobody knows what it must beat.
- **Don't pick an icon size by eye.** Four roles: 12 / 14 / **16 default** / 18.

## Typography
Loaded from Google Fonts in `src/index.css`. **One face: Inter** (2026-09-13, the
Graphite type decision adopted ahead of the rest of that system). Fraunces and
both Geists are out; rank comes from size and weight, never from switching
family.

- **Everything:** Inter — tabular figures, large x-height, wide weight range.
- **Money:** Inter, `font-variant-numeric: tabular-nums` (inherited from `html`) — columns align to the digit, right-aligned.
- **Code / voucher numbers:** Inter with ligatures off (`.ui-mono`); marked by alignment and context, not a second typeface.

### Scale
| Role | Font | Size / line | Weight | Notes |
|------|------|-------------|--------|-------|
| Page title | Inter | 28 / 36 | 700 | `letter-spacing: -.025em` |
| Section title | Inter | 16 / 24 | 600 | |
| Body, UI | Inter | 14 / 20 | 400–500 | |
| Table cell | Inter | 13 / 18 | 400 | |
| Money | Inter | 13 / 18 | 400 | tabular-nums, right-aligned |
| Label, caption | Inter | 12 / 16 | 500 | `.04em`, uppercase |

All visible headings use weight 700. Table headings use the shared graphite
header surface and step to the next grey on hover, so sortable and filterable
columns provide a clear cursor response without introducing another colour.

Nothing below 12px. Nothing between 16 and 24.

## Color
- **Approach:** restrained. One accent, and it means one thing.
- **Brand `#18181B`** (`--brand`): primary action and active navigation. The dark theme inverts it to off-white. This keeps controls strong without adding decorative colour.
- **Money semantics, never the accent:** in `#15803D`, out / late `#B91C1C`, attention `#A16207`.
- **Product chrome:** graphite only. Module icons, navigation, buttons, filters, and neutral KPI cards use the zinc ramp.
- **Neutrals:** cool graphite, `#FAFAFA` → `#09090B`, with white document surfaces and a white navigation rail separated by a quiet grey rule.
- **Dark mode:** redefine tokens only, never restyle components inside a theme block. Surfaces use true neutral blacks; money greens, ambers, and reds remain available for meaning.

## Spacing
- **Base:** 8px.
- **Density:** comfortable-dense.
- **Rhythm — two values in force, a third only intended:** 12 inside a group
  (`space-y-3`, 62 uses), 24 between groups (`space-y-6`, 129 uses).
  - **Page blocks are 24** (`space-y-6`), enforced on every screen root. Before
    2026-09-08 the product used 16 in 43 screens and 20 in 20 more — two values
    on no scale here — so opening one page after another shifted the layout for
    no reason a reader could name.
  - **40 between page sections (`space-y-10`) is written down and never used —
    zero occurrences.** It is an intention, not a rule the code follows. Either
    adopt it deliberately on screens that have distinct sections, or drop it
    from this document; do not cite it as an existing standard.
  - **16 (`space-y-4`) is legacy and still present inside cards and forms**,
    114 uses. It is off the 8-base scale and should migrate to 12 — but that
    tightens every form it touches, so it wants a screen-by-screen visual pass,
    not a codemod. Counted 2026-09-17; do not bulk-replace.

### Row and control height — measured, not assumed

Two table contexts, not one. An audit that quotes a single row height is
reading an older version of this file.

| Context | Row | Control |
| --- | --- | --- |
| List / data table (`.ui-table`) | **55px** (9px cell padding) | 36px |
| Dense line grid (`.ui-grid-dense`) | **40px** (1px cell padding) | **34px** |

Header rows: 37px on a list, 29px on a dense grid. The control tiers those
numbers refer to are defined once under *Controls → Height*.

## Layout
- **Approach:** grid-disciplined.
- **Shell:** left rail with module groups, content pane on page ground. The
  rail is **224px** from `md` and **240px** from `lg` (`md:w-56 lg:w-60`), and
  collapses to `.ui-rail-narrow`. Content is capped at 1920px and centres
  beyond that; page padding is 24px, 16px below `sm`.
- **Breakpoints are read against the window, the panels are laid out in what
  is left of it.** A row of three panels sized at `xl` (1280) is really sharing
  1040px once the rail is taken off, which is how a five-column table ended up
  in a 383px panel. Three-up rows wait for `2xl`; `src/test/overview-breakpoints.test.js` pins it.
- **Radius — two, not four:** 8px (`rounded-lg`) on anything clickable, 12px
  (`rounded-xl`) on anything holding content. `999px` (`rounded-full`) for
  pills and status labels only.
  - **One documented exception: the keycap, 6px.** A key is 22–28px tall; at
    8px the corner is a third of the height and the cap reads as a lozenge
    rather than a key. It also sets 11px type, below the 12px floor, for the
    same reason — a keycap is a glyph of a physical object, not running text.
    `.ui-kbd` is the canonical one. Two call sites still open-code it with
    `rounded-md` (the shortcut sheet's `<kbd>`, the ⌘K hint in the dashboard
    search); both are annotated in place and should converge on `.ui-kbd`, but
    their heights differ from it so that is a visual change, not a rename.
    Every other `rounded-md` was drift and is gone — a third is drift.
- **No card-in-card.** A list is the page: one hairline, no wrapper. A document is a discrete object: it earns a surface.

### Elevation — three tiers, and they mean different things

Shadow is not decoration here; it says how far a surface is from the page.
Three tokens, each redefined for dark mode rather than restyled.

| Token | Reads as | Applied to |
| --- | --- | --- |
| `--shadow-card` | Resting on the page | `.ui-card`, `.ui-stat`, `.ui-strip` — a hairline plus barely a shadow |
| `--shadow-pop` | Floating over the page | `.ui-popover`, `[role="menu"]`, the command palette, every open menu |
| `--shadow-lift` | Being picked up | `.ui-lift:hover` only — a card that is itself clickable |

Rules that come out of that:

- **A lift promises interactivity.** `.ui-lift` is opt-in and never goes on a
  plain content card. If it rises on hover, clicking it must do something.
- **The hover lift is gated** behind `@media (hover: hover) and (pointer: fine)` —
  on a touch screen there is no hover, and a sticky lifted state reads as broken.
- **Anything popped over a card takes the raised surface, not just a shadow.**
  `.ui-in-pop` (and `[role="menu"].ui-card`) switch to `--surface-raised`.
  In light both resolve to white so nothing changes; in dark, a menu opened on
  a card used to sit at exactly the card's colour with only a shadow between
  them. Shadow alone is not enough separation on a dark ground.
- **Shadows are token-only.** No `shadow-lg` or any Tailwind shadow utility in
  app chrome — dark mode redefines these three and a hard-coded shadow does not
  follow.

### Responsive behaviour — three layout classes

The product is desktop-first and stays usable from **911px to 3840px**; that
band is measured, with no page-level horizontal scroll anywhere in it. Browser
zoom is the same thing as a narrower window — 1366 at 125% is 1093 CSS px — so
the zoom levels are covered by the width band rather than tested separately.

| Class | Behaviour |
| --- | --- |
| **Dashboard / overview** | Panel rows collapse by breakpoint. Two-up rows at `xl`; three-up rows wait for `2xl` (see *Layout*). Below that they stack full width |
| **List / data table** | The page never scrolls sideways; the table scrolls inside its own `.ui-table-scroll`. A wide table scrolling in its container is correct, not a defect |
| **Document form** | The head grid reflows by column count (`sm:grid-cols-2 lg:grid-cols-3`, or a 12-column grid). The line grid does not reflow — it scrolls, because a line item read as stacked fields is not a line item |

Fixed points across the whole band:

- Content caps at **1920px** and centres beyond it. It does not keep growing.
- Page padding is **24px**, dropping to 16px below `sm`.
- Control heights never change with viewport — 36px is 36px at every width.
- **A table that scrolls inside its container is not a defect. A page that
  scrolls sideways is.** Those are the two different results, and only the
  second one is a bug.


## Controls

### Height — one baseline, one compact tier, four named exceptions

| Tier | Height | Where |
| --- | --- | --- |
| Baseline | **36px** | Every input, select and button in app chrome |
| Compact | **28px** | `.ui-ctl-compact`, `.ui-btn-sm` — column filters and in-table editors, where 36 will not fit |
| Dense grid | **34px** | `.ui-grid-dense .ui-input` / `.ui-select` — the line grid only |

The baseline is **36, not 40**. A generic spec will tell you 40; this product
was measured before that was adopted and 36 is what every screen already uses.
An override that merely restates the baseline (`!h-9`) is noise and
`src/test/control-geometry.test.js` fails on it.

Four exceptions, each deliberate:

- **`.ui-icon-btn` is 36px, and 28px only inside `.ui-table tbody`.** A second
  rule at higher specificity. So `!h-9` on an icon button *inside* a table is a
  real decision; outside one it says nothing.
- **28px in-field actions.** A mark sitting inside a 36px input: at 36 it fills
  the field edge to edge.
- **44px POS primary** (`!h-11`, the checkout button) — a touch target on a
  counter, used at arm's length.
- **28px POS steppers** (`!h-7 !w-7`) — quantity ± beside a cart line.

### Icon size — four roles, not ten numbers

Ten different icon sizes were in use, and the two biggest were 15px (155) and
16px (145) doing the *same job* — inline and button icons, one pixel apart.
That is not a scale, it is two people's defaults.

| Role | Size | Where |
| --- | --- | --- |
| **XS** | 12px | very compact metadata, tiny supporting marks — only where 12 stays legible |
| **SM** | 14px | compact table actions, compact buttons, dense inline marks |
| **MD** | **16px** | **the default.** Buttons, form and entity icons, toolbar controls, menu items, ordinary inline icons |
| **LG** | 18px | page-heading icons, prominent navigation and context icons |

Reach for MD unless the context is genuinely compact or genuinely a heading.

**Exempt:** illustrations and empty-state artwork (48–104px), which are drawings
rather than icons and are sized to their composition.

**Exceptions still in the code**, small and deliberate, to inspect before
changing: 11px (14 uses) and 10px (5) on compact status and supporting marks —
a status dot enlarged to reach a token is a worse status dot — and 20px (3) on
deliberately prominent buttons.

### Icon stroke — three different things

- **UI icons** (Lucide) take the library's own stroke. It is not overridden per
  call site, and the library default is the product default because a mixed
  stroke across one toolbar reads as a rendering fault.
- **Illustrations** (`AuthIllustration`, `ui/Illustration`, the inline SVGs in
  `AuthGate`) are artwork. They carry their own optical strokes — 1, 1.5, 1.75,
  2, 2.5 — chosen against their own compositions, and normalising them to an
  icon rule would flatten the drawing.
- **Chart graphics** (sparkline paths, axis rules) are data marks. Their stroke
  belongs to the chart's readability, not to the icon scale.

Two Lucide-side overrides remain and are intentional: `Primitives.jsx`
(`strokeWidth 2.1`, compensating for empty-state icons drawn much larger than
interface size) and `DashboardOverview.jsx` (`1.5`, a sparkline, i.e. chart
artwork).

### Layers

Sixteen z-index values were in use, ending at `z-[9999]`. Measured in the
browser: a row-action menu at 9999 painted **over an open dialog**. It never
needed 9999 — the shell creates no stacking context, so a fixed overlay
competes in the root context and only had to clear a sticky table header at 20.
9999 is what a number becomes when there is no scale to consult.

| Token | Value | Layer |
| --- | --- | --- |
| `--z-below` | −1 | decoration painted behind content |
| `--z-base` | 1 | in-flow lifts — a table head against its rows |
| `--z-sticky` | 20 | sticky table headers and toolbars |
| `--z-header` | 40 | the app header |
| `--z-popover` | 60 | menus, dropdowns, pickers, **row actions** |
| `--z-drawer` | 100 | side drawers, the mobile nav (panel at 101) |
| `--z-modal` | 120 | dialogs |
| `--z-modal-popover` | 130 | a menu opened **inside** a dialog |
| `--z-toast` | 140 | notifications outrank what caused them |
| `--z-palette` | 160 | the command palette reaches over everything |
| `--z-tooltip` | 180 | last word, and never interactive |

The order is the rule; the integers are spaced only so a tier can be inserted
without renumbering.

**The two popover layers are the point.** A popover belonging to an open dialog
must sit above that dialog; an unrelated popover on the page behind it must sit
below. Same component, two answers — so `Modal` publishes its layer through
React context and `Popover` reads it. The DOM cannot answer this, because every
overlay portals to `body` and a popover's ancestors say nothing about what
opened it.

**Never write an arbitrary z-index.** `z-[9999]`, `z-[200]`, `z-[125]` are all
gone. A bracketed z-index at or above the drawer tier fails
`src/test/layers-are-ordered.test.js`. A small local `z-10`/`z-30` inside an
already-layered ancestor is fine — it orders siblings inside that ancestor's
context and cannot escape it.

**A third-party overlay joins the scale explicitly or it is outside it.**
Sonner's `Toaster` takes `style={{ zIndex: 'var(--z-toast)' }}` because Sonner
otherwise injects its own `z-index: 999999999` and would paint over the command
palette — the prop is the wiring, not a redundancy to tidy away.

**Before raising a z-index, check the stacking context.** A number cannot lift
an element out of an ancestor that has `transform`, `filter`, `backdrop-filter`,
`contain: paint`, `isolation` or its own positioned z-index. If an overlay is
trapped, portal it — do not escalate.

### Content width — measured, and smaller than it looked

An audit counted 69 `max-w-*` uses across master-data files and read them as
page-width drift. Measuring the rendered pages says otherwise: **document forms,
master forms, lists, dashboards and reports carry no page-level `max-w` at all.**
They use the full content column, which the shell already caps at 1920px and
centres beyond that.

So there are two page-width behaviours in force, not four roles:

| Behaviour | Applies to | Implementation |
| --- | --- | --- |
| **Full content column** | documents, master forms, lists, dashboards, reports | no page-level `max-w`; the shell's 1920px cap governs |
| **Compact** | settings and configuration pages | a page-level `max-w-2xl` (672px) |

The rest of the `max-w-*` values are **inner measure**, not page width: a
paragraph held to `[46ch]`, a totals block at `w-80`, a sub-panel at `max-w-lg`.
Those are correct and should stay per-component.

**A wide page is not a wide field.** Page width and field width are separate
systems: the form grid's column spans decide how wide an input is, and a date
stays a date on a 1920px screen. See *Controls → Value alignment* and the line
grid rules.


### Select

A select draws its own indicator: `appearance: none`, a chevron as an inline
SVG background, 36px of trailing room reserved for a 16px mark, and
`text-overflow: ellipsis` so a long value truncates rather than running under
it. The dark-theme stroke is a separate rule guarded by
`@media (prefers-color-scheme: dark)` — an unguarded `:root:not([data-theme='light'])`
also matches a light page.

**This belongs to `.ui-select` alone, never to the shared `.ui-input` block.**
Putting it there once gave every text input in the product a chevron.

### Value alignment

A figure is aligned by what it *is*, not by being a number. Named once, in
`.ui-val-left` / `.ui-val-center` / `.ui-val-right`, so it is not re-decided at
each call site.

| Kind | Alignment |
| --- | --- |
| Financial table column | **right** — a column is compared down its decimal |
| Financial summary / totals | **right** — it lines up with the column above it |
| Standalone monetary input | **centred** — one field is not a column, and a lone figure pinned right reads as a stray |
| Compact numeric entry | **centred** where the field is narrow enough that right-alignment crowds the edge |
| Text and entity fields | **left** |

A centred amount keeps its currency symbol with the number rather than pinning
it to the left edge — `.ui-money-centred` groups the two so they centre as one
thing.

**Do not reintroduce `text-right` on every money input.** That is the change
this table exists to prevent.

## Motion
- **Approach:** minimal-functional.
- **Duration:** 120ms state, 200ms surface.
- **No entrance animation on list rows.** Data should be there when you look.
- Respect `prefers-reduced-motion`.

## Component Contract
Five primitives. A new module picks archetypes; it does not make layout decisions.

| Primitive | Owns | A module may change |
|-----------|------|---------------------|
| `PageShell` | Title, subtitle, one primary action, secondary actions, padding | The words and the action |
| `DataTable` | Header row, filter caret, density, hover, empty, skeleton, bulk bar, export | Columns and extractors |
| `DocumentView` | Sheet, party block, line table, totals rail, print / download / share | Document kind, line shape |
| `EntryForm` | Identity strip, party field, line grid, totals rail, footer actions | Fields and validation |
| `SettingsPanel` | Grouped toggles, descriptions, save behaviour | Which settings exist |

Rules that hold across every module:
1. One primary action per screen, top right.
2. Voucher number and date sit right of the page title on entry forms.
3. Print / Download / Share, in that order, above a document — never inside it.
4. Every amount is set with tabular figures. Where it is *aligned* depends on
   what kind of thing it is — see *Value alignment* below. A column of figures
   is right-aligned; a lone amount field is not a column.
5. Status is a pill; severity is carried by color *and* text, never color alone.
6. A status hue is a **background**, never type. Pills and filter tabs keep grey
   text on a pale tint; the word carries the meaning and the tint places it.
7. Detail panels state a value in grey at normal weight. A view page is read,
   not scanned for exceptions, so nothing in it is emphasised over anything
   else.

## Audit Baseline (2026-08-24)
Measured across `src/`. Migration is done when these reach zero.

| Finding | Count |
|---------|-------|
| `text-xs` / `text-sm` share of type usage | 1,857 / 2,019 |
| Copies of the same `<th>` class string | 346 |
| Hardcoded palette classes in app chrome | 9 → 0 (fixed 2026-08-24) |
| Hardcoded palette classes in print documents | 298 — correct, see note |
| Competing radii (`lg` 323, `xl` 149, `full` 31, `md` 11) | 4 |
| Pages using `PageHeader` vs raw heading | 36 / 59 |

**Note on the 298.** The first audit counted 319 raw palette classes and called
them debt. That was wrong. 298 of them live in `InvoicePreview.jsx`, the invoice
template renderer in `App.jsx`, and `ExpenseVoucher.jsx` — printed documents,
which are black on white in both themes because that is what comes out of a
printer. Only 9 were real, in app chrome, and those are now tokens. Print
surfaces are deliberately exempt from the token rule.

## Screen Contract

What "done" means for a screen, derived from the Sales Invoice rebuild. Every screen
gets checked against this list; a screen that fails any line is not finished.

**Both archetypes**
1. **Shell.** A list or report uses `PageHeader`. A document uses `DocFormActions` —
   title left; Back, secondary, primary and the ⋮ menu right, pinned while scrolling.
2. **A way back.** Any screen reached *from* another screen carries a Back control that
   returns to where it was opened from, not to a fixed home.
3. **One primary action**, top right. Everything else is secondary or lives in ⋮.
4. **Tokens only.** No `bg-*`/`text-*`/`border-*` palette literals in app chrome; print
   surfaces are the documented exception. Contrast is measured with alpha composited,
   never eyeballed.
5. **Fields carry no local sizing.** `.ui-input` / `.ui-select` own their padding and
   height. A `px-3 py-2` beside them is a silent override and reads as a different
   size to the rest of the product.

**Documents additionally**
6. **Head in two columns**, ruled apart: who and where on the left, the paperwork —
   number, dates, references — on the right.
7. **Line grid** at `.ui-grid-dense`: 40px rows, 34px controls (see *Row and
   control height*), column widths sized to what the column holds, figures
   tabular and right-aligned, no spin buttons. Header text, field text and
   plain cell text all start on one inset — the control is pulled out by its
   own padding so the three agree.
8. **Keyboard.** Pickers on the shared `useListboxKeys` contract; the form on
   `useDocumentFormKeys`. Arrows move between fields and down a grid column, Tab commits
   and advances, a date field is left in one press, Alt+C creates a master in place,
   Ctrl+; enters today.
9. **One figure per job** at the foot. The same total printed three times makes a reader
   check whether the three agree.

Keyboard behaviour is covered by tests in `src/**/*.test.jsx` and runs in the CI gate,
because focus, portals and event order cannot be read off the source.

## Migration Order
1. Type ramp + spacing rhythm into `src/index.css`. Six `space-y` values to three, four radii to two.
2. ~~Remove the hardcoded palette classes.~~ Done (verified 2026-09-07) — the 9 in app
   chrome are tokens; the 329 remaining are all print surfaces and stay as they are.
3. Extract `DataTable`; retire the 346 copied header strings.
4. Force `PageShell` on all 59 raw headings.
5. Monospace money everywhere an amount displays.
6. Unwrap list pages from their card — Sales, then Purchase, then the rest.
7. Build Payroll on the primitives with no new layout code. That build proves the system holds.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-24 | Shell + primitives rebuild over a discipline-only pass | The flat type scale is why it reads as a dense tool rather than premium SaaS; discipline alone would not fix it |
| 2026-09-08 | One vertical rhythm for page blocks | 43 screens at 16px and 20 at 20px meant no two modules agreed, and neither value was on the documented scale |
| 2026-09-08 | Weight marks structure, not content | 121 values carried semibold or bold. Spending weight on content leaves none for hierarchy — everything emphasised is nothing emphasised |
| 2026-09-08 | Money drops to weight 400 | Tabular alignment already marks a figure as money. A weight on top made every amount in every table an emphasis, and a screen that is mostly amounts then had none |
| 2026-09-08 | Status hues move out of type and into the tint | Seven saturated words in the filter strip competed with each other and with the figures beside them. Reverses the 2026-09-01 contrast increase, which raised the wrong thing |
| 2026-09-18 | Icon scale, layer scale and content width governed | Ten icon sizes became four roles (15px and 16px were doing the same job one pixel apart); sixteen z-index values became eleven ordered tokens after a row menu at `z-[9999]` was measured painting over an open dialog; and measuring the pages showed the content-width "drift" was mostly inner measure rather than page width, so two behaviours were documented instead of four roles invented |
| 2026-09-18 | Do's and Don'ts, Elevation and Responsive behaviour added | Three sections the document never had, filled from the tokens and the measured band rather than from intent. Writing them down surfaced that 57 Tailwind shadow utilities sit in app chrome against a three-token system — recorded as legacy, like `space-y-4`, not silently migrated |
| 2026-09-17 | This document reconciled against the rendered app | An audit quoted `#F97316`, "36px table rows" and a 188px rail — all from here, all stale. Every geometry and colour value above is now measured from the running product, and the audit inherited the errors because it read the doc instead of the tokens |
| 2026-09-13 | One face: Inter, everywhere | The Graphite type decision, adopted alone while its colors stay parked. Money and codes keep digit alignment through tabular-nums instead of a mono family |
| 2026-08-24 | Monospace money | Superseded 2026-09-13 — the alignment survives via tabular-nums, the second family does not |
| 2026-08-24 | No card-in-card on lists | 2–3 more rows per screen, less framing noise. Departs from the Zoho/Tally convention deliberately |
| 2026-08-24 | Fraunces stays in-product for page titles | Superseded 2026-09-13 by the one-face decision |
| 2026-08-24 | Orange kept as the single accent | Already tokenized, and rare against Tally blue / Zoho red / QuickBooks green |
| 2026-09-07 | Field sizing lives in the token, not at the call site | 390 call sites restated `.ui-input`'s own padding and beat it. Heights were unaffected — `min-height` already governed — but the horizontal metric differed from the rest of the product |
| 2026-09-07 | Selection is the accent's job | Six list screens marked the chosen row with `bg-stone-100`, a light-palette literal, so a selected row in dark mode was a near-white band across a dark table |
| 2026-09-07 | The Screen Contract above is the definition of done | The invoice rebuild produced the same nine findings screen after screen; written down, they are reviewable instead of rediscovered |
| 2026-08-24 | Print surfaces exempt from the token rule | A printed invoice is black on white whatever theme the app is in. The audit's 319-colour finding was 93% print documents and only 9 real violations |
