# Deploying CLOR

One host: Caddy in front, the API under systemd, PostgreSQL beside it, and the
frontend as static files. No Docker — the box has 954 MB of RAM and a Vite
build peaks well above it, so the frontend is built on the deploying machine
and only its output is shipped.

This file describes what is actually running. It previously described a Docker
stack that production has never used, which is worse than describing nothing:
somebody following it would have taken backups of a volume that does not exist.

## The shape of it

| Piece | Where |
| --- | --- |
| Frontend (static) | `/opt/clor/web`, served by Caddy |
| API | `/opt/clor/server`, `clor-api.service`, listening on 127.0.0.1:4001 |
| Database | PostgreSQL 16, `clor`, localhost only |
| Environment | `/opt/clor/.env`, mode 600 |
| Backups | `/var/backups/clor`, nightly at 02:30 |
| Deploy log | `/opt/clor/deploy.log` |

One database, one schema per application — `accounting`, `payroll`, `people`.
The boundary is the schema, not the server, so one `pg_dump` is consistent
across every app. Three databases cannot be dumped to the same instant, and a
salary journal that is in one archive and not the other is a set of books that
does not balance.

## Deploying

```bash
./deploy.sh          # frontend only — the common case, a few seconds
./deploy.sh --api    # frontend and API: installs, migrates, rebuilds, restarts
./deploy.sh --status # what is running, and who is deploying
./deploy.sh --unlock # clear a lock left by a deployer that died mid-run
```

One deployment at a time: the lock is taken **on the server**, which is the
only place two deploying machines can both see it.

`--api` does, in order: take a `pg_dump`, install with `npm ci`, generate the
three Prisma clients, run the pre-deploy check, apply migrations, grant the
application role, top up Owner permissions, build, restart.

## The on-site connector (Cloud Run image)

Connectors on customers' networks update themselves only to a build signed
with CLOR's Ed25519 key, and that key stays on the deploying machine
(`~/.config/clor/agent-signing.key`, mode 600, never in a repository or an
image). So before `gcloud builds submit`, build and sign the connector:

```bash
cd server && npm run agent:build && AGENT_SIGNING_KEY_FILE=$HOME/.config/clor/agent-signing.key npm run agent:sign
```

That writes `server/dist-agent/clor-agent.cjs` with `.sig` and `.sha256`
beside it (git ignores the folder; the upload and the Docker build include
it). The image serves the signed file at `/agent/v1/download` and its
signature at `/agent/v1/download.sig`. Skip this and the image builds the
connector itself, unsigned: nothing breaks, but no connector in the field will
update to it. Lose the key and a new one means a new public key in
`server/agent/src/signing.ts`, which connectors already out there do not
have — they would need reinstalling by hand.

## Roles, and which one does what

| Role | Used by | May |
| --- | --- | --- |
| `postgres` | backups, and fixing the two attributes below | everything |
| `clor_owner` | migrations, operator scripts | own and alter the schemas |
| `clor_app` | the API, every request | read and write rows, nothing else |

`clor_app` is `NOSUPERUSER NOBYPASSRLS`, and that is load-bearing. PostgreSQL
skips row-level security entirely for a superuser or a `BYPASSRLS` role —
whatever the table says — so an application connecting as either would carry a
full set of policies and be protected by none of them.
`server/scripts/provisionAppRole.mjs` checks this on every deploy and refuses
to continue if it is ever untrue.

Backups run as `postgres` for the opposite reason: every tenant table has
`FORCE ROW LEVEL SECURITY`, which subjects even the owner to its own policies,
and `pg_dump` as the owner fails outright rather than dumping half a table.

## Background jobs on Cloud Run (Cloud Scheduler wake call)

The API scales to zero and gets CPU only while it serves a request, so the jobs
started in `server/src/index.ts` do not run on their timers when nobody is
using the app. That covers leave hand-on to HR, the leave digest, lapse
notices, dated changes, the People outbox, approval reminders, recurring
invoices and the rest. Cloud Scheduler wakes them: every 10 minutes it posts
to `/api/internal/jobs/tick`, which runs each job's tick inside the request
and waits for it (`server/src/services/jobRegistry.ts`).

- **Once per period:** each job runs at most once per its own interval. The
  lease stops two instances from running it, and the registry stops one
  instance from running it twice. Waking a job often is safe.
- **After downtime:** what is due is read from the database, so the first wake
  catches up on what was missed.
- **Retries:** a job that throws makes the call answer 500, and Cloud Scheduler
  retries it with backoff. A job that runs past 4 minutes is reported as
  timed out and keeps running under its lease.
- **Off by default:** without `JOBS_TOKEN` the route does not exist (404).

Set it up once per service (production shown; repeat with `clor-api-staging`
and its own token):

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

The call goes through `api.clor.in`, so the Worker adds the edge header. Cloud
Run's request timeout must be at least 300s, which is the default.

## Backups

Installed on the server as `/usr/local/bin/clor-backup`, run by cron at 02:30:

```
30 2 * * * /usr/local/bin/clor-backup --verify >> /var/log/clor-backup.log 2>&1
```

`--verify` restores the archive it has just written into a scratch database and
compares its row counts against the live one, table by table. An archive nobody
has restored is a file of unknown value, and the moment you find out is the
moment you can least afford to.

Restoring is deliberately beside the live database, never over it:

