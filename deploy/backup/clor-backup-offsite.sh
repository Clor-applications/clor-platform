#!/usr/bin/env bash
# An encrypted, signed copy of every production database, off the database host.
#
# Production is Cloud SQL `clor-pg` (four databases: clor_main, clor_payroll,
# clor_people, clor_platform). Cloud SQL already keeps its own snapshots and
# point-in-time recovery, but those live and die with the instance and the
# project. This script is the copy kept outside them.
#
# It runs as a Cloud Run Job (deploy/backup/Dockerfile), started by Cloud
# Scheduler. It can also run on any machine that can reach the database.
#
# What it does, per run:
#   1. refuses to start unless the database list is the expected one and the
#      dump would be complete (see check_db);
#   2. pg_dump of each database (custom format, compressed);
#   3. counts the rows IN THE DUMP, table by table, into a manifest, and stops
#      if a table holds far fewer rows than PostgreSQL's own statistics say;
#   4. one tar of dumps + manifest, encrypted with age to the owner's PUBLIC
#      key(s). The private key never comes near this script or its host;
#   5. signs the encrypted archive (ssh-keygen -Y sign) with a key only the
#      job holds, so the restore can refuse an archive somebody else planted
#      (anyone with the public age key can make one);
#   6. packs archive and signature into one object, uploads it write-once and
#      checks the stored MD5 against the local one.
#
# Nothing unencrypted ever leaves the working directory, which is mode 700 and
# removed on exit.
#
# Settings (environment):
#   CLOR_BACKUP_RECIPIENTS        required. age public keys ("age1..."), space
#                                 or comma separated. Public keys are not secrets.
#   CLOR_BACKUP_SIGNING_KEY_FILE  required. OpenSSH ed25519 private key (a
#                                 Secret Manager secret mounted as a file).
#   CLOR_BACKUP_DEST              required. gs://BUCKET  or  file:///dir (tests)
#   PGHOST PGPORT PGUSER PGPASSWORD   the usual libpq settings. On Cloud Run:
#                                 PGHOST=/cloudsql/clor-apps-511409:asia-south1:clor-pg
#   CLOR_BACKUP_DATABASES         default: clor_main clor_payroll clor_people clor_platform
#   CLOR_BACKUP_DB_PATTERN        default ^clor_ . Every database on the server
#                                 matching it (and not CLOR_BACKUP_DB_IGNORE,
#                                 default _staging$) must be listed above, so a
#                                 new application database is not silently left out.
#   CLOR_BACKUP_LABEL             default: prod (goes into the object name)
#   CLOR_BACKUP_TZ                default: Asia/Kolkata (decides the day and month)
#
# Objects (the bucket's lifecycle rules delete by prefix, deploy/backup/lifecycle.json):
#   frequent/clor-prod-<UTC stamp>.clorbackup   every run                  kept 7 days
#   daily/clor-prod-<YYYY-MM-DD>.clorbackup     first SUCCESSFUL run of the day    35 days
#   monthly/clor-prod-<YYYY-MM>.clorbackup      first SUCCESSFUL run of the month  400 days
# A .clorbackup is an uncompressed tar of archive.tar.age and its signature
# archive.tar.age.sig, uploaded as one object. The daily and monthly names are fixed per day and
# per month and written only if absent (ifGenerationMatch=0), so a missed or
# failed run never costs the month its copy: the next good run takes it.
set -euo pipefail
umask 077
# Run by hand on a Mac, bsdtar would add ._<name> AppleDouble entries and
# LIBARCHIVE.xattr headers for any extended attribute (com.apple.provenance,
# for one). The restore refuses the unexpected ._ files, so a Mac-made backup
# would never restore. COPYFILE_DISABLE stops the ._ files; --no-xattrs on
# each tar below stops the headers. Both are harmless with GNU tar.
export COPYFILE_DISABLE=1

die() { echo "backup: FAILED: $*" >&2; exit 1; }
say() { echo "backup: $*"; }

DATABASES="${CLOR_BACKUP_DATABASES:-clor_main clor_payroll clor_people clor_platform}"
DB_PATTERN="${CLOR_BACKUP_DB_PATTERN:-^clor_}"
DB_IGNORE="${CLOR_BACKUP_DB_IGNORE:-_staging\$}"
LABEL="${CLOR_BACKUP_LABEL:-prod}"
DEST="${CLOR_BACKUP_DEST:-}"
RECIPIENTS="${CLOR_BACKUP_RECIPIENTS:-}"
SIGNING_KEY="${CLOR_BACKUP_SIGNING_KEY_FILE:-}"
TZNAME="${CLOR_BACKUP_TZ:-Asia/Kolkata}"
START_EPOCH="$(date +%s)"

