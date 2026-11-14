#!/usr/bin/env bash
# One-time: the Console's own database on an existing Cloud SQL instance.
#
#   console/api/scripts/setup-database.sh <instance> <probe-database> [--keep-secrets]
#
#   <instance>        Cloud SQL instance, e.g. clor-pg
#   <probe-database>  a customer database on it, e.g. clor_platform: used only
#                     to prove the Console's role can read nothing there
#   --keep-secrets    store the Console's database URL in Secret Manager as
#                     console-database-url (and the owner's as
#                     console-database-owner-url). Without it nothing is
#                     stored and everything made is removed again: a rehearsal.
#
# What it makes: two plain roles (clor_console_owner owns the tables and runs
# migrations; clor_console_app is what the service connects as) and the
# database clor_console, closed to every other role. Nothing existing is
# changed.
#
# It needs an admin connection and the postgres password is not ours to reset,
# so it makes a temporary admin user through the Cloud SQL API, uses it for
# four statements, and deletes it at the end, whatever happens.
set -euo pipefail

INSTANCE=${1:?instance}
PROBE_DB=${2:?a customer database to probe}
KEEP=${3:-}
PROJECT=${CLOR_PROJECT:-clor-apps-511409}
REGION=${CLOR_REGION:-asia-south1}
PORT=${PROXY_PORT:-5499}
TMP_USER=console_setup_tmp
HERE=$(cd "$(dirname "$0")/.." && pwd)

umask 077
WORK=$(mktemp -d)
PROXY_PID=
cleanup() {
  [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null || true
  if gcloud sql users list --instance "$INSTANCE" --project "$PROJECT" --format='value(name)' | grep -qx "$TMP_USER"; then
    gcloud sql users delete "$TMP_USER" --instance "$INSTANCE" --project "$PROJECT" --quiet >/dev/null && echo "Temporary admin user removed." || echo "!! Could not remove $TMP_USER on $INSTANCE. Remove it by hand: gcloud sql users delete $TMP_USER --instance $INSTANCE --project $PROJECT"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

pw() { openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-40; }
pw > "$WORK/tmp"; pw > "$WORK/owner"; pw > "$WORK/app"

echo "== Temporary admin user on $INSTANCE"
gcloud sql users create "$TMP_USER" --instance "$INSTANCE" --project "$PROJECT" --password "$(cat "$WORK/tmp")" --quiet >/dev/null

echo "== Proxy on 127.0.0.1:$PORT"
cloud-sql-proxy --gcloud-auth --port "$PORT" "$PROJECT:$REGION:$INSTANCE" >"$WORK/proxy.log" 2>&1 &
PROXY_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do nc -z 127.0.0.1 "$PORT" 2>/dev/null && break; sleep 1; done

q() { # q <user> <password-file> <database> <sql...>
  local user=$1 file=$2 db=$3; shift 3
  PGPASSWORD=$(cat "$file") psql -h 127.0.0.1 -p "$PORT" -U "$user" -d "$db" -v ON_ERROR_STOP=1 -X -q "$@"
}

echo "== Roles and database"
q "$TMP_USER" "$WORK/tmp" postgres -v o="$(cat "$WORK/owner")" -v a="$(cat "$WORK/app")" <<'SQL'
CREATE ROLE clor_console_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'o';
CREATE ROLE clor_console_app   LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'a';
GRANT clor_console_owner TO CURRENT_USER;
CREATE DATABASE clor_console OWNER clor_console_owner;
REVOKE clor_console_owner FROM CURRENT_USER;
SQL

echo "== Close the database to everybody else; tables; grants"
q clor_console_owner "$WORK/owner" clor_console <<'SQL'
REVOKE ALL ON DATABASE clor_console FROM PUBLIC;
GRANT CONNECT ON DATABASE clor_console TO clor_console_app;
SQL
(cd "$HERE" && npm run -s build && CONSOLE_DATABASE_URL="postgresql://clor_console_owner:$(cat "$WORK/owner")@127.0.0.1:$PORT/clor_console" node dist/migrate.js)
q clor_console_owner "$WORK/owner" clor_console <<'SQL'
GRANT SELECT, INSERT, UPDATE ON console_member TO clor_console_app;
GRANT SELECT, INSERT ON console_audit_event TO clor_console_app;
GRANT USAGE ON SEQUENCE console_audit_event_id_seq TO clor_console_app;
SQL

echo "== Checks, as the role the service runs as"
q clor_console_app "$WORK/app" clor_console -At -c "SELECT 'console tables readable: ' || count(*) FROM console_member"
q clor_console_app "$WORK/app" clor_console -At -c "SELECT 'role: super=' || rolsuper || ' createrole=' || rolcreaterole || ' createdb=' || rolcreatedb || ' bypassrls=' || rolbypassrls || ' memberships=' || (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid) FROM pg_roles r WHERE rolname = current_user"
if q clor_console_app "$WORK/app" clor_console -c "UPDATE console_audit_event SET reason = 'x'" 2>/dev/null; then echo "!! the app role can change the log"; exit 1; else echo "log cannot be changed by the app role: ok"; fi
if q clor_console_app "$WORK/app" clor_console -c "DROP TABLE console_member" 2>/dev/null; then echo "!! the app role can drop tables"; exit 1; else echo "tables cannot be dropped by the app role: ok"; fi
# Criterion 6: nothing of a customer's is readable.
READABLE=$(q clor_console_app "$WORK/app" "$PROBE_DB" -At -c "SELECT count(*) FROM information_schema.tables t WHERE table_schema NOT IN ('pg_catalog','information_schema') AND has_table_privilege(current_user, quote_ident(table_schema)||'.'||quote_ident(table_name), 'SELECT')" 2>&1 || true)
echo "tables in $PROBE_DB the Console role can read: $READABLE (must be 0, or a refused connection)"
case "$READABLE" in 0|*"permission denied"*|*"not permitted"*) ;; *) echo "!! the Console role can read customer tables"; exit 1 ;; esac

if [ "$KEEP" = "--keep-secrets" ]; then
  echo "== Secrets"
  CONN="$PROJECT:$REGION:$INSTANCE"
  put() { # put <secret> <value>
    gcloud secrets describe "$1" --project "$PROJECT" >/dev/null 2>&1 || gcloud secrets create "$1" --project "$PROJECT" --replication-policy automatic --quiet >/dev/null
    printf '%s' "$2" | gcloud secrets versions add "$1" --project "$PROJECT" --data-file=- --quiet >/dev/null
    echo "stored $1"
  }
  put console-database-url "postgresql://clor_console_app:$(cat "$WORK/app")@localhost/clor_console?host=/cloudsql/$CONN"
  put console-database-owner-url "postgresql://clor_console_owner:$(cat "$WORK/owner")@localhost/clor_console?host=/cloudsql/$CONN"
else
  echo "== Rehearsal: removing what was made"
  q "$TMP_USER" "$WORK/tmp" postgres <<'SQL'
GRANT clor_console_owner TO CURRENT_USER;
DROP DATABASE clor_console;
DROP ROLE clor_console_app;
DROP ROLE clor_console_owner;
SQL
  echo "removed."
fi
echo "Done."
