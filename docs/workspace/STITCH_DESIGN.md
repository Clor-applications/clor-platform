# Design System: Clor Workspace

Prompt source for Google Stitch when generating Workspace screens (the
administration app at app.clor.in: companies, access, security, plan, data).
Values are the ones the running product uses (`apps/admin/src/screens/workspace.css`,
`packages/ui/src/index.css`). Where this file and the repo's `DESIGN.md`
disagree, `DESIGN.md` wins.

## 1. Visual Theme & Atmosphere

A calm, well-lit administration desk for an Indian business owner and their
accountant. Warm porcelain ground, white working surfaces, graphite ink, and
one Blaze Orange that only ever means "the thing to do next". It reads like a
tidy ledger office: everything labelled, nothing decorative, figures that line
up to the digit.

- **Density 5 — Daily App Balanced.** Stat strips and tables carry real
  numbers; panels breathe with 16–18px internal padding and 28px between page
  sections.
- **Variance 3 — Predictable, lightly offset.** Pages use a main column with a
  300px side column (main ~2/3, side ~1/3). Never a centred hero; this is an
  app, not a landing page.
- **Motion 3 — Static Restrained.** Motion only answers an action: a drawer
  slides in, a row confirms, a menu opens. Nothing loops on its own.

## 2. Color Palette & Roles

