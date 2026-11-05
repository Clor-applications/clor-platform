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
# It creates databases clorbk_*, roles clorbk_* and evil_*, and removes them
# all at the end. It refuses any host that is not this machine. Needs psql,
# pg_dump, age, ssh-keygen, python3 and curl.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BACKUP="$HERE/clor-backup-offsite.sh"
RESTORE="$HERE/clor-restore-offsite.sh"

case "${PGHOST:-}" in localhost|127.0.0.1|::1|/*) ;; *) echo "test-local: PGHOST must be this machine (got '${PGHOST:-}')" >&2; exit 2 ;; esac
for t in psql pg_dump age age-keygen ssh-keygen python3 curl; do command -v "$t" >/dev/null || { echo "test-local: $t missing" >&2; exit 2; }; done
psql -d postgres -qtAXc 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user' | grep -qx t \
  || { echo "test-local: PGUSER must be a superuser of the throwaway server" >&2; exit 2; }

SU="$PGUSER"
DBS="clorbk_one clorbk_two"
pass=0 failed=0 STANDIN_PID=""
W=""
cleanup() {
  [ -n "$STANDIN_PID" ] && kill "$STANDIN_PID" 2>/dev/null
  for d in $(PGUSER="$SU" psql -d postgres -qtAXc "SELECT datname FROM pg_database WHERE datname LIKE 'clorbk\_%'"); do
    PGUSER="$SU" psql -d postgres -qXc "DROP DATABASE \"$d\"" >/dev/null
  done
  for r in $(PGUSER="$SU" psql -d postgres -qtAXc "SELECT rolname FROM pg_roles WHERE rolname LIKE 'clorbk\_%' OR rolname LIKE 'evil%'"); do
    PGUSER="$SU" psql -d postgres -qXc "DROP ROLE \"$r\"" >/dev/null 2>&1
  done
  [ -n "$W" ] && rm -rf "$W"
}
trap cleanup EXIT
ok()   { pass=$((pass + 1)); echo "  ok   $1"; }
fail() { failed=$((failed + 1)); echo "  FAIL $1" >&2; }
# expect_fail "name" "text the error must contain" command...
expect_fail() {
  local name="$1" want="$2"; shift 2
  if "$@" > "$W/out" 2>&1; then fail "$name: succeeded, should have refused"; return; fi
  if grep -q -- "$want" "$W/out"; then ok "$name"; else sed 's/^/       | /' "$W/out" | tail -5 >&2; fail "$name: refused for the wrong reason"; fi
}
dbs_like() { PGUSER="$SU" psql -d postgres -qtAXc "SELECT count(*) FROM pg_database WHERE datname LIKE '$1'"; }

# ------------------------------------------------------------------ fixture
# The production pattern in miniature: a non-superuser owner, FORCE ROW LEVEL
# SECURITY on tenant tables (one of them partitioned), policies in the exact
# form the migrations write, a reader that is neither owner nor superuser, and
# a restorer that can create databases but is not a superuser.
cleanup; W="$(mktemp -d "${TMPDIR:-/tmp}/clorbk-test.XXXXXX")"; chmod 700 "$W"
psql -d postgres -qX -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE ROLE clorbk_owner LOGIN PASSWORD 'local-test-owner' CREATEDB;
CREATE ROLE clorbk_reader LOGIN PASSWORD 'local-test-reader';
GRANT pg_read_all_data TO clorbk_reader;
CREATE ROLE clorbk_restorer LOGIN PASSWORD 'local-test-restorer' CREATEDB;
GRANT clorbk_owner TO clorbk_restorer;
CREATE DATABASE clorbk_one OWNER clorbk_owner;
CREATE DATABASE clorbk_two OWNER clorbk_owner;
SQL
for d in $DBS; do
  PGUSER=clorbk_owner PGPASSWORD=local-test-owner psql -d "$d" -qX -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE TABLE "Employee" (id serial PRIMARY KEY, "orgId" text NOT NULL, name text, salary numeric(12,2));
CREATE TABLE "Plan" (key text PRIMARY KEY);
CREATE TABLE "Ledger" (id int, "orgId" text NOT NULL) PARTITION BY LIST ("orgId");
CREATE TABLE "Ledger_a" PARTITION OF "Ledger" FOR VALUES IN ('org0', 'org1');
CREATE TABLE "Ledger_b" PARTITION OF "Ledger" DEFAULT;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['Employee', 'Ledger', 'Ledger_a', 'Ledger_b'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant ON %I USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))$p$, t);
  END LOOP; END $$;
SET clor.bypass = 'on';
INSERT INTO "Employee"("orgId", name, salary)
  SELECT 'org' || (g % 3), CASE WHEN g = 7 THEN E'two\nlines\tand a tab \\ slash' ELSE 'Person ' || g END, 1000 + g
  FROM generate_series(1, 250) g;
INSERT INTO "Plan" VALUES ('free'), ('pro');
INSERT INTO "Ledger" SELECT g, 'org' || (g % 4) FROM generate_series(1, 90) g;
SQL
done
age-keygen -o "$W/owner.key" 2>/dev/null; age-keygen -o "$W/spare.key" 2>/dev/null; age-keygen -o "$W/other.key" 2>/dev/null
ssh-keygen -q -t ed25519 -N '' -C clor-backup-test -f "$W/signing" && ssh-keygen -q -t ed25519 -N '' -C impostor -f "$W/impostor"
echo "clor-backup-job namespaces=\"clor-backup\" $(cat "$W/signing.pub")" > "$W/allowed_signers"
echo "test-local: fixture ready"

reader()   { PGUSER=clorbk_reader PGPASSWORD=local-test-reader "$@"; }
restorer() { PGUSER=clorbk_restorer PGPASSWORD=local-test-restorer CLOR_RESTORE_DATABASES="$DBS" "$@"; }
owner_sql() { PGUSER=clorbk_owner PGPASSWORD=local-test-owner psql -d "$1" -qX -c "$2" >/dev/null; }
export CLOR_BACKUP_DATABASES="$DBS" CLOR_BACKUP_DB_PATTERN='^clorbk_' CLOR_BACKUP_LABEL=test CLOR_BACKUP_DEST="file://$W/bucket"
export CLOR_BACKUP_RECIPIENTS="$(age-keygen -y "$W/owner.key") $(age-keygen -y "$W/spare.key")"
export CLOR_BACKUP_SIGNING_KEY_FILE="$W/signing"
SIGN=(--signers "$W/allowed_signers")

[ "$(reader psql -d clorbk_one -qtAXc 'SELECT count(*) FROM "Employee"')" = 0 ] && ok "fixture: RLS hides every row from the reader without clor.bypass" || fail "fixture: RLS is not hiding rows"

# ------------------------------------------------------------------ refusals before any dump
expect_fail "no recipients: refuses to write an unencrypted backup" "unencrypted" \
  env CLOR_BACKUP_RECIPIENTS= PGUSER=clorbk_reader PGPASSWORD=local-test-reader bash "$BACKUP"
expect_fail "a private key given as recipient is refused" "PRIVATE key" \
  env CLOR_BACKUP_RECIPIENTS="$(grep AGE-SECRET "$W/owner.key")" PGUSER=clorbk_reader PGPASSWORD=local-test-reader bash "$BACKUP"
expect_fail "unknown destination is refused" "CLOR_BACKUP_DEST" \
  env CLOR_BACKUP_DEST=s3://x PGUSER=clorbk_reader PGPASSWORD=local-test-reader bash "$BACKUP"
expect_fail "no signing key: refuses to write an unsigned backup" "signing key" \
  env CLOR_BACKUP_SIGNING_KEY_FILE= PGUSER=clorbk_reader PGPASSWORD=local-test-reader bash "$BACKUP"

# ------------------------------------------------------------------ round trip
if reader bash "$BACKUP" > "$W/backup.log" 2>&1; then
  grep -q 'clorbk_one: 4 tables, 342 rows' "$W/backup.log" && ok "backup as a non-superuser reader sees every row through FORCE RLS, partitions included" \
    || { cat "$W/backup.log"; fail "backup did not see every row"; }
else cat "$W/backup.log"; fail "backup failed"; fi
ARCHIVE="$(find "$W/bucket/frequent" -name '*.tar.age' 2>/dev/null | head -1)"
[ -n "$ARCHIVE" ] && [ -f "$ARCHIVE.sig" ] && ok "archive and its signature written under frequent/" || fail "no frequent/ archive with a .sig"
n_daily=$(find "$W/bucket/daily" -name '*.tar.age' 2>/dev/null | wc -l | tr -d ' ')
n_month=$(find "$W/bucket/monthly" -name '*.tar.age' 2>/dev/null | wc -l | tr -d ' ')
[ "$n_daily" = 1 ] && [ "$n_month" = 1 ] && ok "the first successful run of the day and of the month also writes daily/ and monthly/" || fail "daily=$n_daily monthly=$n_month after the first run (want 1 and 1)"
reader bash "$BACKUP" > "$W/backup2.log" 2>&1 || { cat "$W/backup2.log"; fail "second backup failed"; }
n_freq=$(find "$W/bucket/frequent" -name '*.tar.age' | wc -l | tr -d ' ')
n_daily=$(find "$W/bucket/daily" -name '*.tar.age' 2>/dev/null | wc -l | tr -d ' ')
[ "$n_freq" = 2 ] && [ "$n_daily" = 1 ] && ok "a later run the same day writes frequent/ only, and still succeeds" || fail "frequent=$n_freq daily=$n_daily after the second run (want 2 and 1)"
if [ -n "$ARCHIVE" ] && ! tar -tf "$ARCHIVE" >/dev/null 2>&1 && ! grep -aq 'Person 1' "$ARCHIVE"; then ok "archive is not readable without the key"; else fail "archive is readable without the key"; fi

expect_fail "restore refuses to run as a superuser (a forged dump could run COPY ... TO PROGRAM)" "superuser" \
  env CLOR_RESTORE_DATABASES="$DBS" bash "$RESTORE" "$ARCHIVE" --identity "$W/owner.key" "${SIGN[@]}" --suffix _r0

if restorer bash "$RESTORE" "$ARCHIVE" --identity "$W/owner.key" "${SIGN[@]}" --suffix _r1 > "$W/restore.log" 2>&1 && grep -q 'every count matches' "$W/restore.log"; then
  [ "$(PGUSER="$SU" psql -d clorbk_one_r1 -qtAXc "SELECT name FROM \"Employee\" WHERE id = 7")" = "$(printf 'two\nlines\tand a tab \\ slash')" ] \
    && ok "restore as a non-superuser: every count matches (partitioned table too), awkward text intact" || fail "a value with a newline, tab and backslash did not survive"
else cat "$W/restore.log"; fail "restore as a non-superuser failed"; fi
for d in clorbk_one_r1 clorbk_two_r1; do PGUSER="$SU" psql -d postgres -qXc "DROP DATABASE IF EXISTS $d" >/dev/null; done

if restorer bash "$RESTORE" "$ARCHIVE" --identity "$W/spare.key" "${SIGN[@]}" --suffix _r2 --owner clorbk_owner --drop-after > "$W/restore2.log" 2>&1 \
   && [ "$(dbs_like '%\_r2')" = 0 ]; then ok "the spare key also decrypts; --owner and --drop-after work"; else cat "$W/restore2.log"; fail "spare key / --owner / --drop-after"; fi

# ------------------------------------------------------------------ restore refusals
expect_fail "wrong key is refused" "could not decrypt" restorer bash "$RESTORE" "$ARCHIVE" --identity "$W/other.key" "${SIGN[@]}" --suffix _r3
PGUSER="$SU" psql -d postgres -qXc 'CREATE DATABASE clorbk_one_r3b' >/dev/null
expect_fail "an existing database is never restored over" "already exists" restorer bash "$RESTORE" "$ARCHIVE" --identity "$W/owner.key" "${SIGN[@]}" --suffix _r3b
[ "$(dbs_like 'clorbk\_one\_r3b')" = 1 ] && ok "the existing database was left alone" || fail "the existing database was dropped"
PGUSER="$SU" psql -d postgres -qXc 'DROP DATABASE clorbk_one_r3b' >/dev/null
cp "$ARCHIVE" "$W/tampered.tar.age"; cp "$ARCHIVE.sig" "$W/tampered.tar.age.sig"
size=$(wc -c < "$W/tampered.tar.age"); printf 'X' | dd of="$W/tampered.tar.age" bs=1 seek=$((size / 2)) conv=notrunc 2>/dev/null
expect_fail "a damaged archive is refused" "signature" restorer bash "$RESTORE" "$W/tampered.tar.age" --identity "$W/owner.key" "${SIGN[@]}" --suffix _r4
cp "$ARCHIVE" "$W/nosig.tar.age"
expect_fail "an archive with no signature is refused" "signature" restorer bash "$RESTORE" "$W/nosig.tar.age" --identity "$W/owner.key" "${SIGN[@]}" --suffix _r4

# Forged archives: anyone holding the PUBLIC age key can make one, and anyone
# who can write to the bucket can plant it. forge DIR OUT [signing-key]
mkdir "$W/good"; age -d -i "$W/owner.key" "$ARCHIVE" | tar -C "$W/good" -xf -
forge() {
  tar -C "$1" -cf - . | age -r "$(age-keygen -y "$W/owner.key")" -o "$2"
  [ -n "${3:-}" ] && ssh-keygen -q -Y sign -f "$3" -n clor-backup "$2" >/dev/null 2>&1
  return 0
}
forge "$W/good" "$W/impostor.tar.age" "$W/impostor"
expect_fail "an archive signed by anyone but the job is refused" "signature" restorer bash "$RESTORE" "$W/impostor.tar.age" --identity "$W/owner.key" "${SIGN[@]}" --suffix _r5

# The next ones are signed with the job's real key: what a stolen signing key
# could produce. Names, paths and SQL must still be refused.
cp -R "$W/good" "$W/inj"
sed -i.bak 's/^databases=.*/databases=clorbk_one clorbk_two x";CREATE ROLE evil_super SUPERUSER LOGIN;--/' "$W/inj/MANIFEST"; rm -f "$W/inj/MANIFEST.bak"
forge "$W/inj" "$W/inj.tar.age" "$W/signing"
expect_fail "a database name outside the expected set is refused" "unexpected database" restorer bash "$RESTORE" "$W/inj.tar.age" --identity "$W/owner.key" "${SIGN[@]}" --suffix _r6
[ "$(PGUSER="$SU" psql -d postgres -qtAXc "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'evil%'")" = 0 ] && ok "the forged MANIFEST created no role" || fail "the forged MANIFEST created a role"
cp -R "$W/good" "$W/inj2"
sed -i.bak 's/^databases=.*/databases=clorbk_one clorbk_two/; s/^sha256\.clorbk_one=/sha256.clorbk_one=x/' "$W/inj2/MANIFEST"; rm -f "$W/inj2/MANIFEST.bak"
printf 'sha256.clor.*=evil\n' >> "$W/inj2/MANIFEST"
forge "$W/inj2" "$W/inj2.tar.age" "$W/signing"
expect_fail "manifest keys are matched literally, not as patterns" "checksum" restorer bash "$RESTORE" "$W/inj2.tar.age" --identity "$W/owner.key" "${SIGN[@]}" --suffix _r6
mkdir "$W/sym"; cp "$W/good/MANIFEST" "$W/good/clorbk_two.dump" "$W/good/clorbk_two.rows" "$W/good/clorbk_one.rows" "$W/sym/"; ln -s /etc/passwd "$W/sym/clorbk_one.dump"
forge "$W/sym" "$W/sym.tar.age" "$W/signing"
expect_fail "a symlink inside the archive is refused" "not a plain file" restorer bash "$RESTORE" "$W/sym.tar.age" --identity "$W/owner.key" "${SIGN[@]}" --suffix _r7
mkdir "$W/extra"; cp "$W/good/"* "$W/extra/"; echo x > "$W/extra/evil.sh"
forge "$W/extra" "$W/extra.tar.age" "$W/signing"
expect_fail "an unexpected file inside the archive is refused" "unexpected file" restorer bash "$RESTORE" "$W/extra.tar.age" --identity "$W/owner.key" "${SIGN[@]}" --suffix _r7

