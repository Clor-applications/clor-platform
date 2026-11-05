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
`clor_platform`. It also still holds the four old `*_staging` databases, which
the backup does not copy. There is no VM. `deploy/backup.sh` and the old version
of this file described a single host with `/var/backups`, and that host does
not exist.

| Protection | State on `clor-pg` | Covers |
|---|---|---|
| Automated daily snapshot, 09:00 UTC | on, 7 kept, stored in `asia` multi-region | a bad day |
| Point-in-time recovery (write-ahead logs) | **on**, 7 days | any moment in the last 7 days |
| Deletion protection | on | deleting the instance by mistake |
| Backups kept after the instance is deleted, plus a final backup | on, final backup kept 30 days | losing the instance |
| On-demand snapshot before each release | done by hand (`gcloud sql backups create`) | a bad release |
| **Encrypted copy outside Cloud SQL** | **not yet, set up below** | losing the app's project, or Cloud SQL's own copies |
| **A copy outside Google** | **not yet, optional, below** | losing the Google account or its billing |
| **A restore that has been tested** | **not yet, monthly drill below** | finding out on the day it matters |

The audit said the recovery point was 24 hours. That is true only if the
daily snapshot is all you count. Point-in-time recovery is already on, so for
any problem where the instance and project survive, the recovery point is a
few minutes. What was really missing:

1. **Every copy is in one Google Cloud project, under one Google account.**
   Snapshots, logs and the final backup all go away if the project is deleted
   or suspended, or if someone who signs in as the owner deletes them.
2. **Only Google's keys protect the data.** Cloud SQL encrypts at rest with
   keys Google manages, and anyone who can sign in to the project can read
   the backups.
3. **No restore had ever been tested.**

### What the off-host copy does and does not survive

Be clear about the limits. The off-host copy below lives in a bucket in a
**separate project, but under the same Google account and the same billing
account**.

| Event | Off-host copy survives? |
|---|---|
| The app's project deleted, misconfigured or emptied | **yes** |
| Cloud SQL instance and all its backups lost | **yes** |
| The backup job, or its service account, taken over | **yes**: it can add archives but cannot read, replace or delete one, and a planted archive fails the restore's signature check |
| Someone deletes objects with the owner's sign-in | for **7 days** they can be recovered from soft delete. The retention policy is *not locked*, so whoever holds the owner's sign-in can remove it and then delete everything |
| The Google account lost or taken over, or billing suspended | **no**. Only a copy outside Google (below) or a locked retention policy survives this |

Two cheap things narrow the last row:

- **2-step verification with a security key** on the owner's Google account.
  This costs nothing and protects against most account takeovers.
- **A copy outside Google** (below), about $0 a month.

## The off-host copy

```
Cloud Scheduler (02:30, 08:30, 14:30, 20:30 IST)
  → Cloud Run Job clor-backup   (image: deploy/backup/Dockerfile)
      checks every database and table can be dumped in full
      pg_dump × 4 databases, as read-only role clor_backup
      → counts every table's rows from the dump  → MANIFEST
      → tar → age, encrypted to the owner's PUBLIC keys
      → signed with the job's signing key (ssh-keygen -Y sign)
      → upload, write-once  → gs://clor-backups-511409/{frequent,daily,monthly}/
```

