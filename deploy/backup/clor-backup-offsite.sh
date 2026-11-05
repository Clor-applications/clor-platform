#!/usr/bin/env bash
# An encrypted copy of every production database, off the database host.
#
# Production is Cloud SQL `clor-pg` (four databases: clor_main, clor_payroll,
# clor_people, clor_platform). Cloud SQL already keeps its own snapshots and
# point-in-time recovery, but those live and die with the instance and the
# project. This script is the copy that survives losing either.
#
# It runs as a Cloud Run Job (deploy/backup/Dockerfile), started by Cloud
# Scheduler. It can also run on any machine that can reach the database.
#
# What it does, per run:
#   1. refuses to start unless the dump would be complete (see check_rls);
#   2. pg_dump of each database (custom format, compressed);
#   3. counts the rows IN THE DUMP, table by table, into a manifest;
#   4. one tar of dumps + manifest, encrypted with age to the owner's PUBLIC
#      key(s). The private key never comes near this script or its host, so
#      whoever holds this machine, its service account or the bucket cannot
#      read a single backup;
#   5. uploads it, write-once, and checks the stored MD5 against the local one.
#
# Nothing unencrypted ever leaves the working directory, which is mode 700 and
# removed on exit.
#
# Settings (environment):
#   CLOR_BACKUP_RECIPIENTS  required. age public keys ("age1..."), space or
#                           comma separated. Public keys are not secrets.
#   CLOR_BACKUP_DEST        required. gs://BUCKET  or  file:///some/dir (tests)
#   PGHOST PGPORT PGUSER PGPASSWORD   the usual libpq settings. On Cloud Run:
#                           PGHOST=/cloudsql/clor-apps-511409:asia-south1:clor-pg
#   CLOR_BACKUP_DATABASES   default: clor_main clor_payroll clor_people clor_platform
#   CLOR_BACKUP_LABEL       default: prod (goes into the object name)
#   CLOR_BACKUP_TIER        auto (default) | frequent | daily | monthly
#   CLOR_BACKUP_TZ          default: Asia/Kolkata (decides daily/monthly)
#
# Tiers (the bucket's lifecycle rules delete by prefix, deploy/backup/lifecycle.json):
#   frequent/  every run except the first of the day   kept 7 days
#   daily/     first run of the day (before 06:00)      kept 35 days
#   monthly/   first run on the 1st of the month        kept 400 days
set -euo pipefail
umask 077

die() { echo "backup: FAILED: $*" >&2; exit 1; }
say() { echo "backup: $*"; }

DATABASES="${CLOR_BACKUP_DATABASES:-clor_main clor_payroll clor_people clor_platform}"
LABEL="${CLOR_BACKUP_LABEL:-prod}"
DEST="${CLOR_BACKUP_DEST:-}"
RECIPIENTS="${CLOR_BACKUP_RECIPIENTS:-}"
TZNAME="${CLOR_BACKUP_TZ:-Asia/Kolkata}"
START_EPOCH="$(date +%s)"

for tool in pg_dump pg_restore psql age tar awk; do
  command -v "$tool" >/dev/null || die "$tool is not installed"
done

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
md5b64() { openssl dgst -md5 -binary "$1" | openssl base64; }
filesize() { wc -c < "$1" | tr -d ' '; }

# --------------------------------------------------------------- recipients
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

case "$DEST" in
  gs://*|file://*) ;;
  *) die "CLOR_BACKUP_DEST must be gs://BUCKET or file:///dir (got '${DEST:-nothing}')" ;;
esac

# --------------------------------------------------------------- versions
# pg_dump refuses a server newer than itself, but say why in plain words.
server_num="$(psql -d "${DATABASES%% *}" -qtAXc 'SHOW server_version_num')" \
  || die "cannot connect to ${DATABASES%% *} as ${PGUSER:-$(whoami)}"
server_major=$((server_num / 10000))
dump_major="$(pg_dump --version | awk '{print $3}' | cut -d. -f1)"
[ "$dump_major" -ge "$server_major" ] \
  || die "pg_dump $dump_major cannot dump PostgreSQL $server_major; use a client at least as new as the server"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/clor-backup.XXXXXX")"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bundle"

# --------------------------------------------------------------- check_rls
# Every tenant table has FORCE ROW LEVEL SECURITY. The backup role is not a
# superuser (Cloud SQL has none to give), so the policies apply to it, and a
# policy it does not satisfy hides rows SILENTLY: pg_dump writes a smaller
# table and succeeds. The policies all let a session through that sets
# clor.bypass = 'on' (server/src/utils/tenantScope.ts), and the dump sets it.
#
# So before dumping, prove that is still true of every table, every time: a
# migration that adds a table with a policy that forgets the bypass, or turns
# RLS on with no policy at all, makes this stop instead of quietly backing up
# less. Same for a table or sequence the backup role cannot read.
check_db() {
  local db="$1" problems
  problems="$(psql -d "$db" -qtAX -v ON_ERROR_STOP=1 <<'SQL'
WITH t AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p','S')
    AND n.nspname NOT IN ('pg_catalog','information_schema')
    AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
)
SELECT format('%I.%I: the backup role cannot read it', nspname, relname)
  FROM t WHERE NOT has_table_privilege(oid, 'SELECT')
