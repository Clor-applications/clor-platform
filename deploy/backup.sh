#!/usr/bin/env bash
# A backup of the live books, and a restore that has been proved to work.
#
# Two rewrites, for the same reason each time: this script described a
# deployment that did not exist. It first backed up a Docker volume on a box
# that runs systemd, and then three SQLite files on a box that now runs
# PostgreSQL — so on 25 Sep 2026 the nightly job was pointed at
# /opt/clor/data/prod.db, which had been migrated away an hour earlier. A
# backup script that names the wrong source does not fail loudly; it writes
# something, every night, that nobody looks at until the day it matters.
#
#   ./backup.sh                     # back up
#   ./backup.sh --verify            # back up, then prove the archive restores
#   ./backup.sh --restore FILE DB   # restore an archive into a NEW database
#
# Install (on the server, once):
#   sudo cp deploy/backup.sh /usr/local/bin/clor-backup
#   sudo chmod +x /usr/local/bin/clor-backup
#   ( crontab -l 2>/dev/null; echo "30 2 * * * /usr/local/bin/clor-backup --verify >> /var/log/clor-backup.log 2>&1" ) | crontab -
set -euo pipefail

# ## Why this runs as the postgres superuser and nothing else will do
#
# Every tenant table has `FORCE ROW LEVEL SECURITY`, which subjects the table's
# OWNER to its own policies — that is deliberate, and it is what makes the
# policies real rather than decorative. It also means pg_dump as the owner
# fails outright:
#
#   ERROR: query would be affected by row-level security policy for table ...
#
# PostgreSQL refuses rather than dumping a partial table, which is the right
# refusal and exactly the one you do not want discovered by a restore. A
# superuser is exempt from RLS entirely, so the dump is complete. The
# application role is subject to the policies with no company set and would
# quietly back up nothing at all, which is why it appears nowhere here.
PG=(sudo -u postgres)

DB_NAME="${CLOR_DB_NAME:-clor}"
DEST="${CLOR_BACKUP_DIR:-/var/backups/clor}"
KEEP="${CLOR_BACKUP_KEEP:-30}"

die() { echo "backup: $*" >&2; exit 1; }

command -v pg_dump >/dev/null || die "pg_dump is not installed (apt-get install -y postgresql-client)"
"${PG[@]}" psql -qtAc 'SELECT 1' >/dev/null 2>&1 \
  || die "cannot connect as the postgres superuser — this needs sudo -u postgres"

# ---------------------------------------------------------------- restore
if [ "${1:-}" = "--restore" ]; then
  ARCHIVE="${2:?usage: backup.sh --restore ARCHIVE TARGET_DB}"
  TARGET="${3:?usage: backup.sh --restore ARCHIVE TARGET_DB}"
  [ -f "$ARCHIVE" ] || die "no such archive: $ARCHIVE"
  [ "$TARGET" = "$DB_NAME" ] && die "refusing to restore over the live database — restore beside it and swap"

  # Never restore over an existing database by accident: the caller names the
  # target and it must not already be there.
  if "${PG[@]}" psql -qtAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET'" | grep -q 1; then
    die "database $TARGET already exists — drop it or choose another name"
  fi

  "${PG[@]}" psql -qc "CREATE DATABASE \"$TARGET\"" >/dev/null
  if ! gunzip -c "$ARCHIVE" | "${PG[@]}" psql -d "$TARGET" -v ON_ERROR_STOP=1 -q >/dev/null; then
    "${PG[@]}" psql -qc "DROP DATABASE \"$TARGET\"" >/dev/null
    die "archive would not restore: $ARCHIVE"
  fi
  echo "restored: $ARCHIVE -> $TARGET"
  exit 0
fi

# ----------------------------------------------------------------- backup
mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$DEST/clor-$STAMP.sql.gz"

# One dump of one database: every application's schema, consistent to the same
# instant. That consistency is the reason the apps share a database — three
# databases cannot be dumped to the same moment, and a salary journal that is
# in one archive and not the other is a set of books that does not balance.
#
# pipefail, because gzip succeeds happily on an empty stream — which is exactly
# what a failed dump produces, and exactly what an unusable archive looks like
# from the outside.
set -o pipefail
if ! "${PG[@]}" pg_dump -d "$DB_NAME" | gzip > "$ARCHIVE"; then
  rm -f "$ARCHIVE"
  die "pg_dump failed for $DB_NAME"
fi

# ---------------------------------------------------------------- verify
#
# The part that makes this a backup rather than a hope. An archive nobody has
# restored is a file of unknown value, and the moment you find out is the
# moment you can least afford to.
if [ "${1:-}" = "--verify" ]; then
  PROBE="neev_verify_$$"
  cleanup() { "${PG[@]}" psql -qc "DROP DATABASE IF EXISTS \"$PROBE\"" >/dev/null 2>&1 || true; }
  trap cleanup EXIT

  "${PG[@]}" psql -qc "CREATE DATABASE \"$PROBE\"" >/dev/null
  gunzip -c "$ARCHIVE" | "${PG[@]}" psql -d "$PROBE" -v ON_ERROR_STOP=1 -q >/dev/null \
    || die "the archive just written does not restore: $ARCHIVE"

  # Present and readable is not the same as complete.
  #
  # Every table here is COMPARED against the live database, not merely listed.
  # An earlier version listed four and compared two — and the two it compared
  # happened to be empty on both sides, so an entirely empty archive passed
  # while the source held forty-nine accounts. What is only printed is
  # decoration; the comparison is the test.
  total=0
  for qualified in \
    accounting.Account accounting.Org accounting.User accounting.Invoice \
    accounting.Party accounting.JournalEntry payroll.PayrollRun people.Employee
  do
    schema="${qualified%%.*}"; table="${qualified##*.}"
    live="$("${PG[@]}" psql -d "$DB_NAME" -qtAc "SELECT COUNT(*) FROM \"$schema\".\"$table\"" 2>/dev/null || echo missing)"
    restored="$("${PG[@]}" psql -d "$PROBE" -qtAc "SELECT COUNT(*) FROM \"$schema\".\"$table\"" 2>/dev/null || echo missing)"
    [ "$live" = "missing" ] && die "live database has no $qualified table"
    [ "$restored" = "missing" ] && die "the restored copy has no $qualified table"
    [ "$live" = "$restored" ] || die "$qualified: live has $live rows, the restore has $restored"
    total=$((total + live))
    echo "  $qualified: $restored rows"
  done

  # Every table empty is what a silently-failed backup looks like.
  [ "$total" -gt 0 ] || die "every table is empty — this is not a backup of a live database"

  echo "verified: $ARCHIVE restores and matches the live row counts"
fi

ls -1t "$DEST"/clor-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
echo "backup written: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