for tool in pg_dump pg_restore psql age tar awk ssh-keygen openssl; do
  command -v "$tool" >/dev/null || die "$tool is not installed"
done

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
md5b64() { openssl dgst -md5 -binary "$1" | openssl base64; }
filesize() { wc -c < "$1" | tr -d ' '; }

# --------------------------------------------------------------- settings
# Never write an archive nobody can decrypt, and never write one in the clear.
[ -n "$RECIPIENTS" ] || die "CLOR_BACKUP_RECIPIENTS is not set; refusing to write an unencrypted backup"
AGE_ARGS=()
for r in ${RECIPIENTS//,/ }; do
  case "$r" in
    age1*) AGE_ARGS+=(-r "$r") ;;
    AGE-SECRET-KEY-*) die "CLOR_BACKUP_RECIPIENTS holds a PRIVATE key. Only the public key (age1...) belongs here; treat that private key as exposed" ;;
    *) die "not an age public key: $r" ;;
  esac
done
[ -n "$SIGNING_KEY" ] && [ -r "$SIGNING_KEY" ] \
  || die "CLOR_BACKUP_SIGNING_KEY_FILE is not set or not readable; refusing to write an unsigned backup (the signing key)"

case "$DEST" in
  gs://*|file://*) ;;
  *) die "CLOR_BACKUP_DEST must be gs://BUCKET or file:///dir (got '${DEST:-nothing}')" ;;
esac
for db in $DATABASES; do
  printf '%s' "$db" | grep -Eq '^[a-z_][a-z0-9_]*$' || die "not a plain database name: $db"
done
FIRST_DB="${DATABASES%% *}"

# --------------------------------------------------------------- server
server_num="$(psql -d "$FIRST_DB" -qtAXc 'SHOW server_version_num')" \
  || die "cannot connect to $FIRST_DB as ${PGUSER:-$(whoami)}"
server_major=$((server_num / 10000))
dump_major="$(pg_dump --version | awk '{print $3}' | cut -d. -f1)"
[ "$dump_major" -ge "$server_major" ] \
  || die "pg_dump $dump_major cannot dump PostgreSQL $server_major; use a client at least as new as the server"

# A database added later (a fifth application) would otherwise never be backed
# up, and nothing would say so.
unlisted=""
for d in $(psql -d "$FIRST_DB" -qtAXc 'SELECT datname FROM pg_database WHERE NOT datistemplate'); do
  printf '%s' "$d" | grep -Eq "$DB_PATTERN" || continue
  printf '%s' "$d" | grep -Eq "$DB_IGNORE" && continue
  case " $DATABASES " in *" $d "*) ;; *) unlisted="$unlisted $d" ;; esac
done
[ -z "$unlisted" ] || die "database(s) on the server that this backup does not list:$unlisted (add to CLOR_BACKUP_DATABASES)"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/clor-backup.XXXXXX")"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bundle"
# ssh-keygen refuses a key file others can read; a mounted secret may be 0444.
cp "$SIGNING_KEY" "$WORK/signing.key"; chmod 600 "$WORK/signing.key"

# --------------------------------------------------------------- check_db
# Every tenant table has FORCE ROW LEVEL SECURITY. The backup role is not a
# superuser (Cloud SQL has none to give), so the policies apply to it, and a
# policy it does not satisfy hides rows SILENTLY: pg_dump writes a smaller
# table and succeeds. Every policy the migrations write begins
#   ((current_setting('clor.bypass'::text, true) = 'on'::text) OR
# so a session that sets clor.bypass = 'on' (the dump does) sees every row.
#
# Mentioning clor.bypass is not enough (`bypass = 'on' AND ...` hides rows), so
# the exact form is required: for each table with RLS on, at least one
# permissive policy that applies to this role and starts with that text, and
# every restrictive policy that applies to this role starts with it too.
#
# The check and the dump are separate sessions, so a migration landing between
# them is not covered by the check. The row-count check after the dump is the
# second line for that, and for anything this check does not foresee.
check_db() {
  local db="$1" problems
  problems="$(psql -d "$db" -qtAX -v ON_ERROR_STOP=1 <<'SQL'
WITH t AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p','S')
    AND n.nspname NOT IN ('pg_catalog','information_schema')
    AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
), p AS (
  SELECT pol.polrelid, pol.polname, pol.polpermissive,
         starts_with(coalesce(pg_get_expr(pol.polqual, pol.polrelid), ''),
           '((current_setting(''clor.bypass''::text, true) = ''on''::text) OR ') AS canonical
  FROM pg_policy pol
  WHERE pol.polcmd IN ('*','r')
    AND (0::oid = ANY (pol.polroles)
         OR EXISTS (SELECT 1 FROM unnest(pol.polroles) r WHERE pg_has_role(current_user, r, 'USAGE')))
)
SELECT format('%I.%I: the backup role cannot read it', nspname, relname)
  FROM t WHERE NOT has_table_privilege(oid, 'SELECT')