cp -R "$W/good" "$W/forge"
awk -F'\t' 'BEGIN{OFS="\t"} $1 ~ /Employee/ {$2 = $2 + 1} {print}' "$W/forge/clorbk_two.rows" > "$W/forge/x" && mv "$W/forge/x" "$W/forge/clorbk_two.rows"
forge "$W/forge" "$W/forged.tar.age" "$W/signing"
expect_fail "a count that does not match is caught, table named" 'Employee' restorer bash "$RESTORE" "$W/forged.tar.age" --identity "$W/owner.key" "${SIGN[@]}" --suffix _r8
[ "$(dbs_like '%\_r8')" = 0 ] && ok "a failed verification removes the databases it created" || fail "failed restore left databases behind"

# Interrupted: the databases created so far must go, too.
( export PGUSER=clorbk_restorer PGPASSWORD=local-test-restorer CLOR_RESTORE_DATABASES="$DBS"
  exec bash "$RESTORE" "$ARCHIVE" --identity "$W/owner.key" "${SIGN[@]}" --suffix _r9 ) > "$W/r9.log" 2>&1 &
rpid=$!
for _ in $(seq 1 300); do [ "$(dbs_like 'clorbk\_one\_r9')" = 1 ] && break; sleep 0.1; done
kill -TERM "$rpid" 2>/dev/null; wait "$rpid"; rc=$?
if grep -q verified "$W/r9.log"; then fail "interrupt test: the restore finished before the signal"
elif [ "$rc" -ne 0 ] && [ "$(dbs_like '%\_r9')" = 0 ]; then ok "an interrupted restore removes the databases it created"
else fail "an interrupted restore left $(dbs_like '%\_r9') database(s) (exit $rc)"; fi

