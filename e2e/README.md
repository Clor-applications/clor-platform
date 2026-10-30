# End-to-end tests

Playwright Test drives the real CLOR web app and the employee app the way a
person does, through the scenarios in
[docs/people/qa/PERSONA-SCENARIOS.md](../docs/people/qa/PERSONA-SCENARIOS.md).
Every test is deterministic: no LLM steps. Exploratory checks stay with the
`clor-qa-*` agents.

## Run it

```bash
npm run e2e                     # every scenario, desktop and phone (boots its own API + web app)
npm run e2e:smoke               # the @smoke set, a few minutes
npm run e2e -- --project=phone  # one width only (desktop or phone)
npm run e2e -- -g M2            # one scenario by its ID
npm run e2e:report              # writes docs/people/qa/E2E-RESULTS.md from the last run
npx playwright show-report e2e/report/html
```

First time on a machine: `npx playwright install chromium`.

**Local** (the default) needs PostgreSQL on 5432. The run drops and rebuilds
its own database (`clor_e2e`), migrates it the way production is
(`prisma migrate deploy`, all four schemas), then starts the API on 4016 and
the built web app on 5196, and stops both at the end. The database is left in
place for looking into a failure; the next run replaces it. Other ports or a
database: `E2E_API_PORT`, `E2E_WEB_PORT`, `E2E_DB_NAME`, `E2E_PGADMIN_URL`.
`E2E_REUSE=1` keeps servers you already started (`node e2e/scripts/start-api.mjs`,
`node e2e/scripts/start-web.mjs`); `E2E_WEB=dev` serves the Vite dev server
instead of a build.

**Staging**: nothing is booted; credentials come from the environment only,
never from a file in the repository.

```bash
E2E_TARGET=staging \
E2E_BASE_URL=https://app.staging.clor.in \
E2E_API_URL=https://api.staging.clor.in/api \
E2E_PASSWORD=… \
npm run e2e:smoke -- --project=desktop --workers=1
```

A run signs up new accounts (two per width) and its own companies, named with
the run's suffix, so runs never meet. Staging's sign-up and sign-in rate limits
still apply: keep staging runs to the smoke set at one width. A base URL
without "staging" in it is refused unless `E2E_ALLOW_HOST` names that host.

## What a run builds

`setup/world.setup.ts` runs first, once per width, and builds that width's
world through the API (setup only, never to check a result; TEAM.md):

| Company | | People |
|---|---|---|
| Asha Textiles `<run>` | Karnataka | 12: Suresh (owner), Kavya (HR Manager role), Rahul (Team Manager role) with Priya, Imran, Lakshmi and Deepak, Neha with Arjun and Meena, Farah with Vikram |
| Vels Traders `<run>` | Tamil Nadu, same account | 2 |
| Other Co `<run>` | another account | 1 (Zubin) |

Casual leave (12 days, half days allowed), Earned leave (15), and a holiday
three weeks out. Priya, Imran, Lakshmi, Deepak, Arjun and Meena have the
employee app. Each persona then signs in through the real sign-in screen once;
the browser state is saved under `e2e/.state/<width>/` and reused.

## Writing a scenario

```ts
import { expect, test } from '../support/fixtures';

test('M2: reject with a reason', { tag: ['@M2', '@smoke'] }, async ({ asManager: rahul, app, w }) => {
  await appLeave(w, 'lakshmi', from, to, 'Trip to Hampi');   // setup through the API is fine
  await rahul.goto();
  await rahul.open('Approvals');                              // by the menu label
  …
  const lakshmi = await app('lakshmi');
  await lakshmi.goto('Leave');
  await expect(lakshmi.request(appDay(from))).toContainText('Rejected');   // the result, read in the browser
});
```

- **One test = one scenario ID**, in the title and as a tag (`@E1`). `@smoke`
  puts it in the pull-request set; keep that set to the scenarios that matter
  most, about five minutes in all.
- **Results are checked in the browser**, never through the API. The API may
  create what a scenario needs (`support/seed.ts`: `appLeave`, `decideLeave`).
- **Fixtures**: `asOwner`, `asHR`, `asManager` (web, `pages/people.ts`),
  `asEmployee` (Priya in the employee app, `pages/employeeApp.ts`),
  `web('owner' | 'hr' | 'manager')` and `app('imran')` for a second person in
  the same test, `guest` for a browser nobody is signed in on, `w` for the
  world (names, ids, codes).
- **Navigation is by menu label**: `people.open('Leave requests')` presses the
  module on the rail, then the screen, at either width, and checks the page
  title is that label.
- **Who and when**: tests in one file run in order; files run side by side.
  A file owns the people and the weeks it changes (`support/dates.ts` lists
  them). A new scenario that changes someone takes a person or a week nobody
  else uses, and moves on with `testInfo.retry` so a retry never meets the
  first attempt.
- **When the app is wrong**: keep the test as the scenario says and add
  `test.fail(true, 'APP BUG: …')` with one line on what is wrong. It then
  shows as KNOWN BUG in E2E-RESULTS.md, and as FIXED? once the app is right.
  Never weaken the expectation to make it pass.

## Checks every screen gets

Wired into the fixtures (`support/checks.ts`), not written per test:

- no console error, uncaught exception or unhandled rejection, and no 5xx
  answer, while the test runs (`allowNoise(testInfo, /…/)` for noise a test
  expects, such as a refused page's 404);
- on every screen opened with `open()` and on the page a test ends on: no
  sideways scroll at phone width; no serious or critical axe finding
  (WCAG 2.1 A/AA); the page title (h1) equals the lit menu label.

Known problems are listed in `known-issues.json` by screen and check, so they
do not block the run. Every line there is a bug to fix; delete it once fixed.
To rebuild the list: `E2E_KNOWN_UPDATE=1 npm run e2e`, then
`node e2e/scripts/known-issues.mjs`, and review the diff.

## Reports

`e2e/report/html` (Playwright's report: trace, video and screenshot of every
failure), `e2e/report/junit.xml`, `e2e/report/results.json`, and
`docs/people/qa/E2E-RESULTS.md` (scenario → PASS / KNOWN BUG / FLAKY / FAIL,
written by `npm run e2e:report`). CI keeps them as the run's `e2e-report`
artifact for 14 days.

## In CI

`.github/workflows/ci.yml`, job `e2e` on the Mac runners: `e2e-smoke` on every
pull request after `verify`, `e2e-full` nightly and on a run by hand, each on a
database of its own on the CI Postgres (5434), dropped at the end. One retry in
CI (a test that needed it is reported as flaky), none locally. The staging
nightly (`e2e-staging`) is wired but off until its secrets exist:
docs/CI-ON-MAC.md, "End-to-end tests".
