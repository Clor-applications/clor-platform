# How the CLOR agent team works

Set up 30 Oct 2026 at the owner's request: research, product, code, code review and end-user QA as separate roles, so that every module is researched, scoped, built, reviewed and tested before it ships.
Role definitions live in `.claude/agents/`, and every agent reads this file first.

**Names:** every agent's name starts with `clor-` so the team's work is easy to track. Roles are
`clor-product-manager`, `clor-researcher`, `clor-coder`, `clor-code-reviewer`, `clor-designer`, `clor-qa-tester`, `clor-devops`. A running
instance adds its module or person: `clor-coder-people`, `clor-qa-employee`, `clor-qa-manager`, `clor-qa-hr`,
`clor-qa-owner`, `clor-qa-boundaries`. Sessions are named the same way (for example *clor-coder-people: Talent*),
and branches stay `claude/<module>-<what>`.

## Roles

| Role | Agent | Does | Never |
|---|---|---|---|
| Coordinator | the owner's main session | Picks the next module, starts the others, routes questions, merges, releases, keeps CI healthy, reports to the owner | Builds features itself while a lane owns them |
| Product manager | `clor-product-manager` | Decisions doc (scope, flows, roles, acceptance criteria, test list), tracker | Writes code |
| Researcher | `clor-researcher` | Sourced report: what CLOR has, Indian rules, how 3–5 products do it, small-business fit | Edits anything |
| Coder | `clor-coder` | Server, screens and tests in its own worktree and branch; opens the PR | Merges its own PR, widens scope |
| Code reviewer | `clor-code-reviewer` | Findings on the PR: isolation, permissions, races, migrations, leaks, tests, DESIGN.md | Edits code |
| Designer | `clor-designer` | Looks at every new or changed screen in a browser at desktop and phone width; review with screenshots and exact fixes against DESIGN.md | Edits feature code |
| DevOps | `clor-devops` | CI runners and database, staging, release preparation and checks, cancelling runs nobody needs | Touches other projects' services, or spends money without asking |
| QA | `clor-qa-tester`, one per person (employee, manager, HR, owner/admin, boundaries) running side by side | Runs that person's real tasks from the scenario library (`docs/people/qa/PERSONA-SCENARIOS.md`) in a browser, on their device first, on local and staging; report with evidence | Writes feature code |

## One module, start to finish

```
owner brief ─▶ clor-researcher ─▶ clor-product-manager ─▶ clor-coder ─▶ clor-code-reviewer + clor-designer ─▶ clor-coder fixes ─▶ clor-qa-* (one per person) ─▶ clor-coder fixes ─▶ QA re-test ─▶ coordinator merges ─▶ clor-devops releases
                (report)      (DECISIONS.md)    (PR)     (findings)                       (QA report)
```

1. **Research.** The coordinator starts the researcher with the owner's brief or research pack.
2. **Decide.** The product manager writes `docs/<app>/design-v1/<MODULE>-DECISIONS.md` and the tracker section. The owner prefers decisions made, not asked (`finish-without-asking`); only legal or money questions go to the owner.
3. **Build in batches.** The coder builds batch by batch, each batch in its own PR with tests and a browser check.
4. **Review.** The code reviewer reviews every PR, and the designer reviews every new or changed screen in the browser, at the same time. Blockers are fixed before QA.
5. **QA.** The QA tester runs the decisions doc's test list end to end. Failures go back to the coder, then QA re-tests.
6. **Done.** The product manager marks an item DONE only with QA evidence. The coordinator merges and, at a sensible point, releases (see `DEPLOY.md`).

Questions travel through the coordinator. The answer is written into the decisions doc, not left in chat.

## Working in parallel (speed)