UNION ALL
SELECT format('%I.%I: row-level security is on but no policy lets the backup see rows', t.nspname, t.relname)
  FROM t WHERE t.relkind IN ('r','p') AND t.relrowsecurity
   AND NOT EXISTS (SELECT 1 FROM p WHERE p.polrelid = t.oid AND p.polpermissive AND p.canonical)
UNION ALL
SELECT format('%I.%I: restrictive policy %I hides rows from the backup', t.nspname, t.relname, p.polname)
  FROM t JOIN p ON p.polrelid = t.oid
  WHERE t.relrowsecurity AND NOT p.polpermissive AND NOT p.canonical;
SQL
)" || die "$db: could not check table access"
  [ -z "$problems" ] || die "$db: the dump would be incomplete:
$problems"
}

# --------------------------------------------------------------- dump
# Rows counted from the dump file itself: a COPY block per table, one line per
# row (COPY text format escapes newlines inside values). This is exactly what a
# restore must reproduce, and clor-restore-offsite.sh compares against it.
count_rows() {
  pg_restore --data-only -f - "$1" | awk '
    /^COPY / { name=$2; n=0; inside=1; next }
    inside && $0 == "\\." { print name "\t" n; inside=0; next }
    inside { n++ }'
}

# PostgreSQL's estimate of live rows per table. Approximate: it lags, and can
# run high for a while (a session's own inserts are added again after its
# ANALYZE), so only a large shortfall counts: more than 100 rows AND more
# than a quarter of the estimate missing.
shortfall() {
  local db="$1" rows="$2"
  psql -d "$db" -qtAX -F $'\t' -c "SELECT format('%I.%I', schemaname, relname), n_live_tup FROM pg_stat_user_tables" \
    | awk -F'\t' 'FILENAME == "-" { est[$1] = $2; next }
                  ($1 in est) && est[$1] - $2 > 100 && est[$1] - $2 > est[$1] / 4 {
                    printf "%s: dump has %d rows, PostgreSQL counts about %d\n", $1, $2, est[$1] }' - "$rows"
}

total=0
MANIFEST="$WORK/bundle/MANIFEST"
{
  echo "format=clor-backup-1"
  echo "label=$LABEL"
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "server_version=$(psql -d "$FIRST_DB" -qtAXc 'SHOW server_version')"
  echo "pg_dump=$(pg_dump --version)"
  echo "databases=$DATABASES"
} > "$MANIFEST"

for db in $DATABASES; do
  check_db "$db"
  file="$WORK/bundle/$db.dump"
  # --enable-row-security: without it pg_dump stops at the first table with
  # RLS rather than dump through the policies. clor.bypass lets every row
  # through them (checked above). One snapshot per database.
  PGOPTIONS="${PGOPTIONS:-} -c clor.bypass=on" \
    pg_dump -d "$db" -Fc -Z 6 --enable-row-security -f "$file" \
    || die "pg_dump failed for $db"
  pg_restore --list "$file" >/dev/null || die "$db: the dump just written is not readable"
  count_rows "$file" > "$WORK/bundle/$db.rows"
  [ -s "$WORK/bundle/$db.rows" ] || die "$db: the dump holds no tables"
  short="$(shortfall "$db" "$WORK/bundle/$db.rows")"
  [ -z "$short" ] || die "$db: the dump is missing rows:
$short"
  rows="$(awk -F'\t' '{s+=$2} END {print s+0}' "$WORK/bundle/$db.rows")"
  tables="$(wc -l < "$WORK/bundle/$db.rows" | tr -d ' ')"
  echo "sha256.$db=$(sha256 "$file")" >> "$MANIFEST"
  echo "rows.$db=$rows" >> "$MANIFEST"
  say "$db: $tables tables, $rows rows, $(filesize "$file") bytes"
  total=$((total + rows))
done
echo "rows.total=$total" >> "$MANIFEST"

# A live database with no rows at all is what a silently-failed dump looks
# like. (A brand-new empty database can be backed up with CLOR_BACKUP_ALLOW_EMPTY=1.)
[ "$total" -gt 0 ] || [ "${CLOR_BACKUP_ALLOW_EMPTY:-}" = 1 ] \
  || die "every table is empty; this is not a backup of a live database"

