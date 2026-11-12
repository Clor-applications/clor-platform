# Backup and restore

There are two different things here and conflating them would be a serious
mistake.

| | Whose | What it holds | Where |
|---|---|---|---|
| **System backup** | CLOR's | The whole database server: *every* customer's records | Cloud SQL backups of `clor-pg`; nightly copies in a storage bucket |
| **Company data backup** | The customer's | One company's own records | Settings → Account → Data Backup |

A customer must never be handed a system backup: it is other people's books. A
system backup is not a substitute for the customer's either — it cannot be
read without the server, and a customer who cannot get their data out is a
customer who is locked in.

The rest of this file is the **system** backup. The company export is described
in `docs/COMPANY-DATA-EXPORT.md`.

Production data lives in one Cloud SQL for PostgreSQL instance, `clor-pg`, in
Mumbai (`asia-south1`), project `clor-apps-511409`. It holds four databases:
`clor_main` (Books), `clor_payroll`, `clor_people` (People and Attendance) and
`clor_platform` (accounts, sign-in, billing, email). A backup of the instance
holds all four at the same moment, which matters: a salary journal that is in
one database's backup and not the other's is a set of books that does not
balance.

Until October 2026 the data was a file on a single virtual machine, backed up
by `deploy/backup.sh` and cron. That machine is retired; the script is kept
for its history and backs up nothing in production.

## What exists

Three layers. The first two are certain; check the third as shown.

**1. Cloud SQL's own daily backup.** Taken automatically every day (the one
used in the restore drill below was the 09:00 IST backup) and kept for 7 days.
It covers the whole instance.

**2. A backup before every release.** `scripts/release.sh` takes one by hand
before it deploys, because migrations run as the new revision starts
(`DEPLOY.md`). These on-demand backups are kept until somebody deletes them.

**3. A nightly copy in another city.** `scripts/ops/setup-db-copies.sh` sets
up four Cloud Scheduler jobs (`db-copy-clor_platform`, `db-copy-clor_main`,
`db-copy-clor_people`, `db-copy-clor_payroll`, 2:00 to 2:45 am IST) that export
each database to the bucket `gs://clor-apps-511409-db-copies` in Delhi
(`asia-south2`). The bucket keeps every night's copy for 30 days, and anything
deleted from it, even by an admin, can be brought back for 30 days. The same
script tells Cloud SQL to keep the instance's backups if the instance itself
is deleted. Layers 1 and 2 live with the instance; this is the one that
survives losing it, or losing Mumbai.

The script is run once, by hand, by the project owner. **Confirm it has been
run** and that copies are arriving (see "Checking", below) before relying on
layer 3.

What each layer is for:

| What went wrong | Use |
|---|---|
| A release damaged data | The backup taken just before that release (layer 2) |
| Something was deleted or overwritten in the last week | The daily backup from before it (layer 1) |
| The instance, or the region, is gone | The nightly copy in Delhi (layer 3) |
| One customer wants their own data back | Not this file: their company export, or support restores rows for them from a restored copy |

## Checking

Read-only; safe at any time.

```bash
# The backups Cloud SQL holds: daily ones and the ones taken before releases
gcloud sql backups list --instance clor-pg --project clor-apps-511409 --limit 20

# How the instance is set: backup time, how many are kept, point-in-time recovery
gcloud sql instances describe clor-pg --project clor-apps-511409 \
  --format='yaml(settings.backupConfiguration,settings.deletionProtectionEnabled)'

# The nightly copies in Delhi: there should be a file per database, from last night
gcloud storage ls -l 'gs://clor-apps-511409-db-copies/**'
gcloud scheduler jobs list --location asia-south1 --project clor-apps-511409
```

A backup that is listed `SUCCESSFUL` has still not been proved to restore.
That is what the drill is for.

## Proved, not assumed

An archive nobody has restored is a file of unknown value, and the moment you
find out is the moment you can least afford to.

**Restore drill, 11 Nov 2026:** that morning's automated backup was restored
into a temporary instance. It took 13 minutes. All four databases were opened
and checked, and the temporary instance was deleted.

Repeat it every quarter and after any change to how backups are taken, and add
a line here with the date, which backup, how long it took and what was checked.
The drill is the first four steps of "Restoring" below, followed by deleting
the temporary instance.

Not yet proved: a restore from the nightly Delhi copy (layer 3). Do that one
as its own drill once the copies are confirmed.

## Restoring

Restoring is the owner's decision. It is done **beside** the live instance,
never over it: a restore over the live instance destroys everything written
since the backup, cannot be undone, and takes the product down while it runs.
Restore into a new instance, look at it, and only then decide what to do with it.

