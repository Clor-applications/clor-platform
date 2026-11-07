#!/usr/bin/env bash
# Restore an encrypted off-host backup into NEW databases, and prove it is whole.
#
#   clor-restore-offsite.sh SOURCE --identity KEYFILE [options]
#
# SOURCE    gs://BUCKET/daily/clor-prod-2026-11-05.clorbackup
#           gs://BUCKET                (the newest backup in the bucket)
#           ./clor-prod-....clorbackup  (a file already downloaded)
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
# for a role that can CREATE DATABASE and nothing more (the runbook creates
# `clor_restore`, holding clor_app WITH INHERIT FALSE). It refuses a role that
# is, or could SET ROLE to, a superuser, a CREATEROLE or BYPASSRLS role,
# cloudsqlsuperuser, or one with server-file or server-program access: a dump
# is SQL, and a forged one restored by such a role could run shell commands
# on the server (COPY ... TO PROGRAM).
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
[ "$SUFFIX" = "__default__" ] && SUFFIX="_restore_$(date -u +%Y%m%d_%H%M%S)"
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
# The role itself and every role it is a member of (it could SET ROLE to any
# of them, so a forged dump could too): none may be a superuser, create roles,
# bypass row-level security or reach the server's files or programs. That
# includes Cloud SQL's cloudsqlsuperuser, which is none of those on paper.
strong="$(sql -d postgres <<'SQL'
SELECT string_agg(r.rolname || ' (' || concat_ws(', ',
         CASE WHEN r.rolsuper THEN 'superuser' END,
         CASE WHEN r.rolcreaterole THEN 'CREATEROLE' END,
         CASE WHEN r.rolbypassrls THEN 'BYPASSRLS' END,
         CASE WHEN r.rolname IN ('pg_execute_server_program', 'pg_write_server_files', 'pg_read_server_files', 'cloudsqlsuperuser')
              THEN 'server access' END) || ')', ', ' ORDER BY r.rolname)
FROM pg_roles r
WHERE pg_has_role(current_user, r.oid, 'MEMBER')
  AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls
       OR r.rolname IN ('pg_execute_server_program', 'pg_write_server_files', 'pg_read_server_files', 'cloudsqlsuperuser'))
