# Deploying CLOR

The API runs on Google Cloud Run, its data is in Cloud SQL, and the web app and
the website are static files on Cloudflare Pages. This file describes what is
running, how a release goes out, and how to take one back.

Until October 2026 CLOR ran on a single virtual machine (Caddy, systemd,
PostgreSQL beside the API). That machine is retired. `deploy.sh`,
`deploy/backup.sh`, the Caddyfiles and the docker-compose files in the repo
belong to it and to local development; **none of them deploys production**.

## The shape of it

| Piece | Where | Name |
| --- | --- | --- |
| API | Cloud Run, Mumbai (`asia-south1`) | service `clor-api` |
| Database | Cloud SQL for PostgreSQL, Mumbai | instance `clor-pg` |
| API address | Cloudflare Worker in front of Cloud Run | `api.clor.in` (`deploy/cloudflare/api-proxy`) |
| Web app | Cloudflare Pages | project `clor-app`: app, people, attendance, payroll, books, ops `.clor.in` |
| Website | Cloudflare Pages | project `clor`: `clor.in` |
| API images | Artifact Registry, Mumbai | `asia-south1-docker.pkg.dev/clor-apps-511409/clor/api:<sha7>` |
| Secrets | Secret Manager | `DB_PASSWORD`, `JWT_SECRET`, `MAIL_SECRET_KEY`, `EDGE_SECRET`, `JOBS_TOKEN`, `SMTP_USER`, `SMTP_PASS` |
| Background jobs | Cloud Scheduler job `clor-api-jobs` | wakes the API every 10 minutes |
| Staging | the same, smaller | service `clor-api-staging`, Pages project `clor-app-staging`, `api.staging.clor.in` |

Everything is in the Google Cloud project `clor-apps-511409`.

**Four databases on one instance**, one per application: `clor_main`
(Books), `clor_payroll`, `clor_people` (People and Attendance) and
`clor_platform` (accounts, sign-in, billing, email, jobs). The API connects to
all four over the Cloud SQL socket as the role `clor_app`, with one password
(`server/scripts/cloudrun-start.sh` builds the four addresses from it).
Staging has four of its own, named with `_staging` (`DB_NAME_SUFFIX`).

**The settings the service is meant to have** — request timeout, instances,
CPU and memory, concurrency, probes, every environment variable by name — are
written down in [`deploy/cloudrun.service.yaml`](deploy/cloudrun.service.yaml).
A release changes only the image; a setting is changed by hand with
`gcloud run services update` and in that file in the same pull request.

**A request's path:** browser → `api.clor.in` (the Worker) → Cloud Run. The
Worker adds a secret header and Cloudflare's verified client address. The API
refuses any request without the header (so nobody can go round Cloudflare to
the `run.app` address), except `/ready`, which is how a new revision is checked
before it takes traffic.

## Releasing

One script, from a clean checkout of `origin/main`:

```bash
scripts/release.sh            # dry run: prints every command and the changelog entry, runs nothing
scripts/release.sh --stage    # backup, build, start the new revision with NO traffic, check /ready
scripts/release.sh --go       # all of the above, then move traffic, publish web and website, record it
```

`--skip-web` and `--skip-website` leave the web app or clor.in alone;
`scripts/release.sh --help` lists the rest. Without `--stage` or `--go`
nothing is changed anywhere.

What `--go` does, in order:

1. **Checks** the checkout is exactly `origin/main` with nothing uncommitted.
   What is released must be what is merged.
2. **Signs the on-site connector** if the signing key is on this machine
   (see below).
3. **Backs up the database**: `gcloud sql backups create --instance clor-pg`.
4. **Builds the API image** with Cloud Build, tagged with the commit's short
   id. The build runs as the `clor-build` service account; the project's
   default account cannot push to Artifact Registry, and a build without it
   fails at the push step with no message.
5. **Starts it on Cloud Run with no traffic** (`--no-traffic`). Migrations run
   now, as the container starts.
6. **Tags the revision** `rel-<sha7>`, which gives it its own address:
   `https://rel-<sha7>---clor-api-nmprtntkma-el.a.run.app`.
7. **Checks `/ready`** on that address, for up to three minutes. If it never
   answers, the script stops here. No traffic has moved; customers are still
   on the old revision.