UNION ALL
SELECT format('%I.%I: row-level security is on but no policy lets the backup see rows', t.nspname, t.relname)
  FROM t WHERE t.relkind IN ('r','p') AND t.relrowsecurity AND NOT EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = t.oid AND p.polpermissive AND p.polcmd IN ('*','r')
      AND pg_get_expr(p.polqual, p.polrelid) LIKE '%clor.bypass%')
UNION ALL
SELECT format('%I.%I: policy %I hides rows from the backup (no clor.bypass)', t.nspname, t.relname, p.polname)
  FROM t JOIN pg_policy p ON p.polrelid = t.oid
  WHERE t.relrowsecurity AND p.polcmd IN ('*','r')
    AND coalesce(pg_get_expr(p.polqual, p.polrelid), '') NOT LIKE '%clor.bypass%'
    AND NOT p.polpermissive;
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

total=0
MANIFEST="$WORK/bundle/MANIFEST"
{
  echo "format=clor-backup-1"
  echo "label=$LABEL"
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "server_version=$(psql -d "${DATABASES%% *}" -qtAXc 'SHOW server_version')"
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

# --------------------------------------------------------------- encrypt
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
tier="${CLOR_BACKUP_TIER:-auto}"
if [ "$tier" = auto ]; then
  hour="$(TZ="$TZNAME" date +%H)"; dom="$(TZ="$TZNAME" date +%d)"
  if [ "$hour" -lt 6 ]; then
    if [ "$dom" = 01 ]; then tier=monthly; else tier=daily; fi
  else
    tier=frequent
  fi
fi
case "$tier" in frequent|daily|monthly) ;; *) die "unknown tier: $tier" ;; esac

OBJECT="$tier/clor-$LABEL-$STAMP.tar.age"
ARCHIVE="$WORK/out.tar.age"
tar -C "$WORK/bundle" -cf - . | age "${AGE_ARGS[@]}" -o "$ARCHIVE" \
  || die "encryption failed"
# The plaintext is not needed past this point.
rm -rf "$WORK/bundle"
size="$(filesize "$ARCHIVE")"

# --------------------------------------------------------------- upload
case "$DEST" in
  file://*)
    dir="${DEST#file://}/$(dirname "$OBJECT")"
    mkdir -p "$dir"
    [ -e "${DEST#file://}/$OBJECT" ] && die "refusing to overwrite ${DEST#file://}/$OBJECT"
    cp "$ARCHIVE" "${DEST#file://}/$OBJECT"
    ;;
  gs://*)
    bucket="${DEST#gs://}"; bucket="${bucket%%/*}"
    want_md5="$(md5b64 "$ARCHIVE")"
    # Both endpoints can be overridden only so the upload can be tested
    # against a local stand-in; leave them unset in production.
    meta="${CLOR_BACKUP_METADATA_URL:-http://metadata.google.internal}"
    gcs="${CLOR_BACKUP_GCS_URL:-https://storage.googleapis.com}"
    if token_json="$(curl -sf -m 5 -H 'Metadata-Flavor: Google' \
         "$meta/computeMetadata/v1/instance/service-accounts/default/token" 2>/dev/null)"; then
      # On Cloud Run: the job's own service account, which may only CREATE
      # objects in this bucket (it cannot read, overwrite or delete them).
      # The token goes in a header file, never on a command line or in a log.
      printf 'Authorization: Bearer %s\n' \
        "$(printf '%s' "$token_json" | sed -n 's/.*"access_token" *: *"\([^"]*\)".*/\1/p')" > "$WORK/auth"
      enc_name="$(printf '%s' "$OBJECT" | sed 's#/#%2F#g')"
      resp="$(curl -sS --fail-with-body -X POST -H @"$WORK/auth" \
        -H 'Content-Type: application/octet-stream' --data-binary @"$ARCHIVE" \
        "$gcs/upload/storage/v1/b/$bucket/o?uploadType=media&name=$enc_name&ifGenerationMatch=0")" \
        || die "upload to gs://$bucket/$OBJECT failed: $resp"
      rm -f "$WORK/auth"
      got_md5="$(printf '%s' "$resp" | sed -n 's/.*"md5Hash" *: *"\([^"]*\)".*/\1/p')"
    elif command -v gcloud >/dev/null; then
      gcloud storage cp --no-clobber "$ARCHIVE" "gs://$bucket/$OBJECT" >/dev/null \
        || die "upload to gs://$bucket/$OBJECT failed"
      got_md5="$(gcloud storage objects describe "gs://$bucket/$OBJECT" --format='value(md5_hash)' 2>/dev/null || echo unreadable)"
    else
      die "no way to reach Cloud Storage (no metadata server, no gcloud)"
    fi
    if [ "$got_md5" != "$want_md5" ]; then
      # A creator-only account cannot read metadata through gcloud; the
      # JSON API upload response always carries it.
      [ "$got_md5" = unreadable ] || die "stored object's MD5 ($got_md5) is not the archive's ($want_md5)"
    fi
    ;;
esac

say "written: $DEST/$OBJECT ($size bytes, $total rows, $(( $(date +%s) - START_EPOCH ))s)"
