#!/usr/bin/env bash
#
# Push this working copy to the live server.
#
#   ./deploy.sh          frontend only — the common case, a few seconds
#   ./deploy.sh --api    frontend and API: reinstalls deps, applies schema
#                        changes, rebuilds and restarts the service
#   ./deploy.sh --status what is running right now, and who is deploying
#   ./deploy.sh --unlock clear a lock left by a deployer that died mid-run
#
# One deployment at a time. On 18 Sep 2026 two machines deployed the same
# commit eight minutes apart — the second swept the first's hashed bundle
# while browsers still held a page pointing at it — and the forensics took
# longer than the deploys. So a deploy takes a lock ON THE SERVER first (the
# only place both machines can see), records who and what and when, and a
# second deploy refuses rather than overwriting. The lock is released on any
# exit, including failure and Ctrl-C; only a dead process leaves one behind,
# which is what --unlock is for. Every start and end is appended to
# /opt/clor/deploy.log so the next question of "what changed at 10:16?" has
# an answer.
#
# The frontend is built HERE, never on the server. The box has 954 MB of RAM
# and a Vite build peaks well above that; the build output is just static
# files, so it does not care which machine produced it. This is the whole
# reason a 1 GB instance is enough to run this app.
set -euo pipefail

cd "$(dirname "$0")"

HOST="${CLOR_HOST:-68.233.107.83}"
KEY="${CLOR_KEY:-$HOME/.ssh/clor}"
URL="${CLOR_URL:-https://68.233.107.83.sslip.io}"
SSH=(ssh -i "$KEY" -o ConnectTimeout=20 "ubuntu@$HOST")

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# Who is deploying what. The SHA gains "-dirty" when the tree has uncommitted
# changes, because a bundle built from a dirty tree matches no commit anyone
# can check out later — which is exactly the thing worth knowing about it.
LOCK=/opt/clor/deploy.lock
DEPLOY_LOG=/opt/clor/deploy.log
DEPLOYER="${USER:-$(whoami)}@$(hostname -s)"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
[ -n "$(git status --porcelain 2>/dev/null)" ] && SHA="${SHA}-dirty"
MODE=frontend; [ "${1:-}" = "--api" ] && MODE=frontend+api
STAMP='$(date -u +%Y-%m-%dT%H:%M:%SZ)'   # expanded on the server, not here