- **Encryption.** [age](https://age-encryption.org), with X25519 public-key
  encryption. The job holds only the public keys, so it can write backups but
  cannot read one. The same goes for anyone who takes over the job, its
  service account or the bucket. The private key is never in the repository,
  in Google Cloud, or on any server. The owner keeps it in a password manager,
  and a spare key is kept somewhere else. Every archive is encrypted to both.
  age detects any change to an archive after it was made. It does **not**
  prove who made it: anyone with the public key can encrypt a new archive.
- **Signature.** That is why every archive is also signed with a key only the
  job holds (Secret Manager `BACKUP_SIGNING_KEY`). Its public half is
  committed in `deploy/backup/allowed_signers`, outside Google. The restore
  checks the signature before it decrypts anything, and refuses an archive
  that someone with bucket access planted.

  It does not protect against a stolen signing key: someone who can read that
  secret (the job's service account, or the project's owners and editors) can
  sign. The checks below hold even then. A *replaced* key, or replaced age
  recipients, makes the next drill fail, so a monthly drill catches either
  within a month.

  Recipients and the signing key live in the job's settings and secrets, and
  anyone with editor access to the project can change them. Check them as
  part of the drill:

  ```bash
  gcloud run jobs describe clor-backup --region asia-south1 --format='yaml(spec.template.spec.template.spec.containers[0].env)'
  ```
- **A forged archive cannot take over the restore server.** Even an archive
  signed with a stolen key is handled as untrusted:
  - database names are accepted only from the four production names, and go
    into SQL as quoted psql variables;
  - the archive may hold only `MANIFEST` and `<name>.dump`/`.rows`, as plain
    files (no links, no other paths);
  - manifest keys are matched as text, never as patterns;
  - the restore refuses to run as a superuser, as a role with CREATEROLE, or
    with server-file or server-program access. A dump is SQL, and a forged
    one restored by a superuser could run shell commands on the server
    (`COPY ... TO PROGRAM`). Restore as `clor_restore`, a role that can only
    create databases.
- **Least privilege.** The job's service account may only *create* objects in
  the bucket (`roles/storage.objectCreator`). It cannot list, read, overwrite
  or delete them. Its database role, `clor_backup`, is read-only and not a
  superuser.
- **Complete, or it fails.** Every tenant table has FORCE ROW LEVEL SECURITY.
  A role that does not meet a policy gets fewer rows back, and pg_dump does not
  report an error, so a short backup would look like a good one. Before each
  dump the job checks every table in every database:
  - the backup role can read it;
  - it has a policy that applies to the backup role and begins with exactly
    `((current_setting('clor.bypass'::text, true) = 'on'::text) OR` (all 263
    policies the migrations write do);
  - every restrictive policy on it begins the same way.

  After each dump it compares each table's dumped row count with
  PostgreSQL's own estimate (`n_live_tup`). If more than 100 rows and more
  than a quarter of a table are missing, it stops. It also refuses:
  - a database on the server that matches `clor_*` but is not on its list,
    so a fifth application database cannot be silently left out;
  - a backup in which every table is empty.

  The pre-dump check and the dump run in separate sessions, so a migration
  that lands between them is covered only by the row-count comparison.
- **Proved on restore.** The manifest records each dump's SHA-256 and each
  table's row count, taken from the dump itself. The restore checks both.
  Partitioned tables are counted by partition, as the dump holds them. On
  any failure, or an interrupt, it drops the databases it created.
- **Consistency.** Each database is dumped from one snapshot. The four
  databases are separate, so they are dumped seconds apart. A payroll posting
  made during those seconds could be in `clor_payroll` but not yet in
  `clor_main`. Point-in-time recovery restores all four to the same instant.
  Use it whenever the instance survives.

### Retention (bucket lifecycle, `deploy/backup/lifecycle.json`)

| Object | Written by | Kept |
|---|---|---|
| `frequent/clor-prod-<UTC time>.tar.age` | every run | 7 days |
| `daily/clor-prod-<date>.tar.age` | the **first successful** run of the day (IST) | 35 days |
| `monthly/clor-prod-<month>.tar.age` | the **first successful** run of the month | 400 days, Coldline after 30 |

Each archive has a `.sig` beside it. The daily and monthly names are fixed per
day and per month, and written only if they do not exist yet. So if a run
fails, or Scheduler does not start it, the next good run takes the day's and
the month's copy. The month's copy does not depend on the 02:30 run of the 1st.

Two more protections, both reversible:

- a **7-day retention policy**: nobody can delete or replace an object in its
  first week, unless they first remove the policy, which the owner's sign-in
  can do;
- **7-day soft delete**: a deleted object can be recovered for a week.

#### Locking the retention policy: an owner's choice, and permanent

`gcloud storage buckets update gs://... --lock-retention-period` makes the
7-day policy impossible to remove or shorten, by anyone, Google support
included. It then protects every object's first week even against the
owner's own account being taken over.

The cost of that: the bucket can never be deleted while it holds an object
younger than 7 days, and the period can only ever be made longer. Each
lengthening is also permanent, and costs storage for every object kept that
long.

**This cannot be undone.** It is not part of the checklist. Decide it once
the copy has run for a few weeks.

### A copy outside Google (optional, about $0)

This is the only protection against losing the Google account or its billing.

- **Cloudflare R2.** CLOR already uses Cloudflare. R2's free tier covers
  10 GB of storage a month with no download fees. A year of monthly archives
  is 13 × 20–100 MB, well inside it, so **$0**; beyond 10 GB it costs
  $0.015/GB-month.

  Once a month, after the drill, copy that month's two files:

  ```bash
  npx wrangler@3 r2 object put clor-backups-offgoogle/monthly/clor-prod-2026-11.tar.age --file clor-prod-2026-11.tar.age
  npx wrangler@3 r2 object put clor-backups-offgoogle/monthly/clor-prod-2026-11.tar.age.sig --file clor-prod-2026-11.tar.age.sig
  ```

  Enabling R2 needs a payment method on the Cloudflare account. The archives
  are encrypted, so R2 never sees the data.
- **An external disk.** The same two files, kept on an encrypted USB disk.
  $0.

Either way the recovery point for losing the account is however often you
copy: monthly means up to a month of data.

### Cost

The real dump size is not known yet. The backup must not read production data
before the owner sets it up. The instance uses 488 MB of disk, which includes
PostgreSQL's own files and logs, so a compressed dump will be well under that.
For a guide: the full current schema with test data dumps to 1 MB.

The bucket holds about 99 archives in Standard class:
- 28 frequent;
- 35 daily;
- about 35 recently deleted ones in soft delete;
- 1 young monthly.

Plus 12 monthly archives in Coldline.

| Archive size | Storage | Everything else | Per month |
|---|---|---|---|
| 20 MB (likely today) | 2 GB × $0.023 ≈ $0.05 | ≈ $0.13 | **≈ $0.18 (≈ ₹15)** |
| 100 MB (upper bound) | 9.9 GB × $0.023 + 1.2 GB Coldline ≈ $0.24 | ≈ $0.13 | **≈ $0.37 (≈ ₹31)** |

"Everything else":

- Cloud Run Job: about 120 runs a month at about 30 s each, inside the free tier.
- Cloud Scheduler: the second of three free jobs.
- Secret Manager: two more secrets (database password, signing key), about $0.12.
- Artifact Registry: a 0.1 GB image, about $0.01.
- Uploads: about $0.002.
- Network: free inside asia-south1.

The two alert policies may add up to about $0.10 a condition each month, if
Cloud Monitoring bills for them. An R2 copy is $0. A restore drill downloaded
to the Mac costs about $0.01.

Prices are asia-south1 list prices as of late 2026. The first run logs the real
archive size. Monthly cost ≈ 100 × size in GB × $0.023 + $0.13.

## Recovery point and recovery time

| What went wrong | Recover from | Recovery point (data lost) | Recovery time |
|---|---|---|---|
| Bad release, bad migration, rows deleted or changed by mistake | Point-in-time clone of `clor-pg` | **minutes**: restore to the second before the mistake | **≤ 1 hour** |
| Instance lost or deleted | Final backup or retained snapshots | **≈ 0** for a deletion (final backup); otherwise the last snapshot plus PITR | **≤ 1 hour** |
| App project lost, or all of Cloud SQL's copies | Encrypted off-host copy (separate project) | **≤ 6 hours** (≤ 1 hour with the hourly option) | **≤ 4 hours** |
| Google account or billing lost | The copy outside Google, if kept | **as often as you copy it** (monthly → up to a month); **total loss without it** | **≤ 1 day** (new Google account and project first) |

The recovery time for the off-host rows is mostly rebuilding around the
database:

- a new instance (about 15 min);
- the restore itself (seconds at today's size: the full schema restored and
  verified in 2 s on PostgreSQL 18 locally);
- the API image rebuilt from git with Cloud Build (about 10 min);
- the service's secrets, Cloudflare DNS and the edge Worker pointed at the new
  service.

Repeat the drill below each month, and update this table if the restore
starts taking much longer.

### A shorter recovery point

- **Already in place, no cost:** point-in-time recovery gives minutes for every
  case where the instance survives. Keep it on.
- **Off-host copy every hour, about $0.13 more a month at 20 MB:** change the
  schedule to `30 * * * *`. Compute stays inside the free tier. `frequent/`
  then holds 7 × 24 archives, plus as many again in soft delete. Each run is
  one read-only pg_dump, about a second at today's size, but `db-f1-micro` is
  already at its memory limit. Watch its memory graph for a week after the
  change.
- **Not worth it now:** a cross-region read replica (about $9 a month), or an
  Enterprise Plus instance.

## Restoring

The restore script needs PostgreSQL 18 client tools, age and ssh-keygen. On
the Mac: `brew install age postgresql@18`, and put
`$(brew --prefix postgresql@18)/bin` first on PATH. It is also in the backup
image as `clor-restore-offsite`:

```bash
docker run --rm --entrypoint clor-restore-offsite ... <image>
```

It always restores as a role that can create databases and nothing more. It
refuses a superuser.

### Monthly drill: off-host copy into a scratch database (about 10 minutes)

```bash
# 1. A throwaway local server (nothing to do with production), and a restore
#    role that is not a superuser. `drill` is only used to set it up.
initdb -D /tmp/clor-drill -U drill --auth=trust --locale=C
pg_ctl -D /tmp/clor-drill -o "-p 55432 -k /tmp -c listen_addresses=localhost" -l /tmp/clor-drill.log start
psql -h 127.0.0.1 -p 55432 -U drill -d postgres \
  -c 'CREATE ROLE clor_app' -c 'CREATE ROLE clor_restore LOGIN CREATEDB' -c 'GRANT clor_app TO clor_restore'

# 2. Copy the private key from the password manager to the clipboard. It
#    goes straight to age, never to a file. Newest backup, signature checked,
#    restored, every table's count checked, then dropped.
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=clor_restore \
  deploy/backup/clor-restore-offsite.sh gs://clor-backups-511409 \
  --identity <(pbpaste) --owner clor_app --drop-after
pbcopy < /dev/null        # clear the clipboard

# 3. Clean up
pg_ctl -D /tmp/clor-drill stop; rm -rf /tmp/clor-drill
```

The drill passes when the last line reads `drill done` after `verified`.

- Record the date, the archive name and the total time in
  `docs/team/log/clor-devops.md`.
- Use the spare key one month out of every three, so you find out it still
  works before you need it.
- Check the job's recipients (above). A drill that fails with `could not
  decrypt` or `bad signature` means the job's keys were changed: find out by
  whom before anything else.

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
2. As `postgres`, with SQL, create:
   - `clor_app`;
   - `clor_restore` (`LOGIN CREATEDB`, then `GRANT clor_app TO clor_restore`);
   - `clor_backup`.

   Set new passwords and store them in Secret Manager.
3. Restore under the original names, as `clor_restore`:
   ```bash
   PGHOST=<new instance via cloud-sql-proxy> PGUSER=clor_restore \
     deploy/backup/clor-restore-offsite.sh <archive or bucket> \
     --identity <(pbpaste) --suffix '' --owner clor_app
   ```
   It refuses any database that already exists, and checks every table's
   row count. If it fails or is interrupted, it removes what it created, so
   you can simply run it again.
4. **Put the grants back.** The restore leaves them out (`--no-acl`). Run
   `deploy/backup/grant-backup-role.sql`, and deploy, which runs
   `server/scripts/provisionAppRole.mjs`.
5. Rebuild the API image (`DEPLOY.md`) and deploy the service against the new
   instance, with fresh secrets. JWT and mail secrets that were lost with the
   project mean everyone signs in again.
6. Point `api.clor.in` at it in Cloudflare.

## One-off setup: the owner's checklist

Nothing here has been done; do it in this order.

- Bucket: `gs://clor-backups-511409`, or your own name (bucket names are
  global).
