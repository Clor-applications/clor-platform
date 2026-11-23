# CLOR on AWS

The API and the database on AWS in Mumbai (`ap-south-1`), in place of Cloud Run
and Cloud SQL. The web app, the website and `api.clor.in` stay on Cloudflare.

**Status: LIVE since 23 Nov 2026.** `api.clor.in` (the Worker) forwards to
`https://origin.clor.in`, the AWS server; the data is the Cloud SQL export
taken after Cloud Run was closed (345 tables, row counts equal table by
table). Cloud Run `clor-api` still exists with ingress `internal` and its
scheduler job paused: the fallback for one week, then to be deleted on the
owner's word. **Release with `scripts/release-aws.sh`, not `scripts/release.sh`**
(that one deploys to the closed Cloud Run service).

Going back within the fallback week loses what was written on AWS since:
`ORIGIN` in `deploy/cloudflare/api-proxy/wrangler.toml` back to the run.app
address and `wrangler deploy`; `gcloud run services update clor-api --ingress all`;
`gcloud scheduler jobs resume clor-api-jobs`.

Learnt in the rehearsal and the cutover:
- The image cannot be built on the server (the compiler runs out of memory
  on 2 GB). It is built on the Mac for `linux/amd64`, which needs Docker's
  x86 emulation (`docker run --privileged --rm tonistiigi/binfmt --install amd64`, once).
- The RDS administrator is not a superuser: it cannot drop a database
  `clor_app` owns. `restore-copies.sh --replace` drops them as `clor_app`.
- An API started against a copy runs its background jobs (29 job runs in a
  few minutes). For a rehearsal that is noise; never start one against a copy
  while the real one is still serving if a job could send mail twice.

## Why

Cloud Run was set to sleep when idle (first request after a quiet spell waited
for a cold start) and the database was Cloud SQL's smallest tier (shared CPU,
0.6 GB, 25 connections). Here the server never sleeps and the database has
2 vCPU, 1 GB and room for about 100 connections.

## What runs

| Part | What | About, per month |
|---|---|---|
| API server | EC2 `t3a.small` (2 vCPU, 2 GB), Docker: Caddy + the API image + the jobs wake call | $9 |
| Database | RDS PostgreSQL `db.t4g.micro`, 20 GB, nightly backup kept 7 days, restore to any minute | $18 |
| Disk, public address | 30 GB, one IPv4 | $7 |
| Image store, snapshots, one secret | ECR, RDS snapshots, Secrets Manager | $2 |
| **Total** | | **about $35** |

$1,000 of credits last about 29 months. Hourly prices read from the AWS price
list on 23 Nov 2026 ($0.021 database, about $0.012 server). The server is `t3a` (x86)
because Mumbai had no `t4g` (ARM) capacity in any zone that day; `t4g.small` is
a one-setting change later and the release script builds for whichever it is; set a budget alert (step 2). The bill is by the hour the machines exist, not by use. When real customers
arrive, set `DbInstanceClass=db.t4g.small` (2 GB, about $15 more a month).

Request path: browser, Cloudflare Worker `clor-api-proxy` (`api.clor.in`),
`https://origin.clor.in` (Caddy on the server), the API container, RDS.
The API still refuses anything that did not come through the Worker
(`EDGE_SECRET`), so nothing changes for the web app or the mobile apps.

Files in this folder: `clor.cloudformation.yaml` (everything AWS makes),
`docker-compose.yml`, `Caddyfile`, `api.env` (plain settings),
`clor-server.sh` (runs on the server). The release script is
`scripts/release-aws.sh`.

Not moved by this work, and still pointing at Google Cloud:
the Engineering Console (`clor-console`, reads Cloud Run and Cloud SQL status),
the Ops health page's Google readings (`server/src/routes/opsHealth.ts`),
the GitHub release and rollback workflows, and the monitoring alerts.

## Setting it up (once)

1. **AWS command line on the Mac.** Install it, then sign in to the AWS
   account that holds the credits, with region `ap-south-1`:
   `brew install awscli`, then `aws configure sso` (or `aws configure` with an
   access key of an administrator user).

2. **Budget alert**, so credits never run out unseen: AWS console, Billing,
   Budgets, a monthly cost budget of $40 with an email at 80%.

3. **Create everything:**

   ```bash
   aws cloudformation deploy --region ap-south-1 --stack-name clor --template-file deploy/aws/clor.cloudformation.yaml --capabilities CAPABILITY_NAMED_IAM
   ```

   About 15 minutes (the database is the slow part). Then read what it made:

   ```bash
   aws cloudformation describe-stacks --region ap-south-1 --stack-name clor --query 'Stacks[0].Outputs' --output table
   ```

4. **DNS (Cloudflare dashboard):** an `A` record `origin` pointing at
   `ApiPublicAddress`, **DNS only (grey cloud)**. Caddy gets its own
   certificate for `origin.clor.in` the first time it starts.

