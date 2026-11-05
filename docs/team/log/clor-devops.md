# clor-devops work log

## 2026-11-05 11:30 IST — Backups — review fixes for #129 (632e8cd7)
- Did: fixed every point in the review of #129, with tests written first.
  - Restore: refuses superuser, CREATEROLE and server-file/program roles; database names only from an allow-list, passed to SQL as psql variables; manifest keys matched as text; only MANIFEST and <name>.dump/.rows as plain files; partitioned parents left out of the count; the trap drops the databases it created on any failure or interrupt.
  - Archives are signed (ssh-keygen -Y, key only in Secret Manager, public half to be committed as deploy/backup/allowed_signers) and the signature is checked before decrypting.
  - RLS guard: requires the exact canonical prefix on a policy that applies to the backup role, plus every restrictive policy; after the dump, compares with n_live_tup (more than 100 rows and more than 25 % missing fails); fails on an unlisted clor_* database.
  - Daily and monthly copies come from the first successful run (fixed names, written only if absent).
  - Added the failed-run and no-success-in-7-h alert policies.
  - Image pinned by digest and exact apk versions; Cloud Build has no default tag (MUST_MATCH).
  - Runbook: corrected what the copy survives (same Google and billing account; unlocked retention); locking is an owner's choice, marked permanent; R2 or external-disk copy outside Google at $0; keys in ~/.clor-backup-keys (mode 700); the drill uses --identity <(pbpaste); --project on the commands; re-grant after a restore.
- Evidence:
  - test-local.sh: 21 of the new checks failed against 632e8cd7; after the fixes, 36 passed and 0 failed on a throwaway PG17.
  - n_live_tup backstop checked alone, on a scratch copy with the role check disabled: it refused a dump with 0 of 300 rows.
  - Throwaway PG18 container with the real migrations: all 263 policies match the canonical prefix. Backup in the pinned image with a 0444-mounted key wrote frequent, daily and monthly, each with a .sig. Restored in the image as non-superuser clor_restore, every count matched, 2 s. A superuser was refused.
  - Real Cloud Storage, Cloud Run, Monitoring and Cloud SQL grants are not exercised (no cloud changes).
- Next: re-review of #129; then the owner's checklist.
- Blocked on: the reviewer; then the owner for the cloud setup.

## 2026-11-05 01:40 IST — Backups: encrypted off-host copy, restore drill, RPO/RTO
- Did: built the encrypted off-host backup for Cloud SQL `clor-pg`:
  - `deploy/backup/`: a Cloud Run Job image that dumps the 4 databases (pg_dump 18), encrypts with age to the owner's public keys, and uploads write-once to a create-only bucket;
  - a restore script that checks the SHA-256 and every table's row count;
  - the bucket lifecycle rules, the read-only role SQL, and a local test suite.
  
  Rewrote `docs/BACKUP-AND-RESTORE.md` (the SQLite-era version described a host that does not exist) with the runbook, RPO/RTO, cost and the owner's checklist. Pointed the DEPLOY.md Backups section at it.
- Found (read-only gcloud describe, no data read): PITR is already on (7 days), with deletion protection, retain-backups-on-delete and a 30-day final backup. So the RPO is minutes while the instance and project survive. The audit's 24 h applies only to the daily snapshot. The real gaps were a single project and account, Google-managed keys only, and no restore ever tested.
- Evidence: `deploy/backup/test-local.sh`, 18/18 checks passed on throwaway PG17. Real migrations on a throwaway PG18 container, backup and restore through the built image: 4 DBs, 317 tables, every count matched, restore 3 s. GCS upload path tested against a local mock, including the MD5-mismatch refusal. Real Cloud Storage not exercised.
- Next: the owner runs the checklist in docs/BACKUP-AND-RESTORE.md (keys, bucket, service account, role, job, first drill, schedule, alert); then the first monthly drill gets logged here.
- Blocked on: the owner for the one-off cloud setup (no resources created, nothing in production changed).
