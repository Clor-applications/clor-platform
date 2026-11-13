# CI on a Mac (self-hosted GitHub Actions runner)

> **Retired 14 Nov 2026.** The repository is public, so CI and Security run on
> GitHub's own machines (`ubuntu-latest`), each job with its own PostgreSQL 16
> on port 5434. A self-hosted runner must not serve a public repository: any
> outside pull request could run its code on this Mac. Kept for history.


The `CI` (verify) and `Security` (audit, secrets) workflows run on a Mac, not
on GitHub's machines. The Clor-applications organization is on GitHub's free
plan; its Actions minutes for a private repository ran out in October 2026
(one full CI run takes about 75 minutes). A self-hosted runner costs no
minutes. The Android, iOS and VM-deploy jobs still name GitHub's machines.

## What is on the Mac

| Piece | Where | How it starts |
|---|---|---|
| Runner `suresh-mac`, label `clor-mac` | `~/actions-runner/clor-platform` | LaunchAgent `actions.runner.Clor-applications-clor-platform.suresh-mac`, at login |
| PostgreSQL 16 for CI, port 5434, `max_connections = 300`, superuser `clor_ci` / `clor_ci` | Homebrew `postgresql@16`, data in `/opt/homebrew/var/postgresql@16` | `brew services` (`sh.brew.postgresql@16`), at login |
| gitleaks (secrets scan) | Homebrew | — |

The developer's own PostgreSQL (port 5432) is untouched; CI never uses it.

## Day to day

- CI runs only while the Mac is on and signed in. A job waits ("Queued") until it is.
- A newer push to a pull request cancels the run in progress.
- Status: `cd ~/actions-runner/clor-platform && ./svc.sh status`. Logs: `~/Library/Logs/actions.runner.Clor-applications-clor-platform.suresh-mac/`.
- Stop: `./svc.sh stop`. Start: `./svc.sh start`.
- The runner updates itself.

## Security

Jobs run as the Mac's user, with what that user can reach (gcloud, wrangler,
SSH keys). Only people with write access to this private repository can start
a job. Keep it that way: do not make the repository public while this runner
is attached, and do not add outside collaborators with write access.

## Removing it

    cd ~/actions-runner/clor-platform
    ./svc.sh stop && ./svc.sh uninstall
    ./config.sh remove --token "$(gh api -X POST repos/Clor-applications/clor-platform/actions/runners/remove-token --jq .token)"
    brew services stop postgresql@16

Then set `runs-on: ubuntu-latest` again in `.github/workflows/ci.yml` and
`security.yml` (and put back the `postgres:16` service in ci.yml).

## Three runners, three test shards (29 Oct 2026)

One runner ran every job in turn: a pull request waited behind the others, and
`verify` took ~43 minutes, 32 of them the server tests one file at a time.

- **Three runners on the Mac**, `suresh-mac`, `suresh-mac-2`, `suresh-mac-3`,
  in `~/actions-runner/clor-platform`, `-2`, `-3`, each a launchd service, all
  labelled `clor-mac`. Pull requests run side by side.
- **Server tests in three shards** (`server-tests`, `vitest --shard=N/3`). Each
  shard still runs its files one at a time against a database of its own
  (`clor_test_<pid>`); shadow databases are per run (`clor_shadow_<run>`).
  Postgres on 5434 allows 300 connections, enough for three runs at once.
  It was on 5433 until 30 Oct 2026; another project's Docker database (Banty-AI `docker-pgvector-1`) also binds 5433 and kept taking it, so CI moved. The port is set in `/opt/homebrew/var/postgresql@16/postgresql.conf` (`port = 5434`).
- **No npm cache upload**: the runner keeps its files; saving the cache to
  GitHub cost ~8 minutes a run.
- **Text-only changes skip CI** (`**/*.md`, `docs/**`); Security still runs.

Add a runner: `gh api -X POST repos/Clor-applications/clor-platform/actions/runners/registration-token`,
copy the runner folder without `.runner`, `.credentials*` and `_work`, then
`./config.sh --unattended --url https://github.com/Clor-applications/clor-platform --token <token> --name suresh-mac-N --labels clor-mac --work _work`
and `./svc.sh install && ./svc.sh start`.

## What runs when (11 Nov 2026)

| Event | `verify` (lint, schema, typecheck, web tests, build) | `server-tests` (3 shards, full suite) | `server-tests-related` |
|---|---|---|---|
| Pull request | yes | only with the `full-tests` label (adding it starts them) | yes, without the label |
| Push to main (a merge) | yes | no: the pull request was checked | no |
| Nightly, 03:00 IST | yes | yes | no |
| Run workflow by hand | yes | yes | no |

