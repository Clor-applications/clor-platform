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

**Brand (owner, 14 Nov 2026): the R&D hand-off.** Graphite `#202329` + Blaze
`#FF5400` (an accent, never a fill behind text), Sora 800 for page titles and
Inter for everything else, portal themes (Workspace orange ink `#C5450A`, Ops
forest `#015D47`, People moss `#5A6B1F`, Attendance violet `#5B47C4`), and the
64px rail / 232px panel / 64px top bar shell. Tokens live in
`packages/ui/src/rnd.css`. Accounting keeps its own indigo look.

Hard rules that come up most often:

- **Tokens only, in app chrome.** No `bg-gray-*`, `text-gray-*`, `border-gray-*`
  or any raw palette class. Every color comes from a CSS variable in
  `packages/ui/src/index.css` / `rnd.css`, or dark mode silently breaks.
  **Exception: printed documents.** `InvoicePreview.jsx`, `ExpenseVoucher.jsx`
  and the invoice template renderer are black on white on purpose — a printed
  invoice does not follow the app theme. Leave their raw classes alone.
- **Two radii.** 8px on anything clickable, 12px on anything holding content.
  `rounded-full` for pills only.
- **Money is tabular.** Every displayed amount is in tabular figures
  (`tabular-nums`, the money/mono utility classes), right-aligned, in Inter.
  No second family for numbers or codes.
- **No card-in-card.** A list sits on the page ground under one hairline. A
  document is a discrete object and earns a surface.
- **One primary action per screen**, top right. Row actions such as Approve
  are secondary buttons; Reject and Decline are text buttons.
- **Colour has one job.** Portal colour only for the primary button, links and
  "you are here"; app colours only to identify an app; status colours only for
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