# Prints the lock's contents and its age, for --status, --unlock and the
# refusal message. Silent when there is no lock.
show_lock() {
  "${SSH[@]}" "[ -d '$LOCK' ] || exit 0
    cat '$LOCK/info'
    s=\$(sed -n 's/^started_epoch=//p' '$LOCK/info'); now=\$(date -u +%s)
    [ -n \"\$s\" ] && echo \"age=\$((now - s))s\""
}

if [ "${1:-}" = "--status" ]; then
  "${SSH[@]}" 'systemctl is-active clor-api caddy postgresql | paste -sd" / " -; echo; free -m | head -2; echo
    set -a; . /opt/clor/.env; set +a
    psql "$PGADMIN_URL" -qtAc "SELECT pg_size_pretty(pg_database_size('"'"'clor'"'"'))" 2>/dev/null \
      | sed "s/^/database: /" || echo "database: unreachable"'
  printf '\napp: '; curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 "$URL/"
  step "Deployment lock"
  if "${SSH[@]}" "[ -d '$LOCK' ]"; then
    echo "  IN PROGRESS:"; show_lock | sed 's/^/    /'
  else
    echo "  none — nobody is deploying"
  fi
  step "Last deployments"
  "${SSH[@]}" "tail -n 6 '$DEPLOY_LOG' 2>/dev/null || echo '  (no deploy.log yet)'" | sed 's/^/  /'
  exit 0
fi

if [ "${1:-}" = "--unlock" ]; then
  # Judge staleness from the age it prints before you reach for this. A lock
  # a few seconds old with a live deployer behind it is not stale.
  if ! "${SSH[@]}" "[ -d '$LOCK' ]"; then
    echo "No lock to clear."; exit 0
  fi
  step "Clearing deployment lock"
  show_lock | sed 's/^/  /'
  "${SSH[@]}" "printf '%s UNLOCK by=%s\n' \"$STAMP\" '$DEPLOYER' >> '$DEPLOY_LOG'; rm -rf '$LOCK'"
  echo "Cleared."
  exit 0
fi

# ---- take the lock, before spending a build on a deploy that will refuse ----
step "Acquiring deployment lock as $DEPLOYER ($SHA, $MODE)"
# mkdir is atomic: two deployers racing get exactly one success. The info file
# is written only by the one that won.
if ! "${SSH[@]}" "mkdir '$LOCK' 2>/dev/null \
     && printf 'sha=%s\ndeployer=%s\nmode=%s\nstarted=%s\nstarted_epoch=%s\n' '$SHA' '$DEPLOYER' '$MODE' \"$STAMP\" \"\$(date -u +%s)\" > '$LOCK/info' \
     && printf '%s START sha=%s deployer=%s mode=%s\n' \"$STAMP\" '$SHA' '$DEPLOYER' '$MODE' >> '$DEPLOY_LOG'"; then
  printf '\n\033[1;31mANOTHER DEPLOYMENT IS IN PROGRESS\033[0m — refusing to overwrite it.\n' >&2
  show_lock | sed 's/^/  /' >&2
  printf '\nIf that deployer is gone (crashed, or Ctrl-C with no cleanup), clear it with:\n  ./deploy.sh --unlock\n' >&2
  exit 1
fi
LOCKED=1

# Released on every exit — success, `set -e` failure, or Ctrl-C — with the
# outcome written to the log. A lock that outlives its deploy is worse than
# none, because it turns the next honest deploy into a false alarm.
release_lock() {
  local rc=$?
  [ "${LOCKED:-0}" = 1 ] || return 0
  local outcome=ok; [ "$rc" -eq 0 ] || outcome="failed rc=$rc"
  "${SSH[@]}" "printf '%s END   sha=%s deployer=%s outcome=%s\n' \"$STAMP\" '$SHA' '$DEPLOYER' '$outcome' >> '$DEPLOY_LOG'; rm -rf '$LOCK'" \
    || printf '\n\033[1;31mWARNING\033[0m: could not release %s on the server — run ./deploy.sh --unlock\n' "$LOCK" >&2
}
trap release_lock EXIT

step "Building frontend locally"
npx vite build >/dev/null
du -sh dist | awk '{print "  " $1 " of static files"}'

step "Uploading frontend"
# Two passes, and the order is the point.
#
# One rsync with --delete removes the old hashed bundle in the same breath as
# it writes the new index.html, so anybody whose browser fetched the page a
# second earlier asks for a file that no longer exists: a blank screen and a
# 404 on a bundle nobody can explain. Uploading the new assets first means the
# old page still works while the swap happens, and the stale files go only
# after the new index.html is in place and pointing elsewhere.
# 1. New assets alongside the old ones — nothing is removed yet.
rsync -az -e "ssh -i $KEY" dist/assets/ "ubuntu@$HOST:/opt/clor/web/assets/"
# 2. index.html and the rest, now that what it points at is already there.
rsync -az --exclude assets -e "ssh -i $KEY" dist/ "ubuntu@$HOST:/opt/clor/web/"
# 3. Only now sweep what the new build no longer references.
rsync -az --delete -e "ssh -i $KEY" dist/ "ubuntu@$HOST:/opt/clor/web/"

if [ "${1:-}" = "--api" ]; then
  step "Uploading API source"
  rsync -az --delete \
    --exclude node_modules --exclude 'prisma/*.db' --exclude dist \
    -e "ssh -i $KEY" server/ "ubuntu@$HOST:/opt/clor/server/"

  step "Backing up the database"
  # Before anything is installed, migrated or restarted. A backup taken after a
  # migration is a backup of the problem.
  "${SSH[@]}" 'set -eo pipefail
    mkdir -p /opt/clor/backups
    f="/opt/clor/backups/clor-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
    # One dump of one database: every schema, consistent to the same instant.
    # That consistency is the whole reason the apps share a database.
    #
    # As the postgres superuser, the same as the nightly clor-backup and the
    # CI deploy. Every tenant table FORCEs row-level security, which binds the
    # owner too, so a dump as the owner is refused table by table. It used to
    # run as the owner, and without pipefail the refusal vanished into gzip:
    # every deploy since the policies shipped wrote a few kilobytes, printed
    # its size as if that were a backup, and went on to migrate.
    if ! sudo -u postgres pg_dump -d clor | gzip > "$f"; then
      rm -f "$f"
      echo "  backup FAILED - nothing was installed, migrated or restarted" >&2
      exit 1
    fi
    ls -lh "$f" | awk "{print \"  \" \$5 \" \" \$9}"
    # Keep a fortnight. Older ones are on the operator, not on this script.
    ls -1t /opt/clor/backups/clor-*.sql.gz | tail -n +15 | xargs -r rm --'

  step "Installing, migrating and rebuilding on the server"
  # Migrations are versioned and applied as the OWNER — the application role
  # cannot create tables, which is the point of it. scripts/migrate.ts builds
  # the owner connection from PGADMIN_URL and applies each application's
  # schema in turn.
  #
  # Output is kept, unlike the other steps. `set -e` already aborts the deploy
  # when a migration fails, but silencing it meant the failure arrived with no
  # reason attached and the schema half applied.
  "${SSH[@]}" 'set -e
    cd /opt/clor/server
    set -a; . /opt/clor/.env; set +a
    # --include=dev explicitly: the .env sourced above sets NODE_ENV=production,
    # which makes npm skip devDependencies, and tsc is one of them.
    npm ci --include=dev --no-audit --no-fund >/dev/null 2>&1
    npx prisma generate >/dev/null 2>&1
    # One client per application, each pointed at its own schema.
    npx prisma generate --schema prisma/payroll/schema.prisma >/dev/null 2>&1
    npx prisma generate --schema prisma/people/schema.prisma >/dev/null 2>&1
    # See the CI workflow: the check earns the flag rather than the flag being
    # passed blindly. It exits 1 when something would really be lost, and
    # `set -e` stops the deploy before the schema is touched.
    npx tsx scripts/preflight.ts
    npx tsx scripts/migrate.ts
    # Grants, after the migrations that created the tables to grant on. A new
    # table is unreadable by the application role until this runs, and the
    # symptom is a permission error on one screen rather than a failed deploy.
    node scripts/provisionAppRole.mjs
    # Every addition to the permission catalogue leaves existing Owner roles
    # short of it — the seed runs once, at org creation. Four of six live orgs
    # were missing 92 grants between them, which is why a settings page added
    # after their signup simply never appeared in their menu. Idempotent: it
    # prints "nothing to do" when the catalogue and the grants agree.
    npx tsx scripts/backfillOwnerPermissions.ts --fix
    # Document lines used to name items by a browser-local number that shifted
    # on reload; this points them at the server id where it can be told for
    # certain and reports the rest. Idempotent.
    npx tsx scripts/backfillLineItemIds.ts --fix
    # The stock ledger is kept by triggers; this proves it matches every
    # document, printing and rebuilding anything that does not. After the
    # line repair above, whose rewrites the triggers have just followed.
    npx tsx scripts/verifyStockLedger.ts --fix
    npm run build >/dev/null 2>&1
    sudo systemctl restart clor-api'
fi

step "Checking it came back up"
"${SSH[@]}" 'systemctl is-active clor-api caddy | paste -sd" / " -'
printf 'app: '; curl -s -o /dev/null -w '%{http_code}\n' --max-time 25 "$URL/"
# Not /api/health — that is behind the tenant middleware, so it answers 401
# to a monitor and 401 to a database that has fallen over, which makes it
# useless for telling those apart. A rejected login is a round trip through
# Express, Prisma and PostgreSQL: 401 means the whole path is alive.
#
# Retried, because the restart above returns before Node is listening: the
# first probe after a deploy on 29 Sep landed in those three seconds and
# printed 502 for an API that was fine. Up to ~40s of 5xx/no-answer is
# "still starting"; after that it is a failed deploy, and the script says so
# with its exit code rather than a number somebody has to notice.
api_code=000
for _ in $(seq 1 20); do
  api_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -X POST "$URL/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"deploy-probe@example.invalid","password":"not-a-password"}' || true)
  case "$api_code" in 000|5??) sleep 2 ;; *) break ;; esac
done
printf 'api: %s (401 = alive and refusing a bad password)\n' "$api_code"
case "$api_code" in
  000|5??)
    printf '\n\033[1mAPI is not answering.\033[0m Check: ssh neevone journalctl -u neev-api -n 80\n' >&2
    exit 1 ;;
esac

printf '\n\033[1mLive:\033[0m %s\n' "$URL"
