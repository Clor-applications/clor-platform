#!/bin/zsh
# Copies the 27 platform tables DATABASE_URL(clor_main) -> PLATFORM_DATABASE_URL(clor_platform).
# Target must be empty. Prints counts only, never URLs.
set -e
SRC="$DATABASE_URL"; DST="$PLATFORM_DATABASE_URL"; SP="$1"
T=(Account Org Branch User UserOrgMembership UserBranchMembership UserWarehouseAccess Role Permission RolePermission UserRoleAssignment RoleProfile RoleProfileRole UserRoleProfile UserPermission AuditLog AccountEntitlement FeatureSetting Session PasswordResetToken AuthEvent EmailVerificationToken NotificationSetting EmailSetting EmailOutbox AuthPolicy AuthProvider)
q(){ psql "$1" -v ON_ERROR_STOP=1 -tAc "$2"; }
for t in $T; do n=$(q "$DST" "select count(*) from \"$t\""); [ "$n" = 0 ] || { echo "ABORT: target $t already has $n rows"; exit 1; }; done
# save + drop target FKs
q "$DST" "select format('ALTER TABLE %s ADD CONSTRAINT %I %s;', conrelid::regclass, conname, pg_get_constraintdef(oid)) from pg_constraint where contype='f' and connamespace='public'::regnamespace" > "$SP/fk_readd.sql"
echo "FKs saved: $(wc -l < "$SP/fk_readd.sql" | tr -d ' ')"
q "$DST" "select format('ALTER TABLE %s DROP CONSTRAINT %I;', conrelid::regclass, conname) from pg_constraint where contype='f' and connamespace='public'::regnamespace" | psql "$DST" -v ON_ERROR_STOP=1 -q
# copy each table with an explicit column list (target column order)
for t in $T; do
  cols=$(q "$DST" "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='$t'")
  psql "$SRC" -v ON_ERROR_STOP=1 -qc "\\copy (select $cols from \"$t\") to stdout" | psql "$DST" -v ON_ERROR_STOP=1 -qc "\\copy \"$t\"($cols) from stdin"
done
# re-add FKs (validates every reference)
psql "$DST" -v ON_ERROR_STOP=1 -q -f "$SP/fk_readd.sql"
echo "FKs re-added: $(q "$DST" "select count(*) from pg_constraint where contype='f' and connamespace='public'::regnamespace")"
bad=0
for t in $T; do a=$(q "$SRC" "select count(*) from \"$t\""); p=$(q "$DST" "select count(*) from \"$t\""); [ "$a" = "$p" ] || { bad=$((bad+1)); echo "MISMATCH $t main=$a platform=$p"; }; done
echo "tables compared: ${#T}  mismatches: $bad"