- **Overlap modules:** while the coder builds module N, the researcher and product manager prepare module N+1. The coder is never waiting for a decisions doc.
- **QA runs side by side:** `clor-qa-employee`, `clor-qa-manager`, `clor-qa-hr`, `clor-qa-owner` and `clor-qa-boundaries` run at the same time, each with its own test company user.
- **Two coders at once** only on modules that touch different files (lanes below), each with its own ports and database.
- **DevOps keeps the road clear:** cancels superseded runs, keeps staging current, and has the release ready before the module's QA ends.

## QA happens in the browser

Every QA scenario and design review is done in a real browser (Playwright), by clicking and typing as the person would, at 1440×900 and 390×844. API calls are allowed only to *set up* test data (an account, 20 employees), never to *check* a result. If the browser shows it wrong, it fails, whatever the API says.

## Work logs

Every agent keeps its own log: `docs/team/log/<agent name>.md`, newest entry first. After every task it records: Did / Evidence / Next / Blocked on (format in `docs/team/log/README.md`). One file per agent, so logs never clash. Trackers hold status per item, and logs hold who did what. The coordinator writes a daily summary in `clor-coordinator.md`.

## Lanes: who owns which files

Two coders must never edit the same files. A lane owns its app folder and its own routes and services.

| Lane | Owns | Shared files it may touch (one small change per PR, coordinator told first) |
|---|---|---|
| People | `apps/people/`, `packages/ui/src/people.css`, People routes/services (`server/src/routes/people*.ts`, `server/src/services/people/`), `server/prisma/people/`, `docs/people/` | `server/src/app.ts` (mounting a router), `packages/shell/` |
| Books | `apps/accounting/`, Books routes/services | as above |
| Platform | `packages/shell/`, `packages/platform/`, workspace, ops console, auth, platform schema, CI, staging | everything shared, coordinated |

Tracker rule: each module has its own section in `TRACKER.md`, and a lane edits only its own section.

## One Mac, many agents: ports and databases

| Lane | Web | API | Local database |
|---|---|---|---|
| Owner's live People app | 5186 | 4002 | as configured |
| People coder | 5190 | 4010 | `clor_lane_people` on 5432 |
| Books coder | 5191 | 4011 | `clor_lane_books` on 5432 |
| Platform coder | 5192 | 4012 | `clor_lane_platform` on 5432 |
| QA (local runs) | the coder's ports | | |

- PostgreSQL 5432 is the developer's local server. **5434 belongs to CI** (`docs/CI-ON-MAC.md`), and 5433 belongs to another project. Never use either.
- Never stop or start another project's servers, Docker containers or databases.
- Stop your dev servers when your turn ends.

## Merging and CI (since 30 Oct 2026)

- A pull request runs the quick checks only: lint, schema, typecheck and build, in a few minutes. The full server suite runs after merge on main, nightly at 03:00 IST, or on a PR labelled `full-tests`.
- So **coders run the affected server and web tests locally before pushing**, and the PR description lists what was run.
- The coordinator merges once the quick checks pass and the review and QA are clear. A red main is fixed the same day, before any release.
- Commits and files never contain the names on the owner's banned-names list (kept outside the repo; ask the coordinator).

## Standards every role checks against

- `DESIGN.md`: the look, tokens, components, writing rules and decisions log.
- Small businesses first: one owner and one or two staff, often on a phone.
- Plain words and sentence case, with no filler text.
- Every free-text field suggests existing data through `SuggestInput`, and never another person's private details.
- Company isolation is fail-closed, every write route is guarded, and allotted numbers are race-safe.
- Finished means tested and seen in a browser, at desktop and phone width.
- **Tests never hard-code a date that is compared against today** ("this month", "upcoming", "due in N days", "away today", the leave year). Work it out from today in India's time (`new Date(Date.now() + 330 * 60_000)`, the server's `todayIst`), never `new Date().toISOString()` (UTC, a day behind before 05:30 IST), and allow for today being a weekly off or a holiday. A test about one particular date fixes the clock instead (`vi.setSystemTime`). Prove it with `TEST_TODAY=2026-12-31T23:30:00+05:30` on the web or server suite, which runs it as of that moment. Main went red on 1 Nov 2026 for this.
