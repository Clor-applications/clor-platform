#!/usr/bin/env bash
# Release CLOR: the API to Cloud Run, the web app and the website to Cloudflare
# Pages, and a record of it in git (a rel-<sha7> tag and a CHANGELOG.md entry).
#
#   scripts/release.sh            Dry run (the default). Prints every command, in
#                                 order, and the changelog entry. Runs nothing.
#   scripts/release.sh --stage    Backs up the database, builds the API image and
#                                 starts it on Cloud Run with no traffic, tagged
#                                 rel-<sha7>, and checks /ready there. Customers
#                                 stay on the old revision. Stops.
#   scripts/release.sh --go       All of --stage, then moves traffic to the new
#                                 revision, builds and publishes the web app and
#                                 the website, tags the commit and writes the
#                                 CHANGELOG.md entry.
#
#   --skip-web        with --go: leave the web app (Pages project clor-app) alone
#   --skip-website    with --go: leave clor.in (Pages project clor) alone
#   --since <ref>     count pull requests from this ref instead of the last rel- tag
#   --no-push-tag     with --go: make the tag here but do not push it
#
# Run it from a clean checkout of origin/main (DEPLOY.md says how to make one).
# With --stage or --go it refuses anything else: what is released must be what
# is merged.
#
# Two things to know before --stage:
#  - Migrations run when the new revision starts (server/scripts/cloudrun-start.sh),
#    so they are applied to the live database BEFORE any traffic moves. That is
#    why the backup comes first, and why migrations must be additive: the old
#    revision keeps serving on the new schema until traffic moves, and again
#    after a rollback.
#  - Rolling back is moving traffic back to the revision that was serving before
#    this release. The script reads its name before it moves anything and prints
#    the command at the end. It does not undo a migration.
set -euo pipefail

PROJECT=clor-apps-511409
REGION=asia-south1
SERVICE=clor-api
SQL_INSTANCE=clor-pg
IMAGE_REPO=asia-south1-docker.pkg.dev/$PROJECT/clor/api
BUILD_ACCOUNT=projects/$PROJECT/serviceAccounts/clor-build@$PROJECT.iam.gserviceaccount.com
# The stable half of the service's run.app address; a tag goes in front of it.
RUN_HOST=clor-api-nmprtntkma-el.a.run.app
WEB_PROJECT=clor-app
SITE_PROJECT=clor
SIGNING_KEY=${AGENT_SIGNING_KEY_FILE:-$HOME/.config/clor/agent-signing.key}

MODE=dry
SKIP_WEB=0
SKIP_SITE=0
PUSH_TAG=1
SINCE=
while [ $# -gt 0 ]; do
  case "$1" in
    --go) MODE=go ;;
    --stage) MODE=stage ;;
    --skip-web) SKIP_WEB=1 ;;
    --skip-website) SKIP_SITE=1 ;;
    --no-push-tag) PUSH_TAG=0 ;;
    --since) SINCE=${2:?--since needs a ref}; shift ;;
    -h|--help) sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

step() { printf '\n== %s\n' "$1"; }
say() { printf '   %s\n' "$1"; }
stop() { printf '\nStopped: %s\n' "$1" >&2; exit 1; }

# Every command that changes anything goes through run(): printed always,
# executed only when this part of the release is switched on.
#   run stage <cmd...>   runs with --stage and --go
#   run go <cmd...>      runs with --go only
run() {
  local level=$1; shift
  printf '   $'; printf ' %q' "$@"; printf '\n'
  if [ "$MODE" = dry ]; then return 0; fi
  if [ "$level" = go ] && [ "$MODE" != go ]; then return 0; fi
  "$@"
}
# The same, in another folder.
run_in() {
  local level=$1 dir=$2; shift 2
  printf '   $ (cd %q &&' "$dir"; printf ' %q' "$@"; printf ')\n'
  if [ "$MODE" = dry ]; then return 0; fi
  if [ "$level" = go ] && [ "$MODE" != go ]; then return 0; fi
  (cd "$dir" && "$@")
}
on() { [ "$MODE" = go ] || { [ "$MODE" = stage ] && [ "$1" = stage ]; }; }

