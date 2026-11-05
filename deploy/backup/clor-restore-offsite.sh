#!/usr/bin/env bash
# Restore an encrypted off-host backup into NEW databases, and prove it is whole.
#
#   clor-restore-offsite.sh SOURCE --identity KEYFILE [options]
#
# SOURCE    gs://BUCKET/daily/clor-prod-20261105T203000Z.tar.age
#           gs://BUCKET            (the newest object in the bucket)
#           ./clor-prod-....tar.age (a file already downloaded)
#
# --identity KEYFILE   the age PRIVATE key. Keep it off disk except while
#                      restoring, e.g. paste it from the password manager into
#                      a file in a mode-700 folder and delete it afterwards:
#                      --identity <(pbpaste) also works.
# --suffix S           databases are restored as <name>S. Default
#                      _restore_<UTC stamp>. Never an existing database.
# --suffix ''          restore under the original names: only for a NEW, empty
#                      server after a disaster (still refuses any that exist).
# --owner ROLE         objects owned by ROLE (pg_restore --role); use clor_app
#                      on a rebuilt production server. Default: whoever runs it.
# --drop-after         drop the restored databases once verified (the drill).
#
# Where to restore: the usual libpq settings, PGHOST PGPORT PGUSER PGPASSWORD,
# for a role that can CREATE DATABASE. Point them at a scratch server: a local
# Postgres, or a new Cloud SQL instance. Not at production unless production
# is gone.
#
# It proves the restore, it does not assume it: every dump's SHA-256 must match
# the manifest written at backup time, and every table's row count in the
# restored database must equal the count taken from the dump. Any difference
# stops it with the table named.
set -euo pipefail
umask 077

die() { echo "restore: FAILED: $*" >&2; exit 1; }
say() { echo "restore: $*"; }
now() { date +%s; }

SOURCE="" IDENTITY="" SUFFIX="__default__" OWNER="" DROP_AFTER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) IDENTITY="${2:?}"; shift 2 ;;
    --suffix) SUFFIX="${2-}"; shift 2 ;;
    --owner) OWNER="${2:?}"; shift 2 ;;
    --drop-after) DROP_AFTER=1; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$SOURCE" ] || die "one source only"; SOURCE="$1"; shift ;;
  esac
done
[ -n "$SOURCE" ] || die "usage: clor-restore-offsite.sh SOURCE --identity KEYFILE [--suffix S] [--owner ROLE] [--drop-after]"
[ -n "$IDENTITY" ] || die "--identity KEYFILE is required (the age private key)"
[ "$SUFFIX" = "__default__" ] && SUFFIX="_restore_$(date -u +%Y%m%dT%H%M%SZ)"
case "$SUFFIX" in *[!a-z0-9_]*) die "suffix may hold only a-z 0-9 _" ;; esac

for tool in age tar pg_restore psql awk; do command -v "$tool" >/dev/null || die "$tool is not installed"; done
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/clor-restore.XXXXXX")"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
T0="$(now)"

