# CLOR Engineering Console: design spec

`console.clor.in` · written 14 Nov 2026 · status: draft for the owner's review, nothing built

## 1. Context

CLOR has three audiences and today only two front doors.

| Door | For | Today |
|---|---|---|
| `app.clor.in` | Customers | Live |
| `ops.clor.in` | CLOR business staff (sales, support, finance) | Live, 24 screens |
| `console.clor.in` | The owner and engineers, supervising the platform | Does not exist |

Engineering work is supervised from a terminal on one Mac: `scripts/release.sh`,
`gcloud`, `wrangler`, `gh`. The owner does not write code, so cannot see what is
live, what is waiting, or what an AI agent changed without asking somebody to
run commands. The Console gives the owner that view, and a small number of
guarded buttons, without giving a web page the power to change production on
its own.

**Done means:** the owner can open one page and answer, without a terminal:
what is live, is it healthy, what is waiting to be released, which pull
requests are open and who (or which agent) wrote them; and can release or roll
back with an authenticator code.

## 2. Current state (verified in the repository, 14 Nov 2026)

| Fact | Where |
|---|---|
| No Console code or mention anywhere | `git grep console.clor.in` returns nothing |
| Ops is not a separate application. It is the customer bundle with a host check, and its API is the customer API | `main.jsx:63-73`, `server/src/routes/ops.ts` |
| Ops roles are `SUPER_ADMIN, SALES, SUPPORT, BILLING, READ_ONLY`. There is no engineering role, so no staff member has deploy or database power to take away | `server/src/middleware/operator.ts:40-41` |
| Every Ops write already needs a fresh authenticator code and goes on an append-only log | `requireOperatorStepUp` in `server/src/routes/ops.ts`, `OperatorAuditEvent` in `server/prisma/platform/schema.prisma:1348` |
| A release is one script run on the owner's Mac, in three modes: dry run, `--stage`, `--go` | `scripts/release.sh` |
| Migrations run in their own Cloud Run job before any traffic moves | `scripts/migrate.sh`, `scripts/release.sh:147-151` |
| The header comment of the release script still says migrations run when the new revision starts. That is the old behaviour | `scripts/release.sh:26-30` |
| Rollback is a traffic move to the revision that was serving before; the script prints the command | `scripts/release.sh:240-242` |
| The release needs `gcloud`, `wrangler` and a signing key file that exist only on that Mac | `scripts/release.sh:49,113`, `DEPLOY.md:491` |
| CI runs on GitHub's machines. The full test suite runs nightly, by hand, or on the `full-tests` label | `.github/workflows/ci.yml:127-134` |
| A dead deploy job for the old VM is still in CI, switched off by a variable | `.github/workflows/ci.yml:407-409` |
| A staging copy exists: `clor-api-staging`, Pages project `clor-app-staging` | `DEPLOY.md:24` |
| There is no global feature-flag system. PR 270 (open) adds two owner-only switches that pause public forms | `server/src/services/platformSwitches.ts` in that PR |

### Correction to the first review

The first read said Ops holds technical screens that should move. Having read
them, they should not:

| Ops screen | What it really is | Ruling |
|---|---|---|
| Health | Read-only: are background jobs running, request-ID lookup. Its own comment says fixing stays with engineering | Stays in Ops. Support needs to know if something is down |
| Alerts | Per-team alerts (trial ending, invoice failed, ticket waiting) | Stays in Ops |
| Limits | One customer's company and user limits | Stays in Ops (business) |
| App catalogue | Which apps the site and switcher list | Stays in Ops (product) |
| Forms switches (PR 270) | Pause trials or demo requests with a message | Stays in Ops (business decision) |
| `POST /ops/data-health/payroll-payments/build-index` | A data repair job, allowed to Support | Moves to Console in Phase 2 |

So PR 267 and PR 270 do not conflict with this spec and need not wait for it.

## 3. Ownership rule

One question decides where anything goes: **does it change a customer's
account, or does it change the software and the machines it runs on?**

| Belongs in Ops | Belongs in Console |
|---|---|
| Customers, subscriptions, pricing, offers, invoices, payments | Releases, rollbacks, staging |
| Tickets, saved replies, demo requests, announcements, status page posts | Pull requests, CI results, agent work |
| Payment gateway settings, tax settings, email wording | Cloud resources, DNS, secrets, service accounts |
| Customer limits, app catalogue, form switches | Database backups, migrations, data repair jobs |
| Business audit log | Engineering audit log |
| Website words (when a CMS exists; none today) | Website code and deploys |