SQL
)" || die "cannot connect to the restore server"
[ -z "$strong" ] || die "refusing to restore as $(sql -d postgres -c 'SELECT current_user'): it is, or can become, $strong. Restore as a role that can create databases and nothing more, e.g. clor_restore (not a superuser): a forged dump restored by a superuser can run commands on the server"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/clor-restore.XXXXXX")"
chmod 700 "$WORK"
CREATED="" VERIFIED=0 DEFERRED=""
# Drop a database this run created. With --owner the databases belong to that
# role, which clor_restore holds WITHOUT inheriting its rights, so become it.
drop_db() {
  if [ -n "$OWNER" ]; then
    printf 'SET ROLE :"owner";\nDROP DATABASE IF EXISTS :"name" WITH (FORCE);\n' | sql -d postgres -v name="$1" -v owner="$OWNER"
  else
    printf 'DROP DATABASE IF EXISTS :"name" WITH (FORCE);\n' | sql -d postgres -v name="$1"
  fi
}
on_exit() {
  local rc=$? dropped="" d
  trap '' INT TERM HUP
  if [ "$VERIFIED" != 1 ]; then
    for d in $CREATED; do
      if drop_db "$d" >/dev/null 2>&1; then dropped="$dropped $d"
      else echo "restore: could NOT drop $d; drop it by hand" >&2; fi
    done
    [ -z "$dropped" ] || echo "restore: removed the databases this run created:$dropped" >&2
  fi
  rm -rf "$WORK"
  exit "$rc"
}
trap on_exit EXIT
exit_traps() { trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 129' HUP; }
# While a database is being created, a signal waits until the run has noted
# the database as its own, so the exit can remove it.
defer_traps() { trap 'DEFERRED=130' INT; trap 'DEFERRED=143' TERM; trap 'DEFERRED=129' HUP; }
exit_traps
T0="$(now)"

# --------------------------------------------------------------- fetch
# A backup is ONE object (.clorbackup): an uncompressed tar of exactly two
# files, archive.tar.age and archive.tar.age.sig, so it is stored whole or not at all.
case "$SOURCE" in
  gs://*)
    command -v gcloud >/dev/null || die "gcloud is needed to read $SOURCE"
    if [ "${SOURCE%.clorbackup}" = "$SOURCE" ]; then
      SOURCE="$(gcloud storage ls -l "${SOURCE%/}/**" 2>/dev/null \
        | awk '$NF ~ /\.clorbackup$/ {print $2, $NF}' | sort | tail -1 | cut -d' ' -f2)"
      [ -n "$SOURCE" ] || die "no backups found in the bucket"
      say "newest backup: $SOURCE"
    fi
    gcloud storage cp "$SOURCE" "$WORK/in.clorbackup" >/dev/null || die "could not download $SOURCE"
    PACK="$WORK/in.clorbackup" ;;
  *)
    [ -f "$SOURCE" ] || die "no such file: $SOURCE"
    PACK="$SOURCE" ;;
esac
T1="$(now)"

# --------------------------------------------------------------- signature, decrypt
tar -tf "$PACK" > "$WORK/packlist" 2>/dev/null || die "$SOURCE is not a CLOR backup (not a tar file)"
has_sig=0
while IFS= read -r entry; do
  case "${entry#./}" in
    ""|archive.tar.age) ;;
    archive.tar.age.sig) has_sig=1 ;;
    *) die "unexpected file in the backup: $entry" ;;
  esac
done < "$WORK/packlist"
[ "$has_sig" = 1 ] || die "the backup carries no signature; not restoring it"
mkdir "$WORK/pack"
tar -C "$WORK/pack" -xf "$PACK" || die "could not unpack $SOURCE"
odd="$(cd "$WORK/pack" && find . -mindepth 1 \( ! -type f -o -links +1 \) -print)"
[ -z "$odd" ] || die "not a plain file in the backup: $odd"
ARCHIVE="$WORK/pack/archive.tar.age"
[ -f "$ARCHIVE" ] || die "the backup holds no archive"
# A plain tar is never smaller than the files in it. A sparse entry can be:
# a 10 KB pack can unpack to a 20 GB archive.tar.age that the signature check
# would then spend an hour hashing. Refuse it before reading anything.
pack_bytes="$(wc -c < "$PACK" | tr -d ' ')"
inner_bytes="$(find "$WORK/pack" -type f -exec ls -ln {} + | awk '{s += $5} END {printf "%.0f", s}')"
[ "$inner_bytes" -le "$pack_bytes" ] \
  || die "the backup unpacks to $inner_bytes bytes from a $pack_bytes-byte file (a sparse or forged pack); not restoring it"
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
OWNER_VAR=()
[ -n "$OWNER" ] && ROLE_ARGS+=(--role="$OWNER") && OWNER_VAR=(-v owner="$OWNER")
for db in $DATABASES; do
  target="$db$SUFFIX"
  defer_traps
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
  exit_traps
  [ -z "$DEFERRED" ] || exit "$DEFERRED"
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
  # With --owner, clor_restore holds the owner role without its rights
  # (INHERIT FALSE), so it reads the tables as that role.
  PGOPTIONS="${PGOPTIONS:-} -c clor.bypass=on" sql -d "$target" -F $'\t' ${OWNER_VAR[@]+"${OWNER_VAR[@]}"} > "$WORK/$db.restored" <<'SQL'
\if :{?owner}
SET ROLE :"owner";
\endif
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
  for d in $CREATED; do drop_db "$d" >/dev/null || die "could not drop $d after the drill"; done
  CREATED=""
  say "drill done; restored databases dropped"
else
  say "restored databases:$CREATED"
  say "the restore leaves out grants (--no-acl): run deploy/backup/grant-backup-role.sql and server/scripts/provisionAppRole.mjs before using them as production"
fi
VERIFIED=1
