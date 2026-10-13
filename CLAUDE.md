# CLOR

Indian GST accounting and business SaaS. React 19 + Vite + Tailwind SPA (`src/`), Express + Prisma + SQLite API (`server/`).

## Design System

Always read `DESIGN.md` before making any visual or UI decision. Fonts, colors,
spacing, radii, the type scale, and the five-primitive component contract are
defined there. Do not deviate without explicit user approval.

Hard rules that come up most often:

- **Tokens only, in app chrome.** No `bg-gray-*`, `text-gray-*`, `border-gray-*`
  or any raw palette class. Every color comes from a CSS variable in
  `src/index.css`, or dark mode silently breaks.
  **Exception: printed documents.** `InvoicePreview.jsx`, `ExpenseVoucher.jsx`
  and the invoice template renderer are black on white on purpose — a printed
  invoice does not follow the app theme. Leave their raw classes alone.
- **Two radii.** 8px on anything clickable, 12px on anything holding content.
  `rounded-full` for pills only.
- **Money is tabular.** Every displayed amount is Inter with `tabular-nums`
  (the money/mono utility classes), right-aligned. One face app-wide — no
  second family for numbers or codes.
- **No card-in-card.** A list sits on the page ground under one hairline. A
  document is a discrete object and earns a surface.
- **One primary action per screen**, top right.

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
