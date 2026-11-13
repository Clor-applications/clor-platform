#!/usr/bin/env bash
# Apply the database migrations BEFORE a new API revision takes traffic.
#
# Until 13 Nov 2026 every serving container ran `prisma migrate deploy` at
# start. One bad migration therefore broke every instance at once, and could
# leave a failed row that blocked every later deploy (seen 12 Nov 2026). Now a
# Cloud Run job runs them once, on the same image, with the same database
# credential; if it fails, nothing has taken traffic and the old revision keeps
# serving.
#
#   scripts/migrate.sh <image-tag> [--go]
#
# Without --go it only prints what it would run. The job is created the first
# time and updated after that, so running it twice is safe: Prisma applies each
# migration once.
set -euo pipefail

TAG="${1:-}"
GO="${2:-}"
PROJECT="${CLOR_PROJECT:-clor-apps-511409}"
REGION="${CLOR_REGION:-asia-south1}"
JOB="${CLOR_MIGRATE_JOB:-clor-api-migrate}"
INSTANCE="${CLOR_SQL_INSTANCE:-$PROJECT:$REGION:clor-pg}"
RUNNER="${CLOR_API_SA:-clor-api-run@$PROJECT.iam.gserviceaccount.com}"
IMAGE_REPO="${CLOR_IMAGE_REPO:-$REGION-docker.pkg.dev/$PROJECT/clor/api}"
# A staging deploy points the same job at its own four databases.
SUFFIX="${DB_NAME_SUFFIX:-}"

if [ -z "$TAG" ]; then
  echo "usage: scripts/migrate.sh <image-tag> [--go]" >&2
  echo "       the tag is the one you built, e.g. the git sha" >&2
  exit 2
fi

IMAGE="$IMAGE_REPO:$TAG"

# Everything the migrations need and nothing else: the four URLs are composed
# inside the image from these (server/scripts/cloudrun-start.sh).
ENVS="NODE_ENV=production,DB_USER=${CLOR_DB_USER:-clor_app},CLOUDSQL_INSTANCE=$INSTANCE,MIGRATE_ONLY=1"
[ -n "$SUFFIX" ] && ENVS="$ENVS,DB_NAME_SUFFIX=$SUFFIX"

verb=create
if gcloud run jobs describe "$JOB" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  verb=update
fi

echo "image:   $IMAGE"
echo "job:     $JOB ($verb)"
echo "project: $PROJECT   region: $REGION"
echo "databases: clor_main$SUFFIX, clor_payroll$SUFFIX, clor_people$SUFFIX, clor_platform$SUFFIX"

if [ "$GO" != "--go" ]; then
  echo
  echo "dry run. Add --go to apply the migrations."
  exit 0
fi

gcloud run jobs "$verb" "$JOB" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT" \
  --service-account "$RUNNER" \
  --set-cloudsql-instances "$INSTANCE" \
  --set-env-vars "$ENVS" \
  --set-secrets "DB_PASSWORD=DB_PASSWORD:latest" \
  --max-retries 0 \
  --task-timeout 15m \
  --quiet

echo
echo "running the job; its log follows."
gcloud run jobs execute "$JOB" --region "$REGION" --project "$PROJECT" --wait --quiet

echo
echo "migrations applied. Now deploy the revision with --no-traffic, check /ready, then move traffic."