- **Porcelain Ground** (#FAFAF7) — page background behind every Workspace page.
- **Pure Surface** (#FFFFFF) — panels, tables, drawers, inputs.
- **Soft Stone** (#F4F3EF) — table header row, quiet tiles, sunken areas.
- **Graphite Ink** (#252626) — primary text, headings, figures.
- **Muted Slate** (#70736F) — descriptions, captions, metadata, table headers.
- **Hairline** (#E5E6E1) — 1px borders on panels, tables and dividers.
- **Blaze Orange** (#F4511E) — the single accent: the one primary button per
  page, selected rail item text, focus ring. Hover deepens to #D94313.
- **Blaze Wash** (#FFF0E8) — selected navigation item fill, soft accent tiles.
- **Status, never decoration:** Settled Green (#16856B on #E7F3EC) for active /
  complete; Amber Notice (#B7791F on #FDF4E4) for needs attention; Brick Red
  (#C43C45 on #FCECED) for danger zones and destructive actions.

Rules: one accent only. No gradients, no neon, no glow. No pure black — the
darkest ink is Graphite #252626. Workspace is light theme only.

## 3. Typography Rules

- **One face: Inter** (served from the app as `'Inter Variable'`), for
  everything — headings, body, numbers, codes. This is a project decision
  (DESIGN.md, 2026-09-13) and overrides the skill's Inter ban.
- **Page title:** 26–34px fluid (`clamp(1.6rem, 1.25rem + 1.1vw, 2.1rem)`),
  weight 600, tracking -0.025em, line-height 1.1.
- **Section / panel title:** 16px, weight 600.
- **Body and UI:** 14px, line-height 1.55, max ~72 characters per line for
  descriptions.
- **Table cell:** 13–14px. **Table header:** 12px, weight 600, Muted Slate,
  sentence case.
- **Money and counts:** tabular figures (`tabular-nums`), right-aligned in
  tables. GSTIN, PAN, user IDs: Inter with ligatures off, never a mono family.
- No serif anywhere. No all-caps labels above headings.

## 4. Component Stylings

- **Page head:** breadcrumb (13px, Muted Slate, chevron separators) → title →
  one-line description. The single primary action sits top right. A hairline
  divides the head from the content.
- **Buttons:** 40px tall (38px compact, 44px touch), 8px radius, 600 weight.
  Primary = Blaze fill, white text, faint orange-tinted shadow. Quiet = white
  fill, Hairline border, Graphite text. Danger = Brick Red text/border, filled
  only on the final confirm. Press: 1px downward nudge. No glow.
- **Stat tile:** white, 12px radius, Hairline border; colour icon in a 36px
  soft tile, label, large figure, one-line note. A stat that leads somewhere is
  a button with a chevron.
- **Panel:** white, 12px radius, Hairline border, title row with an optional
  small link on the right. Never a panel inside a panel.
- **Table:** sits in a white frame with 12px radius; Soft Stone header row;
  rows divided by Hairline; cells do not wrap; on narrow screens the table
  scrolls inside its own frame, never the page. Sortable headers carry a
  small sort glyph.
- **Pills:** fully rounded, 12px text — Active (green), You are here (Blaze
  Wash), Setup incomplete (stone), Suspended / Revoked (red).
- **Inputs:** label above (14px, 500), helper or error below; 8px radius,
  Hairline border; focus = Blaze border plus a 3px Blaze ring at 15%.
- **Drawer:** create/edit forms open in a right-side drawer, not a new page.
- **Meter:** label and "used / limit" on one row, a thin bar below; turns
  amber at 80%. An unlimited allowance says "no limit" instead of a bar.
- **Danger zone:** a Brick Red-bordered section at the bottom of Data, set
  apart from everything else, with a plain sentence of consequence.
- **Loading:** skeleton blocks the size of the content. **Empty:** one sentence
  naming the next action, plus the button that does it.
- **Icons:** Microsoft Fluent colour icons in navigation, stat tiles and list
  items; thin line icons only for small affordances (chevrons, close, search).

## 5. Layout Principles

- Content max-width 1280px, centred, with fluid padding
  (`clamp(16px, 2.6vw, 40px)` horizontally).
- **Navigation stays as built:** a narrow icon rail (Overview, Company, Access,
  Security, Plan, Data) beside a module panel listing that module's pages.
  Every rail item opens its own landing page.
- Page body: main column + 300px side column; the side column drops below the
  main one under 1024px.
- Stat strip: 3–4 tiles in an auto-fit grid (min ~220px), never three
  identical feature cards as decoration.
- CSS Grid for page structure; grid children get `min-width: 0` so wide
  content scrolls in place.

## 6. Responsive Rules

- Breakpoints checked: 360, 390, 768, 1024, 1440, 1920px.
- Under 768px everything is one column; the rail becomes bottom tabs
  (Overview, Companies, Members, Security).
- No horizontal page scroll at any width — only a table frame may scroll.
- Touch targets at least 44px on phones. Body text never under 14px.
- Page title scales with `clamp()`; section gaps shrink from 28px to 20px.

## 7. Motion & Interaction

- Durations 150–220ms, easing `cubic-bezier(0.2, 0.7, 0.2, 1)`.
- Animate only `transform` and `opacity`.
- Drawer slides 24px + fades; menus fade and scale from 98%.
- Respect `prefers-reduced-motion`: no movement, instant state changes.
- No perpetual loops, no staggered list entrances, no counting-up numbers —
  a figure is printed so it can be read immediately.

## 8. Anti-Patterns (Banned)

- No emojis.
- No second typeface; no monospace family for numbers or codes.
- No pure black (#000000); no graphite primary buttons inside the Workspace.
- No gradients, glows, neon, glassmorphism.
- No third radius: 8px clickable, 12px content, fully round for pills only.
- No card inside a card.
- No more than one orange primary action on a page.
- No fake data: every figure comes from the server; billing is not live, so no
  invented invoices, prices or payment buttons.
- No buttons that do nothing.
- No placeholder people or companies ("John Doe", "Acme").
- No filler copy ("Seamless", "Elevate", "Unleash", "Scroll to explore").
- No uppercase eyebrow labels above titles; no "01 / 02 / 03" numbering unless
  the content really is a sequence.
- No page that repeats the sidebar as a grid of links.

## 9. Where this deviates from the taste skill (deliberately)

| Skill default | Workspace | Why |
|---|---|---|
| Inter banned; use Geist/Satoshi | Inter only | DESIGN.md one-face decision (2026-09-13); self-hosted for privacy |
| Cards 2.5rem radius | 12px content, 8px clickable | DESIGN.md two-radius rule |
| Accent saturation < 80% | Blaze #F4511E (~91% HSL saturation) | Redesign spec token; contrast checked for white text at 14px semibold |
| Perpetual micro-interactions, staggered reveals | None | Admin tool read for figures; motion only answers actions |
| Mono for dense numbers | Inter tabular-nums | DESIGN.md: digit alignment without a second face |
| Asymmetric hero, inline image typography | No hero | Application screens, not marketing |

Changing any row needs the user's approval and a DESIGN.md decision-log entry.