This narrows the earlier rule "every staff job is done in ops.clor.in": it
still holds for business staff. Engineering jobs go to the Console.

## 4. Design principles

1. **The Console holds no power over production.** It has read-only access to
   Google Cloud and Cloudflare. Every change it makes is a GitHub action:
   start a workflow, approve a run, merge, label or close a pull request. The
   cloud credentials that can change production live only inside GitHub
   Actions, behind an approval.
2. **Nothing reaches production that is not on `main`.** Same rule the release
   script enforces today.
3. **Every write asks for a fresh authenticator code and is logged**, the same
   bar Ops already sets.
4. **No free-form power.** No SQL box, no shell, no secret values shown, no
   in-page code or theme editor. A change to code is a pull request.
5. **The terminal path keeps working.** `scripts/release.sh` on the Mac stays
   the break-glass route when the Console or GitHub is down.
6. **AI agents never sign in to the Console.** They act only by opening pull
   requests. The Console is where a person reviews them.
7. **Link out before building.** Where Google Cloud, Cloudflare or GitHub
   already has a good screen, Phase 1 links to it instead of copying it.

## 5. Architecture

```
 Browser ── console.clor.in ──────────► Cloudflare Pages project  clor-console
                │                        (own build, not in the customer bundle)
                ▼
        console-api.clor.in ──────────► Cloud Run service  clor-console
                │                        service account  clor-console-run
                │
   ┌────────────┼──────────────────────────────┐
   ▼            ▼                              ▼
 GitHub App   Google Cloud (read only)      Cloudflare (read only)
 read + act   Cloud Run, Cloud SQL,          Pages deployments
              Monitoring, Logging
   │
   ▼
 GitHub Actions  release.yml ── environment "production" (owner approves)
   │                              holds the Google and Cloudflare write access
   ▼
 scripts/release.sh --stage | --go | rollback
```

### Decisions taken (the owner can overrule any of them)

| # | Decision | Why | Rejected alternative |
|---|---|---|---|
| D1 | Console is its own Pages project and its own Cloud Run service, in new top-level folders `console/web` and `console/api` | A fault in the customer API must not become control of releases. Scale-to-zero, so cost is near nil | Routes under `/console` in `clor-api`: cheaper to build, but one compromise reaches both |
| D2 | Sign-in is GitHub, through a GitHub App named "CLOR Console" installed on this repository only | Everyone who may touch engineering already has a GitHub account, and GitHub is where the Console acts. No CLOR customer login reaches the Console | CLOR login: ties the control plane to the service it controls |
| D3 | Members are an allow-list of GitHub numeric user ids with a role. First owner comes from the setting `CONSOLE_OWNER_GITHUB_IDS` | Same pattern as `CLOR_OPERATOR_USER_IDS`. An id cannot be renamed or claimed | Any repository collaborator: too wide |
| D4 | Console has its own authenticator enrolment. Every write needs a code no older than 5 minutes | Matches Ops. GitHub sign-in alone does not prove the person is at the keyboard now | Trust the GitHub session |
| D5 | Console's own data (members, audit log) lives in a new database `clor_console` on the existing `clor-pg` instance, reachable only by `clor-console-run` | No new monthly cost. Customer databases are not reachable by the Console at all | New instance (cost); Cloudflare D1 (second stack) |
| D6 | Production writes run in a new workflow `.github/workflows/release.yml`, inside a GitHub environment `production` limited to `main`, with the owner as required reviewer | The repository is public. Environment secrets are never given to pull requests from forks, and a run cannot start without approval | Console calls Google Cloud directly: puts production keys in a web service |
| D7 | GitHub reaches Google Cloud by workload identity federation, no stored key | No long-lived key to leak | Service account key in a GitHub secret |
| D8 | No colour of its own. Console uses the graphite neutrals in `DESIGN.md` with no product hue | It is not a product. The owner decides if it should have one | Borrow Ops forest: the two would be confused |

### Roles

| Role | Sees | May do |
|---|---|---|
| Owner | Everything | Everything below, plus approve a release, roll back, merge, manage members |
| Engineer | Everything | Start full tests, stage a release, label and close pull requests, roll back |
| Viewer | Everything | Nothing |

Rolling back is allowed to Engineers because waiting for the owner during an
outage costs customers. It is still logged and still asks for a code.

### Data model (`clor_console`)

