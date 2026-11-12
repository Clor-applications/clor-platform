#!/usr/bin/env bash
# One-time setup: a daily copy of the four production databases to a separate,
# storage bucket in Delhi (asia-south2). Every night's copy is kept for 30 days;
# anything deleted, even by an admin, can be brought back for 30 days.
# Also keeps clor-pg's own backups if the database server is ever deleted.
# Safe to run twice: steps that already exist are skipped.
set -uo pipefail
P=clor-apps-511409
B=gs://${P}-db-copies
SQL_SA=$(gcloud sql instances describe clor-pg --project $P --format='value(serviceAccountEmailAddress)')
COPY_SA=clor-db-copy@${P}.iam.gserviceaccount.com

step() { echo; echo "== $1"; }

step "Bucket in Delhi: every night kept 30 days, deletes recoverable 30 days"
gcloud storage buckets describe $B >/dev/null 2>&1 || \
  gcloud storage buckets create $B --project $P --location asia-south2 \
    --uniform-bucket-level-access --public-access-prevention --soft-delete-duration 30d
gcloud storage buckets update $B --versioning --soft-delete-duration 30d
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"daysSinceNoncurrentTime":30,"isLive":false}}]}' > /tmp/clor-lifecycle.json
gcloud storage buckets update $B --lifecycle-file=/tmp/clor-lifecycle.json

step "Database server may write copies into the bucket (this bucket only)"
gcloud storage buckets add-iam-policy-binding $B \
  --member serviceAccount:$SQL_SA --role roles/storage.objectAdmin >/dev/null

step "Account that starts the daily copy, allowed only to export"
gcloud iam roles describe dbCopier --project $P >/dev/null 2>&1 || \
  gcloud iam roles create dbCopier --project $P --title "Database copier" \
    --permissions cloudsql.instances.export,cloudsql.instances.get --stage GA >/dev/null
gcloud iam service-accounts describe $COPY_SA --project $P >/dev/null 2>&1 || \
  gcloud iam service-accounts create clor-db-copy --project $P --display-name "Daily database copy"
gcloud projects add-iam-policy-binding $P --member serviceAccount:$COPY_SA \
  --role projects/$P/roles/dbCopier --condition=None >/dev/null

step "Four daily jobs, 2:00-2:45 am India time, one database each"
URL="https://sqladmin.googleapis.com/v1/projects/$P/instances/clor-pg/export"
MIN=0
for DB in clor_platform clor_main clor_people clor_payroll; do
  BODY="{\"exportContext\":{\"fileType\":\"SQL\",\"databases\":[\"$DB\"],\"offload\":true,\"uri\":\"$B/$DB/$DB.sql.gz\"}}"
  ARGS=(--project $P --location asia-south1 --schedule "$MIN 2 * * *" --time-zone Asia/Kolkata
        --uri "$URL" --http-method POST --message-body "$BODY"
        --oauth-service-account-email $COPY_SA
        --oauth-token-scope https://www.googleapis.com/auth/cloud-platform)
  if gcloud scheduler jobs describe db-copy-$DB --location asia-south1 --project $P >/dev/null 2>&1; then
    gcloud scheduler jobs update http db-copy-$DB "${ARGS[@]}" --update-headers Content-Type=application/json >/dev/null
  else
    gcloud scheduler jobs create http db-copy-$DB "${ARGS[@]}" --headers Content-Type=application/json >/dev/null
  fi
  echo "db-copy-$DB at 2:$(printf %02d $MIN) am"
  MIN=$((MIN+15))
done

step "Keep clor-pg's own backups if the server is deleted"
gcloud sql instances patch clor-pg --project $P --retain-backups-on-delete --quiet

echo
echo "All set. First copies land tonight at 2 am. Tell Claude 'check copies' tomorrow."
