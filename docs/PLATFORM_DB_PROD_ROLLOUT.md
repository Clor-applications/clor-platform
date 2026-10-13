# Platform DB split — production rollout (Render + Neon)

**Rehearsed end-to-end on a Neon branch of production on 2026-10-12.** Every step
below ran against a copy of prod first. Do them in order; do NOT push until step 6.

Why the order matters (both proven in rehearsal):
- Accounting tables in clor_main hold foreign keys to the OLD platform tables
  (e.g. Warehouse -> Branch). If those stay, the new code writes a Branch into
  clor_platform and then fails to write the Warehouse -> **every new signup 500s**.
  They must be dropped before deploy (step 4). Dropping them does not affect the
  old code still running, so it is safe to do before the push.
- `prisma migrate deploy` applies the platform row-level-security migration itself;
  no separate psql step.

Scripts (no secrets in them): `server/prisma/platform/rollout/`.
Your shell needs DATABASE_URL (prod clor_main) and PLATFORM_DATABASE_URL (prod
clor_platform = the clor_main string with the db name swapped). Never paste them into files.

## 1. Backup
Neon -> Branches -> New branch from production, "Branch data and schema", auto-delete 7 days.
(Done 2026-10-12: `backup-pre-platform-split`.)

## 2. Create platform tables in prod clor_platform
```
npx prisma migrate deploy --schema prisma/platform/schema.prisma
```
Expect: init + row_level_security + billing applied; 31 tables, 19 policies.

## 3. Quiet window starts — nobody uses app.clor.in until step 7
Writes the OLD code makes after the copy are not carried over.

## 4. Drop the cross-boundary foreign keys in prod clor_main
```
psql "$DATABASE_URL" -f server/prisma/platform/rollout/drop_cross_fks.sql
```
Expect: `cross-boundary FKs dropped: 10`. The old 27 tables stay as an inert backup.

## 5. Copy the 27 tables
```
zsh server/prisma/platform/rollout/copy_platform_data.sh <scratch dir>
```
Uses COPY (local pg_dump 14 cannot dump Neon's Postgres 18). Expect `mismatches: 0`
and `FKs re-added: 22`. The script aborts if clor_platform already has rows.

## 6. Render env, then push
Render -> clor-api -> Environment -> add PLATFORM_DATABASE_URL (prod clor_platform).
Then `git push origin feat/clor-platform`. Render runs prisma:deploy (accounting/payroll/
people: no pending; platform: already applied) and boots.

## 7. Verify
- Render logs: no "Environment variable not found".
- Log in on app.clor.in with the existing account; company and books load.
- More apps opens; no plan card (no subscription assigned = unrestricted).
- A brand-new signup completes company setup.

## 8. Later (after ~a week of clean running)
Drop the 27 old tables from clor_main: `psql "$DATABASE_URL" -f server/prisma/platform/MIGRATE_DATA.sql`.

## Rollback
Before step 6: nothing user-facing changed — remove clor_platform's tables and stop.
After step 6: redeploy the previous commit (66ca808) from Render. The old code reads the
old tables in clor_main (still there); data written in clor_platform after cutover is lost.
Full restore point: Neon branch `backup-pre-platform-split` (until 2026-10-19).
