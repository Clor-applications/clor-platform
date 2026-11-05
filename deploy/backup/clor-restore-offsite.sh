#!/usr/bin/env bash
# Restore an encrypted off-host backup into NEW databases, and prove it is whole.
#
#   clor-restore-offsite.sh SOURCE --identity KEYFILE [options]
#
# SOURCE    gs://BUCKET/daily/clor-prod-2026-11-05.tar.age
#           gs://BUCKET             (the newest archive in the bucket)
#           ./clor-prod-....tar.age  (a file already downloaded; its .sig beside it)
#
# --identity KEYFILE   the age PRIVATE key. Do not write it to disk: from the
#                      password manager, --identity <(pbpaste), then clear the
#                      clipboard.
# --signers FILE       who may have made the archive (ssh allowed_signers
#                      format). Default: deploy/backup/allowed_signers, which
#                      holds the job's public signing key, committed to git.
# --suffix S           databases are restored as <name>S. Default
#                      _restore_<UTC stamp>. Never an existing database.
# --suffix ''          restore under the original names: only for a NEW, empty
#                      server after a disaster (still refuses any that exist).
# --owner ROLE         objects owned by ROLE (pg_restore --role); use clor_app
#                      on a rebuilt production server. Default: whoever runs it.
# --drop-after         drop the restored databases once verified (the drill).
#
# Where to restore: the usual libpq settings, PGHOST PGPORT PGUSER PGPASSWORD,
# for a role that can CREATE DATABASE but is NOT a superuser, has no CREATEROLE
# and no server-file access (the runbook creates `clor_restore`). It refuses
# anything stronger: a dump is SQL, and a forged one restored by a superuser
# could run shell commands on the server (COPY ... TO PROGRAM).
#
# What it trusts, and what it checks anyway:
#   - the archive must carry a valid signature from a key in --signers, checked
#     before it is decrypted. The age public key alone lets anyone make an
#     archive; only the job holds the signing key;
#   - even so, database names are accepted only from CLOR_RESTORE_DATABASES
#     (default: the four production names) and go into SQL as quoted psql
#     variables; the archive may hold only MANIFEST and <name>.dump/.rows as
#     plain files;
#   - every dump's SHA-256 must match the manifest, and every table's row count
#     in the restored database must equal the count taken from the dump.
# Any failure, or an interrupt, drops the databases this run created.
set -euo pipefail
umask 077

die() { echo "restore: FAILED: $*" >&2; exit 1; }
say() { echo "restore: $*"; }
now() { date +%s; }
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME_RE='^[a-z_][a-z0-9_]*$'

SOURCE="" IDENTITY="" SUFFIX="__default__" OWNER="" DROP_AFTER=0 SIGNERS="$HERE/allowed_signers"
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) IDENTITY="${2:?}"; shift 2 ;;
    --signers) SIGNERS="${2:?}"; shift 2 ;;
    --suffix) SUFFIX="${2-}"; shift 2 ;;
    --owner) OWNER="${2:?}"; shift 2 ;;
    --drop-after) DROP_AFTER=1; shift ;;
    -h|--help) sed -n '2,45p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$SOURCE" ] || die "one source only"; SOURCE="$1"; shift ;;
  esac
done
[ -n "$SOURCE" ] || die "usage: clor-restore-offsite.sh SOURCE --identity KEYFILE [--signers FILE] [--suffix S] [--owner ROLE] [--drop-after]"
[ -n "$IDENTITY" ] || die "--identity KEYFILE is required (the age private key)"
[ -f "$SIGNERS" ] || die "no signers file at $SIGNERS (the job's public signing key; see docs/BACKUP-AND-RESTORE.md)"
[ "$SUFFIX" = "__default__" ] && SUFFIX="_restore_$(date -u +%Y%m%dT%H%M%SZ)"
[ -z "$SUFFIX" ] || printf '%s' "$SUFFIX" | grep -Eq '^[a-z0-9_]+$' || die "suffix may hold only a-z 0-9 _"
[ -z "$OWNER" ] || printf '%s' "$OWNER" | grep -Eq "$NAME_RE" || die "not a plain role name: $OWNER"

ALLOWED="${CLOR_RESTORE_DATABASES:-clor_main clor_payroll clor_people clor_platform}"
for db in $ALLOWED; do printf '%s' "$db" | grep -Eq "$NAME_RE" || die "CLOR_RESTORE_DATABASES: not a plain name: $db"; done
allowed() { case " $ALLOWED " in *" $1 "*) return 0 ;; esac; return 1; }