- Project: a separate project for the bucket, `clor-backups`.
- Set `PROJECT=clor-backups B=gs://clor-backups-511409` once in the terminal.

### 1. Keys (on your Mac, 10 minutes)

Use a folder that iCloud does not sync, readable by you only. Do not use the
Desktop or Documents, which iCloud Drive may upload.

```bash
brew install age
K=~/.clor-backup-keys; mkdir -m 700 "$K"
age-keygen -o "$K/owner.txt"     # prints "Public key: age1..."
age-keygen -o "$K/spare.txt"
ssh-keygen -t ed25519 -N '' -C clor-backup-job -f "$K/signing"
```

- Copy the whole of `owner.txt` into your password manager as **"CLOR backup
  key, owner"**.
- Keep `spare.txt` somewhere separate: a second password manager, or printed
  and sealed in a safe place.
- Note the two `age1...` public keys. They are not secret.
- The signing key goes to Secret Manager in step 5.

If both age private keys are lost, every off-host backup is unreadable, and
nobody can recover them, Google included.

### 2. A project for the bucket

Create a separate project, on the same billing account. It is free.

```bash
gcloud projects create $PROJECT
gcloud billing projects link $PROJECT --billing-account <the account clor-apps-511409 uses>
```

Deleting or misconfiguring the app's project then cannot touch the backups.
It does not protect against losing the Google account; see "A copy outside
Google".