# --------------------------------------------------------------- fetch
case "$SOURCE" in
  gs://*)
    command -v gcloud >/dev/null || die "gcloud is needed to read $SOURCE"
    if [ "${SOURCE%.tar.age}" = "$SOURCE" ]; then
      # A bucket: take the newest backup in any tier.
      SOURCE="$(gcloud storage ls -l "${SOURCE%/}/**" 2>/dev/null \
        | awk '$NF ~ /\.tar\.age$/ {print $2, $NF}' | sort | tail -1 | cut -d' ' -f2)"
      [ -n "$SOURCE" ] || die "no backups found in the bucket"
      say "newest backup: $SOURCE"
    fi
    gcloud storage cp "$SOURCE" "$WORK/in.tar.age" >/dev/null || die "could not download $SOURCE"
    ARCHIVE="$WORK/in.tar.age" ;;
  *)
    [ -f "$SOURCE" ] || die "no such file: $SOURCE"
    ARCHIVE="$SOURCE" ;;
esac
T1="$(now)"

# --------------------------------------------------------------- decrypt
mkdir "$WORK/bundle"
age -d -i "$IDENTITY" "$ARCHIVE" | tar -C "$WORK/bundle" -xf - \
  || die "could not decrypt: wrong key, or the archive is damaged"
M="$WORK/bundle/MANIFEST"
[ -f "$M" ] || die "the archive has no MANIFEST; not a CLOR backup"
grep -qx 'format=clor-backup-1' "$M" || die "unknown backup format"
mval() { sed -n "s/^$1=//p" "$M"; }
DATABASES="$(mval databases)"
say "backup of '$(mval label)' taken $(mval created_utc), PostgreSQL $(mval server_version), $(mval rows.total) rows"

for db in $DATABASES; do
  [ "$(sha256 "$WORK/bundle/$db.dump")" = "$(mval "sha256.$db")" ] \
    || die "$db.dump does not match the checksum written at backup time"
done
T2="$(now)"

# --------------------------------------------------------------- restore
exists() { psql -d postgres -qtAXc "SELECT 1 FROM pg_database WHERE datname = '$1'" | grep -q 1; }
for db in $DATABASES; do
  exists "$db$SUFFIX" && die "database $db$SUFFIX already exists; choose another --suffix or drop it yourself"
done

CREATED=""
cleanup_failed() { for d in $CREATED; do psql -d postgres -qXc "DROP DATABASE IF EXISTS \"$d\"" >/dev/null 2>&1 || true; done; }

ROLE_ARGS=(--no-owner --no-acl)
[ -n "$OWNER" ] && ROLE_ARGS+=(--role="$OWNER")
for db in $DATABASES; do
  target="$db$SUFFIX"
  if [ -n "$OWNER" ]; then
    psql -d postgres -qXv ON_ERROR_STOP=1 -c "CREATE DATABASE \"$target\" OWNER \"$OWNER\"" >/dev/null || { cleanup_failed; die "could not create $target"; }
  else
    psql -d postgres -qXv ON_ERROR_STOP=1 -c "CREATE DATABASE \"$target\"" >/dev/null || { cleanup_failed; die "could not create $target"; }
  fi
  CREATED="$CREATED $target"
  # Table data loads before the policies are switched on (pg_dump puts row
  # security in the post-data section), so FORCE RLS does not get in the way.
  pg_restore -d "$target" --exit-on-error "${ROLE_ARGS[@]}" "$WORK/bundle/$db.dump" \
    || { cleanup_failed; die "pg_restore failed for $target (the databases it created are removed)"; }
  say "$db -> $target restored"
done
T3="$(now)"

# --------------------------------------------------------------- verify
# Count every table in the restored copy, through the policies the same way the
# backup did, and compare with the counts taken from the dump.
for db in $DATABASES; do
  target="$db$SUFFIX"
  PGOPTIONS="${PGOPTIONS:-} -c clor.bypass=on" psql -d "$target" -qtAX -F $'\t' -v ON_ERROR_STOP=1 <<'SQL' > "$WORK/$db.restored"
SELECT format('%I.%I', n.nspname, c.relname),
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
SQL
  # pg_restore names tables as schema."Table" only when quoting is needed;
  # normalise both sides through the same quoting rule.
  norm() { awk -F'\t' '{ print $1 "\t" $2 }' "$1" | sort; }
  norm "$WORK/bundle/$db.rows" > "$WORK/$db.want"
  norm "$WORK/$db.restored" > "$WORK/$db.got"
  if ! diff -q "$WORK/$db.want" "$WORK/$db.got" >/dev/null; then
    { cleanup_failed; } 2>/dev/null
    echo "restore: $db differences (backup < > restored):" >&2
    diff "$WORK/$db.want" "$WORK/$db.got" | head -20 >&2
    die "$target does not match the backup (restored databases removed)"
  fi
  say "$target: $(wc -l < "$WORK/$db.got" | tr -d ' ') tables, $(awk -F'\t' '{s+=$2} END {print s+0}' "$WORK/$db.got") rows, every count matches"
done
T4="$(now)"

say "verified. download $((T1-T0))s, decrypt+check $((T2-T1))s, restore $((T3-T2))s, verify $((T4-T3))s, total $((T4-T0))s"

if [ "$DROP_AFTER" = 1 ]; then
  for d in $CREATED; do psql -d postgres -qXc "DROP DATABASE \"$d\"" >/dev/null; done
  say "drill done; restored databases dropped"
else
  say "restored databases:$CREATED"
fi