5. **Secrets.** Each one is a `SecureString` in AWS Parameter Store under
   `/clor/prod/`, with the same name and value it has in Google Secret Manager:
   `JWT_SECRET`, `MAIL_SECRET_KEY`, `EDGE_SECRET`, `JOBS_TOKEN`, `SMTP_USER`,
   `SMTP_PASS`, `CONSOLE_GRANT_PRIVATE_KEY`, and any other secret or private
   setting the Cloud Run service carries (compare with
   `gcloud run services describe clor-api --format=yaml`:
   `CLOR_OPERATOR_USER_IDS`, `CONSOLE_API_ORIGIN`, the `R2_*` file-store keys,
   `FILE_STORE`, and so on). Two are new:

   - `DB_HOST`: the `DatabaseHost` output.
   - `DB_PASSWORD`: a new password for the `clor_app` database user,
     **letters and digits only** (it goes into a connection address).

   `JWT_SECRET` and `MAIL_SECRET_KEY` must be the same values as today: a
   different `JWT_SECRET` signs everyone out, and a different `MAIL_SECRET_KEY`
   makes every stored mail and connector password unreadable.

## Moving the data (the cutover)

Do it once as a rehearsal, with production untouched (skip steps 1, 6 and 7),
and time it. Then for real, in a quiet hour:

1. **Stop writes.** Announce the window. Anything written to Cloud SQL after
   the copy starts is lost, so for the window make the Worker answer 503
   ("back in 20 minutes") instead of forwarding.
2. **Copy out** of Cloud SQL. The nightly copies are already exports of the
   four databases (`gs://clor-apps-511409-db-copies`, docs/BACKUP-AND-RESTORE.md).
   For the real cutover make fresh ones after writes have stopped:
   `gcloud sql export sql clor-pg gs://clor-apps-511409-db-copies/cutover/clor_main.sql.gz --database clor_main`,
   and the same for `clor_payroll`, `clor_people`, `clor_platform`.
3. **Send** the four files to a folder in the `TransferBucket`
   (`gcloud storage cp` to the Mac, then `aws s3 cp`).
4. **Restore** on the server (the only machine that can reach RDS), through
   Systems Manager: `ADMIN_SECRET_ARN=<DatabaseAdminSecret> ./restore-copies.sh s3://<TransferBucket>/<folder>`
   (`deploy/aws/restore-copies.sh`; `--replace` drops a rehearsal's databases
   first). It makes the `clor_app` role, restores everything as that role, so
   it owns the tables as on Cloud SQL, and prints tables, policies and size
   per database. The exports carry no owners or grants; row-level security
   policies come with them and are FORCEd, so the owner is still bound.
5. **Check before any customer sees it:** `scripts/release-aws.sh --stage`
   builds the image, runs the migrations (none should be pending) and starts
   the API against RDS; then compare row counts of the largest tables in both
   databases, and sign in through a temporary Worker route
   (`api-aws.clor.in` with `ORIGIN=https://origin.clor.in`).
6. **Switch:** `scripts/release-aws.sh --go --skip-web --skip-website`, then
   in `deploy/cloudflare/api-proxy/wrangler.toml` set
   `ORIGIN = "https://origin.clor.in"` and `wrangler deploy`. Check
   `https://api.clor.in/ready` and sign in on all six app addresses.
7. **Afterwards:** pause the Cloud Scheduler job `clor-api-jobs` (the server
   wakes its own jobs now). Keep Cloud Run and Cloud SQL as they are for a
   week. Going back within that week means pointing `ORIGIN` at the run.app
   address again, and loses whatever was written on AWS in between. After the
   week, on the owner's word: delete `clor-api`, `clor-console`, `clor-pg`,
   `clor-pg-staging` (take a final export first) and close billing.

## Releases from GitHub

`.github/workflows/release.yml` and `rollback.yml` run `scripts/release-aws.sh`
on GitHub's machines, which are x86 like the server, so the image is built
there natively and no Mac is needed. They sign in to AWS as the role
`clor-release` (the template's `ReleaseRole`), which only a run in this
repository's `production` or `production-rollback` environment can take.

One-time setup, in GitHub, Settings, Environments:

| Where | Name | Value |
|---|---|---|
| `production` and `production-rollback`, variable | `AWS_RELEASE_ROLE_ARN` | the stack's `ReleaseRoleArn` output |
| repository variable | `WRANGLER_VERSION` | an exact version, e.g. the Mac's (`wrangler --version`) |
| `production`, secrets | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | a token that may edit Cloudflare Pages; without it a release publishes the API only and says so |
| `production`, secret (optional) | `AGENT_SIGNING_KEY` | the connector signing key |

Both environments: `main` only, and a required reviewer. The rollback one
too, because on AWS it uses the same role as a release.

## Day to day

- Release: `scripts/release-aws.sh` (dry run), `--stage`, `--go`.
- Roll back: `scripts/release-aws.sh --rollback <sha7> --go`.
- Logs: Session Manager on `clor-api`, then
  `cd /opt/clor && docker compose logs --tail 200 app`.
- Restore the database: RDS console, `clor-pg`, Actions, "Restore to point in
  time" makes a second database; point `DB_HOST` at it.
- Bigger server or database: change `ApiInstanceType` or `DbInstanceClass`
  with the same `cloudformation deploy` command plus
  `--parameter-overrides DbInstanceClass=db.t4g.medium`. A few minutes of
  downtime. Raise the `DB_POOL_*` numbers in `api.env` with it.