### 3. Bucket

```bash
gcloud storage buckets create $B --project $PROJECT --location=asia-south1 --default-storage-class=STANDARD \
  --uniform-bucket-level-access --public-access-prevention --soft-delete-duration=7d
gcloud storage buckets update $B --project $PROJECT --lifecycle-file=deploy/backup/lifecycle.json
gcloud storage buckets update $B --project $PROJECT --retention-period=7d
```

Do **not** lock the retention policy now; see "Locking the retention policy".

### 4. Service account (create-only on the bucket)

```bash
SA=clor-backup-run@clor-apps-511409.iam.gserviceaccount.com
gcloud iam service-accounts create clor-backup-run --project clor-apps-511409 --display-name "CLOR off-host backup job"
gcloud storage buckets add-iam-policy-binding $B --project $PROJECT --member serviceAccount:$SA --role roles/storage.objectCreator
gcloud projects add-iam-policy-binding clor-apps-511409 --member serviceAccount:$SA --role roles/cloudsql.client
```

### 5. Secrets: database password and signing key

```bash
openssl rand -hex 24 | tr -d '\n' | gcloud secrets create DB_BACKUP_PASSWORD --project clor-apps-511409 --data-file=-
gcloud secrets create BACKUP_SIGNING_KEY --project clor-apps-511409 --data-file="$K/signing"
for s in DB_BACKUP_PASSWORD BACKUP_SIGNING_KEY; do
  gcloud secrets add-iam-policy-binding $s --project clor-apps-511409 --member serviceAccount:$SA --role roles/secretmanager.secretAccessor
done
```

