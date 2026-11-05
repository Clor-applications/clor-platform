# Backup and restore

Two different things, and they must not be confused:

| | Whose | What it holds | Where |
|---|---|---|---|
| **System backup** | The operator's | Every company's books, payroll and employee records | Cloud SQL backups + the encrypted off-host copy (this file) |
| **Company data backup** | The customer's | One company's own records | Settings → Account → Data Backup (`docs/COMPANY-DATA-EXPORT.md`) |

Never hand a customer a system backup. It holds other companies' data.

## What production has (checked 5 Nov 2026, read-only)

Production is Cloud SQL `clor-pg` (PostgreSQL 18, `db-f1-micro`, asia-south1).
It holds four databases: `clor_main`, `clor_payroll`, `clor_people` and
`clor_platform`. It also still holds the four old `*_staging` databases, which the
backup does not copy. There is no VM. `deploy/backup.sh` and the old version of
this file described a single host with `/var/backups`, and that host does not
exist.

| Protection | State on `clor-pg` | Covers |
|---|---|---|
| Automated daily snapshot, 09:00 UTC | on, 7 kept, stored in `asia` multi-region | a bad day |
| Point-in-time recovery (write-ahead logs) | **on**, 7 days | any moment in the last 7 days |
| Deletion protection | on | deleting the instance by mistake |
| Backups kept after the instance is deleted, plus a final backup | on, final backup kept 30 days | losing the instance |
| On-demand snapshot before each release | done by hand (`gcloud sql backups create`) | a bad release |
| **Encrypted copy outside Cloud SQL** | **not yet, set up below** | losing the project, the account, or Cloud SQL's copies |
| **A restore that has been tested** | **not yet, monthly drill below** | finding out on the day it matters |

The audit said the recovery point was 24 hours. That is true only if the
daily snapshot is all you count. Point-in-time recovery is already on, so for
any problem where the instance and project survive, the recovery point is a
few minutes. What was really missing:

1. **Every copy is in one Google Cloud project, under one Google account.**
   Snapshots, logs and final backup all go away if the project is deleted or
   suspended, or if someone who signs in as the owner deletes them. Payroll
   and employee records need one copy that survives this.
2. **Only Google's keys protect the data.** Cloud SQL encrypts at rest with
   keys Google manages, and anyone who can sign in to the project can read
   the backups. The off-host copy below is encrypted with the owner's own key.
3. **No restore had ever been tested.**

## The off-host copy

```
Cloud Scheduler (02:30, 08:30, 14:30, 20:30 IST)
  → Cloud Run Job clor-backup   (image: deploy/backup/Dockerfile)
      pg_dump × 4 databases, as read-only role clor_backup
      → counts every table's rows from the dump  → MANIFEST
      → tar → age, encrypted to the owner's PUBLIC keys
      → upload, write-once  → gs://clor-backups-<id>/{frequent,daily,monthly}/
```

