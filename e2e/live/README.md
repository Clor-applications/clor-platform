# Live QA (real clor.in sites)

Drives the deployed CLOR sites in a real Chromium: clor.in, app/Workspace, People,
Payroll, Attendance, Books, Ops (staff side), and the API. Writes a plain report.

## Run

```bash
npm run qa:live            # everything
npm run qa:live:public     # only public pages + API (no login needed)
```

Report: `e2e/live/report/REPORT.md` (screenshots in `report/shots/`, Playwright
detail: `npx playwright show-report e2e/live/report/html`).
First time on a machine: `npx playwright install chromium`.

## What it checks

| File | What |
|---|---|
| `public.live.ts` | API `/ready`, `/health`, safe 401/404s; every clor.in page reachable by links; each portal's front door |
| `apps.live.ts` | per QA account: sign in once, open every app, click every rail module and every panel screen |
| `scenarios.live.ts` | real-world stories across portals by role (owner, hr, manager, employee, accountant, Ops staff) |

On every screen: console errors, uncaught errors, 4xx/5xx API calls, failed
requests, blank or crashed screen, slow screen (> 8 s), screenshot.

## Accounts (never in git)

Copy `e2e/live/.env.live.example` to `e2e/live/.env.live` (git ignores it) and
fill in QA logins. QA companies only (for example Knockbell Logistics QA,
AGS Consultants QA), never a real customer. Live sign-up needs email
verification and admins need 2FA, so the robot cannot make its own accounts:
make them once by hand and put each admin's authenticator key in `totpSecret`.

## Safety

- Read-only by default. Write steps (new employee, leave request, draft invoice,
  draft payroll run, Ops note) run only with `QA_LIVE_WRITES=1` **and** the
  account's company listed in `QA_WRITE_COMPANIES`.
- Everything written carries the run tag `QA-yyyymmdd-xxxx` so it can be found.
- The crawler clicks only navigation, and never a label matching sign out,
  delete, cancel, void, pay, billing, upgrade, reset, archive, deactivate.
- No payments, no gateways, no IRN.

## Adding a scenario

Add to `SCENARIOS` in `scenarios.live.ts`: `id`, `title`, `who` (roles), and
steps. Mark a step `write: true` if it changes data. Steps are soft: a failing
step is reported and the story goes on.