8. **Moves traffic** to the tag.
9. **Builds and publishes the web app** (`npm run build`, then wrangler to the
   Pages project `clor-app`), **then the website** (`website/`, project `clor`).
10. **Records the release**: a git tag `rel-<sha7>`, pushed, and a section in
    `CHANGELOG.md` listing the pull requests merged since the previous `rel-`
    tag (`scripts/release-notes.mjs`). The changelog change is left
    uncommitted for a small pull request, since main takes changes that way.

### Making a clean checkout

The main working folder usually has work in progress, so release from a
worktree of its own:

```bash
git fetch origin main
git worktree add /private/tmp/rel-$(git rev-parse --short=7 origin/main) origin/main
cd /private/tmp/rel-*
```

The web build needs `node_modules`. The Mac's disk is nearly full, so do not
`npm ci` in the new folder: clone an installed worktree's instead, which costs
no space on APFS (`cp -cR <installed worktree>/node_modules ./node_modules`).
The `git status` check ignores `node_modules`. Remove the worktree after the
release (`git worktree remove`).

### Before a release

- **CI on main is green**, and for a release with server changes the full
  server suite has run (pull requests run only related tests unless they carry
  the `full-tests` label; `docs/CI-ON-MAC.md`).
- **Read the migrations going out** (`git diff <previous rel- tag>..origin/main --stat -- 'server/prisma/*/migrations'`).
  They run at step 5, before any traffic moves, against the live database:
  - They must be **additive**. The old revision keeps serving on the new
    schema until step 8, and again after a rollback.
  - They run as `clor_app`, which is **not a superuser** on Cloud SQL. A
    migration that needs one (a function with `SET clor.bypass = …` in its
    header, for example) fails at start and the revision never becomes ready;
    use `set_config` inside the function body instead. This happened on
    12 Nov 2026 (`rel-cc4b003`, which never took traffic).
  - A failed migration leaves a row in `_prisma_migrations` that blocks the
    next start too. Fix the migration in a new commit and mark the failed one
    rolled back before releasing again.
- **Say what is going out** to the owner, and get a yes for clor.in: the
  website is published only when the owner asks.

### After a release

- Open `https://app.clor.in`, sign in, and look at whatever the release changed.
- A browser can hold the old bundle: check the new one is served with
  `curl -s https://app.clor.in/ | grep -o 'index-[^"]*\.js'` against the
  address wrangler printed. Cloudflare has taken ten minutes to switch before.
- `https://ops.clor.in` → Alerts and System health, a quarter of an hour
  later: a job that started failing with the release shows there.

## Rolling back

**The API:** move traffic back to the previous tag. The script prints the
exact command when it finishes; it is

```bash
gcloud run services update-traffic clor-api --project clor-apps-511409 --region asia-south1 --to-tags rel-<previous sha7>=100
```

The previous tag is the section below the newest in `CHANGELOG.md`, and
`gcloud run services describe clor-api --region asia-south1 --project clor-apps-511409`
lists every tag still attached. Rolling back takes seconds and does not
rebuild anything.

**It does not undo a migration.** That is the reason migrations are additive:
the old code runs on the new schema. Where one release's notes say more is
needed to go back (some do, under Schema changes below), follow them.

**The web app and the website:** Cloudflare dashboard → Workers & Pages → the
project → Deployments → the one before → Rollback. Or publish the earlier
commit again from a checkout of it.

**The data:** see [`docs/BACKUP-AND-RESTORE.md`](docs/BACKUP-AND-RESTORE.md).
Restoring is a decision for the owner; a rollback of the code almost never
needs it.

## The on-site connector (Cloud Run image)

Connectors on customers' networks update themselves only to a build signed
with CLOR's Ed25519 key, and that key stays on the deploying machine
(`~/.config/clor/agent-signing.key`, mode 600, never in a repository or an
image). `scripts/release.sh` builds and signs the connector before the image
build when the key is there; by hand it is

```bash
cd server && npm run agent:build && AGENT_SIGNING_KEY_FILE=$HOME/.config/clor/agent-signing.key npm run agent:sign
```