Then commit the signing key's **public** half, so the restore knows which key
to trust. The repository, outside Google, is the place to check against:

```bash
echo "clor-backup-job namespaces=\"clor-backup\" $(cat "$K/signing.pub")" > deploy/backup/allowed_signers
git add deploy/backup/allowed_signers && git commit -m "Backups: the job's public signing key"
rm "$K/signing" "$K/signing.pub"    # the private half now lives only in Secret Manager
```

### 6. Database role

```bash
gcloud secrets versions access latest --secret DB_BACKUP_PASSWORD | pbcopy
```

Open the console, go to Cloud SQL → `clor-pg` → Cloud SQL Studio, and sign in
as `postgres` on `clor_main`. Paste in `deploy/backup/grant-backup-role.sql`,
put the copied password where it says `PASTE_PASSWORD_HERE`, run it, and
clear the clipboard (`pbcopy < /dev/null`). If `GRANT pg_read_all_data` is
refused, the file has a fallback.

The SQL carries the password in clear text. On 5 Nov 2026 `clor-pg` had no
`log_statement` flag and no pgaudit, so the statement is not logged. Check
again just before:

```bash
gcloud sql instances describe clor-pg --format='value(settings.databaseFlags)'
```

If either is set, raise it with the coordinator first.

### 7. Image and job