```prisma
model ConsoleMember {
  githubUserId   BigInt   @id
  githubLogin    String                    // shown only; never used to decide access
  role           String                    // OWNER | ENGINEER | VIEWER
  active         Boolean  @default(true)
  totpSecretEnc  String?                   // encrypted at rest
  totpEnabledAt  DateTime?
  addedBy        BigInt?
  createdAt      DateTime @default(now())
}

model ConsoleAuditEvent {                  // append-only: no update, no delete grant
  id             String   @id @default(cuid())
  at             DateTime @default(now())
  githubUserId   BigInt
  action         String                    // e.g. RELEASE_STAGED, RELEASE_APPROVED, ROLLED_BACK, PR_MERGED
  target         String                    // commit, revision, PR number
  reason         String?
  detail         Json
  ip             String?
}
```

### Console API (Phase 1)

All under `https://console-api.clor.in`. Reads need a signed-in member. Writes
need role and a fresh code; each writes one `ConsoleAuditEvent` before it
calls GitHub and records the outcome after.

| Method and path | Role | What it does |
|---|---|---|
| `GET /me` | any | Who am I, role, authenticator enrolled |
| `POST /two-factor/setup`, `/two-factor/enable`, `/step-up` | any | Same shape as the Ops endpoints |
| `GET /overview` | any | The Overview rows (section 6.1) |
| `GET /releases` | any | Serving revision, staged revision, last 20 releases, what is waiting |
| `POST /releases/tests` | Engineer | Starts the full CI run on `main` |
| `POST /releases/stage` | Engineer | Starts `release.yml` with `mode=stage` |
| `POST /releases/go` | Owner | Starts `release.yml` with `mode=go`, then approves the waiting run as the owner |
| `POST /releases/rollback` | Engineer | Starts `release.yml` with `mode=rollback`, `revision=<name>` |
| `GET /pulls` | any | Open pull requests with the fields in section 6.3 |
| `POST /pulls/:n/full-tests` | Engineer | Adds the `full-tests` label |
| `POST /pulls/:n/merge` | Owner | Merges if every required check is green |
| `POST /pulls/:n/close` | Engineer | Closes with a reason as a comment |
| `GET /audit` | any | The Console log, newest first, filter by action and person |
| `GET /members`, `POST /members`, `PATCH /members/:id` | Owner | Manage the allow-list |

## 6. Phase 1 screens

Three screens, one audit log, one members page. Everything else in the
proposed 12-item menu is a link out (section 7).

### 6.1 Overview

One list on the page ground, one row per part, each with a status pill, one
line of fact, and when it was last checked. No cards inside cards.

| Row | Fact shown | Source |
|---|---|---|
| API | Revision serving, its release tag, age, does `/ready` answer | Cloud Run, an HTTP check |
| Web app | Latest production deployment, commit, age | Cloudflare Pages `clor-app` |
| Website | Same | Cloudflare Pages `clor` |
| Database | Time of last backup, result of last migration job | Cloud SQL, Cloud Run job `clor-api-migrate` |
| Tests | Result of `main` head, result of last nightly full run | GitHub Actions `ci.yml` |
| Security checks | Result of last run | GitHub Actions `security.yml` |
| Waiting to release | Count of pull requests merged since the last `rel-` tag | git tags, GitHub |
| Open pull requests | Count, and how many are red | GitHub |
| Staging | Revision on `clor-api-staging`, age | Cloud Run |

A row whose source cannot be reached says "Could not check" with the time of
the last good answer. It never shows a stale green.

### 6.2 Release Center

The one primary action, top right, is the next sensible step: **Run full
tests**, then **Stage**, then **Release**.

- **What is waiting:** the pull requests merged since the last release, from
  the same logic as `scripts/release-notes.mjs`. A pull request that touches a
  migration, a workflow or the release scripts is marked.
- **Checks before Stage is offered:** `main` head has a green full test run
  no older than the head commit. If not, the button is Run full tests.
- **Stage:** starts the workflow. The page follows the run step by step, using
  the step names the script already prints (1 to 7).
- **Release:** offered only when a staged revision exists for the head commit
  and answered `/ready`. Asks for a reason and a code. Owner only.
- **Roll back:** always visible. Lists the last five revisions that served
  traffic; picking one asks for a reason and a code. States plainly that a
  rollback does not undo a migration.
- **History:** the last 20 releases: tag, who, when, revision, link to the run.

### 6.3 AI Agent Center (Phase 1: review desk)

A list of open pull requests, newest activity first.

