#!/usr/bin/env bash
# One-time: lets GitHub Actions release and roll back without a stored key
# (docs/console/SETUP.md, step 5). Safe to run again.
#
# Makes a workload identity pool that trusts only this repository's `main`,
# and one service account, clor-release, usable only by a job in the GitHub
# environment `production`, where an owner approves each run. It can do what
# scripts/release.sh needs and no more. Rolling back uses the same account
# and the same approval: Cloud Run will not let an account move traffic
# unless it may also start revisions, so there is no weaker account to give
# an unapproved rollback (tried 15 Nov 2026).
set -euo pipefail

PROJECT=${CLOR_PROJECT:-clor-apps-511409}
REGION=${CLOR_REGION:-asia-south1}
REPO=${CLOR_REPO:-Clor-applications/clor-platform}
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
POOL=github
PROVIDER=clor-platform
SUBJECT=principal://iam.googleapis.com/projects/$NUMBER/locations/global/workloadIdentityPools/$POOL/subject
sa() { echo "$1@$PROJECT.iam.gserviceaccount.com"; }
quiet() { "$@" --quiet >/dev/null; }

echo "== Services"
quiet gcloud services enable sts.googleapis.com iamcredentials.googleapis.com --project "$PROJECT"

echo "== Identity pool: only $REPO, only main"
gcloud iam workload-identity-pools describe "$POOL" --location global --project "$PROJECT" >/dev/null 2>&1 \
  || quiet gcloud iam workload-identity-pools create "$POOL" --location global --project "$PROJECT" --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool "$POOL" --location global --project "$PROJECT" >/dev/null 2>&1 \
  || quiet gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --workload-identity-pool "$POOL" --location global --project "$PROJECT" \
       --issuer-uri https://token.actions.githubusercontent.com \
       --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
       --attribute-condition "assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'"

echo "== Accounts"
gcloud iam service-accounts describe "$(sa clor-release)" --project "$PROJECT" >/dev/null 2>&1 \
  || quiet gcloud iam service-accounts create clor-release --project "$PROJECT" --display-name "Release from GitHub Actions"
# Each account answers to one GitHub environment only. GitHub names a job's
# identity "<prefix>:environment:<name>", and the prefix is not always the
# plain repository name: with immutable subjects on (this repository, 15 Nov
# 2026) it carries the owner's and repository's numeric ids, so a renamed or
# re-created repository of the same name is not trusted. Ask GitHub for it.
PREFIX=$(gh api "repos/$REPO/actions/oidc/customization/sub" --jq '.sub_claim_prefix // empty' 2>/dev/null || true)
PREFIX=${PREFIX:-repo:$REPO}
echo "   job identity prefix: $PREFIX"
bind_env() { # bind_env <account> <environment>
  local want="$SUBJECT/$PREFIX:environment:$2"
  # Drop any earlier grant under another prefix, then add the right one.
  for M in $(gcloud iam service-accounts get-iam-policy "$(sa $1)" --project "$PROJECT" --flatten='bindings[].members' --filter='bindings.role:roles/iam.workloadIdentityUser' --format='value(bindings.members)'); do
    [ "$M" = "$want" ] || quiet gcloud iam service-accounts remove-iam-policy-binding "$(sa $1)" --project "$PROJECT" --role roles/iam.workloadIdentityUser --member "$M"
  done
  quiet gcloud iam service-accounts add-iam-policy-binding "$(sa $1)" --project "$PROJECT" --role roles/iam.workloadIdentityUser --member "$want"
}
bind_env clor-release production

echo "== clor-release: what scripts/release.sh does"
#   cloudsql.editor            the backup before a release
#   cloudbuild.builds.editor   submit the image build (run as clor-build)
#   run.developer              the migrate job, the new revision, the traffic move
#   serviceusage consumer      required to call those services at all
#   logging.viewer             read a failed revision's log
for ROLE in roles/cloudsql.editor roles/cloudbuild.builds.editor roles/run.developer roles/serviceusage.serviceUsageConsumer roles/logging.viewer; do
  quiet gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$(sa clor-release)" --role "$ROLE" --condition None
done
# The build's source upload bucket, and nothing else in storage.
quiet gcloud storage buckets add-iam-policy-binding "gs://${PROJECT}_cloudbuild" --member "serviceAccount:$(sa clor-release)" --role roles/storage.admin
# It may run a build as clor-build and start a revision as clor-api-run.
for AS in clor-build clor-api-run; do
  quiet gcloud iam service-accounts add-iam-policy-binding "$(sa $AS)" --project "$PROJECT" --member "serviceAccount:$(sa clor-release)" --role roles/iam.serviceAccountUser
done

echo "== Read the image repository"
# Cloud Run checks that whoever changes a service may read its image, even for a traffic move.
quiet gcloud artifacts repositories add-iam-policy-binding clor --project "$PROJECT" --location "$REGION" --member "serviceAccount:$(sa clor-release)" --role roles/artifactregistry.reader

echo
echo "For GitHub (repository variables):"
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER = projects/$NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
echo "  GCP_RELEASE_SERVICE_ACCOUNT    = $(sa clor-release)"