```bash
TAG=$(git rev-parse --short HEAD)
gcloud builds submit --config deploy/backup/cloudbuild.yaml --substitutions=_TAG=$TAG \
  --service-account=projects/clor-apps-511409/serviceAccounts/clor-build@clor-apps-511409.iam.gserviceaccount.com \
  deploy/backup

gcloud run jobs create clor-backup --region asia-south1 \
  --image asia-south1-docker.pkg.dev/clor-apps-511409/clor/backup:$TAG \
  --service-account $SA \
  --set-cloudsql-instances clor-apps-511409:asia-south1:clor-pg \
  --set-env-vars "^;^PGHOST=/cloudsql/clor-apps-511409:asia-south1:clor-pg;PGUSER=clor_backup;CLOR_BACKUP_DEST=$B;CLOR_BACKUP_SIGNING_KEY_FILE=/secrets/signing/key;CLOR_BACKUP_RECIPIENTS=age1OWNER... age1SPARE..." \
  --set-secrets PGPASSWORD=DB_BACKUP_PASSWORD:latest,/secrets/signing/key=BACKUP_SIGNING_KEY:latest \
  --cpu 1 --memory 1Gi --task-timeout 15m --max-retries 1
```

(`^;^` makes `;` the separator, because the two keys are separated by a space.)

### 8. First run, and the first drill

```bash
gcloud run jobs execute clor-backup --region asia-south1 --wait
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="clor-backup"' --limit 20 --format='value(textPayload)'
```

The last line reads
`backup: written: gs://... frequent/clor-prod-....tar.age as frequent, daily, monthly (N bytes, N rows, Ns)`.
Then run the monthly drill above. Do not schedule anything until the drill
passes.

### 9. Schedule

```bash
gcloud run jobs add-iam-policy-binding clor-backup --region asia-south1 --member serviceAccount:$SA --role roles/run.invoker
gcloud scheduler jobs create http clor-backup --location asia-south1 \
  --schedule '30 2,8,14,20 * * *' --time-zone 'Asia/Kolkata' \
  --uri 'https://run.googleapis.com/v2/projects/clor-apps-511409/locations/asia-south1/jobs/clor-backup:run' \
  --http-method POST --oauth-service-account-email $SA
```

### 10. Be told when it fails, or when it does not run at all

There are two alerts, because a failed run and a run that never started look
different. If Scheduler is paused, loses its permission or is deleted, no run
happens, so no run fails, and only the second alert fires.

```bash
CH=$(gcloud beta monitoring channels create --display-name "Owner email" --type email \
     --channel-labels email_address=<your email> --format='value(name)')
for f in alert-failed alert-no-success; do
  sed "s#CHANNEL#$CH#" deploy/backup/$f.json > /tmp/$f.json
  gcloud alpha monitoring policies create --policy-from-file /tmp/$f.json && rm /tmp/$f.json
done
```

- `alert-failed.json`: any failed run.
- `alert-no-success.json`: no successful run for 7 hours. Runs are 6 hours
  apart, so one missed run is enough.

Test the first alert once: run the job with a broken setting for that one
execution only, and the email arrives within minutes.

```bash
gcloud run jobs execute clor-backup --region asia-south1 --update-env-vars CLOR_BACKUP_DEST=broken
```

If an alert never fires in that test, check in Metrics Explorer that
`run.googleapis.com/job/completed_execution_count` has a `result` label with
the values `succeeded` and `failed`.

### 11. Every month

- Run the drill, check the recipients, and write it in the devops log.
- Optionally, copy the month's archive outside Google.

## Testing the scripts

`deploy/backup/test-local.sh` runs on a throwaway local PostgreSQL. It refuses
any host that is not this machine. It covers 36 checks:

- the round trip as a non-superuser reader through FORCE RLS, partitioned
  tables included, with a value that holds a newline, a tab and a backslash;
- both keys, and the restore as a non-superuser;
- the daily and monthly copies taken by the first successful run;
- the `gs://` upload against a local stand-in (`gcs-standin.py`), including
  write-once and a wrong stored MD5.

It also checks every refusal:

- no key, no signing key, or a private key given as the public one;
- restoring as a superuser;
- a wrong key, a damaged archive, a missing signature, or a signature by
  anyone but the job;
- forged archives signed with the job's own key: an injected database name,
  a pattern in a manifest key, a symlink, an extra file, a wrong row count;
- an existing target database;
- an interrupted restore, which must leave nothing behind;
- a policy without the bypass, one that mentions the bypass but does not let
  it through, one that does not apply to the backup role, and RLS with no
  policy;
- an unlisted database, an unreadable table, and every table empty.

```bash
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=<superuser> deploy/backup/test-local.sh
```
