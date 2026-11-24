---
# gstack: design-md-format=spec
name: CLOR
description: The Motion kit. White work areas on one pale hue per app, square corners, two weights, violet for the one action that matters, motion that snaps and reveals.
colors:
  ground: "#FFFFFF"
  ink: "#18181B"          # stand-in: replace from Motion's full 37-colour palette
  ink-2: "#52525B"        # stand-in: replace from Motion's full 37-colour palette
  primary: "#7C3AED"
  link: "#2563EB"
  danger: "#DC2626"
  focus: "#6366F1"
  red-soft: "#F87171"
  violet-soft: "#A78BFA"
  pink-deep: "#F8ECF0"
  pink-deepest: "#F0E0E8"
  lilac-deep: "#EFEDF3"
  lilac-deepest: "#E6E3EC"
  slate-deep: "#EEEFF3"
  slate-deepest: "#E2E5EC"
  rose-deep: "#F3EDED"
  rose-deepest: "#ECE3E4"
  stone-deep: "#F0F0EE"
  stone-deepest: "#E8E8E6"
  sand-deep: "#F6F0E4"
  sand-deepest: "#F0E8D8"
  mint-deep: "#ECF6F0"
  mint-deepest: "#E0F0E8"
  logo: "#FF5400"         # artwork only, never UI
typography:
  display:
    fontFamily: TASA Orbiter
    fontWeight: 700
    fontSize: 40px
    lineHeight: 44px
  heading:
    fontFamily: TASA Orbiter
    fontWeight: 700
    fontSize: 34px
    lineHeight: 44px
  title:
    fontFamily: TASA Orbiter
    fontWeight: 700
    fontSize: 30px
    lineHeight: 36.65px
  body:
    fontFamily: TASA Orbiter
    fontWeight: 400
    fontSize: 15px
    lineHeight: 23.25px
  small:
    fontFamily: TASA Orbiter
    fontWeight: 400
    fontSize: 13px
    lineHeight: 19.5px
  label:
    fontFamily: TASA Orbiter
    fontWeight: 700
    fontSize: 11px
    lineHeight: 16.5px
  mono:
    fontFamily: Geist Mono
    fontWeight: 400
    fontSize: 13px
rounded:
  none: 0
  round: 50%              # radio dot and the attendance clock button only
spacing:
  s1: 1px
  s2: 4px
  s3: 6px
  s4: 8px
  s5: 10px
  s6: 12px
  s7: 16px
  s8: 18px
  s9: 24px
  s10: 28px
  s11: 30px
  s12: 32px
  s13: 48px
  s14: 71px
  s15: 77px
  s16: 96px
  s17: 107px
  s18: 144px
motion:
  press: "transform 0.14s cubic-bezier(0.16, 1, 0.3, 1)"
  settle: "border-color 0.4s cubic-bezier(0.25, 0, 0, 1)"
  fade: "opacity 0.15s"
  tint: "color 0.15s, background 0.15s"
  reveal: "clip-path 0.4s cubic-bezier(0.25, 0, 0, 1)"
  banner: "0.7s cubic-bezier(0.65, 0, 0.35, 1) both sale-banner-in"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ground}"
    hoverBackground: "{colors.ink}"
    rounded: "{rounded.none}"
    height: 32px
    heightPhone: 48px
  button-secondary:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    borderColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: 32px
  button-ghost:
    backgroundColor: transparent
    hoverBackground: "{colors.slate-deepest}"
    height: 32px
  button-danger:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.danger}"
    borderColor: "{colors.danger}"
    height: 32px
  input:
    backgroundColor: "{colors.ground}"
    borderColor: "{colors.ink-2}"
    focusBorder: "{colors.primary}"
    rounded: "{rounded.none}"
    height: 32px
  table-head:
    height: 32px
    borderColor: "{colors.ink}"
  table-row:
    height: 48px
    borderColor: "{colors.slate-deepest}"
  status-tag:
    rounded: "{rounded.none}"
    height: 24px
  dialog:
    width: 440px
    backgroundColor: "{colors.ground}"
    borderColor: "{colors.ink}"
    rounded: "{rounded.none}"
  drawer:
    width: 480px
    borderColor: "{colors.ink}"