That writes `server/dist-agent/clor-agent.cjs` with `.sig` and `.sha256`
beside it (git ignores the folder; the upload and the Docker build include
it). The image serves the signed file at `/agent/v1/download` and its
signature at `/agent/v1/download.sig`. Without the key the image builds the
connector itself, unsigned: nothing breaks, but no connector in the field will
update to it. Lose the key and a new one means a new public key in
`server/agent/src/signing.ts`, which connectors already out there do not
have — they would need reinstalling by hand.

## The database role

The API connects as `clor_app`, for every request and for the migrations at
start. `clor_app` is `NOSUPERUSER NOBYPASSRLS`, and that is load-bearing:
PostgreSQL skips row-level security entirely for a superuser or a `BYPASSRLS`
role, whatever the table says, so an application connecting as either would
carry a full set of policies and be protected by none of them. Every tenant
table has `FORCE ROW LEVEL SECURITY`; code that must read across companies
(background jobs, the operator console) says so explicitly
(`outsideTenant` in `server/src/utils/tenantScope.ts`).

A new table needs the same row-security policy as its neighbours in the same
schema, or CI's `verify` job fails. A new public route must be added to
`tenant-platform-upgrade-2026-10-23/route-allowlist.json`.

## Background jobs on Cloud Run (Cloud Scheduler wake call)

The API scales to zero and gets CPU only while it serves a request, so the jobs
started in `server/src/index.ts` do not run on their timers when nobody is
using the app. That covers leave hand-on to HR, the leave digest, lapse
notices, dated changes, the People outbox, approval reminders, recurring
invoices, email retries and the rest. Cloud Scheduler wakes them: every 10
minutes it posts to `/api/internal/jobs/tick`, which runs each job's tick
inside the request and waits for it (`server/src/services/jobRegistry.ts`).

- **Once per period:** each job runs at most once per its own interval. The
  lease stops two instances from running it, and the registry stops one
  instance from running it twice. Waking a job often is safe.
- **After downtime:** what is due is read from the database, so the first wake
  catches up on what was missed.
- **Retries:** a job that throws makes the call answer 500, and Cloud Scheduler
  retries it with backoff. A job that runs past 4 minutes is reported as
  timed out and keeps running under its lease.
- **A job that stops, or fails quietly:** each wake ends with a health check
  (`server/src/services/ops/jobHealth.ts`). A job with no good run in about
  three of its periods, or three failed runs in a row, opens an alert on
  `ops.clor.in` → Alerts, mailed once to support staff and owners, and closed
  when the job is well again. If the schedule below is ever changed from 10
  minutes, set `JOBS_WAKE_EVERY_MS` on the service to match.
- **Off by default:** without `JOBS_TOKEN` the route does not exist (404).

Set it up once per service (production shown; staging has neither yet):

```sh
# 1. The token, as a secret, mounted on the service
openssl rand -hex 32 | gcloud secrets create jobs-token --data-file=-
gcloud run services update clor-api --region asia-south1 \
  --update-secrets JOBS_TOKEN=jobs-token:latest

# 2. Cloud Scheduler (the first three jobs per billing account are free)
gcloud services enable cloudscheduler.googleapis.com
gcloud scheduler jobs create http clor-api-jobs --location asia-south1 \
  --schedule '*/10 * * * *' --time-zone 'Asia/Kolkata' \
  --uri 'https://api.clor.in/api/internal/jobs/tick' --http-method POST \
  --headers "x-jobs-token=$(gcloud secrets versions access latest --secret jobs-token),Content-Type=application/json" \
  --message-body '{}' --attempt-deadline 300s \
  --max-retry-attempts 3 --min-backoff 30s --max-backoff 300s

# 3. Check it
gcloud scheduler jobs run clor-api-jobs --location asia-south1
gcloud logging read 'resource.type="cloud_run_revision" AND httpRequest.requestUrl:"/internal/jobs/tick"' --limit 5
```

The call goes through `api.clor.in`, so the Worker adds the edge header.

**Cloud Run's request timeout must be at least 300 seconds** for this call.
On 12 Nov 2026 the live service had 60: a wake that takes longer is cut off,
the scheduler counts an error and retries, and long jobs lose their CPU
mid-run. `deploy/cloudrun.service.yaml` records 300 as the intended value;
bring the service in line with

