#!/usr/bin/env bash
# Release CLOR with the API on AWS (deploy/aws/README.md): the API to the EC2
# server, the web app and the website to Cloudflare Pages, and a record of it
# in git (a rel-<sha7> tag and a CHANGELOG.md entry). The AWS twin of
# scripts/release.sh, which releases to Cloud Run; same modes, same order.
#
#   scripts/release-aws.sh            Dry run (the default). Prints every step. Runs nothing.
#   scripts/release-aws.sh --stage    Snapshot of the database, image built and pushed,
#                                     migrations applied, the new image started beside
#                                     the live one and checked at /ready. Customers stay
#                                     on the old image. Stops.
#   scripts/release-aws.sh --go       All of --stage, then the new image becomes the live
#                                     one, the web app and the website are published, the
#                                     commit is tagged and CHANGELOG.md gets its entry.
#
#   --skip-api        with --go: leave the API alone (web app and website only)
#   --skip-web        with --go: leave the web app (Pages project clor-app) alone
#   --skip-website    with --go: leave clor.in (Pages project clor) alone
#   --since <ref>     count pull requests from this ref instead of the last rel- tag
#   --no-push-tag     with --go: make the tag here but do not push it
#
#   scripts/release-aws.sh --rollback <sha7>        Prints what a rollback to that
#                                     release's image would run. Nothing else.
#   scripts/release-aws.sh --rollback <sha7> --go   Makes that image the live one
#                                     again. Does not undo a migration.
#
# Needs on this Mac: aws (signed in), docker (running), node, npm, wrangler.
# Migrations must be additive, as before: the old image keeps serving on the
# new schema until the switch, and again after a rollback.
set -euo pipefail

export AWS_REGION=${AWS_REGION:-ap-south-1}
export AWS_DEFAULT_REGION=$AWS_REGION
STACK=${CLOR_STACK:-clor}
ORIGIN_HOST=${CLOR_ORIGIN_HOST:-origin.clor.in}
DB_INSTANCE=clor-pg
WEB_PROJECT=clor-app
SITE_PROJECT=clor
SIGNING_KEY=${AGENT_SIGNING_KEY_FILE:-$HOME/.config/clor/agent-signing.key}
READY_URL=${CLOR_READY_URL:-https://api.clor.in/ready}

MODE=dry SKIP_API=0 SKIP_WEB=0 SKIP_SITE=0 PUSH_TAG=1 SINCE= ROLLBACK=
while [ $# -gt 0 ]; do
  case "$1" in
    --go) MODE=go ;;
    --stage) MODE=stage ;;
    --skip-api) SKIP_API=1 ;;
    --skip-web) SKIP_WEB=1 ;;
    --skip-website) SKIP_SITE=1 ;;
    --no-push-tag) PUSH_TAG=0 ;;
    --since) SINCE=${2:?--since needs a ref}; shift ;;
    --rollback) ROLLBACK=${2:?--rollback needs a release, e.g. ad81ab7}; shift ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

step() { printf '\n== %s\n' "$1"; }
say() { printf '   %s\n' "$1"; }
stop() { printf '\nStopped: %s\n' "$1" >&2; exit 1; }
run() {
  local level=$1; shift
  printf '   $'; printf ' %q' "$@"; printf '\n'
  if [ "$MODE" = dry ]; then return 0; fi
  if [ "$level" = go ] && [ "$MODE" != go ]; then return 0; fi
  "$@"
}
run_in() {
  local level=$1 dir=$2; shift 2
  printf '   $ (cd %q &&' "$dir"; printf ' %q' "$@"; printf ')\n'
  if [ "$MODE" = dry ]; then return 0; fi
  if [ "$level" = go ] && [ "$MODE" != go ]; then return 0; fi
  (cd "$dir" && "$@")
}
on() { [ "$MODE" = go ] || { [ "$MODE" = stage ] && [ "$1" = stage ]; }; }

stack_output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

# Run a shell script on the server as root, wait for it, show what it printed.
# No SSH: AWS Systems Manager carries it, and the server has no open port for it.
on_server() { # on_server <level> <what it does> <script text>
  local level=$1 what=$2 script=$3
  say "on the server: $what"
  if [ "$MODE" = dry ]; then return 0; fi
  if [ "$level" = go ] && [ "$MODE" != go ]; then return 0; fi
  local params id status
  params=$(node -e 'process.stdout.write(JSON.stringify({commands:[process.argv[1]],executionTimeout:["1800"]}))' "$script")
  id=$(aws ssm send-command --instance-ids "$SERVER" --document-name AWS-RunShellScript \
        --comment "clor release: $what" --parameters "$params" --query Command.CommandId --output text)
  while :; do
    sleep 4
    status=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$SERVER" --query Status --output text 2>/dev/null || echo Pending)
    case "$status" in Pending|InProgress|Delayed) ;; *) break ;; esac
  done
  aws ssm get-command-invocation --command-id "$id" --instance-id "$SERVER" --query StandardOutputContent --output text | sed 's/^/     | /'
  if [ "$status" != Success ]; then
    aws ssm get-command-invocation --command-id "$id" --instance-id "$SERVER" --query StandardErrorContent --output text | sed 's/^/     ! /' >&2
    return 1
  fi
}

