# People design audit, 4 Nov 2026: the "soft-skill" lens

Owner's request: audit People against the high-end visual design skill (`taste-skill/soft-skill`).
Reviewer: clor-designer. Nothing in the app was changed; this document and its screenshots are the whole change.

## How this was done

- **Build:** `origin/claude/people-white-clean` (PR #123, 760b86bd). It is one commit ahead of `main` (e8cf86f1) and five behind, and it is the owner's latest direction: a white work area, with colour only in the accents. Every finding below that is not about PR #123's own surfaces also holds on `main`.
- **Data:** the e2e world (`e2e/scripts/seed-only.ts`, run `s8ky1d`): Asha Textiles with 12 people, plus 5 waiting casual-leave requests sent from the employee app.
- **Servers:** API on 4027 and web (`vite preview`) on 5207, against the database `clor_design_audit`. 4017/5197 were taken by another session.
- **Browser:** headless Chromium (Playwright) at 1440×900, and at 390×844 with touch and the mobile flag. I signed in through the real sign-in screen as Suresh (owner) and, for the employee app, as Priya.
- **Measured, not eyeballed:** a script read every element's computed `box-shadow`, `transition`, `border-radius`, font and size on all 28 screen/width pairs, and every tap target under 44px at 390. The numbers quoted below come from that script.
- **Evidence:** `docs/people/design-v1/evidence/design-audit-2026-11-04/`. Files named `NN-screen-1440.png` are full-page captures. At 390, `NN-screen-390.png` is full-page and `NN-screen-390-sK.png` are viewport captures at successive scroll positions.

### Which rules apply

DESIGN.md is the owner's and it wins. From the skill I applied only the principles that fit it:

- spacing rhythm and hierarchy
- hairlines and diffused shadows, not harsh ones
- icon weight
- motion: custom easing, animating transform and opacity only, honouring reduced motion
- press feedback
- entry, loading and empty states
- phone layout

Where the skill contradicts DESIGN.md, I did not count the gap as a finding. Each one is a question for the owner at the end.

## What already looks right

Say it first, because most of the system holds:

- **No sideways page scroll.** The page's `scrollWidth` equals the window width on all 28 screen/width pairs.
- **Press feedback is in place and gated.** Buttons scale to `.98` on `:active`, and rows, tabs, segments, chips and figures press too. These rules sit in `people.css`, around lines 870 and 1459. Phone sheets can be dragged away. Reduced motion is honoured in 29 rule blocks, and the Home reveal is switched off under it.
- **Loading inside the app takes the page's shape.** See `20-leave-requests-loading-1440.png`: title, tabs, filters and skeleton rows, with no boxed spinner.
- **Drawers move well.** They enter with `ui-slide-right` over 200ms on `cubic-bezier(0.16, 1, 0.3, 1)`, which is within DESIGN's 200ms for a surface and uses a custom curve.
- **Focus is clear.** There is one focus ring: a 2px `--ring` (red) outline (`23-focus-ring-1440.png`).
- **Colour follows the rules:**
  - marigold pills mark what is waiting (Waiting, To do);
  - a figure at nought is quiet grey;
  - the chosen view tab is marigold with oxblood words.
- **Words follow the rules:**
  - labels are in sentence case;
  - page titles equal their menu labels on all 14 screens;
  - phone fields are 16px, so iOS does not zoom.
- **Lists are flat.** Employees, Approvals, Leave requests and Attendance sit on the white page under one hairline, with no card wrapper.
- **The employee record works.** Its header, Overview sections and activity rail read well at 1440 (`03-employee-record-1440.png`).

## Findings, by impact

**B** means blocker: it breaks a DESIGN.md rule on a main screen, or hurts a task. **P** means polish.

### 1. B · Home: content fades in from a blur over 900ms, and stays invisible until scrolled to

- **Where:** Home, at 1440 and 390. Evidence: `01-home-390.png`, the full-page capture, where about 1,000px of blank sits where *Your tasks* should be; compare `01-home-390-s3.png`, where it shows once scrolled into view.
- **What is wrong:** `.people-soft [data-reveal]` starts every block at `opacity: 0; transform: translateY(2rem); filter: blur(6px)`. It then transitions all three over **900ms**, staggered by 70ms (`people.css:684–691`). The block shows only when an IntersectionObserver sets `data-shown`.
  - Other Home motion is also slow:
    - `.soft-pill`: 500ms;
    - `.soft-band-stat`: 600ms;
    - the panels: 600ms;
    - the growth chart draws over **1600ms** after a 300ms delay.
- **Why it matters:**
  - DESIGN.md → Motion: 120ms for a state, 200ms for a surface, and "Data should be there when you look".
  - The skill's own guardrail is to animate only `transform` and `opacity`. A `filter: blur` transition repaints every frame on a phone.
  - Anything that does not scroll the page (print, a fast fling, a screenshot, a slow device) sees empty space. The owner opens Home every day: a figure arriving a second late reads as "still loading", not as polish.
- **Fix:**
  - `.people-soft [data-reveal] { opacity: 0; transform: translateY(0.5rem); transition: opacity 200ms var(--soft-ease), transform 200ms var(--soft-ease); transition-delay: calc(min(var(--i, 0), 4) * 30ms); }`
  - Drop `filter` from both rules.
  - Set `data-shown` on mount for every block, not from the IntersectionObserver.
  - `.soft-pill`, `.soft-pill-orb`, `.soft-band-stat`, `.soft-core-action`, `.soft-event`: `transform 120ms`, `background-color 120ms`.
  - `.soft-chart-line`: `animation-duration: 400ms; animation-delay: 0`.

### 2. B · Cards render with a 4px corner, not 12px

- **Where:** every People screen with a `.ui-card`. Measured on:
  - Home: *Not checked in today*, *Your company has grown*, *Get People ready*;
  - all 30 Settings tiles;
  - the People report's four figure cards;
  - the employee app's cards.

  Evidence: `01-home-1440.png`, `14-settings-1440.png`, `13-reports-1440.png`.
- **What is wrong:** `.ui-card` reads `border-radius: var(--radius)`, and the platform sets `--radius: 0.25rem`. Next to it, `--radius-lg` is 4px and `--radius-xl` is 6px (`index.css:459–467`). People overrides only `--radius-btn` and `--radius-input`, both to 8px (`people.css:862`).

  So Home now shows **four radii side by side**:
  - 4px on `.ui-card`;
  - 8px on buttons;
  - 12px on `.soft-band-stat`;
  - 999px on the Approve chips.

  Off-scale radii found as well:
  - 3px on a mark;
  - 10px on a Settings icon;
  - 14px on `.soft-event-date`;
  - 16px on `.soft-event`.
- **Why it matters:** DESIGN.md has two radii: 8px on anything clickable, 12px on anything holding content.
- **Fix:**
  - In the sky palette block of `people.css` (next to line 862), add `--radius: 0.75rem; --radius-lg: 0.5rem; --radius-xl: 0.75rem; --radius-kpi: 0.75rem;`
  - `.soft-event` → `border-radius: var(--radius-btn)`.
  - `.soft-event-date` → `border-radius: var(--radius-btn)`.
  - The platform-wide fix is owner question Q12.

### 3. B · The same action has three shapes and five heights

- **Where:** Home against Approvals, at both widths. Evidence: `01-home-1440.png`, `04-approvals-1440.png`.
- **What is wrong:**

  | Control | Class | Shape | Height |
  |---|---|---|---|
  | Approve and Review on Home | `.soft-chip` | 999px pills | 32px |
  | The same Approve on Approvals | `.ui-btn-sm` | 8px | 30px |
  | Quick links (Leave requests, HR cases, Announce) | `.soft-pill` | | 40px |
  | Check in | | | 36px |
  | Hide this list, Set up, Skip | `.ui-btn-sm` | | 30px, not 28 |

- **Why it matters:**
  - DESIGN.md → Controls: a 36px baseline and a 28px compact size; 8px on anything clickable; `rounded-full` for pills and status labels only.
  - Approve looking like a status pill on one screen and a button on the next makes people hunt for it.
- **Fix:**
  - `.soft-chip`:
    - `border-radius: var(--radius-btn); height: 1.75rem;` (compact, because it sits in a row);
    - under 768px, `height: 2.75rem`, as the phone rule does for `.ui-btn`.
  - `.people-soft .soft-pill`: `height: 2.25rem`.
  - Find the 2px that makes `.ui-btn-sm` 30px and remove it. It is likely padding or a border on top of `min-height`; `control-geometry.test.js` should catch it.

### 4. B · The primary button glows red

- **Where:** the top-right primary on every screen (Add employee, Enter leave, New opening, New goal, Edit on the record); Approve in the approval drawer. Evidence: `02-employees-1440.png`, `03-employee-record-1440.png`, `25-phone-approval-open-390.png`.
- **What is wrong:** the primary carries:
  - a resting shadow, `0 6px 16px -8px rgba(200,16,46,.7)`;
  - an inset highlight;
  - and `rgba(138,11,32,.3) 0 1px 2px`.

  The result is a red halo under the button at rest. The soft pill version (`rgba(200,16,46,.25)`) is the same idea.
- **Why it matters:**
  - DESIGN.md → Elevation: shadow says distance and has three tokens, and "a lift promises interactivity" only on hover.
  - The skill bans harsh, dark drop shadows.
  - A coloured glow at rest makes the primary look permanently lifted and pulls the eye even when the screen's job is elsewhere, such as reading a record.
- **Fix:**
  - `:root[data-palette='sky'] :is(.ui-btn-primary, .ui-btn-brand, .soft-pill-primary) { box-shadow: none; }`
  - On hover, change the fill only, to `--brand-ink` (`#A50D26`), as DESIGN.md says.

### 5. B · Two shadow families, one of them blue-tinted

- **Where:** drawers, menus and any `--shadow-*` token user, next to Home's soft tiles. Evidence: `22-enter-leave-drawer-1440.png`, `21-employees-row-menu-1440.png`.
- **What is wrong:** the platform tokens are `--shadow-card: 0 1px 2px rgb(11 31 68 / .04)`, `--shadow-pop: … rgb(11 31 68 / .10)` and `--shadow-lift` (`index.css:478–480`). That tint is the old navy. Home's tiles use oxblood-tinted shadows, `rgba(92,10,22,.05/.16)`. 70 elements on the measured screens use the navy version.
- **Why it matters:**
  - Blue is banned on the red brand.
  - A cool shadow beside a warm one reads as two products.
  - The skill asks for diffused, ambient shadows; the drawer's `0 4px 12px` is short and hard-edged for a 36rem panel.
- **Fix:** in the sky palette, redefine the three tokens in warm ink:
  - `--shadow-card: 0 0 0 1px rgb(var(--border)), 0 1px 2px rgb(31 26 28 / 0.04);`
  - `--shadow-pop: 0 0 0 1px rgb(var(--border)), 0 12px 32px -12px rgb(31 26 28 / 0.18);`
  - `--shadow-lift: 0 0 0 1px rgb(var(--border)), 0 10px 24px -10px rgb(31 26 28 / 0.16);`

  Then point the `.soft-*` shadows at these tokens rather than hand-written `rgba(92,10,22,…)` values.

### 6. B · Phone: on Employees, the first person starts 640px down the screen

- **Where:** Employees at 390. Evidence: `02-employees-390-s0.png`.
- **What is wrong:** before the first row come, in order:
  1. the title;
  2. a row of Import and Export;
  3. a full-width Add employee;
  4. six figures in a 3×2 grid (all zero but one);
  5. the joiners banner on two lines;
  6. the view tabs;
  7. search;
  8. a separate Filters row.

  That is 76% of the first screen. Leave requests (`05-leave-requests-390-s0.png`) is better: its rows start at 380px.
- **Why it matters:**
  - Small business first: the owner is often on a phone, and this list is the screen they open most.
  - The skill's spatial-rhythm principle is about hierarchy, not volume: the content should lead.
- **Fix, under 768px:**
  - Move Import and Export into a ⋮ More beside Add employee, keeping one row.
  - Make the figures one horizontal row that scrolls in its own container, about 64px tall, with zeros hidden. Or drop them, since the tab counts already carry them.
  - Put search and Filters on one row, with Filters as a 44px `.ui-icon-btn` that shows a count.
  - Collapse the banner to one line ("12 joiners · Open").
  - Target: the first row above 420px.

### 7. B · Phone: sheets put their actions at the top, out of thumb reach

- **Where:** the approval drawer and Enter leave, at 390. Evidence: `25-phone-approval-open-390.png`, `26-phone-enter-leave-sheet-390.png`.
- **What is wrong:**
  - The approval drawer wraps Withdraw, Change and Reject on one line and Approve on a second, under the title.
  - Enter leave puts Cancel and Save above the form.
  - Both open from the right as a 93%-wide side drawer.
- **Why it matters:**
  - A one-handed approver's thumb lives at the bottom.
  - DESIGN.md's motion notes (2026-10-28) describe phone sheets that leave downward.
  - The skill's phone guidance is to stack content and keep touch targets free of each other.
- **Fix, under 768px:**
  - Render drawers as bottom sheets (`.ui-drawer-sheet`, which already exists with a grabber).
  - Add a sticky `.ui-sheet-actions` footer: Approve as the primary and Reject as secondary, split half and half, 44px tall. Withdraw and Change go into a ⋮.
  - In Enter leave, move Save to that footer.

### 8. B · Headings: section titles at 18–20px Bricolage, and the face has spread to the navigation

- **Where:** the employee record (Personal information, Job details, and the other sections), Home's panel heads, and Who's away (Away today, Next 7 days, Lapsing on …). Evidence: `03-employee-record-1440.png`, `07-whos-away-1440.png`.
- **What is wrong:**
  - Panel and section heads are oxblood Bricolage at 18px and 20px, weight 700.
  - Bricolage also sets:
    - the rail labels (126 elements at 12px);
    - the module panel's screen names (`.ui-split-mod`);
    - its group captions;
    - the avatar initials (13px);
    - the app switcher name (16px).
  - On the record, six section heads in the display face compete with the page title, and every block reads equally loud.
- **Why it matters:** DESIGN.md → Typography:
  - Bricolage is for the wordmark, page titles and large figures, "nothing else";
  - a section title is Inter 16/24 at 600;
  - "Nothing between 16 and 24".

  The skill's hierarchy principle agrees: one display moment per screen.
- **Fix:**
  - `people.css:975` and `:2118`: `.ui-t-sec` → `font-family: inherit; font-size: 1rem; line-height: 1.5rem; font-weight: 600; color: rgb(var(--fg));`
  - `:824–825` (`.ui-split-mod`, `.ui-split-panel p.ui-caption`) and the rail label rule → `font-family: inherit`.
  - Keep `--font-display` on `h1`, `.ui-metric-value` and `.soft-band-stat-value` only.
  - Delete the dead `--font-display: 'Plus Jakarta Sans …'` at `people.css:815`, which line 1806 overrides.

### 9. B · Home is one long column next to an empty one

- **Where:** Home at 1440. Evidence: `01-home-1440.png`.
- **What is wrong:**
  - The right column (Announcements, Coming up, Celebrate) ends at 550px. The left runs on for 2,400px.
  - *Your tasks* lists six identical "Collect ID and address proof" lines, one per person.
  - *Your company has grown* is a 5-line paragraph card in the middle of the work.
- **Why it matters:**
  - The skill's spatial-rhythm principle: balance the composition.
  - DESIGN.md: no filler. A small owner should see what to do today without scrolling three screens.
- **Fix:**
  - Group tasks by task ("Collect ID and address proof · 6 people", which expands), with five at most and Show all.
  - Move *Out today* and *Your tasks* into the right column under Celebrate; the two-up row is already sized at `xl`.
  - Cut *Your company has grown* to one line with its two buttons ("You have 12 people. Show every screen · Keep it simple"), or move it to Settings → Features & apps.

### 10. P · Breadcrumbs name the wrong place, and come and go

- **Where:** across People. Evidence: `04-approvals-1440.png`, `12-workplace-helpdesk-1440.png`, `09-talent-openings-1440.png`, `13-reports-1440.png`.
- **What is wrong:**

  | Screen | Breadcrumb shown | Problem |
  |---|---|---|
  | Approvals | "People / Home" | |
  | Leave requests | "People / Time" | |
  | Help desk | "People / Help desk" | its module is Workplace |
  | Announcements | "People / Announcements" | its module is Workplace |
  | Job openings | "Talent / Job openings" | |
  | People report, Settings | none | the title jumps from y=112 to y=90 when you move to them |

- **Why it matters:** the skill's rhythm principle, applied to DESIGN.md's Screen Contract: a title should sit at the same place on every screen, and a "way back" should go back.
- **Fix:**
  - Drop the breadcrumb on screens opened from the rail: the module panel already says where you are.
  - Keep it only below the top level (Employees / Priya Sharma).
  - Hold `h1` at one top offset everywhere: `.ui-page-heading` with `padding-top: 1rem` and no crumb row.

### 11. P · Empty states: one shared drawing, and every filter still showing

- **Where:** Job openings, Goals, Announcements, Help desk. Evidence: `09-talent-openings-1440.png`, `10-talent-goals-1440.png`, `11-workplace-announcements-1440.png`, `12-workplace-helpdesk-1440.png`.
- **What is wrong:**
  - Each shows the same document illustration and a label.
  - Help desk says "Nothing here" and offers no action.
  - Seven status tabs, a search box and a filter stay above a list that has nothing in it.
  - The Goals filter is labelled only "Select".
- **Why it matters:**
  - The skill asks for designed empty states.
  - DESIGN.md (2026-10-28 finishing states): an empty list hides its header row.
  - Tabs and search over nothing are noise for a two-person company that has never hired.
- **Fix:**
  - When the *All* count is 0, hide tabs, search and filters.
  - Use the screen's own Phosphor two-tone place icon at 48px instead of the shared document.
  - Name the thing ("No job openings", "No help requests"), with the secondary button carrying the primary's label.
  - Give the Goals filter its own placeholder ("Every person").

### 12. P · The leave calendar draws each day as a separate block, and waiting looks the same as approved

- **Where:** Leave calendar at 1440 and 390. Evidence: `06-leave-calendar-1440.png`, `06-leave-calendar-390-s0.png`.
- **What is wrong:**
  - A three-day leave is three pink squares with gaps between them.
  - Every request here is waiting, yet the cells use the casual-leave pink, not the legend's grey "Waiting".
  - Today shows only as a red letter.
  - The *Away* row has a label and nothing in it.
  - At 390, the name column takes 45% of the width and only eight days show.
- **Why it matters:**
  - DESIGN.md: status needs colour and something besides colour.
  - The skill: hierarchy and calm. A span is one thing and should look like one.
- **Fix:**
  - Draw one bar per span: `--leave-n` fill, `--radius-btn` ends, 20px tall, centred in the row.
  - Waiting: the same hue at 30% with a 1px dashed `--leave-n` edge, matching the legend.
  - Today: a 2px `--brand` rule down the column and the header on `--brand-soft`.
  - Hide the *Away* row when it is empty.
  - Under 768px: a 96px sticky name column showing initials and first name.

### 13. P · Chosen-segment colour is not the shared `--choice`

- **Where:** Daily attendance (Day / Month) and the employee app sign-in (Sign in / First time?). Evidence: `08-attendance-1440.png`, `15-app-signin-390.png`.
- **What is wrong:** Day / Month uses blush with red words, and Sign in is a solid red segment.
- **Why it matters:**
  - DESIGN.md (3 Nov): "A chosen view is marigold" through `--choice`, `--on-choice` and `--choice-tray`.
  - Red is the action colour, so a red segment reads as a button.
- **Fix:** both selected segments read `background: rgb(var(--choice)); color: rgb(var(--on-choice));` on `--choice-tray`.

### 14. P · Faces change colour between screens

- **Where:** Employees, Approvals and Leave requests use per-team hues. Attendance and Home use blush for everyone. Evidence: `02-employees-1440.png` against `08-attendance-1440.png`.
- **Why it matters:** PR #123 says faces keep their own hue, and the same person should look the same everywhere.
- **Fix:** Attendance's and Home's rows should use the shared initials component with `--dept-*` washes, not a fixed `--brand-soft`.

### 15. P · Red used for things that are not errors

- **Where:**
  - Leave requests → Recent activity: a red dot on every line;
  - Home's growth chart: a red line and a red-to-pink area.

  Evidence: `05-leave-requests-1440.png`, `01-home-1440.png`.
- **Why it matters:** DESIGN.md: red means the action, or `--neg` for an error. Charts use the `--dept-*` series.
- **Fix:**
  - Activity dots → `--fg-subtle`, or the leave type's `--leave-n`.
  - `.soft-chart-line` → `stroke: rgb(var(--dept-1))`, with the area fill at `--dept-1` / 8%.

### 16. P · People report: headings do not sit over their numbers

- **Where:** People report at 1440 and 390. Evidence: `13-reports-1440.png`, `13-reports-390-s0.png`.
- **What is wrong:**
  - "Headcount at start" and the other numeric headings are left-aligned. Their figures are right-aligned 200px away.
  - Row rules start at column 2, leaving Month without a rule.
  - Joiners shows "—" in the month rows but "0" in Whole period.
- **Why it matters:**
  - DESIGN.md → Value alignment: a financial column is right-aligned, and so is its heading.
  - The skill: hairlines that line up.
- **Fix:**
  - `th` on numeric columns → `.ui-val-right`.
  - Put the border on `tr` (`.ui-table tbody tr { border-top: 1px solid rgb(var(--border)) }`), not on the cells from column 2.
  - Use one way of showing nothing: "0" in every row.

### 17. P · Pagination on short lists

- **Where:** Employees (12 rows), Approvals (5), Leave requests (5), Attendance (12). Evidence: `04-approvals-1440.png`.
- **What is wrong:** a "25 per page" select stretches 240px wide and floats above a pager with one page. "Showing 1–5 of 5" sits on a different line.
- **Fix:**
  - Hide the pager and the per-page select when the total is no more than the page size.
  - Otherwise put "Showing …", the per-page select (`w-auto`, about 7.5rem) and the pager on one row.

### 18. P · Search placeholders are cut off

- **Where:**
  - Approvals: "Search name, employee ID or reque…";
  - Daily attendance: "…or depar…";
  - Employees at 390: "…or work em…".
- **Fix:** shorter words: "Search name or ID" on Approvals and Attendance, and "Search name, ID or email" on Employees. Plain words already carry the rest.

### 19. P · Settings: one pencil icon for ten different settings

- **Where:** Settings at 1440. Evidence: `14-settings-1440.png`.
- **What is wrong:** the same pencil-in-square icon marks ten tiles:
  - Exit interview;
  - Automations;
  - Letters;
  - Company choices;
  - Request types;
  - Leave policy;
  - Attendance request types;
  - Attendance rules;
  - and two others.

  Icon weight is fine (light Fluent line), but the icon carries no meaning.
- **Fix:** each tile takes its own place icon from the manifest's Phosphor set, for example:
  - a scroll for Leave policy;
  - lightning for Automations;
  - an envelope for Letters;
  - a list-check for Request types;
  - a door for Exit interview;
  - a clock-alert for Attendance rules.

### 20. P · Phone: small tap targets

- **Where:** Employees and Approvals at 390.
- **What is wrong:** measured at 390:
  - row tick boxes: 24×24 (Employees 12, Approvals 5);
  - Home task ticks: 24×24;
  - inline links: 18–20px tall (Open ×3 and Show all on the record, Open Joining, Balances, the person names on Home).
- **Why it matters:** DESIGN.md: 44px for anything a thumb must hit.
- **Fix:**
  - Wrap each checkbox in a `label` with `min-h-11 min-w-11 grid place-items-center`.
  - Give `.people-more`, `.people-name-link` and section "Open" links `padding-block: 0.75rem; margin-block: -0.75rem` under 768px.

### 21. P · Phone: two menu buttons for one drawer, and Escape does not close it

- **Where:** every People screen at 390. Evidence: `24-phone-hamburger-390.png`.
- **What is wrong:**
  - The top bar's Menu and the tab bar's Menu open the same *People navigation* sheet.
  - In my run, Escape left the sheet open.
  - The top bar also has a button with no accessible name: the second button, beside the logo.
- **Fix:**
  - Under 768px, drop the top-bar Menu; the tab bar's Menu is in thumb reach.
  - Close the sheet on Escape.
  - Give the unnamed button an `aria-label`, or make it non-interactive.

### 22. P · A cold load is a blank page with a spinner

- **Where:** a cold load of Employees with a slow API (3–4s). Evidence: `20-employees-loading-1440.png`.
- **What is wrong:**
  - The whole window is the warm ground with a spinning C mark until the session is read. Loading inside the app is fine (see *What already looks right*).
  - The skeleton on Leave requests draws a Status column that the loaded *Waiting* tab drops, so the columns shift when data arrives.
- **Fix:**
  - Draw the shell (top bar, rail, module panel) from the cached session straight away, with the skeleton in `main`.
  - Build the skeleton's columns from the same column list the tab will use.

### 23. P · Employee app: the first screen has no CLOR, and the code field is right-aligned

- **Where:** employee app sign-in at 390. Evidence: `15-app-signin-390.png`.
- **What is wrong:**
  - A red fingerprint and "Employee portal" in Inter. No CLOR mark.
  - The Company code placeholder and value are right-aligned.
  - The segment is red (finding 13).
- **Why it matters:**
  - DESIGN.md → Value alignment: text and code fields are left-aligned.
  - Brand: the wordmark or mark appears in every app header.
- **Fix:**
  - `ClorMark` (oxblood, 40px) above the title.
  - Title as `h1` in `--font-display`.
  - Company code → `.ui-val-left`.

### 24. P · Employee app: a card inside a card, and four actions competing on *Me*

- **Where:** the employee app's *Today* and *Me* at 390. Evidence: `16-app-1-today-390.png`, `16-app-5-me-390.png`.
- **What is wrong:**
  - *Today*'s card holds three sunken tiles (In, Out, Worked).
  - *Me* stacks five cards, each with its own action: Add a bill (red primary), Ask for an advance, Ask for one, …. Their buttons do not line up with their titles.
- **Why it matters:** DESIGN.md: no card in a card, and one primary per screen.
- **Fix:**
  - Draw In, Out and Worked as three figures on the card's own surface, divided by 1px `--border` rules, with no fill.
  - On *Me*, make Add a bill `.ui-btn-secondary`, and align each card's head with `items-center`.

### 25. P · The scrim fades linearly

- **Where:** behind every drawer and dialog.
- **What is wrong:** `ui-fade` runs over 120ms on `linear`. The sheet beside it uses the custom curve.
- **Fix:** `animation: ui-fade 200ms var(--soft-ease) both`, so the two move together.

## Conflicts with DESIGN.md: questions for the owner

Each question names the skill's rule, DESIGN.md's rule, and my recommendation. Until you answer, DESIGN.md stands.

| # | Question | Skill says | DESIGN.md says | Recommendation |
|---|---|---|---|---|
| Q1 | Should Inter stay the working face? | Inter is banned; use Geist, Clash, Jakarta and the like | Inter for the work, Bricolage for the brand | **Keep Inter.** It has tabular figures for money, it is already self-hosted, and it is what makes a column of rupees line up. |
| Q2 | Should cards have the "double bezel" (an outer tray with a nested inner card)? | Every card is nested | No card in a card | **No.** People still has a disabled `.soft-bezel` (`--soft-pad: 0` in the sky palette, 1.5rem/0.375rem in `index.css:8247`). Delete that dead code so nobody switches it back on. |
| Q3 | Should buttons be full pills with a "button-in-button" arrow circle? | `rounded-full` and a nested icon circle | 8px on anything clickable | **No, and remove the one that crept in.** Home's *Add an employee* carries `.soft-pill-orb` (an arrow in a white circle), the only one in the product. It reads as decoration and gives the button two icons. Use the plain `.ui-btn-primary` with its `+`. |
| Q4 | Should sections breathe with 96–160px gaps? | `py-24` to `py-40` | 12px inside a group, 24px between groups | **Keep 12 and 24.** People is a work tool for a one- or two-person business on a phone, and those gaps would push the first request below the fold. |
| Q5 | Should every block fade up from a blur as it scrolls in? | 800ms+ blur fade-up on everything | 200ms at most; no entrance on data | **No (finding 1).** Keep a 200ms opacity-and-8px rise on first paint, and nothing on scroll. |
| Q6 | Should the top bar float as a glass pill, with a full-screen menu? | A floating island nav | A white top bar and a rail (owner, 3 Nov: "header keep white only") | **Keep yours.** |
| Q7 | Should headings carry a tiny uppercase "eyebrow" pill? | 10px uppercase pills over H1/H2 | Nothing below 12px; no filler | **No.** Home's date pill is the one eyebrow and already does the job. |
| Q8 | Should icons all be ultra-light? | Thick Lucide is banned | Lucide at its default stroke in the other apps; Phosphor two-tone and Fluent line in People | **Keep the current sets.** People's icons are already light. Fix their meaning instead (finding 19). |
| Q9 | Grain overlays, mesh gradients, and "never the same layout twice"? | Yes | Five primitives; "a module picks archetypes, it does not make layout decisions" | **No.** Sameness between screens is what makes a work tool learnable. |
| Q10 | One face or two? | n/a | DESIGN.md says Inter plus Bricolage, but CLAUDE.md still says "One face app-wide". The scale table says page title 24/700, while the People section and the code use 28/800 (Home 34/700). | **Confirm two faces and 28/800 for People titles.** Then I would update the CLAUDE.md line and the scale table so the three documents agree. |
| Q11 | Should Bricolage keep spreading beyond titles and figures? | Display type for character | Titles and figures only | **No (finding 8).** Rail labels, panel names and section heads go back to Inter. |
| Q12 | Should the radius fix go platform-wide? | n/a | 8px and 12px for every app | **Yes, platform-wide.** The platform tokens (`--radius` 4px, `--radius-xl` 6px, `--radius-kpi` 4px, `index.css:459–467`) contradict DESIGN.md for Payroll, Attendance and Accounting too. Its own comment defends a square KPI card ("five small cards read as five pills"). Fix it in People first (finding 2), and let the platform lane decide the rest with you. |

## Hand-off

- **clor-coder-people:** findings 1–9 before the next People release; 10–25 can be batched.
- **Coordinator:** Q1–Q12 to the owner; Q12 to the platform lane.
- Every fix above is in `packages/ui/src/people.css` or `apps/people/`, apart from Q12, finding 5's tokens, and finding 22's shell.