```sh
gcloud run services update clor-api --region asia-south1 --project clor-apps-511409 --timeout 300
```

## Backups

Cloud SQL takes a backup of the whole instance every day and one more is
taken by hand before each release (step 3 above). How they are kept, what else
should exist, and how to restore: [`docs/BACKUP-AND-RESTORE.md`](docs/BACKUP-AND-RESTORE.md).

## Schema changes

Migrations are versioned under `server/prisma/*/migrations`, one folder per
schema (`migrations` for Books, `payroll`, `people`, `platform`), and applied
by `npm run prisma:deploy` each time a container starts
(`server/scripts/cloudrun-start.sh`): the database-address guard first, then
`prisma migrate deploy` for each of the four. A revision is not ready, and
takes no traffic, until all four have finished. The rules for writing one are
under "Before a release" above.

The notes below are for particular migrations: what to do after them, and
what going back needs.

### Explore's sample company (migration `20261123090000_explore_passes`): optional, after migrate

Explore links (a demo request on clor.in mails one) open a shared, read-only
sample company, "Sample Traders Pvt Ltd". It is made the first time somebody
opens a link, which makes that person wait about a minute. To spare them the
wait, build it once after the release that brings the migration: in the
operator console, open **Sample company** and press **Build sample company**.
The screen shows the build as it goes, when it finished or why it stopped,
and what is in the company. **Rebuild from scratch** runs every step again
(nothing is deleted; anything missing is put back), for after the sample data
changes. Both need the support or billing role and an authenticator code, and
go on the operator log. **Explore links** on the same console lists every
link sent, to resend or end.

The build is safe to run again: a second run only reads, and adds only what
is missing. The sample company sends no mail and gives no notices; every
person and customer in it is on the reserved `.example` domain.

Developer fallback only (the console is the way for Clor staff): the same
build from a shell is `npm run seed:sample` in `server/`, with the API's
environment; `-- --force` is the rebuild. It needs no running server.

### Stand-in merge (workflow engine 2b, migration `20261118090000_stand_in_merge`): rolling back

Until phase 3c, a rollback to an API from before 2b is safe:

- Leave delegates stay in `ApprovalStandIn`. The migration copies them into
  `StandIn` and keeps the old rows, and every new stand-in that covers leave or
  attendance is also written there (linked by `StandIn.legacyId`). The older
  leave and attendance code still sees every one of them.
- A leave-and-attendance `StandIn` row stores no sign-ins (`userId`,
  `standInUserId` are null). The older engine and People stand-ins list select
  by sign-in, so they never return such a row, and never meet a null where
  their client expects a value.
- People stand-ins named before the merge read `['PEOPLE']` (People requests
  only), and so does a row an older API writes with no list.
- Rows that hand on People requests (`ALL`, `PEOPLE`, named People types) keep
  their sign-ins. The older engine reads every one of them as a People
  stand-in for all People requests. It does not read the narrower list.
- A delegate the older API removes (its `ApprovalStandIn` row) is ignored by
  the newer API too. A delegate the older API names after the rollback exists
  only in `ApprovalStandIn`, and the newer API reads it from there.

- The older API reads every `ApprovalStandIn` row as leave and attendance.
  So a "Leave only" delegate also decides attendance requests there.
- While the deploy runs, or after a rollback, removing a delegate on the older
  API deletes only its `ApprovalStandIn` row. If the newer `StandIn` row was
  an "All approvals" one, its People part goes as well: the newer API ignores
  a row whose linked old row is gone. Name it again on the newer API if
  needed.

Nothing needs undoing on a rollback. Do not drop `ApprovalStandIn` before
phase 3c. The 3c order is in `docs/people/workflow-engine/SPEC.md` section 9.

### Leave on the engine (workflow engine 2c-i, migration `20261119090000_leave_on_engine`): deploying and rolling back

The migration adds one column, `PeopleSetting.leaveOnEngine`, default `false`.
An older API never reads it.

- **Switch off (every company, the default):** leave decides exactly as
  before and nothing new is written: no `ApprovalRequest`, no preset rule.
  The deploy window (old and new instances side by side) and a rollback to
  rel-eed8908 need nothing.
