---
# gstack: design-md-format=spec
name: CLOR
description: The calm register. White paper, black ink, tidy columns and one app colour with four jobs; calm, obviously accurate, never shouts.
colors:
  surface: "#FFFFFF"
  hover: "#F7F7F7"
  hairline: "#E5E5E5"
  field-border: "#D6D6D6"
  input-border: "#949494"
  rule: "#C8C8C8"
  text: "#1C1B18"
  text-muted: "#5C5A54"
  text-subtle: "#6E6B64"
  on-primary: "#FFFFFF"
  primary-workspace: "#202329"
  primary-people: "#A21CAF"
  primary-payroll: "#006A9E"
  primary-attendance: "#A85A00"
  primary-ops: "#015D47"
  rail: "#F3F3F0"
  logo: "#FF5400"
  logo-text: "#C95000"
  success: "#166534"
  success-bg: "#E6F1E9"
  warning: "#8A5A00"
  warning-bg: "#FBF1DC"
  error: "#B42318"
  error-bg: "#FCEBE9"
typography:
  title:
    fontFamily: Figtree
    fontWeight: 700
    fontSize: 1.5rem
    lineHeight: 2rem
  section:
    fontFamily: Figtree
    fontWeight: 600
    fontSize: 1.0625rem
    lineHeight: 1.5rem
  body:
    fontFamily: Figtree
    fontWeight: 400
    fontSize: 0.875rem
    lineHeight: 1.25rem
  secondary:
    fontFamily: Figtree
    fontWeight: 400
    fontSize: 0.8125rem
    lineHeight: 1.125rem
  label:
    fontFamily: Figtree
    fontWeight: 600
    fontSize: 0.75rem
    lineHeight: 1rem
    letterSpacing: 0
  figure:
    fontFamily: Figtree
    fontWeight: 600
    fontSize: 1.375rem
    lineHeight: 1.75rem
    fontFeature: tnum
  mono:
    fontFamily: JetBrains Mono
    fontWeight: 500
    fontSize: 0.8125rem
rounded:
  control: 8px
  box: 12px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary-people}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    height: 36px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    borderColor: "{colors.field-border}"
    rounded: "{rounded.control}"
    height: 36px
  input:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.input-border}"
    rounded: "{rounded.control}"
    height: 36px
  table-row:
    height: 44px
    borderColor: "{colors.hairline}"
  table-header:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.rule}"
  status-tag:
    rounded: "{rounded.full}"
    height: 24px
  dialog:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.box}"
---

# CLOR

Preview: https://claude.ai/artifact/F7VgW5Qy25YSLJ3VU3BewC

Written fresh on 19 Nov 2026. It replaces the 2,687-line file built from 67 picker rounds,
whose rules contradicted each other; that file is kept as `DESIGN.legacy.md` for history only.
Where `DESIGN.legacy.md`, `picks.css` or `legibility.css` disagree with this file, this file wins
and the code is what moves. **Books is out of scope**: it keeps its own look (navy `#232A66`,
orange `#FF6B00`, its split rail) as recorded in `DESIGN.legacy.md`, "Books (Accounting)".

## Overview

**Creative North Star:** the calm register. It should feel like a ledger the most careful clerk in
the office has already checked: white paper, black ink, tidy columns, and nothing that shouts.

**Product context:** Indian HR, payroll, attendance and company administration (Workspace, People,
Payroll, Attendance, Ops), sold mostly through CAs to growing and medium companies, alongside
Keka, greytHR and Zoho People. It is a dense data app that people use all day at a desk. Employees
also open self-service on phones.

**Memorable thing:** calm and accurate. Trust is the product.