| Column | Notes |
|---|---|
| Title and number | Links to GitHub |
| Written by | Agent (branch starts `claude/`), Dependabot, or a person |
| Checks | Green, red, running, or "full tests not run" |
| Size | Files and lines changed |
| Touches | Marks for: database migration, CI workflow, release scripts, sign-in or permissions code, Books (another developer's area) |
| Age | Days open, days since last push |

Row actions: Run full tests, Merge (Owner, only when green), Close. Opening a
row shows the description and the list of files, with a link to the preview
deployment when one exists. No code is edited here.

"Touches" is decided by path:

| Mark | Paths |
|---|---|
| Migration | `server/prisma/**/migrations/**` |
| Workflow | `.github/workflows/**` |
| Release | `scripts/release.sh`, `scripts/migrate.sh`, `deploy/**`, `cloudbuild*.yaml` |
| Access | `server/src/middleware/**`, `server/src/routes/auth*`, `console/api/**` |
| Books | `apps/accounting/**` |

A pull request marked Workflow, Release or Access cannot be merged from the
Console. It shows "Review this one on GitHub" instead. A change to the release
path should not be approved by the tool that depends on it.

## 7. The other nine menu items

| Menu item in the requirement | Phase 1 | Later |
|---|---|---|
| Applications | Folded into Overview | Phase 2: per-service page with environment and settings names |
| Frontend Studio | Not built. Preview links sit on each pull request | Phase 3 at most: a gallery of previews. Never an editor |
| Backend Services | Link to Cloud Run | Phase 2: workers and scheduled jobs, last run, last failure |
| API Center | Link to Ops Health request lookup | Phase 3: endpoint list from the route manifest, webhook delivery log |
| Database Center | Backup and migration rows on Overview | Phase 2: migration history, backup list, restore-drill date, data repair jobs as approved workflows. Never a SQL box |
| Infrastructure | Links to Google Cloud and Cloudflare | Phase 3: resource list, DNS records, month-to-date cost |
| Observability | Link to Cloud Logging and Monitoring | Phase 2: error rate and slow requests for the last day |
| Security Center | Members page and audit log | Phase 2: secret names with age and last rotation (never values), service accounts and their roles, results of `security.yml` |
| Quality Center | Tests row on Overview | Phase 2: flaky tests, coverage trend, release gates |

Agent task hand-out (writing a task in the Console and having an agent pick it
up) is Phase 2. Phase 1 only reviews what agents produce.

## 8. Build order

```
#0 Release in GitHub Actions ──► #2 Release Center
        │
#1 Console skeleton ─┬─────────► #3 Overview
   (sign-in, roles,  ├─────────► #4 AI Agent Center
    audit, members)  └─────────► #2
```

| # | Piece | Contents | Effort |
|---|---|---|---|
| 0 | Release from GitHub Actions | `release.yml` with `stage`, `go`, `rollback`; workload identity federation; `production` environment; pinned `wrangler`; signing key as an environment secret; changelog pull request opened by the run; fix the stale comment in `release.sh`; remove the dead VM deploy job | 2 days |
| 1 | Console skeleton | `console/web`, `console/api`, Pages project, Cloud Run service, database, GitHub App sign-in, authenticator, members, audit log, CI for both folders | 3 days |
| 2 | Release Center | Section 6.2 | 2 days |
| 3 | Overview | Section 6.1 | 1.5 days |
| 4 | AI Agent Center | Section 6.3 | 2 days |

About 10.5 working days. Piece 0 comes first because it is useful on its own
(a release no longer depends on one Mac) and because it is the riskiest: it is
proven with `--stage` against staging before any screen exists.

## 9. Acceptance criteria

1. `console.clor.in` is served from Pages project `clor-console`; its bundle
   contains no file from `apps/` or `packages/ops`, and the `clor-app` bundle
   contains no file from `console/`.
2. A GitHub user who is not an active `ConsoleMember` gets 403 from every
   Console API path except sign-in, and no row of data.
3. A member without an enrolled authenticator can read nothing but `/me`.
4. Every write endpoint returns 401 without a code issued in the last 5
   minutes, for all three roles.
5. A Viewer gets 403 on every write. An Engineer gets 403 on `/releases/go`,
   `/pulls/:n/merge` and `/members`.
6. The service account `clor-console-run` holds only viewer roles on Cloud
   Run, Cloud SQL, Monitoring and Logging, and can connect only to
   `clor_console`. Verified from the IAM policy, not from code.
7. `release.yml` cannot run its cloud steps without an approval in the
   `production` environment, and that environment accepts only `main`.
8. Stage from the Console produces a revision tagged `rel-<sha7>` with no
   traffic, the same result as `scripts/release.sh --stage` on that commit.
9. Roll back from the Console moves 100% of traffic to the named revision and
   the Overview API row shows that revision within 60 seconds.
10. Each write leaves exactly one `ConsoleAuditEvent` with person, action,
    target, reason and outcome. The database role has no update or delete
    grant on that table.
11. Merge is refused for a pull request with a red or missing required check,
    and for one marked Workflow, Release or Access.
12. With the GitHub API unreachable, Overview loads and each affected row
    shows "Could not check" with the time of the last good answer.
13. `scripts/release.sh --stage` and `--go` still work from the Mac, unchanged
    in behaviour.
14. No Console response contains a secret value; a test searches every
    response fixture for the names in the environment.
15. Each test states: `protects=<what it protects>; fails_when=<the wrong
    result it rejects>; no_claim=<what a pass does not prove>`.

## 10. Testing plan

| Layer | What | Count |
|---|---|---|
| Unit | Role and step-up checks, the path-to-mark table, "what is waiting" from tags, stale-answer handling | +25 |
| API | Every endpoint for each role, with and without a code; audit row written; GitHub and Google Cloud replaced by recorded answers | +30 |
| Workflow | `release.yml` run with `mode=stage` against staging | 1 run per change to it |
| Browser | Sign in, enrol authenticator, read Overview, stage on staging, roll back on staging, try to merge a red pull request | +6 |

What the recorded answers do not prove: that the GitHub App's permissions are
enough in production. The staging run in the Workflow layer covers that.

## 11. Rollback of the Console itself

- Console web or API: redeploy the previous Pages deployment or Cloud Run
  revision. No customer is affected either way.
- `release.yml` misbehaves: disable the workflow in GitHub; release from the
  Mac as today.
- Whole project abandoned: delete the Pages project, the Cloud Run service,
  the database `clor_console`, the GitHub App and the federation binding.
  Nothing in `server/` or the customer apps will have changed.

## 12. Out of scope

- Any change to Ops screens, Ops roles, or PR 267 and PR 270.
- A website content editor in Ops. The site is static files in `website/`;
  a CMS is a separate project.
- Help Centre.
- Global feature flags. None exist; inventing them is its own spec.
- Mobile builds (`android-*.yml`, `ios.yml`).
- Cost reporting (needs billing export; Phase 3).

## 13. Open questions for the owner

1. **Who besides you gets a Console login in Phase 1?** The spec assumes you as
   Owner and nobody else yet.
2. **May an Engineer roll back without you?** The spec says yes (section 5).
3. **Is GitHub sign-in acceptable to you day to day?** It means your GitHub
   account, with its own two-step sign-in, is the key to the Console.
4. **The signing key for the on-site connector** would be stored as a GitHub
   environment secret so a release can run off the Mac. If you would rather it
   never leave the Mac, releases that include the connector stay on the Mac.

## 14. Risks

| Risk | Guard |
|---|---|
| The repository is public, so the release workflow is readable by anyone | Secrets only in the `production` environment; environment limited to `main`; required reviewer; no secrets to fork pull requests |
| An agent's pull request edits `release.yml` to leak secrets | Marked Workflow; cannot be merged from the Console; add `CODEOWNERS` so `.github/` and `scripts/` need the owner's review on GitHub |
| GitHub is down during an outage | Mac path kept working (criterion 13) |
| Console becomes a second place to do Ops work | Section 3 rule; Console has no access to customer databases at all |
| Scope creep to all 12 menus | Section 7 fixes what Phase 1 does not build |

## 15. Files

| Path | Change |
|---|---|
| `console/web/**` | New: Console front end |
| `console/api/**` | New: Console API and its Prisma schema |
| `.github/workflows/release.yml` | New |
| `.github/workflows/ci.yml` | Add `console/` build and tests to `verify`; remove the VM `deploy` job (lines 407 on) |
| `.github/CODEOWNERS` | New: owner review for `.github/`, `scripts/`, `deploy/`, `console/api/` |
| `scripts/release.sh:26-30` | Correct the comment about when migrations run |
| `scripts/release.sh` | Add a `--rollback <revision>` mode so the workflow and the Mac share one path |
| `DEPLOY.md` | Add the Console and the workflow route |
| `docs/workspace/OPERATOR_CONSOLE.md` | One line pointing engineering jobs to the Console |