- **Encryption.** [age](https://age-encryption.org), with X25519 public-key
  encryption. The job holds only the public keys, so it can write backups but
  cannot read one. The same goes for anyone who takes over the job, its
  service account or the bucket. The private key is never in the repository,
  in Google Cloud, or on any server. It is kept in the owner's password manager,
  and a spare key is kept somewhere else. Every archive is encrypted to both.
  age authenticates each chunk, so a damaged or altered archive will not
  decrypt; it cannot restore as wrong data.
- **Least privilege.** The job's service account may only *create* objects in
  the bucket (`roles/storage.objectCreator`). It cannot list, read, overwrite
  or delete them. Its database role, `clor_backup`, is read-only and not a
  superuser.
- **Complete, or it fails.** Every tenant table has FORCE ROW LEVEL SECURITY.
  A role that does not meet a policy gets fewer rows back, and pg_dump does not
  report an error, so a short backup would look like a good one. Before each
  dump the job checks every table in every database:
  - the backup role can read it;
  - it has a policy that lets `clor.bypass` through;
  - no restrictive policy hides rows.

  If any check fails, the job stops and names the table. It also refuses a
  backup in which every table is empty.
- **Proved on restore.** The manifest records each dump's SHA-256 and each
  table's row count, taken from the dump itself. The restore script checks
  both. If any table's count differs, it stops, names the table, and removes
  the databases it created.
- **Consistency.** Each database is dumped from one snapshot. The four
  databases are separate, so they are dumped seconds apart. A payroll posting
  made during those seconds could be in `clor_payroll` but not yet in
  `clor_main`. Point-in-time recovery restores all four to the same instant.
  Use it whenever the instance survives.

### Retention (bucket lifecycle, `deploy/backup/lifecycle.json`)

| Prefix | Written by | Kept |
|---|---|---|
| `frequent/` | the 08:30, 14:30 and 20:30 runs | 7 days |
| `daily/` | the 02:30 run | 35 days |
| `monthly/` | the 02:30 run on the 1st | 400 days, Coldline after 30 |

The bucket also has a 7-day retention policy, so nobody can delete or replace
an object in its first week, and 7-day soft delete, so a deleted object can be
recovered for a week.

### Cost

The real dump size is not known yet. The backup must not read production data
before the owner sets it up. The instance uses 488 MB of disk, which includes
PostgreSQL's own files and logs, so a compressed dump will be well under that.
For a guide: the full current schema with test data dumps to 1 MB.

The bucket holds about 85 archives in Standard class (21 frequent, 35 daily,
about 28 recently deleted ones in soft delete, 1 young monthly), plus 12
monthly archives in Coldline.

| Archive size | Storage | Everything else | Per month |
|---|---|---|---|
| 20 MB (likely today) | 1.7 GB × $0.023 ≈ $0.04 | ≈ $0.08 | **≈ $0.12 (≈ ₹10)** |
| 100 MB (upper bound) | 8.5 GB × $0.023 + 1.2 GB Coldline ≈ $0.20 | ≈ $0.08 | **≈ $0.28 (≈ ₹25)** |

"Everything else":

- Cloud Run Job: about 120 runs a month at about 30 s each, inside the free tier.
- Cloud Scheduler: the second of three free jobs.
- Secret Manager: one more secret, about $0.06.
- Artifact Registry: a 0.1 GB image, about $0.01.
- Uploads: about $0.001.
- Network: free inside asia-south1.
- A restore drill downloaded to the Mac: about $0.01 each.

Prices are asia-south1 list prices as of late 2026. The first run logs the real
archive size. Monthly cost ≈ 85 × size in GB × $0.023 + $0.08.

## Recovery point and recovery time

| What went wrong | Recover from | Recovery point (data lost) | Recovery time |
|---|---|---|---|
| Bad release, bad migration, rows deleted or changed by mistake | Point-in-time clone of `clor-pg` | **minutes**: restore to the second before the mistake | **≤ 1 hour** |
| Instance lost or deleted | Final backup or retained snapshots | **≈ 0** for a deletion (final backup); otherwise the last snapshot plus PITR | **≤ 1 hour** |
| Project, account or all Cloud SQL copies lost, or the data is needed outside Google | Encrypted off-host copy | **≤ 6 hours** (≤ 1 hour with the hourly option) | **≤ 4 hours** |

The recovery time for the last row is mostly rebuilding around the database:

- a new instance (about 15 min);
- the restore itself (seconds at today's size: the full schema restored and
  verified in 3 s on PostgreSQL 18 locally);
- the API image rebuilt from git with Cloud Build (about 10 min);
- the service's secrets, Cloudflare DNS and the edge Worker pointed at the new
  service.

Repeat the drill below each month, and update this table if the restore
starts taking much longer.

### A shorter recovery point

- **Already in place, no cost:** point-in-time recovery gives minutes for every
  case where the instance survives. Keep it on.
- **Off-host copy every hour, for a few cents more a month:** change the
  schedule to `30 * * * *`. Compute stays inside the free tier. The
  `frequent/` prefix then holds 7 × 23 = 161 archives, about 3 GB at 20 MB, or
  **about $0.07 more a month**. Each run is one read-only pg_dump, about a second
  at today's size, but `db-f1-micro` is already at its memory limit. Watch its
  memory graph for a week after the change.
- **Not worth it now:** a cross-region read replica (about $9 a month), or an
  Enterprise Plus instance.

## Restoring

The restore script needs PostgreSQL 18 client tools and age. On the Mac:
`brew install age postgresql@18`, and put
`$(brew --prefix postgresql@18)/bin` first on PATH. You can also run it inside
the backup image (see the drill below).

### Monthly drill: off-host copy into a scratch database (about 10 minutes)

```bash
# 1. A throwaway local server (nothing to do with production)
initdb -D /tmp/clor-drill -U drill --auth=trust --locale=C
pg_ctl -D /tmp/clor-drill -o "-p 55432 -k /tmp -c listen_addresses=localhost" -l /tmp/clor-drill.log start
psql -h 127.0.0.1 -p 55432 -U drill -d postgres -c 'CREATE ROLE clor_app LOGIN'

# 2. The private key, from the password manager, only for the drill
mkdir -m 700 /tmp/clor-key && pbpaste > /tmp/clor-key/owner.txt

# 3. Newest backup, restored, every table's count checked, then dropped
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=drill \
  deploy/backup/clor-restore-offsite.sh gs://clor-backups-<id> \
  --identity /tmp/clor-key/owner.txt --owner clor_app --drop-after

# 4. Clean up
rm -rf /tmp/clor-key; pg_ctl -D /tmp/clor-drill stop; rm -rf /tmp/clor-drill
```

The drill passes when the last line reads `verified` with the timings. Record
the date, the archive name and the total time in `docs/team/log/clor-devops.md`.
Use the spare key one month out of every three, so you find out it still works
before you need it.

### Real restore, instance alive (point-in-time)

```bash
# A new instance as of the second before the mistake (UTC). clor-pg is untouched.
gcloud sql instances clone clor-pg clor-pg-pitr --point-in-time '2026-11-05T08:59:00Z'
```

Then either copy the damaged rows back from `clor-pg-pitr`, or move the API to
it:

1. Deploy a no-traffic revision with
   `CLOUDSQL_INSTANCE=clor-apps-511409:asia-south1:clor-pg-pitr` and
   `--set-cloudsql-instances` to match. The users and passwords are cloned too.
2. Test its `rel-` tag.
3. Move traffic to it, the same way as a release (`DEPLOY.md`).

Delete the clone when you are done. It costs about $0.013 an hour.

### Real restore, from the off-host copy (project or instance gone)

1. Create a new instance, PostgreSQL 18, asia-south1, in a working project.
2. As `postgres`, create the role `clor_app` (and `clor_backup`) with SQL.
   Set new passwords and store them in Secret Manager. Run
   `GRANT clor_app TO postgres`, so the restore can create objects owned by
   `clor_app`.
3. Restore under the original names:
   ```bash
   PGHOST=<new instance via cloud-sql-proxy> PGUSER=postgres \
     deploy/backup/clor-restore-offsite.sh <archive or bucket> \
     --identity <key file> --suffix '' --owner clor_app
   ```
   The script refuses any database that already exists, and checks every
   table's row count.
4. Rebuild the API image (`DEPLOY.md`) and deploy the service against the new
   instance, with fresh secrets. JWT and mail secrets that were lost with the
   project mean everyone signs in again.
5. Point `api.clor.in` at it in Cloudflare.

## One-off setup: the owner's checklist

Nothing here has been done; do it in this order. Use the bucket name
`clor-backups-511409`, or your own. Bucket names are global.

### 1. Keys (on your Mac, 5 minutes)

```bash
brew install age
age-keygen -o ~/Desktop/clor-backup-owner.txt    # prints "Public key: age1..."
age-keygen -o ~/Desktop/clor-backup-spare.txt
```

- Copy the whole of `clor-backup-owner.txt` into your password manager as
  **"CLOR backup key, owner"**.
- Keep the spare somewhere separate: a second password manager, or printed and
  sealed in a safe place.
- Note the two `age1...` public keys. They are not secret.
- Delete both files from the Desktop, and empty the Bin.

If both private keys are lost, every off-host backup is unreadable, and nobody
can recover them, Google included.

### 2. Where the bucket lives

**Recommended:** a separate project, for example `clor-backups`, on the same
billing account. It is free to create. Deleting or misconfiguring the app's
project then cannot touch the backups. Run the bucket commands below with
`--project clor-backups`. A bucket in `clor-apps-511409` works too, but then
one project holds every copy.

### 3. Bucket

```bash
B=gs://clor-backups-511409
gcloud storage buckets create $B --location=asia-south1 --default-storage-class=STANDARD \
  --uniform-bucket-level-access --public-access-prevention --soft-delete-duration=7d
gcloud storage buckets update $B --lifecycle-file=deploy/backup/lifecycle.json
gcloud storage buckets update $B --retention-period=7d
```

### 4. Service account (create-only on the bucket)

```bash
SA=clor-backup-run@clor-apps-511409.iam.gserviceaccount.com
gcloud iam service-accounts create clor-backup-run --display-name "CLOR off-host backup job"
gcloud storage buckets add-iam-policy-binding $B --member serviceAccount:$SA --role roles/storage.objectCreator
gcloud projects add-iam-policy-binding clor-apps-511409 --member serviceAccount:$SA --role roles/cloudsql.client
```

### 5. Database role

```bash
openssl rand -hex 24 | gcloud secrets create DB_BACKUP_PASSWORD --data-file=-
gcloud secrets add-iam-policy-binding DB_BACKUP_PASSWORD --member serviceAccount:$SA --role roles/secretmanager.secretAccessor
gcloud secrets versions access latest --secret DB_BACKUP_PASSWORD | pbcopy
```

Open the console, go to Cloud SQL → `clor-pg` → Cloud SQL Studio, and sign in
as `postgres` on `clor_main`. Paste in `deploy/backup/grant-backup-role.sql`,
put the copied password where it says `PASTE_PASSWORD_HERE`, and run it. If
`GRANT pg_read_all_data` is refused, the file has a fallback.

### 6. Image and job

```bash
TAG=$(git rev-parse --short HEAD)
gcloud builds submit --config deploy/backup/cloudbuild.yaml --substitutions=_TAG=$TAG \
  --service-account=projects/clor-apps-511409/serviceAccounts/clor-build@clor-apps-511409.iam.gserviceaccount.com \
  deploy/backup

gcloud run jobs create clor-backup --region asia-south1 \
  --image asia-south1-docker.pkg.dev/clor-apps-511409/clor/backup:$TAG \
  --service-account $SA \
  --set-cloudsql-instances clor-apps-511409:asia-south1:clor-pg \
  --set-env-vars "^;^PGHOST=/cloudsql/clor-apps-511409:asia-south1:clor-pg;PGUSER=clor_backup;CLOR_BACKUP_DEST=$B;CLOR_BACKUP_RECIPIENTS=age1OWNER... age1SPARE..." \
  --set-secrets PGPASSWORD=DB_BACKUP_PASSWORD:latest \
  --cpu 1 --memory 1Gi --task-timeout 15m --max-retries 1
```

(`^;^` makes `;` the separator, because the two keys are separated by a space.)

### 7. First run, and the first drill

```bash
gcloud run jobs execute clor-backup --region asia-south1 --wait
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="clor-backup"' --limit 20 --format='value(textPayload)'
```

The last line reads `backup: written: gs://.../clor-prod-....tar.age (N bytes, N rows, Ns)`.
Then run the monthly drill above against that object. Do not schedule anything
until the drill passes.

### 8. Schedule

```bash
gcloud run jobs add-iam-policy-binding clor-backup --region asia-south1 --member serviceAccount:$SA --role roles/run.invoker
gcloud scheduler jobs create http clor-backup --location asia-south1 \
  --schedule '30 2,8,14,20 * * *' --time-zone 'Asia/Kolkata' \
  --uri 'https://run.googleapis.com/v2/projects/clor-apps-511409/locations/asia-south1/jobs/clor-backup:run' \
  --http-method POST --oauth-service-account-email $SA
```

### 9. Be told when it fails

In the console, open Monitoring → Alerting → Create policy. Choose the metric
**Cloud Run Job → Completed executions**, filter `result = failed`, set the
threshold to above 0 in 1 hour, and add your email as the channel. An alert
policy costs at most a few cents a month. Without it, a failing backup stays
silent until the next drill.

### 10. Every month

- Run the drill, and write it in the devops log.
- Check the bucket shows yesterday's `daily/` object.

## Testing the scripts

`deploy/backup/test-local.sh` runs on a throwaway local PostgreSQL. It refuses
any host that is not this machine. It covers:

- the round trip as a non-superuser reader through FORCE RLS, with a value
  that holds a newline, a tab and a backslash;
- both keys;
- a restore as a non-superuser owner, as on Cloud SQL.

It also checks every refusal:

- no key, or a private key given as the public one;
- a wrong key, or a damaged archive;
- an existing target database;
- a forged row count;
- a policy without the bypass, RLS on with no policy, or an unreadable table;
- every table empty.

```bash
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=<superuser> deploy/backup/test-local.sh   # 18 checks
```