for tool in age tar pg_restore psql awk ssh-keygen; do command -v "$tool" >/dev/null || die "$tool is not installed"; done
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
# psql with the names passed as variables, never pasted into SQL text.
sql() { psql -qtAX -v ON_ERROR_STOP=1 "$@"; }

# --------------------------------------------------------------- who is restoring
strong="$(sql -d postgres <<'SQL'
SELECT concat_ws(', ',
  CASE WHEN rolsuper THEN 'superuser' END,
  CASE WHEN rolcreaterole THEN 'CREATEROLE' END,
  CASE WHEN pg_has_role(current_user, 'pg_execute_server_program', 'MEMBER') THEN 'pg_execute_server_program' END,
  CASE WHEN pg_has_role(current_user, 'pg_write_server_files', 'MEMBER') THEN 'pg_write_server_files' END,
  CASE WHEN pg_has_role(current_user, 'pg_read_server_files', 'MEMBER') THEN 'pg_read_server_files' END)
FROM pg_roles WHERE rolname = current_user
SQL
)" || die "cannot connect to the restore server"
[ -z "$strong" ] || die "refusing to restore as $(sql -d postgres -c 'SELECT current_user') ($strong). Restore as a role that can create databases and nothing more, e.g. clor_restore (not a superuser): a forged dump restored by a superuser can run commands on the server"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/clor-restore.XXXXXX")"
chmod 700 "$WORK"
CREATED="" VERIFIED=0
on_exit() {
  local rc=$?
  if [ "$VERIFIED" != 1 ]; then
    for d in $CREATED; do
      sql -d postgres -v name="$d" >/dev/null 2>&1 <<'SQL' || echo "restore: could not drop $d; drop it by hand" >&2
DROP DATABASE IF EXISTS :"name"
SQL
    done
    [ -z "$CREATED" ] || echo "restore: removed the databases this run created:$CREATED" >&2
  fi
  rm -rf "$WORK"
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
T0="$(now)"

# --------------------------------------------------------------- fetch
case "$SOURCE" in
  gs://*)
    command -v gcloud >/dev/null || die "gcloud is needed to read $SOURCE"
    if [ "${SOURCE%.tar.age}" = "$SOURCE" ]; then
      SOURCE="$(gcloud storage ls -l "${SOURCE%/}/**" 2>/dev/null \
        | awk '$NF ~ /\.tar\.age$/ {print $2, $NF}' | sort | tail -1 | cut -d' ' -f2)"
      [ -n "$SOURCE" ] || die "no backups found in the bucket"
      say "newest backup: $SOURCE"
    fi
    gcloud storage cp "$SOURCE" "$WORK/in.tar.age" >/dev/null || die "could not download $SOURCE"
    gcloud storage cp "$SOURCE.sig" "$WORK/in.tar.age.sig" >/dev/null 2>&1 || die "$SOURCE has no signature ($SOURCE.sig)"
    ARCHIVE="$WORK/in.tar.age" ;;
  *)
    [ -f "$SOURCE" ] || die "no such file: $SOURCE"
    [ -f "$SOURCE.sig" ] || die "$SOURCE has no signature beside it ($SOURCE.sig)"
    ARCHIVE="$SOURCE" ;;
esac
T1="$(now)"

# --------------------------------------------------------------- signature, decrypt
ssh-keygen -Y verify -f "$SIGNERS" -I clor-backup-job -n clor-backup -s "$ARCHIVE.sig" < "$ARCHIVE" >/dev/null 2>&1 \
  || die "bad signature: this archive was not made by the backup job (or was changed since). Not restoring it"
age -d -i "$IDENTITY" -o "$WORK/bundle.tar" "$ARCHIVE" 2>/dev/null \
  || die "could not decrypt: wrong key, or the archive is damaged"

# Only the expected file names, and only plain files, before anything is read.
tar -tf "$WORK/bundle.tar" > "$WORK/list" || die "the archive is not a tar file"
while IFS= read -r entry; do
  e="${entry#./}"
  case "$e" in
    ""|MANIFEST) continue ;;
    *.dump|*.rows) allowed "${e%.*}" && continue ;;
  esac
  die "unexpected file in the archive: $entry"
done < "$WORK/list"
mkdir "$WORK/bundle"
tar -C "$WORK/bundle" -xf "$WORK/bundle.tar" || die "could not unpack the archive"
rm -f "$WORK/bundle.tar"
odd="$(cd "$WORK/bundle" && find . -mindepth 1 \( ! -type f -o -links +1 \) -print)"
[ -z "$odd" ] || die "not a plain file in the archive: $odd"

M="$WORK/bundle/MANIFEST"
[ -f "$M" ] || die "the archive has no MANIFEST; not a CLOR backup"
# Keys are compared as text, never used as a pattern.
mval() { awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$M"; }
[ "$(mval format)" = clor-backup-1 ] || die "unknown backup format"
DATABASES=""
for db in $(mval databases); do
  allowed "$db" || die "unexpected database name in the manifest: $db"
  case " $DATABASES " in *" $db "*) die "database listed twice in the manifest: $db" ;; esac
  DATABASES="${DATABASES:+$DATABASES }$db"
done
[ -n "$DATABASES" ] || die "the manifest lists no databases"
say "backup of '$(mval label | tr -cd 'a-zA-Z0-9_.-')' taken $(mval created_utc | tr -cd '0-9TZ:-'), $(mval rows.total | tr -cd 0-9) rows"

for db in $DATABASES; do
  [ -f "$WORK/bundle/$db.dump" ] && [ -f "$WORK/bundle/$db.rows" ] || die "the archive is missing $db.dump or $db.rows"
  [ "$(sha256 "$WORK/bundle/$db.dump")" = "$(mval "sha256.$db")" ] \
    || die "$db.dump does not match the checksum written at backup time"
done
T2="$(now)"

# --------------------------------------------------------------- restore
for db in $DATABASES; do
  [ -z "$(sql -d postgres -v name="$db$SUFFIX" <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'name'
SQL
)" ] || die "database $db$SUFFIX already exists; choose another --suffix or drop it yourself"
done

ROLE_ARGS=(--no-owner --no-acl)
[ -n "$OWNER" ] && ROLE_ARGS+=(--role="$OWNER")
for db in $DATABASES; do
  target="$db$SUFFIX"
  if [ -n "$OWNER" ]; then
    sql -d postgres -v name="$target" -v owner="$OWNER" >/dev/null <<'SQL' || die "could not create $target"
CREATE DATABASE :"name" OWNER :"owner"
SQL
  else
    sql -d postgres -v name="$target" >/dev/null <<'SQL' || die "could not create $target"
CREATE DATABASE :"name"
SQL
  fi
  CREATED="$CREATED $target"
  # Table data loads before the policies are switched on (pg_dump puts row
  # security in the post-data section), so FORCE RLS does not get in the way.
  pg_restore -d "$target" --exit-on-error "${ROLE_ARGS[@]}" "$WORK/bundle/$db.dump" \
    || die "pg_restore failed for $target"
  say "$db -> $target restored"
done
T3="$(now)"

# --------------------------------------------------------------- verify
# Count every plain table (partitions included, partitioned parents not: their
# rows live in the partitions, which is also how the dump holds them) through
# the policies the same way the backup did, and compare with the dump's counts.
norm() { awk -F'\t' '{ print $1 "\t" $2 }' "$1" | sort; }
for db in $DATABASES; do
  target="$db$SUFFIX"
  PGOPTIONS="${PGOPTIONS:-} -c clor.bypass=on" sql -d "$target" -F $'\t' > "$WORK/$db.restored" <<'SQL'
SELECT format('%I.%I', n.nspname, c.relname),
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM ONLY %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
SQL
  norm "$WORK/bundle/$db.rows" > "$WORK/$db.want"
  norm "$WORK/$db.restored" > "$WORK/$db.got"
  if ! diff -q "$WORK/$db.want" "$WORK/$db.got" >/dev/null; then
    echo "restore: $db differences (backup < > restored):" >&2
    diff "$WORK/$db.want" "$WORK/$db.got" | head -20 >&2
    die "$target does not match the backup"
  fi
  say "$target: $(wc -l < "$WORK/$db.got" | tr -d ' ') tables, $(awk -F'\t' '{s+=$2} END {print s+0}' "$WORK/$db.got") rows, every count matches"
done
T4="$(now)"

say "verified. download $((T1-T0))s, check+decrypt $((T2-T1))s, restore $((T3-T2))s, verify $((T4-T3))s, total $((T4-T0))s"

if [ "$DROP_AFTER" = 1 ]; then
  for d in $CREATED; do sql -d postgres -v name="$d" >/dev/null <<'SQL'
DROP DATABASE :"name"
SQL
  done
  CREATED=""
  say "drill done; restored databases dropped"
else
  say "restored databases:$CREATED"
  say "the restore leaves out grants (--no-acl): run deploy/backup/grant-backup-role.sql and server/scripts/provisionAppRole.mjs before using them as production"
fi
VERIFIED=1
