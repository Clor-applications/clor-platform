# clor-devops work log

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
