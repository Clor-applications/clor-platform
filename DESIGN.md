# Design System — CLOR

Preview (rendered): https://claude.ai/code/artifact/b5f06c26-a4de-4879-979f-fbb1e88ad45a

## Product Context
- **What this is:** GST accounting and business SaaS for Indian SMEs, expanding from Sales / Purchase / Inventory into People (HR), Payroll, Attendance, CRM and Projects.
- **Who it's for:** CAs, accountants and SME finance teams who live in the software all day; first, small businesses of one owner and one or two staff (2026-10-25), often on a phone.
- **Space:** Tally, Zoho Books, Vyapar, QuickBooks India. All either dated or generic.
- **Project type:** dense data web application.
- **Memorable thing:** *Serious software for serious work.* Calm, obviously accurate, never shouts. Trust is the product.
- **Brand idea (Direction D, 2026-10-29; red since 2026-11-03):** *Done, daily.* Books, GST, people and pay, ticked off before tea.

## Brand
- **Logo (owner's wordmark, 3 Nov 2026):** **CLOR** in the owner's own letterforms, always capitals, drawn from outlines traced curve for curve from the owner's artwork (within 0.3% of its pixels) — never typed. The C holds a marigold dot, its own shape. `ClorLogo` (`packages/ui/src/components/brand`) draws it; the outlines live once, in `clorPaths.js`. Oxblood `#5C0A16` letters on light grounds (owner, 3 Nov 2026: "logo color do not keep red"), white on dark (`--logo-mark`); the dot is marigold everywhere (`--logo-dot`); ink `#1F1A1C` for one-colour print. Red is never the logo's colour; it is the app icon's tile. The C-tick mark of 29 Oct is retired.
- **Mark:** the C with its dot (`ClorMark`, `public/brand/clor-mark.svg`): the favicon, the app icon, the phone bar.
- **App icons:** one family — a red tile, a white glyph and a marigold accent (`public/icon.svg`, `public/icons/*.svg` and their PNGs). The mark sits at 60% of the tile so it survives a maskable crop.
- **Sign-in:** the oxblood logo over the board's "Done, daily." panel on cream `#FFF8F0` (light only, the promise in red with a marigold underline) with a Today card whose done rows carry a white tick on red, and a marigold halftone. The operator console keeps its own light side.
- **Never:** the blue `#1F7EFD` from the owner's source image (owner, 3 Nov 2026: "do not use this color").

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
- **Name menus in sentence case, and make each page title equal its menu label.** (People rail, 2026-10-28: Home · People · Organisation · Time · Talent · Workplace · Reports · Settings; one Approvals inbox; *My leave* and *My attendance* open from My profile.) A test enforces the case in People; Attendance keeps Title Case.
- **Write the brand as CLOR**, in capitals, in every logo, wordmark and app header.
- **Look at the screen while building it** — desktop and phone screenshots, fixed as seen, before it is called done.
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
- **Don't write filler.** No page or drawer descriptions, no step subtitles, no help that restates its label, no "(optional)" tags. Plain names: *First name*, not *Legal first name*; no code keys shown to people.
- **Don't add a card, colour or style without a reason.** A list sits on the page ground, a record is one sheet, a form being filled is one sheet, a side task opens in a drawer. People writes the reason per screen in `docs/people/design-v1/WORKFORCE-LAYOUT.md`.

## Typography
Self-hosted (Fontsource) in `packages/ui/src/index.css`. **Inter for the work,
Bricolage Grotesque for the brand** (2026-10-29, Direction D): warm display,
plain Inter for figures. Bricolage is the wordmark and page titles (`h1`,
`.ui-t-page`) and the sign-in display — nothing else. Rank inside a screen
still comes from size and weight.

- **Display:** Bricolage Grotesque Variable (optical size auto), 700–800. In People it also sets large figures (count tiles, figure cards) via `--font-display`; tables, money and running text stay Inter.
- **Everything else:** Inter — tabular figures, large x-height, wide weight range.
- **Money:** Inter, `font-variant-numeric: tabular-nums` (inherited from `html`) — columns align to the digit, right-aligned.
- **Code / voucher numbers:** Inter with ligatures off (`.ui-mono`); marked by alignment and context, not a second typeface.

### Scale
| Role | Font | Size / line | Weight | Notes |
|------|------|-------------|--------|-------|
| Page title | Bricolage Grotesque | 24 / 29 | 700 | `letter-spacing: -.025em` |
| Section title | Inter | 16 / 24 | 600 | |
| Body, UI | Inter | 14 / 20 | 400–500 | |
| Table cell | Inter | 13 / 18 | 400 | |
| Money | Inter | 13 / 18 | 400 | tabular-nums, right-aligned |
| Label, caption | Inter | 12 / 16 | 500 | `.04em`, uppercase |

All visible headings use weight 700. Table headings use the shared lilac
header surface and step to the next tint on hover, so sortable and filterable
columns provide a clear cursor response without introducing another colour.

Nothing below 12px. Nothing between 16 and 24.

## Color
- **Approach:** restrained. The red brand (owner, 3 Nov 2026: "go with red combination"; supersedes Direction D's indigo) — six colours, each with one job. Tokens in `packages/ui/src/index.css` (platform), `people.css` (People) and the `blaze` palette block (Attendance).
- **CLOR Red `#C8102E`** (`--red`, `--brand`): what you press, and the app icon's tile — the primary action, the open tab's line, the focus ring. White on it 5.9:1. As words it is `#A50D26` (`--brand-ink`, `--link`, 7.8:1 on white, 6.6:1 on blush); hover `#A50D26`, pressed `#8A0B20`.
- **Oxblood `#5C0A16`** (`--oxblood`, `--brand-deep`): the deep brand — the logo's letters, People's rail, headings in People, a solid block (Home's greeting, the record's header, an open view tab, the rail's open module pill). White on it 13.9:1.
- **Blush `#FBE8EA`** (`--blush`, `--brand-soft`): chosen and done — the module panel, a selected row, header bands, Filed / Paid / Approved chips. Ink on it 14.6:1.
- **Marigold `#F5A623`** (`--marigold`): the dot in the C, "waiting on you", and the dark theme's action. A fill, never text on white (2.0:1); oxblood on it 6.9:1.
- **Ink `#1F1A1C`** (`--ink`, `--fg`): running text and the one-colour logo, 17.2:1 on white. Muted `#5B4F53` (7.8:1), subtle `#74686C` (5.0:1 on the ground).
- **A chosen view** (a segmented switch: In use / Retired, Pending / Approved / All) is marigold with oxblood words, 6.9:1, on a warm neutral tray (`--choice`, `--on-choice`, `--choice-tray`; owner, 3 Nov 2026: "use different color like green or orange"). Not red, which is the action; not green, which means done. Every app on the red brand; Accounting's indigo palette unsets the tokens and keeps its indigo fill.
- **Grounds:** white for the work area and the top bar of every app (owner, 3 Nov 2026: "header keep white only"); the page ground is a warm white `#FAF6F4`; cream `#FFF8F0` is paper (sign-in, the website). Hairline `#EADFE1`, strong `#CEBCC0`, sunken `#F5EFEE`.
- **Money, now that red is the brand:** money in stays green `#15803D`; **money out is ink with a minus sign** (`--money-out`, `.ui-amount-neg`), not red; attention `#A16207`. Red for meaning is the error colour `#B91C1C` (`--neg`) only — rejected, overdue, failed — and an error always carries its warning mark and its own edge, so it never reads as the brand.
- **Per-app palettes (2026-10-24):** an app may name one shared palette in its manifest (`palette`), and that palette may redefine only colour tokens; it never restates type, radius, spacing or shadow, and nothing is scoped to an app id. Payroll and the workspace wear the red brand through the platform tokens; Attendance the `blaze` palette (the name predates the colours: oxblood rail, marigold on the open module, red actions); People the `sky` palette (also a historical name). **Accounting keeps Direction D** (owner, 3 Nov 2026: "do not change color to accounting") through the `indigo` palette: indigo `#232A66` acts, lilac `#E9E5F4` is chosen and done, cotton `#FAF6EE` is the page, and money out stays red. It wears the same CLOR logo as every other app; its app icon keeps its navy tile.
- **People (light theme only):**
  - **Frame (3 Nov 2026: "header keep white only", then "sidebar complete red background" removed).** The top bar, the rail and the phone tab bar are white over a hairline. The rail's icons are oxblood on a light duotone; the open module's icon sits on a blush tile with its marigold fill and its label is red and bold. The top bar carries the oxblood logo, the app's tile red with a white mark, and the search on the sunken tone. The module panel is a warm neutral `#F7F5F2` (`--frame-panel`) with a `#E4DFDA` hairline, ink words (15.8:1) and group names `#5B4F53` (7.2:1); the open screen in it is a white tile with red words (`--brand-ink`), weight 700 and a 3px red edge.
  - **Colour beside the red (owner, 3 Nov 2026: "only red is visible where is other colours").** Blush is for what is chosen, not every surface. Figures and panels keep their own tint in four families: slate `#334155` on `#EEF1F5` (neutral counts), green `#166534` on `#E7F5EC` (done, present, 6.3:1), clay `#A63F12` on `#FFEDE3`, and red `#A50D26` on blush. Marigold stays "waiting". Never the banned blue.
  - **Home:** the greeting sits on the white page, no card (owner, 3 Nov 2026: "remove hero card"): an oxblood title, a blush date pill, quick links as secondary buttons, and Add an employee the one red primary. Each figure is a solid wash in its own tint (Headcount slate, Out today green, To approve clay, On notice blush); the one that waits on you, above nought, is solid marigold. Panel heads are white over a hairline, the tinted icon chip beside the title carrying the colour. The employee record's header stays an oxblood block with Edit in marigold.
  - **Lists:** the figures strip is white with a hairline, each figure's mark in its own tint; the view tabs a warm neutral tray with the open view marigold (its count an oxblood pill); the head row the panel's warm neutral.
  - **Marigold is the one warm "look here":** the bell's count and a dot on each unread line; the count on a tab whose rows wait on you; a 3px bar along the top of a figure that waits on you and is above nought; Waiting and To do pills (solid marigold, oxblood words); warning marks. Drawn as a line on white it is deep marigold `#C98200` (`--btn-icon-on-white`, 3.2:1), never running text; marigold's text form is `#7A4F00`. A look-here line (a clash, a gap in the data) is marigold-soft `#FEF1D6` with a 3px marigold edge — not red.
  - **Away `#A86E7C`** (`--away`) marks on leave and out today, a mark only (4.1:1 on white).
  - **Charts and categories** use one series: oxblood, marigold, away, deep marigold, red, `#5B4F53`, `#968A8C`, `#74686C` (`--dept-1..8`; `--dept-0`, no team, grey). Initials on a face are oxblood on their team's 16% wash. Leave types draw from the same family (`--leave-0..7`), never red, as a leave is not an error.
  - **Zero is quiet:** a figure at nought is subtle grey at weight 600.
  - **Shapes and order (unchanged):** buttons, fields, search and tabs 8px; cards, trays and figure tiles 12px; 999px only for status pills, faces and dots. Page titles 28px (Bricolage 800); Home's greeting 34px, 28px on a phone. Rail labels and panel group names 12px. The module panel is 200px wide (owner, 3 Nov 2026: "reduce width of the second sidebar bit"; was 224px). Home has one primary action (Add an employee).
  - **The employee app** (shared with Attendance) wears the brand's "waiting" — solid marigold pills with oxblood words, a marigold line over the open tab — through its own `data-brand="d"`.
  - **Dark theme:** People keeps its earlier dark values (teal `#2DD4BF` on near-black) until a dark red brand is designed for it.
  - Superseded and not to be reused: Burnished Rose `#A45761` (2026-10-24), Sky blue `#0B72B5` and lagoon teal `#0E7C7B` (2026-10-28), Direction D indigo `#232A66` / `#1B2152`, lilac `#E9E5F4` and cotton `#FAF6EE` (2026-10-29 to 2026-11-03), Blaze orange `#FF6700` (2026-10-21 to 2026-11-03).
- **Dark mode:** redefine tokens only, never restyle components inside a theme block. Surfaces are the red brand's night (`#1A0C0F` ground, `#24141A` card), text warm white, the logo white with its marigold dot, marigold takes the action with oxblood words; money greens, ambers and reds remain available for meaning.

## Spacing
- **Base:** 8px.
- **Density:** comfortable-dense.
- **Rhythm — two values in force, a third only intended:** 12 inside a group
  (`space-y-3`, 62 uses), 24 between groups (`space-y-6`, 129 uses).
  - **Page blocks are 24** (`space-y-6`), enforced on every screen root;
    **12 on People's screens** (2026-10-28, Sky palette only). Before
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
| List / data table (`.ui-table`) | **55px** (9px cell padding); People: **46–49px** a name over an email (6px, 2026-10-28) | 36px |
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
  in a 383px panel. A three-up row comes at `xl` only when every panel still
  keeps 15rem in what the breakpoint leaves beside the rail (the page padding
  and the overview's own padding taken off too); otherwise it waits for `2xl`.
  `test/overview-breakpoints.test.js` pins the arithmetic. *(Was "three-up rows
  wait for `2xl`"; changed 2026-10-30 to match the running-book Home, pending
  owner approval — see the decisions log.)*
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
| **Dashboard / overview** | Panel rows collapse by breakpoint. Two-up rows at `xl`; three-up rows at `xl` only when each panel keeps 15rem beside the rail, else `2xl` (see *Layout*; pending owner approval). Below that they stack full width |
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

### Text fields suggest what already exists

Every free-text field offers matching values the company already has, on focus
and while typing: cities, relationships, the work-email domain, the branch a
work site sits at, reasons used before, names already on people's records. Use
`SuggestInput` (`packages/ui/src/components/ui/SuggestInput.jsx`), never a
native `<datalist>`. The list sits under the field and the caret stays in it;
↓/↑ move, Enter takes a row only after the arrows were used, Escape closes.
Typing stays free. A suggestion is offered, never forced.

What is never suggested: one person's private details to anyone else (phones,
personal emails, government IDs, home addresses, bank details), and anything
from private cases or help-desk tickets. Free reasons are offered only once a
phrase has been used at least twice. A name that already exists in the list
being added to is said plainly ("already in the list"), not offered.

## Buttons

Two separate ideas, and a review checks both:

- **Priority** is how much a button matters on its screen: *primary* (the one
  thing the screen is for), *secondary* (things you also do here), *tertiary*
  (ways out and small things on a row).
- **Appearance** is how it looks. Priority picks the appearance, but the two are
  not the same word: a secondary action can be outlined or soft, a tertiary one
  is usually ghost.

### Five appearances

| Appearance | Class | Looks | Used for |
| --- | --- | --- | --- |
| Primary | `.ui-btn-primary` (`.ui-btn-brand` is the same on brand surfaces) | Filled, the app's action colour (red) | One per screen, top right. Also the Continue / Next of a stepped form |
| Secondary | `.ui-btn-secondary` | Outlined on the surface | Preview, Export, Download, Print |
| Soft | `.ui-btn-soft` | Tinted, no hard edge | Quiet additive actions: Add row, Add another |
| Ghost | `.ui-btn-ghost` | No fill until hovered | Cancel, Back, View details, row actions |
| Danger | `.ui-btn-danger` | Filled red | Delete, Withdraw |

There is no sixth. **Icon-only is a size of ghost, not a type**
(`.ui-icon-btn`): it always has an accessible name (`aria-label`), and a 44px
tap area on phones even when the glyph is smaller.

Sizes: **36px** baseline, **28px** compact (`.ui-btn-sm`, in tables and
toolbars where 36 will not fit), and **44px on phones** as the target for
every button a thumb has to hit. Where it is enforced today: in People (sky
palette, under 768px) every `.ui-btn`, `.ui-btn-sm` and page button in the work
area and in drawers and dialogs (`people.css`, "The base button rule fixes its
height"); in the other apps, inside any screen that opts in with
`.ui-touch-44` (under 768px; Payroll's pay runs, salary slips, final
settlements and the employee app's money screens so far) and the stepped-form
actions (`.ui-wizard-actions`, under 640px). Elsewhere it is a target, not yet
a rule. Radius **8px**. People's brand D draws its buttons as pills
(2026-10-28); that is the one exception and it stays inside the sky palette.

### Icons in buttons (People)

Icons inside People's buttons are **marigold** (owner, 2026-10-31). Measured,
and the rule follows the numbers:

- **Primary** (red fill since 3 Nov 2026): marigold #F5A623 on red is 2.9:1, under the 3:1 a graphic needs, so the primary's icon is a light marigold #FFD68C, 4.3:1
  (5.7:1 on hover; on the old indigo fill marigold was 6.5:1).
- **Secondary, soft, ghost with a label** (white surfaces): the bright marigold
  was 2.0:1 and read washed out, so these take a deeper marigold,
  `--btn-icon-on-white` **#C98200**: 3.2:1 on white, 2.9:1 on the hover tint,
  2.7:1 on the soft tint. That clears the 3:1 a meaningful graphic needs (WCAG
  1.4.11) on white; below it, it is allowed only because the label carries the
  meaning and the icon is `aria-hidden` decoration.
- **Icon-only** buttons have no label to lean on, so they keep their ink
  (indigo, 13:1). People's action icons are Fluent line glyphs with no second
  layer, so there is no two-tone marigold-and-indigo version to use instead.
  A `.ui-btn` drawn icon-only is marked `.ui-btn-icon-only` (or
  `data-icon-only`) so it keeps its ink too.
- **Danger** keeps its own white. A **disabled** button's icon drops to its
  label's colour and fades with it. The **done tick** takes the icon's colour.
  The **loading spinner** is ink on secondary, soft and ghost (a thin amber
  ring on white was hard to see) and marigold on the primary.
- **Legacy dark theme** (brand D is light only; People's dark keeps its earlier
  teal values until a dark brand D is designed): bright marigold on the dark
  surfaces is 7.6–9.8:1, so secondary, soft and ghost keep it; the legacy dark
  primary is a light teal fill (marigold on it 1.1:1), so its icon keeps the
  dark ink.

Payroll, Attendance and Accounting do not change: the rule lives in
`people.css` under the sky palette.

### States

| State | How it shows |
| --- | --- |
| Default | The appearance above |
| Hover | One step deeper (fill) or a sunken tint (outlined, soft, ghost) |
| Pressed | A slight press (scale or 1px down); released faster than pressed |
| Keyboard focus | The one shared focus ring, never a per-button outline |
| Disabled | Faded, not clickable. When the reason is not obvious, say it nearby (a caption or a `title`), never leave the person guessing |
| Loading | `aria-busy="true"`: a small spinner where the icon was (over the label when there is none), same width, clicks ignored, label still read out. Not the disabled look. Reduced motion: it breathes instead of turning |
| Success | `data-state="done"`: a tick and one word ("Saved", "Added") for about 1.5s, then back. Used sparingly, where no toast fires; **the toast is the main success signal** |
| Error | Not on the button. The field says what is wrong, or a message near the form does; the button goes back to default |

Use the shared helper, `Button` in `Primitives.jsx`: `loading` sets
`aria-busy`, draws the spinner and refuses a second submit; `done` (with
`useDoneFlash()`) draws the success state. Do not swap the label for
"Saving…": the button changes width and the row beside it jumps. A plain
`<button class="ui-btn" aria-busy="true">` gets the same look from the CSS
when the helper cannot be used.

### Ask first

Destructive and hard-to-undo actions open the shared confirm dialog
(`confirmDialog`) before they run, and its button names the action:
**Run payroll / approve a pay run, Mark paid, Delete, Withdraw a leaving,
Cancel a run.** The dialog's confirm button is danger by default (`tone`);
pass `tone: 'primary'` when the action is hard to undo but not destructive,
such as approving a pay run.

### No floating action button

A floating "+" in a corner is a second primary action and breaks "one primary
action, top right". CLOR does not use one. A phone-only "+" that *replaces* the
top-right primary would need the owner's approval first.

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
| 2026-11-03 | A chosen view is marigold | Owner, on People's "In use / Retired" switch (solid oxblood): "use different color like green or orange, any best in entire app". Marigold with oxblood words (6.9:1) on a warm neutral tray, through `--choice` / `--on-choice` / `--choice-tray`, read by every selected-segment rule (platform, Blaze, People's tray and segmented strips). Orange-family marigold is already the brand's second colour; red is the action and green means done, so neither fits a choice. Accounting's indigo palette unsets the tokens and is unchanged |
| 2026-11-03 | People: no hero card, a white rail, colour beside the red | Owner, after the red brand went live: "remove hero card and sidebar complete red background in people", then "only red is visible where is other colours". Home's greeting leaves its oxblood card for the white page (Add an employee the one red primary); the rail and the phone tab bar turn white with oxblood icons. The red brand had folded every wash into blush, so figures, panel heads and the module panel all read pink: figures get their own tints again (slate, green, clay, blush), panel heads and list strips go white, the module panel a warm neutral, and green returns for done and present. A leave type is never red |
| 2026-11-03 | Accounting keeps its indigo | Owner, after the red brand went live: "do not change color to accounting". Accounting opts into a shared `indigo` palette (its manifest's `palette`), which restates Direction D's tokens exactly as they were (money out red, cotton page, lilac selection); its icon and install manifest go back to their navy tile. Keyed on the palette, not the app id. The CLOR logo is the same in every app, so the palette leaves `--logo-*` alone |
| 2026-11-03 | The red brand and the owner's wordmark, in every app and on clor.in | Owner, 3 Nov: a new CLOR logo ("this latest logo i want exact curves design everything"), its blue banned ("do not use this color"), then "go with red combination" over violet, plum and graphite, and "header keep white only". The wordmark is traced from the owner's image and drawn from outlines (`clorPaths.js`), its letters oxblood (owner: "logo color do not keep red"); the C-tick is retired. Palette: red `#C8102E` acts, oxblood `#5C0A16` is the deep brand (People's rail, blocks), blush `#FBE8EA` is chosen and done, marigold `#F5A623` the dot and "waiting", ink `#1F1A1C` the text. Every top bar is white. Attendance's Blaze orange and graphite become oxblood and red. Because red is now the brand, money out is ink with a minus sign and red means only an error `#B91C1C`, always with its warning mark. Icons, favicons, manifests, the share card and the website's accent follow |
| 2026-11-03 | People: lilac module panel; every app wears the dotted CLOR mark | Owner, 3 Nov: "both sidebars same color, hard to read modules and submodules" — the indigo rail and indigo panel read as one ground. The module panel is lilac `#E9E5F4`, brand D's secondary, with indigo words (10.7:1) and the open screen a white tile with the marigold edge; the bar and rail stay deep indigo; light theme only. Owner, same day: "logo still using old" — Payroll, Attendance, Accounting, sign-in and the static icons still drew the C-tick without its marigold dot. `ClorMark` and `ClorLogo` now draw `ClorTick`, the shell drops its People-only branch, and the favicon, `logo*.svg`, `brand/*.svg` and their PNGs carry the dot (the tile icon is a cotton tick with a marigold dot on indigo, as People's). The static lockups keep their old spacing between mark and name |
| 2026-11-03 | People: one indigo for the frame and its blocks | Owner, 3 Nov: "header … colour mismatch". Home's greeting block was brand indigo `#232A66` directly under the `#1B2152` bar and beside the `#1B2152` rail: two indigos a step apart, which reads as a mistake. The greeting and the employee record's header now use `--frame` (`#1B2152`); their lilac words gain contrast (support text 9.0:1, was 7.8:1). Brand indigo stays for ink (buttons, the open tab, initials, fields on the bar). Light theme, People only |
| 2026-11-02 | People: deep indigo frame (direction A) | Owner, 2 Nov: People looked "too pale, washed out", "generic", and its spacing and hierarchy were off. The designer showed three directions on real screens (A Deep indigo, B Warm editorial, C Dense pro); the owner chose A. On the sky palette, light theme: the bar and rail `#1B2152`, the module panel `#232A66`, lilac words on them; the open screen a lilac tile with a marigold edge; Home's greeting and the record's header on indigo blocks with a marigold primary; figures on lilac, what waits on you on marigold; the head row and the tab tray lilac. **Supersedes** the Cotton rail and module panel (2026-10-29) and the pale lilac panel (2026-10-31); the white work area stands. Also fixed: People's buttons, fields and tabs back to 8px and its cards to 12px (they were 999px pills and 20px, against the two radii); Home's waiting requests above the fold with one primary action (Check in secondary, the setup list below Waiting for you); rail labels at 12px; the logo drawn from `--logo-*` tokens. Payroll, Attendance, Accounting and the employee app unchanged |
| 2026-08-24 | Shell + primitives rebuild over a discipline-only pass | The flat type scale is why it reads as a dense tool rather than premium SaaS; discipline alone would not fix it |
| 2026-09-08 | One vertical rhythm for page blocks | 43 screens at 16px and 20 at 20px meant no two modules agreed, and neither value was on the documented scale |
| 2026-09-08 | Weight marks structure, not content | 121 values carried semibold or bold. Spending weight on content leaves none for hierarchy — everything emphasised is nothing emphasised |
| 2026-09-08 | Money drops to weight 400 | Tabular alignment already marks a figure as money. A weight on top made every amount in every table an emphasis, and a screen that is mostly amounts then had none |
| 2026-09-08 | Status hues move out of type and into the tint | Seven saturated words in the filter strip competed with each other and with the figures beside them. Reverses the 2026-09-01 contrast increase, which raised the wrong thing |
| 2026-10-31 | People: brand colours used where they belong | Owner: "yellow and other colors not utilised properly in frontend"; a designer audit (`docs/people/design-v1/COLOUR-AUDIT-2026-10-31.md`) found five causes — the tab-count rule named `.ui-count`, which nothing renders; status tokens left from the teal era (`--warn` #B25000, `--neg` #D70015, Present and On leave both indigo); brand D's indigo figures overriding "nought is quiet grey"; the figure-card rule matching only buttons, so the People report kept Payroll's blue and green; and colours from outside brand D (red 10px bell count, a department rainbow, blue/crimson gender, Tailwind leave colours, peach "Waiting" in the employee app). Owner: "Yes, all ten". On the sky palette, light theme: marigold on counts, figures, pills and the bell that wait on you (tabs marked `data-tone="warn"`, figures `data-attention`), the bell 12px; `--warn` #7A4F00 for words with `--warn-mark` marigold for marks; red #B91C1C only for what went wrong; a new away mark #8D84C6; clash lines marigold-soft with a marigold edge; one series for charts, teams, gender, faces and uncoloured leave types (`--dept-*`, new `--leave-*`, whose base values are the old hexes so other apps are unchanged); the module panel's open screen on the lilac tile with a line; Settings icons on lilac tiles. The employee app wears brand D's waiting pill and a marigold line over the open tab through `data-brand="d"`, not the sky palette, so Attendance's screens keep Blaze. The bell count is 12px everywhere (the type floor); its colour changes in People only. Payroll, Attendance and Accounting are otherwise unchanged |
| 2026-10-31 | People module panel pale lilac, rail stays Cotton | Owner: "sidebars both same yellowish background, need to differentiate, slightly change second sidebar colour, keep primary same and pages same". Module panel `#F7F5FC` (hover `#EFECF8`), rail Cotton `#FAF6EE`, work area white, all unchanged otherwise. Light theme only; Payroll, Attendance and Accounting unchanged |
| 2026-10-28 | People lists are full page, denser, with plain line icons | Owner: "i don't want card type i want full page", "reduce empty spaces to view more data in table", and the pastel duotone icon tiles did not read as icons. On the Sky palette only (People): no rounded box or shadow round a table or the figures, one hairline above; 6px cell padding; 12px page rhythm; 224px module panel; plain Phosphor line icons, muted, the open screen in the accent; figure, tick-box and menu columns as wide as their content; view tabs in the search row; Onboarding & Exit gets search and kind/owner filters. Detail and form screens the same way: the employee record's tabs and Add employee's steps on the page ground under a hairline, forms 56rem wide with Save under them, drawers and dialogs with the page's round buttons and 12px fields. Later the same day: People's ground white, not grey; columns as wide as their content with the spare width once at the row's end; one job per colour beside Sky #0B72B5 (actions) — Navy #0E2A47 headings, Emerald #0E7C5A approved/active, Amber #A15C07 waiting, Coral red #C53A45 rejected/overdue, Violet #5B4BC4 information, Butter #F2C94C highlight only; initials in five soft washes picked from the name. Then a side panel beside ten People lists (`withSidePanel`, `apps/people/src/panels.jsx`): away this week and team clashes, waiting longest, joiners and birthdays, headcount, late items, expiring documents, and where to go next; every line opens a page or filters the list; drawn only when the table still fits at its natural width beside it (never on phones), and not on the employee record, which has its own activity rail. The row menu is 48px at the right edge; on a wide screen the spare width is shared among the columns in proportion to what they hold (a band of empty space at the row's end was rejected: "gaps in right ... not looks good"). Panel blocks: a heading with its count, status pills, a tinted alert line, a timeline for activity, date tiles, link chips. Finishing states: a loading screen takes the page's shape (title, rows) instead of a boxed card; an empty list hides its header row and its empty-state button steps down to secondary when the page heading already has the primary; a figure at nought is quiet grey. A tab that already names the one status its rows share drops the Status column (leave and attendance requests, help desk, workspace lists; kept on All and while a manager's step needs saying), and on Employees Active is plain grey words, pills only for on notice, joining, suspended, left. Org chart: one row of controls (views, as of, count, expand/collapse, zoom), the chart to the bottom of the window, the department legend floating in its corner. Motion (Apple notes): phone sheets leave downward and can be dragged away (1:1, momentum projection, springs, rubber band); press feedback on rows, tabs, menus, chips and figures; lists that open upward rise and fade out on close; reduced motion fades instead of sliding. Inter stays the one face (a redesign audit suggested a display font; not taken without the owner's say). Payroll, Attendance and Accounting unchanged |
| 2026-10-28 | People colours and icons upgraded; Organisation overview as rows | **Colours and icons superseded 2026-10-29 (brand D, two-tone icons); the Organisation rows stand.** Owner: "colours primary and all the colors need to be upgraded, icons", then "i don't want blue as every software this industry used same colours". On the Sky palette only (People): the accent is lagoon teal #0E7C7B (white on it 5.0:1; #0A6665 as text, 6.6:1), apart from the blues and purples of other HR apps; dark theme #2DD4BF with dark ink on it, near-black ground #0A0A0C and neutral grey surfaces #1C1C1E/#2C2C2E. Ink #1D1D1F for text and headings (navy headings dropped); status at Apple's accessible system values: green #1E7F37, orange #B25000, red #D70015, purple #8944AB (dark: #30D158, #FF9F0A, #FF6961, #BF8CFF). The Mist trial (slate #5D6B6B, blush counts) is removed; counts and date tiles take the teal wash. Icons stay Phosphor line icons; the open module and the open screen fill their icon's soft layer in the accent, as a selected symbol does on iOS. Organisation overview: departments and branches as full-width rows under one hairline instead of a card grid that left the end of each row empty; Other lists on the same ground. Payroll, Attendance and Accounting unchanged |
| 2026-10-26 | Text fields suggest what already exists | Owner rule, for every app: a field offers the company's own matching data so nothing is typed twice or spelled two ways. One shared `SuggestInput`; shared vocabulary only, never another person's private details |
| 2026-10-24 | People wears a rose accent on Accounting's layout | **Rose superseded 2026-10-28, then by brand D 2026-10-29; colour-tokens-only palettes stand.** The owner asked for People to keep the same layout and type as Accounting while having its own face. People's app-scoped CSS (59 selectors, 26 `!important`: 22px titles, 15px sections, 6px controls, a coral palette and a second-pass Blaze layer) is removed and replaced by one shared `[data-palette='rose']` block that sets colour tokens only. Colour icons stay (D-01, docs/people/08) |
| 2026-10-29 | People wears brand D, on a white work area | Owner chose brand D for People ("mark this as new"), replacing lagoon teal. Indigo ink and action, marigold for "waiting on you" (fill only), lilac for chosen and done. The work area is white ("keep it white": Cotton read yellowish) with cool lilac-grey hairlines; Cotton stays on the rail and module panel. Bricolage for headings and large figures. Light theme only; People's dark theme keeps its earlier values. Payroll, Attendance and Accounting unchanged |
| 2026-10-29 | People icons: two-tone Phosphor for places, Fluent line for actions | The pastel duotone tiles did not read as icons, and Fluent Color scored 5/10 on brand D. Owner picked option C of six: Phosphor two-tone, indigo line with a lilac fill, marigold fill on the open module, screen and tab (`iconSet: 'duo'`, `duo()` in the manifest). Buttons and row actions use Fluent Regular line icons (`lineIcons: 'fluent'`, via `@ui/components/ui/lineIcons`, which draws Lucide for the other apps). One icon family per role in People |
| 2026-10-28 | People navigation renamed and regrouped | Owner, as a user, was "not satisfied". Rail: Home · People · Organisation · Time · Talent · Workplace · Reports · Settings. Sentence case for every People label (tested); page titles equal menu labels; one Approvals inbox with Approve on each row; My leave and My attendance under My profile; Reports holds reports only (Data check and Privacy controls moved to Settings) |
| 2026-10-30 | Web tests run on every pull request; drifted code fixed to this file | Nothing ran the web suite and 53 tests had failed since the initial import (00f6a61a). Where the code had drifted from a rule already here, the code was fixed: 36 bold or semibold data values (weight marks structure, money at 400), and the Masters "TDS" entry renamed TDS Rates beside GST Rates and TCS Rates |
| 2026-10-30 | **Pending owner approval:** what shipped differs from what the old tests asked | The updated tests describe the screens as shipped, not a decision taken. Each is the owner's to accept or reverse: a three-up overview row at `xl` when each panel keeps 15rem (was "wait for `2xl`"); document lists' status dropdowns without counts; Price Lists without a figure row or its "pricing nothing" figure; the Settings catalogue leaving out the platform category and Tax Rates (reached from Sales and Masters instead). Also as shipped and unremarkable: the overviews share a running Home's plain header (HeroBand stays for Home's first hour); party masters draw addresses as one table and the customer's Dr / Cr sit inline beside the amount |
| 2026-10-31 | Buttons: five appearances, loading and success states, no FAB; marigold icons in People | Owner reviewed a nine-type button list. CLOR keeps five appearances (primary, secondary, soft, ghost, danger); icon-only is a size of ghost; priority and appearance are separate ideas. Adds a shared loading state (`aria-busy`, spinner in the icon's place, width kept, clicks refused, label still read out, breathing under reduced motion) and a brief success state (`data-state="done"`, tick and "Saved" for 1.5s, only where no toast fires), via `Button` / `useDoneFlash` in `Primitives.jsx`. No floating action button. Owner, same day: "in buttons symbols use yellow": in People (sky palette) icons in buttons are marigold: #F5A623 on the indigo primary (6.5:1), a deeper #C98200 on white secondary, soft and ghost (3.2:1 on white; the bright one was 2.0:1 and read washed out), spinner in ink there; icon-only buttons keep their ink (no 3:1-safe two-tone in Fluent line icons); danger keeps white; disabled follows the label; legacy dark primary keeps its ink (1.1:1 on teal). Payroll, Attendance and Accounting unchanged |
| 2026-10-29 | Direction D "Done, daily" brand shipped | C-tick mark and Bricolage wordmark replace the red mark and PNG wordmark; platform palette moves from graphite to indigo / marigold / lilac / cotton. Money semantics and the per-app palettes (Blaze, Rose) unchanged |
| 2026-10-02 | Contrast floor re-measured against the page ground, not white | Compliance audit: Graphite `--fg-subtle` #71717A was 4.83:1 on white but 4.40:1 on the `--app-bg` it often sits on, under AA; now #6B6B73 (4.81:1). `--warn` #A66A00 measured 4.48:1, now #996200. Orange-theme tokens (primary fill, focus ring, orange text → `--brand-ink`) corrected too, though Graphite overrides them. Field borders (1.48:1, WCAG 1.4.11) left for a design decision — see docs/compliance |
| 2026-10-02 | Inter served from the app, not Google Fonts | Loading it from fonts.googleapis.com sent every visitor's IP to Google before sign-in. Same face (`@fontsource-variable/inter`, OFL); the family is `'Inter Variable'` first in every stack |
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
