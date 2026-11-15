# CLOR

Indian GST accounting and business SaaS. React 19 + Vite + Tailwind SPA (`src/`), Express + Prisma + SQLite API (`server/`).

## Where People work stands (read before touching People, Time or Attendance)

The People work of 28–29 Oct 2026 is merged into `main` (PR #50). Start new work from
`origin/main` (fetch first); the local `main` checkout may be stale. What is done, what is
next and how to run the tests: `docs/people/design-v1/TRACKER.md` (latest section at the
end). The owner's live app runs from `/private/tmp/clor-people-latest-20261028` (web 5186 /
API 4002); CI runs on GitHub's own machines since 14 Nov 2026 (the repository is public; `docs/CI-ON-MAC.md` is the old Mac setup).

## Design System

Always read `DESIGN.md` before making any visual or UI decision. Fonts, colors,
spacing, radii, the type scale, and the five-primitive component contract are
defined there. Do not deviate without explicit user approval.

**Brand (owner, 15 Nov 2026): the frontend redesign** (`frontend-redesign-2026-11-15.md`,
Books included), with the owner's later choices of the same day: **each app has its own
colours** (Workspace graphite `#202329`, People magenta `#A21CAF`, Payroll deeper blue
`#006A9E`, Attendance amber `#A85A00`, Books navy `#232A66` with orange `#FF6B00` as its
second colour, no red), set per `data-app` in `packages/ui/src/rnd.css` (Books in
`index.css` under `[data-palette='indigo']`). The CLOR logo and gate pages stay Blaze
orange. **Figtree** for everything (JetBrains Mono for identifiers only). Icons: Lucide
today; Fluent Emoji (flat) chosen for navigation and feature marks, small controls stay
line icons. See DESIGN.md.

**White and light only (owner, 15 Nov 2026):** every ground is pure white `#FFFFFF`,
in every app and in Books: no grey, cream or tinted page, panel, rail or header
band. Grey `#F7F7F7` is hover feedback only; hairlines `#E5E5E5`. There is no dark
theme. Gate pages (two-factor setup, no access, company setup, suspended, ended
link) all use `packages/shell/GatePage.jsx`.

Hard rules that come up most often:

- **Tokens only, in app chrome.** No `bg-gray-*`, `text-gray-*`, `border-gray-*`
  or any raw palette class. Every color comes from a CSS variable in
  `packages/ui/src/index.css` / `rnd.css`, or the palette drifts screen by screen.
  **Exception: printed documents.** `InvoicePreview.jsx`, `ExpenseVoucher.jsx`
  and the invoice template renderer are black on white on purpose — a printed
  invoice does not follow the app theme. Leave their raw classes alone.
- **Two radii.** 8px on anything clickable, 12px on anything holding content.
  `rounded-full` for pills only.
- **Money is tabular.** Every displayed amount is in tabular figures
  (`tabular-nums`, the money/mono utility classes), right-aligned, in Figtree.
  Identifiers (GSTIN, PAN, invoice numbers) set in JetBrains Mono via `.ui-mono`;
  never money.
- **No card-in-card.** A list sits on the page ground under one hairline. A
  document is a discrete object and earns a surface.
- **One primary action per screen**, top right. Row actions such as Approve
  are secondary buttons; Reject and Decline are text buttons.
- **Colour has one job.** The app's primary only for the primary button, links and
  "you are here"; its second colour for charts and secondary marks; status colours only for
  state, always with a label.

In QA or review, flag any code that does not match `DESIGN.md`.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