---

# CLOR

Live kit: https://claude.ai/artifact/4HBqVKjSN3X3irhatkpEKe (every component below, with its states, on one page).

Adopted on 24 Nov 2026 by the owner: "forget all already available components and transitions, use best fit
from this skill". The source is the Motion design-system skill (tokens extracted from motion.dev). It replaces the
calm register of 19 Nov 2026 (still readable in git history before this commit) for **every surface: clor.in,
Admin center, Ops, Console, People, Payroll, Attendance and Books**. `DESIGN.legacy.md`, `picks.css`,
`legibility.css`, `rnd.css` and `website/src/styles/darwin.css` are now history; where they disagree with this
file, this file wins and the code moves (see Migration).

**Books:** included at the owner's request. Books belongs to another developer, so agree with them before a
Books PR lands.

## Overview

**Product context:** Indian HR, payroll, attendance, accounting and company administration, sold mostly through CAs
to growing and medium companies, alongside Keka, greytHR and Zoho. Dense data used all day at a desk; employees also
use self-service on phones.

**Character:** precise and developer-grade. White work areas, square edges, hairlines instead of shadows, one pale
hue per app, and a violet that marks only the action that matters. Motion is quick and physical: buttons press,
menus and drawers reveal with a clip-path wipe.

**Memorable thing:** obviously accurate. Trust is the product.

**Key characteristics:**
- Work areas are white. Each app's identity is a pale tint on its top bar and app header, never on lists or forms.
- Square corners everywhere. No shadows. Floating layers have a 1px ink border.
- Two weights only: 400 and 700.
- Money is the loudest thing on a money page: tabular, right aligned, bold total over an ink rule.
- Totals are a count line, not tiles. Only exceptions carry a status tag.

## Colors

**Rule from the skill:** no colour outside the palette above. The logo orange `#FF5400` is artwork, not a UI colour.

