#!/bin/bash
# Runs ON the AWS server (as root). Restores the four Cloud SQL export files
# (gcloud sql export sql, as the nightly copies are) from the transfer bucket
# into the RDS database. Used for the rehearsal and for the real cutover.
#
#   ADMIN_SECRET_ARN=<DatabaseAdminSecret> restore-copies.sh <s3 folder, e.g. s3://bucket/rehearsal> [--replace]
#
# Without --replace it refuses if a clor_ database already exists; with it, the
# four databases are dropped and made again. Never run --replace once customers
# are served from this database.
#
# The exports carry no owners and no grants. Everything is restored AS
# clor_app, so clor_app owns the tables, as on Cloud SQL, where the same role
# runs the migrations. Row-level security is FORCEd on the tables, so owning
# them does not let the application skip a policy.
set -euo pipefail
SRC=${1:?usage: restore-copies.sh s3://bucket/folder [--replace]}
REPLACE=${2:-}
REGION=$(curl -s -H "X-aws-ec2-metadata-token: $(curl -s -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token)" http://169.254.169.254/latest/meta-data/placement/region)
export AWS_DEFAULT_REGION=$REGION
DBS="clor_main clor_payroll clor_people clor_platform"

param() { aws ssm get-parameter --name "/clor/prod/$1" --with-decryption --query Parameter.Value --output text; }
HOST=$(param DB_HOST)
APP_PW=$(param DB_PASSWORD)
# The administrator password's secret: the stack's DatabaseAdminSecret output.
: "${ADMIN_SECRET_ARN:?set ADMIN_SECRET_ARN to the DatabaseAdminSecret output of the stack}"
ADMIN=$(aws secretsmanager get-secret-value --secret-id "$ADMIN_SECRET_ARN" --query SecretString --output text)
ADMIN_USER=$(printf %s "$ADMIN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["username"])')
ADMIN_PW=$(printf %s "$ADMIN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')

W=/opt/clor/restore; rm -rf "$W"; mkdir -p "$W"
for d in $DBS; do aws s3 cp "$SRC/$d.sql.gz" "$W/$d.sql.gz" --only-show-errors; done

pg() { # pg <user> <password> <database> [psql args...]   (stdin is passed through)
  local u=$1 p=$2 d=$3; shift 3
  docker run --rm -i -e PGPASSWORD="$p" -e PGSSLMODE=require postgres:18-alpine \
    psql -h "$HOST" -U "$u" -d "$d" -v ON_ERROR_STOP=1 -X -q "$@"
}

have=$(pg "$ADMIN_USER" "$ADMIN_PW" postgres -Atc "select count(*) from pg_database where datname like 'clor\_%'")
if [ "$have" != 0 ]; then
  [ "$REPLACE" = --replace ] || { echo "$have clor_ database(s) already exist. Pass --replace to drop and restore them." >&2; exit 1; }
  for d in $DBS; do pg "$ADMIN_USER" "$ADMIN_PW" postgres -c "drop database if exists $d with (force)"; done
fi

# The application role: may create databases and roles (as on Cloud SQL), is
# not a superuser and cannot bypass row-level security.
pg "$ADMIN_USER" "$ADMIN_PW" postgres <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'clor_app') then
    create role clor_app login createdb createrole;
  end if;
end \$\$;
alter role clor_app password '$APP_PW';
SQL

for d in $DBS; do
  pg clor_app "$APP_PW" postgres -c "create database $d"
  # Dropped from the file: the one grant to Cloud SQL's own role, which does not exist here.
  gunzip -c "$W/$d.sql.gz" | grep -v 'cloudsqlsuperuser' | pg clor_app "$APP_PW" "$d"
  echo "$d: $(pg clor_app "$APP_PW" "$d" -Atc "select count(*) from pg_tables where schemaname='public'") tables, $(pg clor_app "$APP_PW" "$d" -Atc "select count(*) from pg_policies") policies, $(pg clor_app "$APP_PW" "$d" -Atc "select pg_size_pretty(pg_database_size(current_database()))")"
done
rm -rf "$W"
echo "restored from $SRC"