`server-tests-related` runs the server test files that import what the pull
request changed, are named after it, or use a changed test helper
(`scripts/ci/related-server-tests.mjs`); a schema, migration or test setup
change runs the whole suite there. Before 11 Nov every merge re-ran the full
suite on main and held all three runners ~30 minutes while pull requests
queued. Before a deploy, run the full suite by hand on the commit released.

The web tests (`npm run test:web`, vitest at the repository root, ~1,800
tests, about four minutes on the two threads CI gives it, no database) joined `verify` on 30 Oct
2026, so every pull request runs them. Before that nothing ran them and 53 had
failed unnoticed since the initial import.

Docs-only changes run nothing. A newer push cancels an older run on the same
branch (main included); the nightly run and a run started by hand are never
cancelled. On a busy day merges keep replacing main's run, so the release check
is a run by hand on the commit being released
(`gh workflow run CI --ref main`), which finishes whatever merges after it.
A server-test failure on main is fixed the same day, before the next release.

## End-to-end tests (30 Oct 2026)

Job `e2e` in `ci.yml` (Playwright, `e2e/README.md`), on the same Mac runners:

| Event | Runs |
|---|---|
| Pull request | `e2e-smoke`: the `@smoke` scenarios, desktop and phone, after `verify` |
| Nightly, run by hand | `e2e-full`: every scenario |
| Push to main | nothing (the nightly run covers it) |

Each run boots its own API and web app on ports taken from the run id
(4400–4899, 6400–6899), builds a database of its own on the CI Postgres
(`clor_e2e_<run>_<attempt>` on 5434, as `clor_ci`) and drops it at the end. The
Chromium build Playwright needs stays in `~/Library/Caches/ms-playwright`.
The HTML report, traces and videos of failures, JUnit XML and
`E2E-RESULTS.md` are the run's `e2e-report-…` artifact, kept 14 days.

### One end-to-end run at a time (31 Oct 2026)

`e2e-smoke` failed at random on pull requests: different tests each time,
mostly at phone width, often green on a re-run. Every red run of 30–31 Oct
shared the Mac with another e2e run, a `verify` or the server shards; the runs
that had the Mac to themselves passed in 3–4 minutes. Under that load a People
screen took 10–20 seconds to answer, past the tests' waits.

- **One e2e run on the Mac at a time.** The test step runs under
  `scripts/ci/one-at-a-time.sh ~/.clor-e2e.lock …`, a `lockf` lock all three
  runners share. A second run waits (its log says so) instead of halving the
  first one's speed. **A waiting run holds its runner**: with two e2e runs
  waiting, only one runner is free for verify and the server shards until the
  lock frees. Each smoke run holds the lock about 5 minutes. The kernel drops the lock when the job ends, is cancelled
  or dies; there is nothing to clean up.
- **In one workflow run, e2e waits for the server shards** (`needs: [verify,
  server-tests]`), when they run at all (main, nightly, `full-tests`).
- **Bigger database pool on CI** (`E2E_DB_POOL=10` per schema; locally 5 on the
  shared 5432).
- **One Playwright install at a time**: the runners share
  `~/Library/Caches/ms-playwright`; two installs at once broke Playwright's own
  directory lock (run 41099681328).
- **Retries**: one in CI, none locally. A test that needed it is listed under
  "Flaky" in `E2E-RESULTS.md`, in the run's summary and as a warning on the
  run. Fix it; a retry is not a pass.

### Staging nightly: off until the owner adds these

The job `e2e-staging` runs the smoke set against staging at 03:00 IST once
both of these exist. Nothing else is needed; nobody else should add them.

| Kind | Name | Value |
|---|---|---|
| Secret | `E2E_STAGING_BASE_URL` | the staging web app, e.g. `https://app.staging.clor.in` |
| Secret | `E2E_STAGING_API_URL` | the staging API including `/api` |
| Secret | `E2E_STAGING_PASSWORD` | a password the run gives the accounts it signs up (any strong value; it is not a real person's) |
| Variable | `E2E_STAGING_ENABLED` | `true` |

Add them under the repository's Settings → Secrets and variables → Actions.
Each staging run signs up two new accounts (`suresh.<run>@e2e.clor.test` and
`zubin.<run>@e2e.clor.test`) with companies named `… <run>`, plus one for the
sign-up scenario. Staging's sign-up limit is 5 an hour from one address, so
keep it to one run at a time.