- **No screen or API turns it on in 2c-i.** Only staging QA turns it on, per
  company, as the owner of the schema:
  `UPDATE people."PeopleSetting" SET "leaveOnEngine" = true WHERE "orgId" = '<id>';`
  (insert a row first if the company has none). 2c-ii adds the switch to
  Company choices.

What a company with the switch on writes, and how rel-eed8908 reads it:

- **Preset rules:** three `ApprovalRule` rows, request type `LEAVE`, variant
  keys `preset:HR_OR_MANAGER`, `preset:MANAGER`, `preset:MANAGER_THEN_HR`,
  no conditions. The older API reads only the main rule (variant `""`) and
  picks a variant only by its conditions, so it never uses them. Its
  Approval rules screen lists them under Leave's variants, read only; that
  is cosmetic.
- **A new leave:** the leave row is written as before, with
  `ruleId` null, and the manager's step under "manager, then HR" is still
  written on the row (`managerApprovedAt`). To the older API it is an
  ordinary chain request, and the parity tests show the chain gives it the
  same people, so it decides it on the old path.
- **Before rolling back a company that has it on (mandatory, both steps):**
  1. Switch it off, so no more engine requests open:
     `UPDATE people."PeopleSetting" SET "leaveOnEngine" = false WHERE "orgId" = '<id>';`
  2. Close its waiting engine requests, so the older API never sees them:
     `SET clor.bypass = 'on'; UPDATE people."ApprovalStep" SET status = 'WITHDRAWN' WHERE status = 'WAITING' AND "requestId" IN (SELECT id FROM people."ApprovalRequest" WHERE "orgId" = '<id>' AND "sourceKind" = 'LEAVE' AND status = 'WAITING'); UPDATE people."ApprovalRequest" SET status = 'WITHDRAWN' WHERE "orgId" = '<id>' AND "sourceKind" = 'LEAVE' AND status = 'WAITING';`
  Their leave rows are untouched: the older API decides them on the old path,
  with the same people, and a later roll-forward leaves them there.
- **Why step 2 is not optional.** An engine request left waiting is read by
  the older API as an ordinary People request: it lists it on People →
  Approvals under "Waiting for me", reminds its people after two working
  days, its away job may hand the step up to someone else, and approving it
  there closes only the engine request (it has no leave effect) and tells
  the employee "Approved" while the leave is still waiting.
- **Rolling forward again.** A leave whose engine request is no longer
  waiting goes on the old path (never stuck). If the older API took the
  manager's step on the leave row, the newer API takes that step as the
  same person's on the engine before anyone decides it, and HR's step opens.
  A waiting engine request whose leave is decided or cancelled on the newer
  API closes to match then; one whose leave the older API decided stays
  waiting but is listed nowhere (the queues read waiting leave only).

Nothing else needs undoing. Phase 3c stops the writes to the old manager
columns, once no leave is pending on the old path.

### Leave on the engine, phase 2c-ii: what changes for deploying and rolling back

No migration. What is new:

- **The switch is a company choice** (People → Settings → Company choices,
  "Leave requests are decided by the approval rules"), owner or admin only,
  off by default, audited. Turning it on is now something a customer can do,
  so the rollback steps above apply to any company that did.
- **The company's leave rule (RULE types) runs on the engine too** with the
  switch on. Its leave rows carry no `ruleId` (the engine has the steps), so
  an older API reads them as chain leave and decides them by the company's
  chain, not by the rule. Before rolling back such a company, after the two
  mandatory steps, either let its waiting RULE-type leave be decided first,
  or tell HR those requests now follow the company's chain until the
  roll-forward.
- **The type's auto-approval** is the engine's AUTO_APPROVED step; the
  leave row is approved as before (`autoApproved`, by "system"), so an older
  API reads it the same.
- **Reminders and the leave rule's hand-on** for leave on the engine come
  from the engine's dues job (`runApprovalDues`, every 15 minutes, woken by
  the scheduler). An older API's dues job reminds leave engine steps in its
  own words (the "Overdue: …" People notice) — one more reason for the
  mandatory close step.
- **The leave job refreshes who decides** leave waiting on the engine every
  hour (`runLeaveEngineRefresh`, inside the existing leave job): approvers
  away today, back, stand-ins starting or ending. A stand-in named in a
  company with more than 100 waiting leave requests is picked up there
  rather than in the request that named it.