# ---------------------------------------------------------------------------
step "What is being released"
git fetch --quiet origin main || say "Could not fetch origin/main; using what is here."
HEAD_SHA=$(git rev-parse HEAD)
MAIN_SHA=$(git rev-parse origin/main)
SHA7=$(git rev-parse --short=7 HEAD)
TAG=rel-$SHA7
TAG_URL=https://$TAG---$RUN_HOST
say "Commit $SHA7: $(git log -1 --pretty=%s)"
say "Mode: $MODE$([ "$MODE" = dry ] && echo ' (nothing below is run)')"

PROBLEMS=
[ "$HEAD_SHA" = "$MAIN_SHA" ] || PROBLEMS="this checkout is at $SHA7, origin/main is at $(git rev-parse --short=7 origin/main)"
[ -z "$(git status --porcelain)" ] || PROBLEMS="${PROBLEMS:+$PROBLEMS; }there are uncommitted or untracked files here"
if [ -n "$PROBLEMS" ]; then
  if [ "$MODE" = dry ]; then say "NOTE: a real release would refuse: $PROBLEMS."; else stop "$PROBLEMS. Release from a clean checkout of origin/main."; fi
fi
if [ "$MODE" != dry ]; then
  for tool in gcloud curl node npm wrangler; do command -v "$tool" >/dev/null || stop "$tool is not installed (wrangler: the Cloudflare CLI, installed on this Mac outside the project, never fetched by npx)."; done
fi

PREVIOUS=${SINCE:-$(git tag --list 'rel-*' --merged HEAD --sort=-creatordate | grep -vx "$TAG" | head -1 || true)}
say "Previous release: ${PREVIOUS:-none recorded in git yet}"

# The revision customers are on now: the rollback target. Read by name, not by
# tag. A tag only exists while some traffic entry carries it, and until 14 Nov
# 2026 step 6 used --set-tags, which wiped the previous release's tag, so the
# printed rollback (by the previous release's tag) failed when it was needed.
SERVING='<the revision serving now>'
if [ "$MODE" != dry ]; then
  SERVING=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format=json \
    | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));const t=(s.status.traffic||[]).filter(x=>x.percent>0).sort((a,b)=>b.percent-a.percent);process.stdout.write(t.length?t[0].revisionName:"")')
  [ -n "$SERVING" ] || stop "Could not read which revision is serving now, so there would be nothing to roll back to."
fi
say "Serving now (the rollback target): $SERVING"

# ---------------------------------------------------------------------------
step "1. The on-site connector, signed (DEPLOY.md, The on-site connector)"
if [ -f "$SIGNING_KEY" ]; then
  run_in stage server npm run agent:build
  run_in stage server env AGENT_SIGNING_KEY_FILE="$SIGNING_KEY" npm run agent:sign
else
  say "No signing key at $SIGNING_KEY: the image builds the connector unsigned,"
  say "and connectors already at customers stay on the version they have."
fi

step "2. Back up the database (the migrations run at step 4, before any new revision exists)"
run stage gcloud sql backups create --instance "$SQL_INSTANCE" --project "$PROJECT"

step "3. Build the API image"
run stage gcloud builds submit --project "$PROJECT" --config cloudbuild.cloudrun.yaml "--substitutions=_TAG=$SHA7" "--service-account=$BUILD_ACCOUNT" .

step "4. Apply the migrations, in their own job"
# Until 13 Nov 2026 every serving container migrated at start, so one bad
# migration broke all of them at once. Now it happens once, here: if it fails,
# nothing has taken traffic and the old revision keeps serving.
run stage ./scripts/migrate.sh "$SHA7" --go

step "5. Start it on Cloud Run with no traffic"
run stage gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --image "$IMAGE_REPO:$SHA7" --no-traffic --quiet

REVISION='<new revision>'
if on stage; then
  REVISION=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.latestCreatedRevisionName)')
  [ -n "$REVISION" ] || stop "Cloud Run did not name the new revision."
  # The revision must be the image just built, not an older one that happens to be newest.
  RUNNING_IMAGE=$(gcloud run revisions describe "$REVISION" --project "$PROJECT" --region "$REGION" --format='value(spec.containers[0].image)')
  case "$RUNNING_IMAGE" in *":$SHA7"|*"@sha256:"*) ;; *) stop "Revision $REVISION runs $RUNNING_IMAGE, not api:$SHA7." ;; esac
  say "New revision: $REVISION"