These commands change things in Google Cloud. Read each one before running it.

**1. Choose the backup.**

```bash
gcloud sql backups list --instance clor-pg --project clor-apps-511409 --limit 20
```

Note the ID of the one from before the damage.

**2. Make an empty instance to restore into.** It must be the same PostgreSQL
version as `clor-pg` and at least as large; copy both from

```bash
gcloud sql instances describe clor-pg --project clor-apps-511409 \
  --format='value(databaseVersion,settings.tier,settings.dataDiskSizeGb,region)'

gcloud sql instances create clor-pg-restore --project clor-apps-511409 \
  --region asia-south1 --database-version <the version> --tier <the tier> --storage-size <the size>
```

**3. Restore the backup into it.**

```bash
gcloud sql backups restore <BACKUP_ID> --project clor-apps-511409 \
  --restore-instance clor-pg-restore --backup-instance clor-pg
```

**4. Look at it.** Connect to `clor-pg-restore` (Cloud SQL Studio in the
console is the least set-up) and check, in each of the four databases, that
the tables are there and the newest rows are from just before the backup: for
example the latest `"Invoice"` in `clor_main`, the latest `"User"` in
`clor_platform`, the latest attendance punch in `clor_people`.

**5. Then one of two things.**

- *Bring back particular records* (the usual case: one company's rows, one
  table). Leave production running. Copy what is needed out of the restored
  instance and into the live one, by hand, with engineering. Then delete the
  restored instance.
- *Go back entirely* (the live data is beyond repair). Everything customers
  did after the backup is lost; tell them. Stop traffic first so nothing more
  is written, point the API at the restored instance, and bring it back:

  ```bash
  gcloud run services update clor-api --project clor-apps-511409 --region asia-south1 \
    --set-cloudsql-instances clor-apps-511409:asia-south1:clor-pg-restore \
    --update-env-vars CLOUDSQL_INSTANCE=clor-apps-511409:asia-south1:clor-pg-restore
  ```

  That creates a new revision with no traffic (traffic is pinned to tags,
  `DEPLOY.md`); tag it, check `/ready`, and move traffic as in a release. The
  database password and roles come across with the backup. Record the new
  instance name in `deploy/cloudrun.service.yaml`, and set up backups and the
  nightly copy on it: a restored instance does not inherit the old one's
  schedule until it is checked.

**6. Delete what is no longer needed**: `gcloud sql instances delete clor-pg-restore`.
An extra instance costs money every hour it exists.

### From the nightly copy, when the instance is gone

Make a new instance as in step 2 (in `asia-south2` if Mumbai is the problem),
create the four empty databases and the `clor_app` role on it, then import
each file:

```bash
gcloud sql import sql <new instance> gs://clor-apps-511409-db-copies/clor_main/clor_main.sql.gz \
  --database clor_main --project clor-apps-511409
```

and the same for `clor_payroll`, `clor_people` and `clor_platform`. The four
files were written fifteen minutes apart, not at one moment, so check the
edges between them (a payroll run's journal in Books, an employee in both
People and Payroll): `npm run integrity:cross-store` in `server/` lists links
that do not match.

### A moment in time

If point-in-time recovery is on for the instance (the `describe` command
under "Checking" says), a copy can be made as of any minute in the kept
window, instead of as of a backup:

```bash
gcloud sql instances clone clor-pg clor-pg-restore --project clor-apps-511409 \
  --point-in-time '2026-11-12T08:30:00Z'
```

Then continue from step 4.

## Still missing, and it matters

- **Seven days of daily backups is short.** A mistake noticed after a week is
  only in the Delhi copies (30 days), and the public privacy notice has said
  30 daily backups. Either raise the instance's retention or change the
  notice; they should say the same thing.
- **Nobody is told when a backup or a nightly copy fails.** A failed export is
  a line in Cloud Scheduler's log. An alert on those four jobs and on Cloud
  SQL backup failures is the missing piece.
- **The Delhi copy has not been restored in a drill.**
- **Uploaded files, the day they move out of the database.** Documents, photos
  and attachments are stored in the database today (`FILE_STORE` is not set on
  the service), so the backups above include them. If they are moved to object
  storage (`npm run files:to-r2`), they stop being covered here, and that
  bucket's own versioning and retention must be written down in this file first.

Until those are done, the honest description is: recoverable from a bad
release or a deleted table within a week, with a restore that has been proved
once; recoverable from losing the instance if the nightly copies are
confirmed to be running.