### Attendance on the engine (workflow engine 2d, migration `20261120090000_attendance_on_engine`): deploying and rolling back

The migration adds one column, `PeopleSetting.attendanceOnEngine`, default
`false`. An older API never reads it.

- **Switch off (every company, the default):** attendance requests (missed
  punch, work from home, on duty, permission, shift change), overtime and
  comp-off, and field punches decide exactly as before, and nothing new is
  written. The deploy window and a rollback need nothing.
- **The switch is a company choice** (People → Settings → Company choices,
  "Attendance requests, overtime and field punches are decided by the
  approval rules"), owner or admin only, audited.

What a company with the switch on writes, and how an older API reads it:

- **Preset rules:** `ApprovalRule` rows with request types
  `ATTENDANCE:<kind>`, `OVERTIME`, `COMP_OFF` and `FIELD_PUNCH`, variant keys
  `preset:<KEY>`, made the first time each is needed. No older API reads a
  rule of those request types (its Approval rules screen lists only the
  types it knows).
- **A new request or field punch:** its row is written as before, and an
  `ApprovalRequest` with `sourceKind` `ATTENDANCE`, `OVERTIME` or
  `FIELD_PUNCH` opens beside it. The manager's step under "the manager, then
  HR" is still written on the row (`managerApprovedAt`), so the older API
  decides the row on the old path with the same people.
- **Before rolling back a company that has it on (do both, as for leave):**
  1. Switch it off:
     `UPDATE people."PeopleSetting" SET "attendanceOnEngine" = false WHERE "orgId" = '<id>';`
  2. Close its waiting engine requests:
     `SET clor.bypass = 'on'; UPDATE people."ApprovalStep" SET status = 'WITHDRAWN' WHERE status = 'WAITING' AND "requestId" IN (SELECT id FROM people."ApprovalRequest" WHERE "orgId" = '<id>' AND "sourceKind" IN ('ATTENDANCE', 'OVERTIME', 'FIELD_PUNCH') AND status = 'WAITING'); UPDATE people."ApprovalRequest" SET status = 'WITHDRAWN' WHERE "orgId" = '<id>' AND "sourceKind" IN ('ATTENDANCE', 'OVERTIME', 'FIELD_PUNCH') AND status = 'WAITING';`
  The rows themselves are untouched: the older API decides them on the old
  path. Step 2 matters most for a rollback to a release before 2c, which
  reads an engine request as an ordinary People request (it would list it
  on People → Approvals, remind its people, and "approve" it with no effect
  on the row). A release from 2c on leaves requests with a `sourceKind`
  alone, but closing them keeps the data tidy either way.
- **Rolling forward again.** A row whose engine request is no longer
  waiting is decided on the old path (never stuck). A row the older API
  decided closes its engine request when it is next read or decided. If the
  older API took the manager's step on the row, the newer API takes that
  step as the same person's on the engine before HR decides, and a
  rejection then is HR's (the whole company's), never the manager's again.
- **No reminders, no away hand-up, no new job.** Attendance had neither;
  the engine's dues job only closes an engine request whose row was decided
  elsewhere.

Nothing else needs undoing. Phase 3c stops the writes to the old manager
columns, once nothing is pending on the old path.

## Who can do what

- **Google Cloud:** the project owner is the owner's cloud account. Releases
  use that sign-in on the deploying Mac (`gcloud auth list`). Builds run as
  `clor-build`; the API runs as `clor-api-run`, the only account that can read
  the secrets.
- **Cloudflare:** wrangler is signed in on the deploying Mac. Custom domains
  and DNS are changed by the owner in the dashboard.
- **Nobody deploys from CI.** CI runs on the owner's Mac and holds no cloud
  credentials (`docs/CI-ON-MAC.md`).

## What is not here yet

Said plainly, so nobody assumes otherwise (`docs/LAUNCH-CHECKLIST.md` tracks them):

- Migrations run at container start with the API's own database role. A bad
  one stops every new instance from starting. Moving them to a step of their
  own before the deploy is planned.
- Staging has no background-job wake call.
- The settings in `deploy/cloudrun.service.yaml` are a record kept by hand;
  nothing compares the live service against it automatically.