```bash
/usr/local/bin/clor-backup --restore /var/backups/clor/clor-<stamp>.sql.gz clor_restored
# look at it, then swap:
sudo -u postgres psql -c 'ALTER DATABASE clor RENAME TO clor_old'
sudo -u postgres psql -c 'ALTER DATABASE clor_restored RENAME TO clor'
sudo systemctl restart clor-api
```

## Schema changes

Migrations are versioned under `server/prisma/*/migrations` and applied by
`server/scripts/migrate.ts` as `clor_owner`. Before deploying one, run the
pre-deploy check against the live database — it names anything that would be
lost and exits 1 when something really would be:

```bash
ssh ubuntu@$HOST 'cd /opt/clor/server && set -a && . /opt/clor/.env && set +a && npx tsx scripts/preflight.ts'
```

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

### Payroll on the engine (workflow engine 3a, migration `20261121090000_payroll_on_engine`): deploying and rolling back

The migration adds one column, `PeopleSetting.payrollOnEngine`, default `false`. An older API never reads it.

- **Switch off (every company, the default):** loans, salary revisions and final settlements are approved exactly as
  before, and nothing new is written. The deploy window and a rollback need nothing.
- **The switch is a company choice** (People → Settings → Company choices, "Loans, salary revisions and final
  settlements are decided by the approval rules"), owner or admin only, audited.
- **One change with the switch off too:** approving a loan claims the loan before its schedule is written, so two
  approvals at once write one schedule and only the one that moved it is recorded. Same answer to both callers as
  before.

What a company with the switch on writes, and how an older API reads it:

- **Preset rules:** `ApprovalRule` rows with request types `LOAN`, `SALARY_REVISION`, `FINAL_SETTLEMENT`, variant key
  `preset:PAYROLL`, made the first time each is needed. No older API reads a rule of those request types.
- **A new loan, a revision sent for approval, a new settlement:** the Payroll row is written as before, then an
  `ApprovalRequest` with `sourceKind` `LOAN`, `SALARY_REVISION` or `FINAL_SETTLEMENT` opens beside it. Payroll's rows,
  states and checks are unchanged, so an older API approves the row on the old path with the same people.
- **Before rolling back a company that has it on:**
  1. Switch it off: `UPDATE people."PeopleSetting" SET "payrollOnEngine" = false WHERE "orgId" = '<id>';`
  2. Close its waiting engine requests:
     `SET clor.bypass = 'on'; UPDATE people."ApprovalStep" SET status = 'WITHDRAWN' WHERE status = 'WAITING' AND "requestId" IN (SELECT id FROM people."ApprovalRequest" WHERE "orgId" = '<id>' AND "sourceKind" IN ('LOAN', 'SALARY_REVISION', 'FINAL_SETTLEMENT') AND status = 'WAITING'); UPDATE people."ApprovalRequest" SET status = 'WITHDRAWN' WHERE "orgId" = '<id>' AND "sourceKind" IN ('LOAN', 'SALARY_REVISION', 'FINAL_SETTLEMENT') AND status = 'WAITING';`
  Step 2 matters most for a rollback to a release before 2c, which reads an engine request as an ordinary People
  request. A release from 2c on leaves requests with a `sourceKind` alone.
- **Rolling forward again.** A row whose engine request is no longer waiting is approved on the old path (never
  stuck). A row the older API approved meanwhile has its waiting request brought in line when it is next approved or
  rejected, or by the engine’s dues job once its step is two working days old, as approved by the person Payroll
  names as approver.
- **No notices, no reminders, no new job.** Payroll sends none for these today.

## A first-time setup, from nothing

```bash
sudo apt-get install -y postgresql postgresql-client
sudo -u postgres psql -c "CREATE ROLE clor_owner LOGIN CREATEROLE PASSWORD '<owner password>'"
sudo -u postgres psql -c "CREATE DATABASE clor OWNER clor_owner"
sudo -u postgres psql -c "GRANT SET ON PARAMETER session_replication_role TO clor_owner"
sudo -u postgres psql -d clor <<'SQL'
CREATE SCHEMA IF NOT EXISTS accounting AUTHORIZATION clor_owner;
CREATE SCHEMA IF NOT EXISTS payroll    AUTHORIZATION clor_owner;
CREATE SCHEMA IF NOT EXISTS people     AUTHORIZATION clor_owner;
REVOKE ALL ON DATABASE clor FROM PUBLIC;
SQL
```

Then write `/opt/clor/.env` (mode 600) with `DATABASE_URL`,
`PAYROLL_DATABASE_URL`, `PEOPLE_DATABASE_URL` — each with its own `?schema=` —
plus `PGADMIN_URL`, `CLOR_APP_PASSWORD`, `CLOR_SCHEMAS` and `CLOR_DATABASES`,
and run `./deploy.sh --api`. The application role is created by the deploy.

`GRANT SET ON PARAMETER session_replication_role` is only needed to import an
existing database with `server/scripts/migrateSqliteToPostgres.mjs`, which
suspends foreign-key checks for one transaction so tables can be copied in any
order. It can be revoked afterwards.

## Tuning for a small box

`/etc/postgresql/16/main/conf.d/clor.conf` trims the defaults, which assume a
machine that does nothing else: `shared_buffers = 128MB`,
`effective_cache_size = 384MB`, `max_connections = 30`,
`listen_addresses = 'localhost'`, and `lock_timeout`/
`idle_in_transaction_session_timeout` so a request nobody is still waiting for
cannot hold a lock forever.
