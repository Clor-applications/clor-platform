# CI on a Mac (self-hosted GitHub Actions runner)

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

## What runs when (30 Oct 2026)

| Event | `verify` (lint, schema, typecheck, web tests, build) | `server-tests` (3 shards) |
|---|---|---|
| Pull request | yes | only with the `full-tests` label |
| Push to main (a merge) | yes | yes |
| Nightly, 03:00 IST | yes | yes |
| Run workflow by hand | yes | yes |

The web tests (`npm run test:web`, vitest at the repository root, ~1,800
tests, about four minutes on the two threads CI gives it, no database) joined `verify` on 30 Oct
2026, so every pull request runs them. Before that nothing ran them and 53 had
failed unnoticed since the initial import.

Docs-only changes run nothing. A newer push cancels an older run on the same
branch (main included); the nightly run is never cancelled. A server-test
failure on main is fixed the same day, before the next release.
