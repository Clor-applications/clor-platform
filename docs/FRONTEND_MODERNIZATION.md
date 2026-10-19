# Attendance, Payroll and People: frontend modernization

October 2026. Frontend only: no server, schema, API, permission or calculation
code was changed.

## Audit

| Area | What the repository has |
|---|---|
| Framework | React 19, Vite, plain JavaScript (JSX). No router: the shell keeps the open app and screen in React state. |
| Shell | `packages/shell/Shell.jsx` draws the platform bar, app switcher, notifications and, for People, Attendance and Payroll, the split sidebar (`splitNav.js`). Accounting draws its own navigation (`Root`). |
| Navigation data | Each app's `manifest.jsx`: `modules` (rail and groups) and `nav` (screens, icons, permissions). The shell filters `nav` by the person's permissions before building the rail. |
| Permissions | `getMyPermissions` once per company; `WriteGuard` makes a screen read-only when the person lacks write rights. Unchanged. |
| Styling | Tailwind utilities plus one design system file, `packages/ui/src/index.css`, with RGB custom-property tokens. People, Attendance and Payroll are scoped by `[data-app]`. |
| Components | `packages/ui/src/components/ui/Primitives.jsx`: `PageHeader`, `StatTile`, `EmptyState`, `SkeletonCard`, pills, buttons and table classes. Reused, not replaced. |
| Icons | `lucide-react`, already used everywhere. No new dependency was added. |
| Tests | Vitest with jsdom and Testing Library. |

## Baseline before the change

| Check | Result |
|---|---|
| Web tests | 69 failing, 1,403 passing. The failures are in `apps/accounting` and ten design-rule tests under `test/`. |
| Lint (`npm run lint`) | 12,140 problems across the repository. |
| Typecheck (server) | Passes. |
| Production build | Passes. |

## Navigation: rail and contextual panel

| Rail module | Groups and screens (screen key) |
|---|---|
| Today | Today (`today`): one screen, no panel |
| Personnel | Organization: Departments (`departments`), Positions (`positions`), Areas (`areas`). Employees: Employees (`employees`), Contractors (`contractors`), Resignations (`resignations`), Transfer (`transfer`). Privacy: Data requests (`dataRequests`) |
| Readers | Readers: Reader health (`readerHealth`), Readers (`readers`), Sync status (`readerSync`). Data: Transactions (`transactions`), Enrolments (`enrolments`), Unmatched punches (`unmatched`), Reader logs (`deviceLogs`) |
| Attendance | Daily: Records, Corrections, Leave requests. Reports: Register, Calendar, Month summary, Reports & registers. Schedule: Schedule calendar, Shifts, Employee schedule, Department schedule, Temporary schedule, Rotations. Rules: Holidays, Attendance rules. Leave setup: Leave types, Leave balances |
| System | Employee portal: Portal access, Work sites, Site check. Integrations. Data: Import, Export |
| Me | Mine: My attendance (`me`), My leave (`myLeave`) |

Each panel ends with More apps; the app switcher stays in the platform bar.
No route was added, renamed or removed.

Behaviour:

- A rail tap opens that module's panel and does not change the screen. Only
  Today, which has one screen, navigates.
- Tapping the module whose panel is open closes it. The panel also has a close
  button. The open or closed choice is remembered in this browser.
- The rail marks two things separately: the module holding the current
  screen (ink pill) and a module whose panel is open but not yet entered
  (outline).
- The address names the screen: `?open=<screen>`, plus `?app=<app>` where the
  hostname does not say which app it is (localhost, previews). Reload, shared
  links and browser back and forward all restore the screen and its panel.
  `?open=` is the parameter notification links already used.
- Phone (under 768px): the same rail and panel inside the menu drawer, with
  the existing bottom tab bar. Tablet (768 to 1099px): the rail stays and the
  panel opens over the content, closes on Escape, on the scrim, or once a
  screen is picked. Desktop: the panel sits beside the rail, 264px.
- Opening and closing panels does not remount the screen, so unsaved form
  input is kept.

The decisions live in small pure functions in `splitNav.js`
(`railAction`, `screenSearch`, `readScreenSearch`) so they are tested directly.

## Visual system (scoped to People, Attendance and Payroll)

| Token | Light | Use |
|---|---|---|
| Ground | `#F8FAFC` | page background |
| Surface | `#FFFFFF` | cards, tables, inputs |
| Sunken | `#F1F5F9` | rail, table heads, hover rows |
| Border | `#E2E8F0`, strong `#CBD5E1` | hairlines, fields |
| Text | `#0F172A`, muted `#64748B` | ink, supporting text |
| Action | `#C2410C` (Clor orange, 5.2:1 with white) | primary buttons |
| Accent | `#EA580C` | focus rings, current-screen bar |

Type: 14px body, 13px tables, 12px sentence-case column heads, 22px page
titles, 15px section titles. Controls are 36px high with 6px corners;
surfaces have 8px corners and a 1px hairline. Dark mode has matching values.
Accounting keeps its own palette.

## Screens changed beyond the shared styles

- Today: six figures from the existing overview (headcount, present, late,
  absent, on leave, not marked); the waiting queues as one-click links to
  Records, Corrections and Leave requests; a seven-day in, absent and leave
  strip from the existing calendar endpoint, with a text label for each day;
  a readers panel showing each reader's status as the server reports it (the
  same words Reader health uses), never inferred from a timestamp. Both extra
  panels hide if the person cannot read them.
- Integrations: the API table had a duplicate React key (`/employees` is both
  GET and POST), which logged an error; now keyed by method and path, and the
  table scrolls inside its card on a phone.
- Site check: the table scrolls inside its card on a phone.
- Earlier the same day: compact stat tiles and empty states, uniform spacing,
  two-column rules, reader cards in columns, Reports opening on its first
  report, Calendar opening on today, Payroll setup and ledger mapping text.

## Results after the change

| Check | Result |
|---|---|
| Web tests | 68 failing, 1,417 passing. No test newly fails; one that failed before now passes; 14 tests added (`test/split-navigation.test.js`). |
| Lint, changed files | 0 errors; 1 warning in `Shell.jsx` that was there before. |
| Typecheck, build | Pass. |
| Browser checks (Playwright) | Rail, panel, close, reload, back and forward, keyboard reach, phone drawer, tablet overlay and unsaved input: all pass, no console errors. |
| Width sweep | Every Attendance (41) and Payroll (19) screen at 360, 390, 768, 1024, 1440 and 1920px, signed in: no page-level horizontal scroll and no console errors. |

## Known issues left as they were

- The 68 failing tests (Accounting and design-rule tests) predate this work.
- Repository-wide lint reports about 12,000 problems, mostly outside the
  changed files.
- Accounting has its own navigation and palette and was not part of this.
- The Android and iOS apps bundle the web build; they show this after their
  next build.
