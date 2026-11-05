#!/usr/bin/env bash
# Proves clor-backup-offsite.sh and clor-restore-offsite.sh against a THROWAWAY
# local PostgreSQL: the round trip, and every way they must refuse.
#
#   PGHOST=127.0.0.1 PGPORT=55432 PGUSER=<superuser> deploy/backup/test-local.sh
#
# A throwaway server, for example:
#   initdb -D /tmp/clorpg -U pgadmin --auth=trust --locale=C
#   pg_ctl -D /tmp/clorpg -o "-p 55432 -k /tmp -c listen_addresses=localhost" -l /tmp/clorpg.log start
#
# It creates databases clorbk_one and clorbk_two, roles clorbk_owner and
# clorbk_reader, and removes all of them at the end. It refuses any host that
# is not this machine.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BACKUP="$HERE/clor-backup-offsite.sh"
RESTORE="$HERE/clor-restore-offsite.sh"

case "${PGHOST:-}" in localhost|127.0.0.1|::1|/*) ;; *) echo "test-local: PGHOST must be this machine (got '${PGHOST:-}')" >&2; exit 2 ;; esac
for t in psql age age-keygen pg_dump; do command -v "$t" >/dev/null || { echo "test-local: $t missing" >&2; exit 2; }; done
psql -d postgres -qtAXc 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user' | grep -qx t \
  || { echo "test-local: PGUSER must be a superuser of the throwaway server" >&2; exit 2; }

SU="$PGUSER"
W="$(mktemp -d "${TMPDIR:-/tmp}/clorbk-test.XXXXXX")"; chmod 700 "$W"
DBS="clorbk_one clorbk_two"
pass=0
cleanup() {
  export PGUSER="$SU"; unset PGPASSWORD
  for d in $(psql -d postgres -qtAXc "SELECT datname FROM pg_database WHERE datname LIKE 'clorbk\_%'"); do
    psql -d postgres -qXc "DROP DATABASE \"$d\"" >/dev/null
  done
  psql -d postgres -qXc 'DROP ROLE IF EXISTS clorbk_reader; DROP ROLE IF EXISTS clorbk_owner' >/dev/null 2>&1 || true
  rm -rf "$W"
}
trap cleanup EXIT
ok()   { pass=$((pass + 1)); echo "  ok   $1"; }
fail() { echo "  FAIL $1" >&2; exit 1; }
# expect_fail "name" "text the error must contain" command...
expect_fail() {
  local name="$1" want="$2"; shift 2
  if "$@" > "$W/out" 2>&1; then fail "$name: succeeded, should have refused"; fi
  grep -q -- "$want" "$W/out" || { cat "$W/out" >&2; fail "$name: refused for the wrong reason"; }
  ok "$name"
}

# ------------------------------------------------------------------ fixture
# The production pattern in miniature: a non-superuser owner, FORCE ROW LEVEL
# SECURITY on tenant tables, policies that allow clor.org_id or clor.bypass,
# and a reader that is neither owner nor superuser.
cleanup; W="$(mktemp -d "${TMPDIR:-/tmp}/clorbk-test.XXXXXX")"; chmod 700 "$W"
psql -d postgres -qX -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE ROLE clorbk_owner LOGIN PASSWORD 'local-test-owner' CREATEDB;
CREATE ROLE clorbk_reader LOGIN PASSWORD 'local-test-reader';
GRANT pg_read_all_data TO clorbk_reader;
CREATE DATABASE clorbk_one OWNER clorbk_owner;
CREATE DATABASE clorbk_two OWNER clorbk_owner;
SQL
for d in $DBS; do
  PGUSER=clorbk_owner PGPASSWORD=local-test-owner psql -d "$d" -qX -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE TABLE "Employee" (id serial PRIMARY KEY, "orgId" text NOT NULL, name text, salary numeric(12,2));
CREATE TABLE "Plan" (key text PRIMARY KEY);
ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Employee" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON "Employee" USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
SET clor.bypass = 'on';
INSERT INTO "Employee"("orgId", name, salary)
  SELECT 'org' || (g % 3), CASE WHEN g = 7 THEN E'two\nlines\tand a tab \\ slash' ELSE 'Person ' || g END, 1000 + g
  FROM generate_series(1, 250) g;
INSERT INTO "Plan" VALUES ('free'), ('pro');
SQL
done
age-keygen -o "$W/owner.key" 2>/dev/null; age-keygen -o "$W/spare.key" 2>/dev/null; age-keygen -o "$W/other.key" 2>/dev/null
echo "test-local: fixture ready"

reader() { PGUSER=clorbk_reader PGPASSWORD=local-test-reader "$@"; }
export CLOR_BACKUP_DATABASES="$DBS" CLOR_BACKUP_LABEL=test CLOR_BACKUP_DEST="file://$W/bucket"
export CLOR_BACKUP_RECIPIENTS="$(age-keygen -y "$W/owner.key") $(age-keygen -y "$W/spare.key")"

# The reader really is held back by the policies without the bypass.
[ "$(reader psql -d clorbk_one -qtAXc 'SELECT count(*) FROM "Employee"')" = 0 ] || fail "fixture: RLS is not hiding rows"
ok "fixture: RLS hides every row from the reader without clor.bypass"

# ------------------------------------------------------------------ refusals before any dump
expect_fail "no recipients: refuses to write an unencrypted backup" "unencrypted" \
  env CLOR_BACKUP_RECIPIENTS= PGUSER=clorbk_reader PGPASSWORD=local-test-reader bash "$BACKUP"
expect_fail "a private key given as recipient is refused" "PRIVATE key" \
  env CLOR_BACKUP_RECIPIENTS="$(grep AGE-SECRET "$W/owner.key")" PGUSER=clorbk_reader PGPASSWORD=local-test-reader bash "$BACKUP"
expect_fail "unknown destination is refused" "CLOR_BACKUP_DEST" \
  env CLOR_BACKUP_DEST=s3://x PGUSER=clorbk_reader PGPASSWORD=local-test-reader bash "$BACKUP"

# ------------------------------------------------------------------ round trip
reader bash "$BACKUP" > "$W/backup.log" || { cat "$W/backup.log"; fail "backup failed"; }
grep -q 'clorbk_one: 2 tables, 252 rows' "$W/backup.log" || { cat "$W/backup.log"; fail "backup did not see every row"; }
ok "backup as a non-superuser reader sees all 252 rows per database through FORCE RLS"
ARCHIVE="$(find "$W/bucket" -name '*.tar.age' | head -1)"
case "$ARCHIVE" in */daily/*|*/monthly/*|*/frequent/*) ok "archive written under a tier prefix" ;; *) fail "no tier prefix: $ARCHIVE" ;; esac
if tar -tf "$ARCHIVE" >/dev/null 2>&1 || grep -aq 'Person 1' "$ARCHIVE"; then fail "archive is readable without the key"; fi
ok "archive is not readable without the key"

bash "$RESTORE" "$ARCHIVE" --identity "$W/owner.key" --suffix _r1 > "$W/restore.log" || { cat "$W/restore.log"; fail "restore failed"; }
grep -q 'every count matches' "$W/restore.log" || fail "restore did not verify"
[ "$(psql -d clorbk_one_r1 -qtAXc "SELECT name FROM \"Employee\" WHERE id = 7")" = "$(printf 'two\nlines\tand a tab \\ slash')" ] \
  || fail "a value with a newline, tab and backslash did not survive"
ok "restore into new databases: every table's count matches, awkward text intact"

PGUSER=clorbk_owner PGPASSWORD=local-test-owner bash "$RESTORE" "$ARCHIVE" --identity "$W/spare.key" --suffix _r2 --owner clorbk_owner --drop-after > "$W/restore2.log" \
  || { cat "$W/restore2.log"; fail "restore as non-superuser owner failed"; }
ok "the spare key also decrypts; restore as a non-superuser owner (as on Cloud SQL) works and --drop-after cleans up"
psql -d postgres -qtAXc "SELECT 1 FROM pg_database WHERE datname = 'clorbk_one_r2'" | grep -q 1 && fail "--drop-after left a database"

# ------------------------------------------------------------------ restore refusals
expect_fail "wrong key is refused" "could not decrypt" bash "$RESTORE" "$ARCHIVE" --identity "$W/other.key" --suffix _r3
expect_fail "an existing database is never restored over" "already exists" bash "$RESTORE" "$ARCHIVE" --identity "$W/owner.key" --suffix _r1
cp "$ARCHIVE" "$W/tampered.tar.age"
size=$(wc -c < "$W/tampered.tar.age"); printf 'X' | dd of="$W/tampered.tar.age" bs=1 seek=$((size / 2)) conv=notrunc 2>/dev/null
expect_fail "a damaged archive is refused (age authenticates every chunk)" "could not decrypt" bash "$RESTORE" "$W/tampered.tar.age" --identity "$W/owner.key" --suffix _r4

# A manifest whose counts the restore cannot reproduce: the restore must name it and clean up.
mkdir "$W/forge"; age -d -i "$W/owner.key" "$ARCHIVE" | tar -C "$W/forge" -xf -
awk -F'\t' 'BEGIN{OFS="\t"} $1 ~ /Employee/ {$2 = $2 + 1} {print}' "$W/forge/clorbk_two.rows" > "$W/forge/x" && mv "$W/forge/x" "$W/forge/clorbk_two.rows"
tar -C "$W/forge" -cf - . | age -r "$(age-keygen -y "$W/owner.key")" -o "$W/forged.tar.age"
expect_fail "a count that does not match is caught, table named" 'Employee' bash "$RESTORE" "$W/forged.tar.age" --identity "$W/owner.key" --suffix _r5
psql -d postgres -qtAXc "SELECT 1 FROM pg_database WHERE datname LIKE '%\_r5'" | grep -q 1 && fail "failed restore left databases behind"
ok "a failed verification removes the databases it created"

# ------------------------------------------------------------------ incomplete-dump guards
PGUSER=clorbk_owner PGPASSWORD=local-test-owner psql -d clorbk_two -qXc \
  "CREATE TABLE \"Secret\" (id int, \"orgId\" text); ALTER TABLE \"Secret\" ENABLE ROW LEVEL SECURITY; ALTER TABLE \"Secret\" FORCE ROW LEVEL SECURITY; CREATE POLICY t ON \"Secret\" USING (\"orgId\" = current_setting('clor.org_id', true))" >/dev/null
expect_fail "a policy without clor.bypass stops the backup" "Secret" reader bash "$BACKUP"
PGUSER=clorbk_owner PGPASSWORD=local-test-owner psql -d clorbk_two -qXc 'DROP POLICY t ON "Secret"' >/dev/null
expect_fail "RLS with no policy at all stops the backup" "no policy lets the backup see rows" reader bash "$BACKUP"
PGUSER=clorbk_owner PGPASSWORD=local-test-owner psql -d clorbk_two -qXc 'DROP TABLE "Secret"' >/dev/null
psql -d postgres -qXc 'REVOKE pg_read_all_data FROM clorbk_reader' >/dev/null
expect_fail "a table the backup role cannot read stops the backup" "cannot read" reader bash "$BACKUP"
psql -d postgres -qXc 'GRANT pg_read_all_data TO clorbk_reader' >/dev/null
for d in $DBS; do PGUSER=clorbk_owner PGPASSWORD=local-test-owner psql -d "$d" -qXc 'SET clor.bypass = on; TRUNCATE "Employee", "Plan"' >/dev/null; done
expect_fail "an all-empty database is refused as a silently failed backup" "every table is empty" reader bash "$BACKUP"

echo "test-local: $pass checks passed"