# The four files the server runs from, packed into the command itself (a few KB).
server_files() {
  local pack
  pack=$(tar -C deploy/aws -czf - docker-compose.yml Caddyfile api.env clor-server.sh | base64 | tr -d '\n')
  printf 'set -e; mkdir -p /opt/clor; cd /opt/clor; echo %s | base64 -d | tar -xzf -; chmod +x clor-server.sh; export ORIGIN_HOST=%q; ' "$pack" "$ORIGIN_HOST"
}

SERVER='<server id>' REPO='<image repository>'
if [ "$MODE" != dry ]; then
  for tool in aws curl node npm; do command -v "$tool" >/dev/null || stop "$tool is not installed."; done
  aws sts get-caller-identity >/dev/null || stop "aws is not signed in (aws sso login, or aws configure)."
  SERVER=$(stack_output ApiServerId); REPO=$(stack_output ImageRepository)
  [ -n "$SERVER" ] && [ -n "$REPO" ] || stop "The '$STACK' stack has no server or image repository. Was it created? (deploy/aws/README.md)"
fi

# ---------------------------------------------------------------------------
if [ -n "$ROLLBACK" ]; then
  [[ "$ROLLBACK" =~ ^[0-9a-f]{7}$ ]] || stop "'$ROLLBACK' is not a release (seven characters of a commit, e.g. ad81ab7)."
  [ "$MODE" != stage ] || stop "--rollback goes with --go, or alone for a dry run."
  step "Roll the API back to rel-$ROLLBACK$([ "$MODE" = dry ] && echo ' (dry run: nothing is run)')"
  on_server go "make $REPO:$ROLLBACK the live image" "$(server_files)./clor-server.sh switch $REPO:$ROLLBACK" \
    || stop "The server could not switch to rel-$ROLLBACK; it put back what was serving."
  say "A rollback does not undo a migration, the web app or the website."
  exit 0
fi

# ---------------------------------------------------------------------------
step "What is being released"
git fetch --quiet origin main || say "Could not fetch origin/main; using what is here."
HEAD_SHA=$(git rev-parse HEAD)
MAIN_SHA=$(git rev-parse origin/main)
SHA7=$(git rev-parse --short=7 HEAD)
TAG=rel-$SHA7
IMAGE=$REPO:$SHA7
say "Commit $SHA7: $(git log -1 --pretty=%s)"
say "Mode: $MODE$([ "$MODE" = dry ] && echo ' (nothing below is run)')"

PROBLEMS=
[ "$HEAD_SHA" = "$MAIN_SHA" ] || PROBLEMS="this checkout is at $SHA7, origin/main is at $(git rev-parse --short=7 origin/main)"
[ -z "$(git status --porcelain)" ] || PROBLEMS="${PROBLEMS:+$PROBLEMS; }there are uncommitted or untracked files here"
if [ -n "$PROBLEMS" ]; then
  if [ "$MODE" = dry ]; then say "NOTE: a real release would refuse: $PROBLEMS."; else stop "$PROBLEMS. Release from a clean checkout of origin/main."; fi
fi
if [ "$MODE" != dry ]; then
  [ "$SKIP_API" = 1 ] || { command -v docker >/dev/null && docker info >/dev/null 2>&1; } || stop "Docker is not running on this Mac (the API image is built here)."
  [ "$MODE" != go ] || [ "$SKIP_WEB$SKIP_SITE" = 11 ] || command -v wrangler >/dev/null || stop "wrangler (the Cloudflare CLI) is not installed."
fi

PREVIOUS=${SINCE:-$(git tag --list 'rel-*' --merged HEAD --sort=-creatordate | grep -vx "$TAG" | head -1 || true)}
say "Previous release: ${PREVIOUS:-none recorded in git yet}"
SERVING='<the image serving now>'

if [ "$SKIP_API" = 1 ]; then
  step "API: skipped (--skip-api)"