# --------------------------------------------------------------- encrypt, sign
mkdir "$WORK/pack"
ARCHIVE="$WORK/pack/archive.tar.age"
tar --no-xattrs -C "$WORK/bundle" -cf - . | age "${AGE_ARGS[@]}" -o "$ARCHIVE" \
  || die "encryption failed"
rm -rf "$WORK/bundle"   # the plaintext is not needed past this point
ssh-keygen -q -Y sign -f "$WORK/signing.key" -n clor-backup "$ARCHIVE" >/dev/null 2>&1 \
  || die "signing failed (is CLOR_BACKUP_SIGNING_KEY_FILE an OpenSSH private key?)"
rm -f "$WORK/signing.key"
# One object holding both, so a copy is stored whole or not at all: a
# signature uploaded apart from its archive could fail after the archive was
# stored, and the day's fixed name would then be taken by an unusable copy.
BACKUP="$WORK/out.clorbackup"
tar --no-xattrs -C "$WORK/pack" -cf "$BACKUP" archive.tar.age archive.tar.age.sig || die "packing failed"
size="$(filesize "$BACKUP")"

# --------------------------------------------------------------- upload
# put LOCAL OBJECT_NAME -> 0 written, 2 already there, dies on anything else.
case "$DEST" in
  gs://*)
    bucket="${DEST#gs://}"; bucket="${bucket%%/*}"
    # Both endpoints can be overridden only so the upload can be tested
    # against a local stand-in; leave them unset in production.
    meta="${CLOR_BACKUP_METADATA_URL:-http://metadata.google.internal}"
    gcs="${CLOR_BACKUP_GCS_URL:-https://storage.googleapis.com}"
    # On Cloud Run: the job's own service account, which may only CREATE
    # objects in this bucket (it cannot read, overwrite or delete them). The
    # token goes in a header file, never on a command line or in a log.
    token_json="$(curl -sf -m 10 -H 'Metadata-Flavor: Google' \
      "$meta/computeMetadata/v1/instance/service-accounts/default/token")" \
      || die "no token from the metadata server (this uploads only from Google Cloud)"
    printf 'Authorization: Bearer %s\n' \
      "$(printf '%s' "$token_json" | sed -n 's/.*"access_token" *: *"\([^"]*\)".*/\1/p')" > "$WORK/auth"
    put() {
      local src="$1" name="$2" code want got
      want="$(md5b64 "$src")"
      code="$(curl -sS -o "$WORK/resp" -w '%{http_code}' -X POST -H @"$WORK/auth" \
        -H 'Content-Type: application/octet-stream' --data-binary @"$src" \
        "$gcs/upload/storage/v1/b/$bucket/o?uploadType=media&name=$(printf '%s' "$name" | sed 's#/#%2F#g')&ifGenerationMatch=0")" \
        || die "upload of gs://$bucket/$name failed (no response)"
      case "$code" in
        200) ;;
        412) return 2 ;;
        *) die "upload of gs://$bucket/$name failed: HTTP $code $(head -c 300 "$WORK/resp")" ;;
      esac
      got="$(sed -n 's/.*"md5Hash" *: *"\([^"]*\)".*/\1/p' "$WORK/resp")"
      [ "$got" = "$want" ] || die "stored gs://$bucket/$name has MD5 $got, the file has $want"
      return 0
    } ;;
  file://*)
    put() {
      local target="${DEST#file://}/$2"
      [ -e "$target" ] && return 2
      mkdir -p "$(dirname "$target")"
      cp "$1" "$target"
    } ;;
esac

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
put "$BACKUP" "frequent/clor-$LABEL-$STAMP.clorbackup" || die "frequent/clor-$LABEL-$STAMP.clorbackup already exists"
written="frequent"
for tier in daily monthly; do
  case "$tier" in
    daily) name="daily/clor-$LABEL-$(TZ="$TZNAME" date +%Y-%m-%d).clorbackup" ;;
    monthly) name="monthly/clor-$LABEL-$(TZ="$TZNAME" date +%Y-%m).clorbackup" ;;
  esac
  rc=0; put "$BACKUP" "$name" || rc=$?
  [ "$rc" = 0 ] && written="$written, $tier"
done
rm -f "$WORK/auth"

say "written: $DEST frequent/clor-$LABEL-$STAMP.clorbackup as $written ($size bytes, $total rows, $(( $(date +%s) - START_EPOCH ))s)"