# ------------------------------------------------------------------ gs:// upload, against a local stand-in
port=$((40000 + RANDOM % 20000))
python3 -I "$HERE/gcs-standin.py" "$port" > "$W/standin.log" 2>&1 & STANDIN_PID=$!
for _ in $(seq 1 50); do curl -s "http://127.0.0.1:$port/_list" >/dev/null && break; sleep 0.1; done
gs() { reader env CLOR_BACKUP_DEST=gs://clor-backups-test CLOR_BACKUP_METADATA_URL="http://127.0.0.1:$1" CLOR_BACKUP_GCS_URL="http://127.0.0.1:$1" bash "$BACKUP"; }
if gs "$port" > "$W/gs1.log" 2>&1 && gs "$port" > "$W/gs2.log" 2>&1; then
  list="$(curl -s "http://127.0.0.1:$port/_list")"
  nf=$(printf '%s' "$list" | grep -o '"clor-backups-test/frequent/[^"]*\.tar\.age"' | wc -l | tr -d ' ')
  ns=$(printf '%s' "$list" | grep -o '\.tar\.age\.sig"' | wc -l | tr -d ' ')
  nd=$(printf '%s' "$list" | grep -o '"clor-backups-test/daily/[^"]*\.tar\.age"' | wc -l | tr -d ' ')
  [ "$nf" = 2 ] && [ "$nd" = 1 ] && [ "$ns" = 4 ] && ok "gs:// upload: two runs, two frequent/, one daily/ and one monthly/, each signed" \
    || { echo "$list" >&2; fail "gs:// objects: frequent=$nf daily=$nd sigs=$ns (want 2, 1, 4)"; }
else cat "$W/gs1.log" "$W/gs2.log" 2>/dev/null | tail -5; fail "gs:// upload failed"; fi
kill "$STANDIN_PID" 2>/dev/null; wait "$STANDIN_PID" 2>/dev/null
python3 -I "$HERE/gcs-standin.py" "$((port + 1))" --wrong-md5 > /dev/null 2>&1 & STANDIN_PID=$!
for _ in $(seq 1 50); do curl -s "http://127.0.0.1:$((port + 1))/_list" >/dev/null && break; sleep 0.1; done
expect_fail "gs:// upload: a stored MD5 that is not the archive's is refused" "MD5" gs "$((port + 1))"
kill "$STANDIN_PID" 2>/dev/null; wait "$STANDIN_PID" 2>/dev/null; STANDIN_PID=""

# ------------------------------------------------------------------ incomplete-dump guards
owner_sql clorbk_two "CREATE TABLE \"Secret\" (id int, \"orgId\" text); INSERT INTO \"Secret\" SELECT g, 'org1' FROM generate_series(1,300) g; ALTER TABLE \"Secret\" ENABLE ROW LEVEL SECURITY; ALTER TABLE \"Secret\" FORCE ROW LEVEL SECURITY"
owner_sql clorbk_two "CREATE POLICY t ON \"Secret\" USING (\"orgId\" = current_setting('clor.org_id', true))"
expect_fail "a policy without clor.bypass stops the backup" "Secret" reader bash "$BACKUP"
owner_sql clorbk_two "DROP POLICY t ON \"Secret\"; CREATE POLICY t ON \"Secret\" USING (current_setting('clor.bypass', true) = 'on' AND \"orgId\" = current_setting('clor.org_id', true))"
expect_fail "a policy that mentions clor.bypass but does not let it through stops the backup" "Secret" reader bash "$BACKUP"
owner_sql clorbk_two "DROP POLICY t ON \"Secret\"; CREATE POLICY t ON \"Secret\" TO clorbk_owner USING (current_setting('clor.bypass', true) = 'on' OR \"orgId\" = current_setting('clor.org_id', true))"
expect_fail "a bypass policy that does not apply to the backup role stops the backup" "Secret" reader bash "$BACKUP"
owner_sql clorbk_two "DROP POLICY t ON \"Secret\""
expect_fail "RLS with no policy at all stops the backup" "no policy lets the backup see rows" reader bash "$BACKUP"
owner_sql clorbk_two 'DROP TABLE "Secret"'
psql -d postgres -qXc 'CREATE DATABASE clorbk_three' >/dev/null
expect_fail "a new database the backup does not list stops it" "clorbk_three" reader bash "$BACKUP"
psql -d postgres -qXc 'DROP DATABASE clorbk_three' >/dev/null
psql -d postgres -qXc 'REVOKE pg_read_all_data FROM clorbk_reader' >/dev/null
expect_fail "a table the backup role cannot read stops the backup" "cannot read" reader bash "$BACKUP"
psql -d postgres -qXc 'GRANT pg_read_all_data TO clorbk_reader' >/dev/null
for d in $DBS; do owner_sql "$d" 'SET clor.bypass = on; TRUNCATE "Employee", "Plan", "Ledger"'; done
expect_fail "an all-empty database is refused as a silently failed backup" "every table is empty" reader bash "$BACKUP"

echo "test-local: $pass passed, $failed failed"
[ "$failed" = 0 ]