else
  if [ "$MODE" != dry ]; then
    SERVING=$(on_server stage "which image is serving" "cd /opt/clor 2>/dev/null && ./clor-server.sh serving || true" | sed -n 's/^     | //p' | tail -1)
  fi
  say "Serving now (the rollback target): ${SERVING:-nothing yet}"

  step "1. The on-site connector, signed"
  if [ -f "$SIGNING_KEY" ]; then
    run_in stage server npm run agent:build
    run_in stage server env AGENT_SIGNING_KEY_FILE="$SIGNING_KEY" npm run agent:sign
  else
    say "No signing key at $SIGNING_KEY: the image builds the connector unsigned,"
    say "and connectors already at customers stay on the version they have."
  fi

  step "2. Snapshot of the database (the migrations run at step 4)"
  # On top of RDS's own nightly backup and restore-to-any-minute. Named by the
  # release, so a second run of the same release finds it and moves on.
  SNAP=clor-pg-$TAG
  if on stage && aws rds describe-db-snapshots --db-snapshot-identifier "$SNAP" >/dev/null 2>&1; then
    say "Snapshot $SNAP already exists; left as it is."
  else
    run stage aws rds create-db-snapshot --db-instance-identifier "$DB_INSTANCE" --db-snapshot-identifier "$SNAP"
    run stage aws rds wait db-snapshot-available --db-snapshot-identifier "$SNAP"
  fi
  # Keep the newest five release snapshots; each older one costs storage.
  if on stage; then
    for old in $(aws rds describe-db-snapshots --db-instance-identifier "$DB_INSTANCE" --snapshot-type manual \
        --query "reverse(sort_by(DBSnapshots[?starts_with(DBSnapshotIdentifier,'clor-pg-rel-')],&SnapshotCreateTime))[5:].DBSnapshotIdentifier" --output text); do
      run stage aws rds delete-db-snapshot --db-snapshot-identifier "$old" >/dev/null
    done
  fi

  step "3. Build the API image here and push it"
  # The server is ARM (t4g), and so is this Mac, so the build is native.
  if on stage; then
    aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}" >/dev/null
  fi
  run stage docker buildx build --platform linux/arm64 -f docker/api.cloudrun.Dockerfile -t "$IMAGE" --push server

  step "4. Apply the migrations"
  on_server stage "apply the migrations with $IMAGE" "$(server_files)./clor-server.sh migrate $IMAGE" \
    || stop "The migrations failed. Nothing was switched; customers are still on ${SERVING:-the old image}."

  step "5. Start the new image beside the live one and ask it /ready"
  on_server stage "stage $IMAGE" "$(server_files)./clor-server.sh stage $IMAGE" \
    || stop "The new image did not become ready. Nothing was switched; customers are still on ${SERVING:-the old image}."

  if [ "$MODE" = stage ]; then
    step "Staged"
    say "$IMAGE started and answered /ready, and was stopped again. Customers are on ${SERVING:-the old image}."
    say "To finish the release, run: scripts/release-aws.sh --go"
    exit 0
  fi

  step "6. Make it the live image   (--go only)"
  on_server go "switch to $IMAGE" "$(server_files)./clor-server.sh switch $IMAGE" \
    || stop "The server could not switch to $IMAGE; it put back what was serving."
  printf '   $ curl --fail --max-time 20 %q   (up to 6 tries, 10 seconds apart)\n' "$READY_URL"
  if [ "$MODE" = go ]; then
    try=1
    until curl --fail --silent --show-error --max-time 20 --output /dev/null "$READY_URL"; do
      [ "$try" -lt 6 ] || stop "$READY_URL did not answer 200 through Cloudflare, though the server says the API is up. Check the Worker's ORIGIN and the origin DNS record."
      try=$((try + 1)); sleep 10
    done
    say "Ready through api.clor.in."
  fi
fi

if [ "$SKIP_WEB" = 1 ]; then
  step "7. Web app: skipped (--skip-web)"
else
  step "7. Build and publish the web app (Pages project $WEB_PROJECT)   (--go only)"
  run go npm run build
  run go wrangler pages deploy dist --project-name "$WEB_PROJECT" --branch main
fi

if [ "$SKIP_SITE" = 1 ]; then
  step "8. Website: skipped (--skip-website)"
else
  step "8. Build and publish clor.in (Pages project $SITE_PROJECT)   (--go only)"
  run_in go website npm run build
  run_in go website wrangler pages deploy dist --project-name "$SITE_PROJECT" --branch main
fi

step "9. Record the release   (--go only)"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  say "Tag $TAG already exists; left as it is."
else
  run go git tag -a "$TAG" -m "Release $TAG: AWS image $IMAGE"
  if [ "$PUSH_TAG" = 1 ]; then run go git push origin "$TAG"; fi
fi
NOTES=(node scripts/release-notes.mjs --tag "$TAG" --revision "aws:$SHA7")
if [ -n "$PREVIOUS" ]; then NOTES+=(--previous "$PREVIOUS"); fi
if [ "$MODE" = go ]; then
  run go "${NOTES[@]}" --write
  say "CHANGELOG.md is changed here and not committed: open a 'Release record: $TAG' pull request."
else
  printf '   $'; printf ' %q' "${NOTES[@]}" --write; printf '\n'
fi

step "Done$([ "$MODE" = dry ] && echo ' (dry run: nothing was run)')"
say "To roll the API back, name the release that was serving before (the part after the colon of: ${SERVING:-<image>}):"
say "  scripts/release-aws.sh --rollback <sha7>          (prints the plan; add --go to do it)"
say "To roll the web app or the website back: Cloudflare dashboard, the Pages project, Deployments, the one before, Rollback."
