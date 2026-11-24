# CLOR

Indian GST accounting and business SaaS. React 19 + Vite + Tailwind SPA (`src/`), Express + Prisma + SQLite API (`server/`).

## Where People work stands (read before touching People, Time or Attendance)

The People work of 28–29 Oct 2026 is merged into `main` (PR #50). Start new work from
`origin/main` (fetch first); the local `main` checkout may be stale. What is done, what is
next and how to run the tests: `docs/people/design-v1/TRACKER.md` (latest section at the
end). The owner's live app runs from `/private/tmp/clor-people-latest-20261028` (web 5186 /
API 4002); CI runs on GitHub's own machines since 14 Nov 2026 (the repository is public; `docs/CI-ON-MAC.md` is the old Mac setup).

## Design System

Always read `DESIGN.md` before making any visual or UI decision. Fonts, colours,
spacing, corners, motion and every component are defined there; the live kit page
is linked at its top. Ask the user before departing from it.

**The Motion kit (owner, 24 Nov 2026).** The owner supplied the Motion
design-system skill and said to forget the existing components and transitions.
`DESIGN.md` was rewritten to it for **every surface: clor.in, Admin center, Ops,
Console, People, Payroll, Attendance and Books** (agree Books PRs with its
developer). It replaces the calm register (19 Nov), the per-app colours (15 Nov),
Figtree, clor.in's pale-blue look and `DESIGN.legacy.md`. The code still follows the
old system and moves through the migration PRs listed at the end of `DESIGN.md`. In
short:

- **Palette only.** No colour outside the Motion palette in `DESIGN.md`. One violet
  primary `#7C3AED` in every app; each app's identity is a pale hue family on its top
  bar and app header (People pink, Payroll lilac, Attendance and clor.in sand, Ops
  mint, Admin stone, Console slate, Books rose). Work areas stay white. The logo
  orange is artwork only. Ink, success and warning are stand-ins until the full
  palette is pulled.
- **TASA Orbiter** for everything, **Geist Mono** for identifiers only; six sizes
  (11/13/15/30/34/40), two weights (400, 700).
- **Square corners, no shadows.** Floating layers get a 1px ink border.
- **4px grid**, 32px controls (48 on phones), 48px table rows.
- **Motion:** press 0.14s snap, reveal 0.4s clip-path, fades 0.15s; figures never
  animate; reduced motion stops everything.
- **Money is tabular,** right aligned, ₹ first; never mono.
- Kept product rules: count line instead of tiles on lists, status tags only on
  exception rows, one primary action per screen, tick and cross approvals, no
  card-in-card, light only.
- **Printed documents** (`InvoicePreview.jsx`, `ExpenseVoucher.jsx`, the invoice
  template renderer) stay black on white.

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
