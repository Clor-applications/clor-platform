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

One time, the owner runs:

```bash
npm run qa:live:setup
```

It asks for one inbox you own, then makes Knockbell Logistics QA, AGS Consultants
QA and Vels Traders QA on live, each with employees and owner, HR, manager,
accountant and employee logins (plus-addresses of your inbox). You click one
verification mail per company owner. Passwords are made up by the script, 2FA is
switched on for every login, and all of it is saved only in `e2e/live/.env.live`
(git ignores it). An Ops staff login is added in ops.clor.in > Staff; the script
asks for it at the end. Hand-made logins: see `.env.live.example`.

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
