#!/usr/bin/env bash
# Build and deploy the Console API to Cloud Run. Safe to run again: it makes
# what is missing and updates the rest.
#
#   console/api/scripts/deploy.sh <owner-address>[,<owner-address>...]
#
# The argument is who may become the first owner by password (the setting
# CONSOLE_OWNER_EMAILS). First run also makes: the service account
# clor-console-run (read-only roles), and the secrets console-session-secret,
# console-edge-secret and console-owner-setup-code. The setup code is also
# written to ~/.config/clor/console-owner-setup-code.txt for the owner to
# read; it is never printed. The database comes first: scripts/setup-database.sh.
set -euo pipefail

OWNERS=${1:?owner sign-in address(es), comma-separated}
PROJECT=${CLOR_PROJECT:-clor-apps-511409}
REGION=${CLOR_REGION:-asia-south1}
INSTANCE=${CLOR_SQL_INSTANCE:-clor-pg}
SERVICE=clor-console
SA=clor-console-run@$PROJECT.iam.gserviceaccount.com
BUILD_ACCOUNT=projects/$PROJECT/serviceAccounts/clor-build@$PROJECT.iam.gserviceaccount.com
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
TAG=$(git -C "$ROOT" rev-parse --short=7 HEAD)
IMAGE=$REGION-docker.pkg.dev/$PROJECT/clor/console-api:$TAG
umask 077

echo "== Service account"
gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1 || gcloud iam service-accounts create clor-console-run --project "$PROJECT" --display-name "Engineering Console (read only)" --quiet
for ROLE in roles/run.viewer roles/cloudsql.viewer roles/cloudsql.client; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" --role "$ROLE" --condition None --quiet >/dev/null
done

echo "== Secrets"
make_secret() { # make_secret <name> <generator...>: only if it does not exist
  local name=$1; shift
  if gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then echo "kept $name"; return 1; fi
  gcloud secrets create "$name" --project "$PROJECT" --replication-policy automatic --quiet >/dev/null
  "$@" | tr -d '\n' | gcloud secrets versions add "$name" --project "$PROJECT" --data-file=- --quiet >/dev/null
  echo "made $name"
}
make_secret console-session-secret openssl rand -base64 48 || true
make_secret console-edge-secret openssl rand -hex 32 || true
if make_secret console-owner-setup-code sh -c "openssl rand -base64 24 | tr -d '/+=' | cut -c1-24"; then
  mkdir -p "$HOME/.config/clor"
  gcloud secrets versions access latest --secret console-owner-setup-code --project "$PROJECT" > "$HOME/.config/clor/console-owner-setup-code.txt"
  echo "The owner's setup code is in ~/.config/clor/console-owner-setup-code.txt"
fi
for S in console-session-secret console-edge-secret console-owner-setup-code console-database-url; do
  gcloud secrets add-iam-policy-binding "$S" --project "$PROJECT" --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor --quiet >/dev/null
done

echo "== Image $IMAGE"
gcloud builds submit "$ROOT/console/api" --project "$PROJECT" --config "$ROOT/console/api/cloudbuild.yaml" "--substitutions=_TAG=$TAG" "--service-account=$BUILD_ACCOUNT" --quiet >/dev/null

echo "== Cloud Run"
ENVS="NODE_ENV=production@CONSOLE_WEB_ORIGIN=https://console.clor.in@CONSOLE_API_ORIGIN=https://console.clor.in@CONSOLE_OWNER_EMAILS=$OWNERS"
# Optional settings pass through from this shell when set (GitHub App ids, Cloudflare account).
for V in CONSOLE_OWNER_GITHUB_IDS CONSOLE_GITHUB_APP_ID CONSOLE_GITHUB_INSTALLATION_ID CONSOLE_GITHUB_CLIENT_ID CONSOLE_CF_ACCOUNT_ID; do
  [ -n "${!V:-}" ] && ENVS="$ENVS@$V=${!V}"
done
SECRETS="CONSOLE_SESSION_SECRET=console-session-secret:latest,CONSOLE_DATABASE_URL=console-database-url:latest,CONSOLE_EDGE_SECRET=console-edge-secret:latest,CONSOLE_OWNER_SETUP_CODE=console-owner-setup-code:latest"
for PAIR in CONSOLE_GITHUB_PRIVATE_KEY=console-github-private-key CONSOLE_GITHUB_CLIENT_SECRET=console-github-client-secret CONSOLE_CF_READ_TOKEN=console-cf-read-token; do
  gcloud secrets describe "${PAIR#*=}" --project "$PROJECT" >/dev/null 2>&1 && SECRETS="$SECRETS,${PAIR%%=*}=${PAIR#*=}:latest"
done
# ^@^ makes "@" the list separator, so the comma-separated owner list stays one value.
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
  --service-account "$SA" --allow-unauthenticated --min-instances 0 --max-instances 2 --memory 512Mi --cpu 1 \
  --add-cloudsql-instances "$PROJECT:$REGION:$INSTANCE" \
  --set-env-vars "^@^$ENVS" --set-secrets "$SECRETS" --quiet 2>&1 | tail -4

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')
echo "Service: $URL"
echo "health: $(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$URL/api/health")   direct (must be 403): $(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$URL/api/auth/options")"