**Mode per surface:** Operate (every app screen); Persuade (clor.in, owner's own text). clor.in shares the logo orange and the app colours; since 24 Nov 2026 it has its own look (owner): pale blue grounds `#F2F9FF`, navy text `#002B54`, blue hairlines `#C4DCF7`, Switzer, pill buttons, 12px controls and 21px panels, all in `website/src/styles/darwin.css`. The apps are unchanged.

**Key characteristics:**
- White ground everywhere. Colour appears only where it means something.
- One title size, one row height, one control height across every app.
- Money is the loudest thing on a money page: tabular, right aligned, with a bold total.
- Totals are stated in a sentence, not in tiles.
- Only exceptions carry a status tag.

## Colors

**Strategy:** restrained. Neutrals carry the page. Each app has one colour, and that colour has
exactly four jobs: the primary button, links, the open menu item, and the focus ring. It is never
a panel tint, a tile bar, a chart default or a heading colour.

**Light or dark:** light only (owner, 15 Nov 2026). The use scene is office desks under bright light.
There is no dark theme, and `test/palette.test.js` fails if one returns.

**Per app:** the shell sets `data-app` on `<html>`, and `rnd.css` maps `--act` to that app's
primary token (graphite, magenta, deeper blue or amber). The Ops console sets `data-portal="ops"` and takes forest `#015D47` (owner left the pick to Claude, 21 Nov 2026), a blue-green that does not read as the status green. White text on each passes 4.5:1. Hover
darkens by about 15%. The CLOR logo and the gate pages keep the logo orange whatever app was
open last. The logo orange is `#FF5400` (owner, 21 Nov 2026), the same on clor.in. Orange fill
is not a text colour (white on `#FF5400` is 3.2:1), so text uses `logo-text`.

**Neutrals:** `hover` is feedback only, never a ground. The one exception is `rail`, the first sidebar's light grey `#F3F3F0` (owner, 19 Nov 2026), which tells the first menu from the second; every other ground stays white. `hairline` separates rows and regions.
`field-border` edges secondary buttons and cards. `input-border` edges every text field, select and
textarea: 3:1 on white, so a field is found without its label (WCAG 1.4.11; owner, 22 Nov 2026). `rule` sits under a table header and above a
total. `text-subtle` is placeholder and disabled only, never information.

**Status:** done, waiting and problem are shared by every app. Each always carries a word and is
never decoration. In Attendance, "waiting" amber sits next to the app's amber, so a waiting tag
there always keeps its dot and word.

**Light accents on Home pages (owner, 20–21 Nov 2026):** every app's Home or overview uses the
same three light accents, so all apps look alike: a soft-tint icon tile on each card (mint, lilac,
peach, butter or the info blue, by subject, never by app), a soft tag naming a task's subject, and a
soft inset top edge in the warning or problem tint on a card that needs action. Each tint pairs with
its own ink at 4.5:1 or more. They stay on Home and overview pages; lists, forms and documents keep
the white ground.

**Charts:** ink first, then series told apart by shape, dash and direct labels. The app colour
marks only the series the page is about. Category colours appear only when the category is also
written out (leave types in a legend).

## Typography

**Figtree** (variable, self-hosted through `@fontsource-variable/figtree`, OFL) for everything.
**JetBrains Mono** (self-hosted, OFL) for identifiers only: GSTIN, PAN, IFSC, account, employee,
invoice and voucher numbers, device IDs, API keys. Never for money and never for prose.

Six sizes, and any other size is a bug:

| Role | Size | Use |
|---|---|---|
| title | 24/32, 700 | Page title, the same in every app |
| section | 17/24, 600 | Section heading over a 2px ink rule |
| body | 14/20, 400 | Prose, table cells, field values, menu items (500) |
| secondary | 13/18, 400 | The email under a name, help under a heading |
| label | 12/16, 600 | Column heads, field labels, tags, filter counts |
| figure | 22/28, 600 | A key amount on an overview or a run total |

- Labels are sentence case. No uppercase, no tracking.
- Money: tabular figures, right aligned, ₹ before the amount, two decimals, true minus. Zero in a
  table is `—`, and a balance shows `₹0.00`. Indian grouping (₹1,12,000.00). Compact form (₹1.2L) only in
  a count line.
- Dates in words: `9 Dec 2026`. Never ISO in the interface.
- Weights per screen: 400, 600, and 700 for the title and totals.

## Layout

- **Shell:** a full-width 56px top bar (logo, app name, search, account); below it a 216px white
  menu with a hairline on its right, and the page. At or under 820px wide the menu becomes a sheet
  and the page gutter drops to 16px.
- **Page header:** title on the left, and under it the **count line** (one sentence of totals,
  for example "142 people · 3 joining Monday · 2 need documents"). Clauses whose count is zero
  are left out; a clause that needs action is a link. One primary button at top right, with
  secondary buttons to its left.
- **No figure tiles on list pages.** Overview pages may show at most four figures, each with real
  data. A tile is never shown at zero, and tiles never carry coloured bars.
- **Lists:** full width on the page ground under one rule. They have no card around them.
  Filter chips with counts sit above the list. Pages hold 25, 50 or 100 rows.
- **Forms:** two columns up to 720px, one on phones. Sections are a heading over a 2px ink rule,
  never a box or a tinted band.
- **Spacing:** 4px base. 12 inside a group, 16 between a header and its content, 24 between
  groups and as the page gutter, 32 to 48 between major page regions.
- **Phone (375):** tables with more than three columns turn each row into a two-line entry, name
  on the left and the key amount or state on the right.

## Elevation & Depth

The page is flat. Only floating layers cast a shadow: menus, popovers, dialogs and drawers, at
`0 8px 24px rgba(28,27,24,.10), 0 1px 3px rgba(28,27,24,.08)`. A document (invoice, payslip)
is the one object on the page that earns a hairline box with 12px corners.
No glow, no glass, no tinted cards.

## Shapes

Two radii. **8px** on anything clickable (buttons, fields, chips, menu items) and **12px** on
anything that holds content (dialogs, drawers, documents, the empty-state block). Tags are the
only pills. Nothing is nested inside a card.

## Components

- **Buttons:** 36px, or 32px for compact controls in toolbars and pagers, and 44px on phones.
  - Primary: app colour fill, white word. There is one primary per screen.
  - Secondary: white with a field border.
  - Text button: no border, hover grey.
  - Danger: white with red text, and it always asks first.
  - Every button has a Lucide icon and a word, except a pure text button.
  - Focus is a 3px ring of the app colour at 28%.
  - Disabled is at 45% opacity and says why in a title or help line.
- **Fields:** white with an input border (`#949494`), 36px, and the app colour on focus. The label (12/16, 600)
  sits above the field and help or error text (12/16) below it. The error says what is wrong
  and how to fix it ("A PAN has 10 characters. This one has 9."). Fields with 5 or more options
  get a search box. Every free text field suggests matching existing values.
- **Tables:**
  - The header is white, with label-size column heads in muted ink and a 1px rule under it.
  - Rows are at least 44px, with a hairline between rows and grey on hover.
  - Numbers are right aligned, and a total row is bold over a rule.
  - Row actions appear on hover; on touch screens they sit in a trailing menu.
  - The selected row takes the hover grey plus a check, never the app colour.
- **Status tags:**
  - A tag is a soft pill 24px high, with a 6px dot and a word.
  - It appears only when a row is an exception: waiting on someone, failed, missing, overdue. A
    row in the expected state shows no tag.
  - Exceptions sort first.
  - Filters and exports always offer every status.
- **Filter chips:** 32px. A chip holds a word and a count. The chosen chip takes the app colour
  for its border and word.
- **Tabs:** an underline in the app colour under the open tab, 14/20 at 600.
- **Menu:**
  - Items have a Fluent Emoji icon (flat, 16px) and a word, 36px high.
  - The open item shows its word in the app colour at 600 on hover grey.
  - Group names are label size, sentence case.
- **Dialogs:**
  - A dialog is 420px wide, with a 17/24 title that asks the question with its object
    ("Approve leave for Rohan Deshpande?").
  - Under the title, one line says what will change.
  - The buttons sit on the right, with the action last, and the action is named by its verb
    ("Approve leave", never "OK").
- **Toasts:** white with a dark word and a green tick. They say what happened ("Leave approved").
- **Empty states:** one line saying what will appear here and one button to add the first item.
  No illustration on a list. The block is 12px rounded with a hairline.
- **Loading:** skeleton rows the height of real rows. Never "Nothing selected" while data loads.
- **Approvals:** tick and cross buttons in People, Payroll, Attendance and Workspace (owner's
  style). Books keeps a secondary Approve and a text Reject.

## Reference products (People)

When designing a People page, study these products first (owner's research, 24 Nov 2026). Take
**structure, flow and features** from them: what is on the page, in what order, and how a task is
finished. Never take their colours, fonts, tinted grounds, card styles or navigation; every rule
above still applies, and where a reference disagrees with this file, this file wins.

| People area | Study first |
|---|---|
| Home (HR dashboard) | HiBob, Factorial |
| Employee directory | Rippling, BambooHR |
| Employee profile | HiBob, BambooHR |
| Attendance and shifts | Keka, Darwinbox |
| Leave | Keka, Factorial |
| Recruitment and onboarding | Personio, Rippling |
| Performance and goals | HiBob, Darwinbox |
| Organization structure | HiBob, Darwinbox |
| Policies and workflows | Zoho People, Rippling |
| Reports and analytics | Darwinbox, HiBob |
| Tables, filters, forms | Linear, Rippling |
| Settings, permissions, audit | Rippling, Zoho People |

Overall weight: HiBob 35%, Rippling 25%, Keka 20%, Factorial 10%, Linear 10%.

How the research's wishes map onto this file:

- **Meaningful KPIs:** on Home and overview pages only, at most four figures, each with real data.
  List pages keep the count line.
- **Clear status indicators:** the soft tag with a dot and a word, on exception rows only (people
  lists keep Active).
- **Purposeful illustrations:** Home and first-run pages only. A list's empty state stays one line
  and one button.
- **No decorative cards:** a card must help finish a task, or it goes.
- **Not adopted:** the split sidebar and the soft-mist ground. Navigation and the white ground
  follow this file and the owner's 15 Nov and 23 Nov decisions.

## Do's and Don'ts

- Do: give every screen one title of 24px and one primary action at top right.
- Do: write totals as a count line and drop the clauses that are zero.
- Do: right-align every amount, in tabular figures with ₹ in front.
- Do: show a status tag only when something needs attention.
- Do: name each page in its title exactly as the menu names it.
- Don't: put figure tiles above a list, or show a tile at 0.
- Don't: use the app colour for anything but the primary button, links, the open menu item and focus.
- Don't: tint a ground, a panel, a band or a header row. Grey is hover only.
- Don't: put a card inside a card, or a box around a list.
- Don't: greet by time of day, use uppercase labels, or show raw codes (APP_NOT_SUBSCRIBED) or ISO dates.

## Motion

- **Approach:** minimal-functional.
- **Easing:** ease-out for enter, exit and hover; ease-in-out for a drawer moving.
- **Duration:** hover and focus 120ms; menus 150ms; dialogs and drawers 180ms.
- **Numbers never animate.** A count that rolls up suggests the figure is not settled.
- All motion stops under `prefers-reduced-motion`.

## Migration

The code still follows the old picks. Move it in this order, one PR each, and check each step in the browser:

1. Tokens: `rnd.css` per-app `--act`, neutrals and status. Delete the conflicting rules from
   `picks.css` (3px buttons, grey fields, glassy cards, solid tags, the 16px title) and fold
   `legibility.css` into the six-size scale.
2. Table: one 44px row, white header with a rule, and the `--list-head` band removed outside Books.
3. Page header: the 24px title, the count line, and figure tiles removed from list pages (People
   first: Leavers, Assets, Learning, Announcements, Events, Helpdesk).
4. Status: exceptions-only tags, list by list (Payroll salary assignments first).
5. Phone: two-line rows for wide tables.

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 19 Nov 2026 | Fresh design system: "the calm register" | The old file had 67 picker rounds that contradicted each other, and a 238-page audit found mismatched titles, zero tiles and repeated tags. Written by /design-consultation from design knowledge, with one outside Claude voice. |
| 19 Nov 2026 | Kept: per-app colours, white ground, light only, Figtree and JetBrains Mono, Fluent Emoji navigation | Owner's fixed constraints |
| 19 Nov 2026 | Count line replaces figure tiles; status tags only on exceptions | The outside voice's departures, chosen by Claude at the owner's request ("select what is best") |
| 19 Nov 2026 | Kept the soft tag with a dot (owner, 19 Nov); no app-colour margin rule | A tag reads better than a bare dot now that tags are rare, and a margin rule would be a fifth job for the app colour |
| 19 Nov 2026 | Books excluded | Books belongs to another developer |
| 21 Nov 2026 | Logo orange `#FF5400` everywhere, clor.in on Figtree with the apps' colours, Ops forest `#015D47`, the grey rail recorded as the one ground exception, the same light accents on every Home | Owner's answers to the 21 Nov interaction audit |
| 24 Nov 2026 | clor.in only: pale blue grounds, navy text, Switzer, pill buttons and rounder panels, orange kept as the accent | Owner supplied a reference design system and chose "that look, CLOR orange accent" |
| 24 Nov 2026 | People reference products recorded (HiBob, Rippling, Keka, Factorial, Linear and others, per page); structure and features only. Split sidebar and soft-mist ground not adopted | Owner's research, with the choice left to Claude ("keep what is better for best user experience"): a white ground reads best for dense data, and one top-bar menu is simpler than two side menus |