fi

step "6. Tag the revision $TAG"
# --update-tags adds this one and keeps the rest. --set-tags replaces every tag
# on the service, which deleted the previous release's tag (14 Nov 2026).
run stage gcloud run services update-traffic "$SERVICE" --project "$PROJECT" --region "$REGION" --update-tags "$TAG=$REVISION"

step "7. Is it ready? $TAG_URL/ready"
# /ready answers 200 once the API has started and reached its databases. It is
# the one path the edge guard lets through on a run.app address.
ready_check() {
  local try=1
  while [ "$try" -le 18 ]; do
    if curl --fail --silent --show-error --max-time 20 --output /dev/null "$TAG_URL/ready"; then return 0; fi
    say "not ready yet (try $try of 18)"
    try=$((try + 1))
    sleep 10
  done
  return 1
}
printf '   $ curl --fail --max-time 20 %q   (up to 18 tries, 10 seconds apart)\n' "$TAG_URL/ready"
if on stage; then
  ready_check || stop "$TAG_URL/ready did not answer 200. No traffic was moved; customers are still on the old revision. Read the revision's log: gcloud run revisions logs read $REVISION --project $PROJECT --region $REGION"
  say "Ready."
fi

if [ "$MODE" = stage ]; then
  step "Staged"
  say "$REVISION is running with no traffic at $TAG_URL"
  say "To finish the release, run: scripts/release.sh --go"
  say "(--go builds and stages again, then moves traffic. To move traffic by hand instead:"
  say " gcloud run services update-traffic $SERVICE --project $PROJECT --region $REGION --to-tags $TAG=100)"
  exit 0
fi

# ---------------------------------------------------------------------------
step "8. Move traffic to $TAG   (--go only)"
run go gcloud run services update-traffic "$SERVICE" --project "$PROJECT" --region "$REGION" --to-tags "$TAG=100"

if [ "$SKIP_WEB" = 1 ]; then
  step "8. Web app: skipped (--skip-web)"
else
  step "8. Build and publish the web app (Pages project $WEB_PROJECT)   (--go only)"
  run go npm run build
  run go wrangler pages deploy dist --project-name clor-app --branch main
fi

if [ "$SKIP_SITE" = 1 ]; then
  step "9. Website: skipped (--skip-website)"
else
  step "9. Build and publish clor.in (Pages project $SITE_PROJECT)   (--go only)"
  run_in go website npm run build
  run_in go website wrangler pages deploy dist --project-name clor --branch main
fi

step "9. Record the release   (--go only)"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  say "Tag $TAG already exists; left as it is."
else
  run go git tag -a "$TAG" -m "Release $TAG: Cloud Run revision $REVISION"
  if [ "$PUSH_TAG" = 1 ]; then run go git push origin "$TAG"; fi
fi
NOTES=(node scripts/release-notes.mjs --tag "$TAG" --revision "$REVISION")
if [ -n "$PREVIOUS" ]; then NOTES+=(--previous "$PREVIOUS"); fi
if [ "$MODE" = go ]; then
  run go "${NOTES[@]}" --write
  say "CHANGELOG.md is changed here and not committed: main takes changes by pull request."
  say "Open one with just that file, e.g. 'Release record: $TAG'."
else
  printf '   $'; printf ' %q' "${NOTES[@]}" --write; printf '\n'
  say "The entry it would write, from the pull requests merged since ${PREVIOUS:-the start}:"
  "${NOTES[@]}" | sed 's/^/     | /'
fi

step "Done$([ "$MODE" = dry ] && echo ' (dry run: nothing was run)')"
say "To roll the API back, move traffic to the revision that was serving before this release:"
say "  gcloud run services update-traffic $SERVICE --project $PROJECT --region $REGION --to-revisions $SERVING=100"
say "To roll the web app or the website back: Cloudflare dashboard, the Pages project, Deployments, the one before, Rollback."
if [ "$MODE" = dry ]; then say "Nothing was changed. Run with --stage to try the new revision without traffic, or --go to release."; fi