**Surfaces: one hue family per app.** Each family has a deep tint (top bar, app header, the app's section bands
on clor.in) and a deepest tint (that app's hairlines, pressed states, avatar ground).

| App | Family | Deep | Deepest |
|---|---|---|---|
| People | pink | `#F8ECF0` | `#F0E0E8` |
| Payroll | lilac | `#EFEDF3` | `#E6E3EC` |
| Console, shared chrome | slate | `#EEEFF3` | `#E2E5EC` |
| Books | rose | `#F3EDED` | `#ECE3E4` |
| Admin center | stone | `#F0F0EE` | `#E8E8E6` |
| Attendance, clor.in | sand | `#F6F0E4` | `#F0E8D8` |
| Ops | mint | `#ECF6F0` | `#E0F0E8` |

Code: the shell sets `data-app` on `<html>`; one stylesheet maps `--app-deep` and `--app-deepest` from it.

**Accents and their only jobs** (contrast measured on white):

| Token | Value | Contrast | Jobs |
|---|---|---|---|
| primary | `#7C3AED` | 5.70:1 (4.5+ on every tint) | Primary button fill, selected tab underline, chosen chip, switch on, checked box, current step, the one series a chart is about |
| link | `#2563EB` | 5.17:1 | Links and info notices. On white only (4.45–4.55 on tints) |
| danger | `#DC2626` | 4.83:1 | Error text and borders, danger button, problem tag. Text on white only |
| focus | `#6366F1` | 4.47:1 | 2px focus ring (needs 3:1). Never text |
| red-soft, violet-soft | `#F87171`, `#A78BFA` | 2.7:1 | Chart fills, and links on the ink toast. Never text on a light ground |

Primary is the same violet in every app; the hue family carries the app identity.

**Status (shared by every app):** always a word, never colour alone.
- Done: mint-deep ground, mint-deepest border, ink word.
- Waiting: sand-deep ground, sand-deepest border, ink word.
- Problem: white ground, danger border and word.

**Open gap:** the skill as pasted shows 20 of 37 colours and has no ink, success or warning colour. `ink` and
`ink-2` above are stand-ins. Replace them, and add success and warning inks if Motion has them, from the full
palette before the token PR lands.

**Light only.** No dark theme.

## Typography

**TASA Orbiter** for everything. **Geist Mono** for identifiers only: GSTIN, PAN, IFSC, UAN, account, employee,
invoice and voucher numbers, HSN, device IDs, release tags, API keys. Never for money, never for prose.

Six sizes; any other size is a bug.

| Token | Size / line | Use |
|---|---|---|
| display (text-2xl) | 40 / 44, 700 | clor.in hero only |
| heading (text-xl) | 34 / 44, 700 | clor.in section heads; app section heads on overview pages |
| title (text-lg) | 30 / 36.65, 700 | Page title in every app; a key figure |
| body (text-base) | 15 / 23.25, 400 | Prose, dialog titles (700), field values on phones |
| small (text-sm) | 13 / 19.5, 400 | Table cells, buttons (700), fields, menus, count line |
| label (text-xs) | 11 / 16.5, 700 | Field labels, column heads, tags, help and error text (400) |

- Two weights per page: 400 and 700. No 500 or 600.
- Labels are sentence case. No uppercase.
- Money: tabular figures, right aligned, ₹ first, two decimals, true minus, Indian grouping (₹1,12,000.00). Zero
  in a table is `—`; a balance shows `₹0.00`. Compact form (₹38.4L) only in a count line or a figure.
- Dates in words: `9 Dec 2026`. Never ISO in the interface.
- Body and code are never centred.

## Layout

- **Spacing:** 4px grid. Everyday gaps: 4, 8, 12, 16, 24, 32, 48, 96. Off-grid steps on the scale (1, 6, 10, 18,
  28, 30) for hairlines and optical nudges only. No value off the scale.
- **Shell:** 48px top bar on the app's deep tint: logo, app name, the app's places as tabs (People: Home · People ·
  Time · Pay · Grow · Company), search (`/`), alerts, account. No side rail. Below 860px the places move to a 48px
  bottom tab bar with safe-area padding.
- **Page header:** title (30/36.65) on the left, the **count line** under it ("142 people · 3 joining Monday · 2 need
  documents"; zero clauses dropped; action clauses are links), one primary button at top right, secondaries to its
  left. Page gutter 24px desktop, 16px phone.
- **Lists:** full width on white under one ink rule. No card around a list. Filter chips with counts above. Pages of
  25, 50 or 100.
- **Figures:** Home and overview pages only, at most four, never at zero, hairline box, no coloured bars.
- **Forms:** two columns up to 720px, one on phones. Sections are a 15/23.25 700 heading over a 1px ink rule.
- **Phone (375):** controls and rows 48px. Tables with more than three columns become two-line entries.

## Elevation & Depth

None. The page is flat. Menus, popovers, dialogs and drawers float with a **1px ink border** and no shadow. The
dialog scrim is ink at 32%. A document (payslip, invoice, offer) is the one in-page object that earns a box: 1px ink.

## Shapes

Square corners on everything, including buttons, fields, tags, chips, cards, dialogs and avatars. Two exceptions,
both round by nature: the radio dot and the 160px attendance clock-in button.

## Motion

| Token | Value | Used for |
|---|---|---|
| press | `transform 0.14s cubic-bezier(0.16, 1, 0.3, 1)` | Button and card press (scale .97), tab underline grow, switch thumb, dialog rise (8px) |
| settle | `border-color 0.4s cubic-bezier(0.25, 0, 0, 1)` | Field and button border on hover and focus |
| fade | `opacity 0.15s` | Scrim, tooltip, dialog opacity |
| tint | `color 0.15s, background 0.15s` | Hover fills, row hover, chip and link colour |
| reveal | `clip-path 0.4s cubic-bezier(0.25, 0, 0, 1)` | Menu, listbox and popover open (wipe down), drawer (wipe from right), toast (wipe up) |
| banner | `0.7s cubic-bezier(0.65, 0, 0.35, 1) both sale-banner-in` | clor.in announcement bar, once per visit (opens from the centre) |

- Figures never animate. A total that counts up looks unsettled.
- No ambient or looping animation; spinners and skeleton pulse are the only loops.
- Everything stops under `prefers-reduced-motion`.

## Components

Every component defines default, hover, focus-visible, active, disabled, loading and error, and handles empty,
overflow, truncation and maximum content (₹99,99,99,999.00; a 60-character name).

### Shell and navigation
- **App bar and places:** as Layout. Open place 700 ink with a 2px primary underline; `nav aria-label="Places"`,
  `aria-current="page"`.
- **Tabs:** text-sm; open tab 700 ink with a 2px primary underline that scales in (press). Arrow keys, Home, End,
  roving tabindex; `tablist / tab / tabpanel`. Overflow scrolls sideways inside the strip.
- **Command palette:** ⌘K; dialog with a 48px search and a listbox; recent items first; `combobox` + `listbox`.
- **Back link and breadcrumb:** back link one level up from a record; breadcrumb only in settings trees deeper
  than two levels.

### Actions
- **Button:** 32px (48 on phones), padding 16, text-sm 700, a Lucide 16px icon plus a word (icon-only buttons are
  32×32 with `aria-label`). Primary violet, hover ink. Secondary white with 1px ink border, hover slate-deep.
  Ghost borderless, hover slate-deepest. Danger red border and word, hover fills red, always confirms first.
  Press scales to .97. Disabled 45% opacity with the reason in `title` or help. Loading: square spinner replaces
  the icon, width held, `aria-busy`. Done: a tick and the past-tense word ("Saved") for about 1.5s, announced,
  then back to default. Expanded (a button that opens a menu, popover or section): slate-deep ground and the
  chevron turned up (press) while open, `aria-expanded="true"`. Cooldown (Resend code, Send reminder, Resend
  invite): disabled, the wait said once in the label ("Resend in 30s"), no ticking count (figures never animate);
  when the wait ends the label returns ("Resend code"), announced. Errors show on the field and in the error
  summary, never on the button. Not used: hold-to-confirm, drag and in-button progress fills (use the meter). One
  primary per screen. Buttons name verb and object ("Approve leave").
- **Approve / reject:** tick and cross 32×32 buttons (every app, Books included). Tick hover fills primary; cross
  hover turns danger. Approve acts at once with an Undo toast; reject opens a reason drawer.
- **Menu:** ink border, reveal; items 32px text-sm; danger item last after a hairline. Arrow keys, Enter, Esc
  returns focus, type-ahead; `menu / menuitem`, trigger `aria-haspopup aria-expanded`.
- **Link:** link blue, underline offset 3px. Links go somewhere; buttons do something.

### Inputs
- **Text field:** 32px, 1px ink-2 border, hover ink, focus primary border plus focus ring; label text-xs 700 above;
  help or error text-xs below. Error: danger border and a message that says what is wrong and how to fix it ("A PAN
  has 10 characters. This one has 8."). Disabled: stone-deep ground, hairline border. Every free-text field suggests
  matching existing values. `aria-invalid`, `aria-describedby`.
- **Money:** ₹ prefix block on stone-deep, right aligned tabular, Indian grouping on blur.
- **Identifier:** Geist Mono, uppercase as typed, length counter (GSTIN 15, PAN 10, IFSC 11, UAN 12).
- **Phone:** +91 prefix block, `inputmode="tel"`. **Password:** show/hide ghost button, caps-lock warning.
- **Textarea:** 80px minimum, grows; count shown near the limit.
- **Select:** five or more options get a search box; opens with reveal; empty search offers "Add …" when allowed.
  `combobox` + `listbox`.
- **Checkbox and radio:** 16px; checked fills primary; mixed state on select-all.
- **Switch:** 32×18 square track, thumb slides (press); only where the change takes effect at once. In a form with
  Save, use a checkbox. `role="switch" aria-checked`.
- **Date, range, week:** typed or picked, shown in words; range presets first (This month, Last month, This
  quarter, This financial year); holidays marked in the calendar.
- **File drop:** dashed ink-2 border; hover primary border on lilac-deep; lists file, size, remove.
- **One-time code:** six 40×48 Geist Mono cells, paste fills all, auto-advance, `autocomplete="one-time-code"`.

### Data display
- **Table:** head 32px text-xs 700 ink-2 over a 1px ink rule; rows 48px with an app-deepest hairline; hover
  slate-deep (tint); money right aligned; total row 700 over an ink rule. Checkbox column for selection; rows open
  on Enter; sortable heads are buttons with `aria-sort`. Row actions on hover, a trailing ⋯ menu on touch.
- **Status tag:** 24px, square, 6px square dot, text-xs 700. Only on exception rows (waiting, failed, missing,
  overdue); exceptions sort first. Lists of people keep "Active". Filters and exports offer every status.
- **Filter chips:** 32px, word plus a mono count; chosen chip has primary border and word; `aria-pressed`.
- **Column filter:** popover under a head: values with counts, date range, amount range.
- **Bulk bar:** ink bar at the list top when rows are picked: "4 picked · Approve 4 · Export · Clear".
- **Pagination:** "1–25 of 142" plus Previous (ghost) and Next (secondary).
- **Figure:** label text-xs over a 30/36.65 700 tabular value, hairline box.
- **Meter:** 8px bar on slate-deepest, primary fill, danger past the limit, with the amount in words.
- **Avatar:** 32px (48 on a profile header), square, initials on a deepest tint hashed from the person's ID.
- **Timeline:** 8px square ink dots on a hairline; who, what and when in words.
- **Chart:** bars and lines only. Ink axis, slate-deepest grid, text-xs ink-2 labels. The page's series is
  primary; others violet-soft or red-soft with direct labels. A data-table toggle under every chart. No pies, 3D
  or gradients.
  Draw them with `LineChart` and `BarChart` from `packages/ui/src/components/charts/kit` (24 Nov 2026).

### Overlays
- **Dialog:** 440px, ink border, 24px padding; title asks the question with its object ("Approve leave for Rohan
  Deshpande?"); one line says what changes; buttons right, action last, named by its verb. Rises 8px (press) and
  fades. Focus trapped, Esc closes, focus returns. `role="dialog" aria-modal="true"`.
- **Drawer:** 480px (full width on phones), left ink border, wipes in from the right (reveal); sticky footer
  actions; closing with changes asks to discard.
- **Popover:** like the menu. **Tooltip:** ink ground, white text-xs, on hover and focus; never the only copy of
  anything. **Toast:** ink bar bottom centre, wipes up (reveal), says what happened ("Leave approved"), Undo for 6s,
  `role="status"`.

### Feedback
- **Notice:** 2px left rule plus a tint: info (link blue on slate-deep), warning (ink on sand-deep), problem (danger
  on rose-deep, `role="alert"`). Merge several into one list rather than stacking.
- **Empty state:** dashed hairline block, one line saying what appears here, one button to add the first. Filtered
  empty: "No one matches 'Fin'. Clear filters." Illustrations only on Home and first-run pages.
- **Loading:** skeleton rows at 48px with a 1.4s pulse. Never an empty message while data loads.
- **Error:** problem notice with Retry; keep the last good data on screen.
- **Error summary:** on submit, a problem notice listing each error as a link to its field; focus moves to it.
- **Progress:** meter plus "Imported 120 of 400 rows" and Cancel, for imports and pay runs.

### Documents and flows
- **Document sheet:** payslip, invoice, offer letter, settlement. 1px ink box, header over an ink rule, mono
  identifiers, tabular money, bold total. Prints black on white, A4, 16mm margins, "page x of y" footer.
- **Stepper:** steps as 2px rules across the top: done ink, current primary and 700, later hairline. A done step
  links back. `ol` with `aria-current="step"`.

## Components per app

The full list with specimens is on the live kit page. In short:

- **clor.in:** announcement bar, site nav with products mega panel, hero, product window, logo strip, feature row,
  steps, plan card (recommended plan gets a 2px primary top rule), monthly/yearly toggle, comparison table, quote,
  FAQ accordion (reveal), demo form, closing band, footer.
- **Admin center:** at-a-glance card, top actions list, setup checklist, app tile, seat meter row, member row,
  invite form, permission matrix, location access table, plan change summary, invoice list and sheet, audit trail,
  security switches, device row, support access grant.
- **Ops:** customer header, switch board (reason required), reason drawer, approval queue (two-person rule), ticket
  thread with internal notes on sand-deep, saved reply picker, health row, pricing editor, trial row, deal board,
  alert feed, staff roles.
- **Console:** code sign-in, authenticator enrol, guard re-ask before risky actions, release row (promote / roll
  back with reason), pull row, confirm-with-reason dialog, member row, audit table. Console is a separate bundle: it
  takes the same tokens file, not the app components.
- **People:** Home act-in-place card with Undo, Home pay-run status (the last three runs: month, state as a word,
  total in ₹, links to the run; hidden to people without payroll access), overview attendance trend (a monthly
  attendance-rate bar chart, current month in primary, data-table toggle), Home headcount by department, Home
  celebrations (birthdays and work anniversaries in the next 30 days, three rows, people who opted out left out),
  directory row, profile header, field group with edit drawer, add employee wizard, import wizard, org chart node,
  approvals inbox, audience picker, goal row, review form, candidate board, interview slot picker, offer sheet,
  helpdesk thread, policy reader.
- **Payroll:** pay run stepper, run guards, run total, pay calendar strip, salary structure editor (formula in mono,
  live sample), component row, payslip, statutory dues table, tax declaration form, settlement sheet, bank change
  approval, loan schedule, ledger mapping.
- **Attendance:** clock-in button (160px round), day register, month grid (letters P/A/L/W/H, not colour alone),
  roster grid, week bars, punch evidence, geofence editor, device health row, unmatched punch matcher, month close,
  leave balance, phone tab bar.
- **Books:** voucher form with line-item grid, document number field, party picker, tax split row, knock-off table,
  outstanding bills dialog, bank reconciliation pair, ledger statement, invoice print, e-way bill form, report grid,
  import center.

## Reference products (People)

Take **structure, flow and features** only; never colours, fonts, grounds or card styles. Where a reference
disagrees with this file, this file wins.

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

## Design laws

Twenty laws of UX, each tied to the rule in this file that carries it out (owner, 25 Nov 2026). Use them to check a
screen in review. Where a law and a rule seem to disagree, the rule wins. Laws marked **new** add a rule.

| Law | How CLOR carries it out |
|---|---|
| Aesthetic-usability effect | Precision is the look: square, flat, white, aligned figures. Not a licence to decorate. |
| Law of proximity | 4px grid; a label sits 4px from its field, 24px between groups; form sections are a heading over an ink rule. |
| Von Restorff effect | Violet marks the one action that matters; status tags only on exception rows. If two things stand out, neither does. |
| Zeigarnik effect | **new.** Unfinished work is shown where it was left: a draft employee, a pay run halfway through, an import stopped. Home and the list show one "Continue …" row with the step it stopped at ("Pay run for Nov · step 3 of 5 · Continue"). Never nag with badges. |
| Tesler's law | **new.** The system takes the complexity the user would otherwise carry: tax splits, state codes from a GSTIN, pro-rata, holidays, PF and ESI ceilings are worked out, not typed. Show the working on request, never ask for it. |
| Law of Prägnanz | Six sizes, two weights, square shapes, no shadows: each screen reads as a few simple blocks. |
| Serial position effect | **new.** In menus, tabs and lists of actions, the most used item goes first and the danger or exit item last. Home is always the first place; the account menu ends with Sign out. |
| Progressive disclosure | **new.** Forms show what most people fill; rarely used fields sit under one "More details" toggle or in a drawer. Settings deeper than two levels get a breadcrumb. Never hide a required field. |
| Law of common region | A boundary means "these belong together": the 1px ink box only on documents and floating layers; no card inside a card, no box around a list. |
| Goal-gradient effect | **new.** Every multi-step job shows how far along it is: stepper for flows, "4 of 7 done" on setup checklists, "Imported 120 of 400 rows" on progress. Done steps are counted from the start, never reset. |
| Law of similarity | Same thing, same look everywhere: one violet primary, three status looks, one button set in every app. |
| Recognition over recall | Every text field suggests existing values; ⌘K shows recent items first; dates in words; pickers over typed codes. |
| Pareto principle | The count line and exceptions-first sorting put the 20% that needs attention at the top. |
| Occam's razor | When two layouts work, pick the one with fewer parts. Remove before adding. |
| Parkinson's law | **new.** Long jobs say how long they take before they start ("About 2 minutes for 142 people") and setup tasks may carry a due date. No countdowns or false urgency. |
| Uniform connectedness | Lines tie related things: stepper rules, timeline hairline, the bulk bar over the picked rows. |
| Paradox of the active user | People skip instructions, so the screen teaches: errors say how to fix, empty states have one button, defaults are sensible. No tours that must be read first. |
| Cognitive load | One primary per screen, search at five or more options, two-line rows on phones, at most four figures in a Home or summary band. |
| Default effect | Defaults are the safe, common choice: this month, this financial year, the company's main branch. Never default to a destructive or paid option. |
| Peak-end rule | **new.** A finished job ends on a summary, not a blank list: pay run, month close, import, onboarding and approvals inbox end with one line of what was done in figures ("Nov pay run done · 142 paid · ₹38,40,000.00"), revealed once with the reveal motion, plus the next useful link. No confetti or looping animation; figures never animate. Errors at the end keep the last good data and offer Retry. |

## Accessibility

- Text 4.5:1; controls, borders that identify a control, and focus 3:1 (WCAG 2.2 AA).
- Focus always visible: 2px focus-colour outline, 2px offset.
- Every control works by keyboard alone; every icon-only button has a label.
- Touch targets 48px on phones.
- State is never colour alone: tags carry words, calendar cells carry letters.

## Do's and Don'ts

- Do: one 30px title and one primary action per screen.
- Do: write totals as a count line and drop the zero clauses.
- Do: right-align every amount in tabular figures with ₹ in front.
- Do: show a status tag only when something needs attention.
- Do: name each page exactly as the menu names it.
- Don't: use a colour outside the palette, or a size, gap or timing off the scale.
- Don't: round a corner or cast a shadow.
- Don't: use a third font weight.
- Don't: tint a list, form or document ground; tints belong to the top bar, app header and Home cards.
- Don't: put figure tiles above a list, or show a tile at 0.
- Don't: put a card inside a card, or a box around a list.
- Don't: ship a component without hover, focus-visible and disabled states.
- Don't: greet by time of day, use uppercase labels, or show raw codes (APP_NOT_SUBSCRIBED) or ISO dates.

## Definition of Done (per component)

- Default state renders in a smoke test.
- Hover, focus-visible, active, disabled, loading and error each checked in the browser.
- No raw values: every colour, size, gap and timing is a token from this file.
- Works by keyboard alone.
- No critical axe violations.
- Checked at 375px and 1440px.
- Empty, overflow and maximum content shown.
- Purpose, when to use and when not to use written down, with at least one anti-pattern.

## Migration

The code still follows the calm register. Move it in this order, one PR each, checked in the browser, updating the
tests that pin the old values (`test/design-rules.test.js`, `test/ui-rules.test.js`,
`test/quiet-emphasis.test.js`, `test/people-colours.test.js`, `test/palette.test.js`) in the same PR:

0. Close the palette gap: real ink, success and warning colours from Motion's full palette.
1. Tokens: one tokens file (colours, hue families by `data-app`, type, spacing, motion) used by the apps, Console
   and clor.in; self-host TASA Orbiter and Geist Mono; delete `picks.css`, `legibility.css` and the old per-app
   colours in `rnd.css`.
2. Shape and depth: radius 0 and no shadows everywhere; floating layers get the ink border.
3. Controls: buttons, fields, chips, switches and tabs at 32px with the new states and motion.
4. Table and page header: 48px rows, 32px head over an ink rule, 30px title and count line.
5. Overlays and feedback: dialog, drawer, menu, toast and notices with reveal and press motion.
6. Per app, in order: Admin center, People, Payroll, Attendance, Ops, Console, clor.in, then Books (after agreeing
   with its developer).
7. Phone: 48px controls and rows, bottom tab bar, two-line table rows.

**Progress.** The owner asked for People first (24 Nov 2026), ahead of the shared steps. `packages/ui/src/motion.css`
carries the kit for the apps that have moved and nothing else (`test/motion-kit.test.js` keeps it scoped):

| App | Moved | What changed |
|---|---|---|
| People | 24 Nov 2026 | Tokens (violet, ink, hairlines, pink top bar, TASA Orbiter, Geist Mono), square, flat, 1px ink border on menus and dialogs, 32px controls, 48px rows over an ink rule, 30px title, mint/sand/white tags, links blue, current place violet, press and reveal motion |
| Admin center | 25 Nov 2026 | Same layer as People, stone top bar (`#F0F0EE`, hairline `#E8E8E6`); its own cards and tiles checked for colour outside the palette |

To move the next app, add its `data-app` value to the scope in `motion.css` and to `MOVED` in the test, give it its
hue family, and check it in the browser. Steps 0 to 5 then become deleting the old layers once every app has moved.

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 19 Nov 2026 | The calm register (Figtree, per-app colours, 8/12px radii) | Replaced a 67-round file that contradicted itself |
| 24 Nov 2026 | People reference products recorded; structure and features only | Owner's research |
| 24 Nov 2026 | **The Motion kit replaces the calm register on every surface, Books and clor.in included** | Owner supplied the Motion design-system skill and said to forget the existing components and transitions and use the best fit from the skill |
| 24 Nov 2026 | One violet primary in every app; app identity moves to a pale hue family | The skill has only three accents that pass AA as text; seven surface families map cleanly onto the apps |
| 24 Nov 2026 | Square corners, no shadows, 1px ink border on floating layers | The skill detected no radius and no elevation |
| 24 Nov 2026 | Logo orange kept as artwork only | The brand mark stays; it is not a UI colour |
| 24 Nov 2026 | Ink, success and warning are stand-ins until Motion's full palette is pulled | The pasted skill showed 20 of 37 colours |
| 24 Nov 2026 | Kept from earlier: count line, exceptions-only tags, one primary per screen, tick/cross approvals, white work areas, light only, six People places | Product rules, not visual style; nothing in the skill contradicts them |
| 25 Nov 2026 | Twenty design laws mapped to rules; seven new rules (Zeigarnik, Tesler, serial position, progressive disclosure, goal-gradient, Parkinson, peak-end) | Owner asked to check the platform against the laws and add the missing ones |
| 25 Nov 2026 | Button gains done, expanded and cooldown states; People Home gets pay-run status and an attendance trend (headcount by department and celebrations were already there) | Owner asked to check an HRM dashboard and a sixteen-state button reference against the platform; error, hold, drag and progress-fill states were left out on purpose; payroll trend belongs in Payroll |
