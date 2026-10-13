#!/bin/zsh
# copy_db.sh <SRC_URL> <DST_URL> <label> <scratch_dir>
# Copies every table that exists in the DESTINATION (public schema, except
# _prisma_migrations) from SRC to DST, using COPY with an explicit column list
# (works across Postgres versions; no pg_dump). Destination must be empty.
#  - drops destination foreign keys, copies, re-adds them (re-validates links)
#  - temporarily turns off FORCE row-level security on destination tables so the
#    owner can load every tenant's rows, then turns it back on
#  - resets sequences to max(id)
#  - prints row counts per table and mismatches. Never prints URLs.
set -e
SRC="$1"; DST="$2"; L="$3"; SP="$4"
q(){ psql "$1" -v ON_ERROR_STOP=1 -tAc "$2"; }
tables=("${(@f)$(q "$DST" "select tablename from pg_tables where schemaname='public' and tablename<>'_prisma_migrations' order by 1")}")
srctables=" $(q "$SRC" "select string_agg(tablename,' ') from pg_tables where schemaname='public'") "
for t in $tables; do n=$(q "$DST" "select count(*) from \"$t\""); [ "$n" = 0 ] || { echo "[$L] ABORT: destination $t already has $n rows"; exit 1; }; done
q "$DST" "select format('ALTER TABLE %s ADD CONSTRAINT %I %s;', conrelid::regclass, conname, pg_get_constraintdef(oid)) from pg_constraint where contype='f' and connamespace='public'::regnamespace" > "$SP/fk_$L.sql"
q "$DST" "select format('ALTER TABLE %s DROP CONSTRAINT %I;', conrelid::regclass, conname) from pg_constraint where contype='f' and connamespace='public'::regnamespace" | psql "$DST" -v ON_ERROR_STOP=1 -q
forced=("${(@f)$(q "$DST" "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relforcerowsecurity")}")
for t in $forced; do [ -n "$t" ] && q "$DST" "ALTER TABLE \"$t\" NO FORCE ROW LEVEL SECURITY" >/dev/null; done
copied=0; skipped=""
for t in $tables; do
  if [[ "$srctables" != *" $t "* ]]; then skipped="$skipped $t"; continue; fi
  srccols=" $(q "$SRC" "select string_agg(column_name,' ') from information_schema.columns where table_schema='public' and table_name='$t'") "
  cols=""
  for c in ${(f)"$(q "$DST" "select column_name from information_schema.columns where table_schema='public' and table_name='$t' order by ordinal_position")"}; do
    [[ "$srccols" == *" $c "* ]] && cols="${cols:+$cols,}\"$c\""
  done
  psql "$SRC" -v ON_ERROR_STOP=1 -qc "\\copy (select $cols from \"$t\") to stdout" | psql "$DST" -v ON_ERROR_STOP=1 -qc "\\copy \"$t\"($cols) from stdin"
  copied=$((copied+1))
done
psql "$DST" -v ON_ERROR_STOP=1 -q -f "$SP/fk_$L.sql"
for t in $forced; do [ -n "$t" ] && q "$DST" "ALTER TABLE \"$t\" FORCE ROW LEVEL SECURITY" >/dev/null; done
q "$DST" "select format('SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I.%I),0)+1, false);', s.relname, a.attname, n.nspname, t.relname) from pg_class s join pg_depend d on d.objid=s.oid join pg_class t on t.oid=d.refobjid join pg_attribute a on a.attrelid=t.oid and a.attnum=d.refobjsubid join pg_namespace n on n.oid=t.relnamespace where s.relkind='S' and n.nspname='public'" | psql "$DST" -q >/dev/null 2>&1 || true
bad=0; total=0
for t in $tables; do [[ "$srctables" != *" $t "* ]] && continue; a=$(q "$SRC" "select count(*) from \"$t\""); b=$(q "$DST" "select count(*) from \"$t\""); total=$((total+b)); [ "$a" = "$b" ] || { bad=$((bad+1)); echo "[$L] MISMATCH $t src=$a dst=$b"; }; done
echo "[$L] tables copied: $copied  rows: $total  mismatches: $bad  FKs re-added: $(wc -l < "$SP/fk_$L.sql" | tr -d ' ')  forced-RLS restored: ${#forced}${skipped:+  (no source table, left empty:$skipped)}"
