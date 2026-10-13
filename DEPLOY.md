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
