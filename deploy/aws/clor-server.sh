#!/bin/bash
# Runs ON the AWS server (as root, in /opt/clor), sent there by
# scripts/release-aws.sh through AWS Systems Manager. One job per call:
#
#   clor-server.sh secrets            read /clor/prod/* from Parameter Store into secrets.env
#   clor-server.sh migrate <image>    apply the migrations with that image, then stop
#   clor-server.sh stage <image>      start that image beside the live one, check /ready, remove it
#   clor-server.sh switch <image>     make that image the live one; put the old one back if it does not come up
#   clor-server.sh serving            print the image serving now
#   clor-server.sh console <image>    start (or replace) the Engineering Console's API with that image
#
# It also keeps two small records in /opt/clor/state for the Console to read:
# serving.json (which release serves, since when) and migration.json (how the
# last migration run ended).
set -euo pipefail
cd /opt/clor
REGION=$(curl -s -H "X-aws-ec2-metadata-token: $(curl -s -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token)" http://169.254.169.254/latest/meta-data/placement/region)
export AWS_DEFAULT_REGION=$REGION

secrets() {
  umask 077
  aws ssm get-parameters-by-path --path /clor/prod --with-decryption --recursive \
    --query 'Parameters[].[Name,Value]' --output text \
    | awk -F'\t' '{ n=$1; sub(/^.*\//,"",n); print n "=" $2 }' > secrets.env.new
  for need in DB_HOST DB_PASSWORD JWT_SECRET MAIL_SECRET_KEY EDGE_SECRET JOBS_TOKEN; do
    grep -q "^$need=" secrets.env.new || { echo "Parameter Store has no /clor/prod/$need" >&2; rm -f secrets.env.new; exit 1; }
  done
  mv secrets.env.new secrets.env
  echo "secrets.env: $(wc -l < secrets.env) settings"
}

ready() { # ready <port> <tries>
  local n=1
  until curl --fail --silent --max-time 10 --output /dev/null "http://127.0.0.1:$1/ready"; do
    [ "$n" -lt "$2" ] || return 1
    n=$((n + 1)); sleep 5
  done
}

serving() { grep '^API_IMAGE=' .env 2>/dev/null | cut -d= -f2- || true; }

write_env() { # write_env <image>
  local host console; host=${ORIGIN_HOST:-$(grep '^ORIGIN_HOST=' .env 2>/dev/null | cut -d= -f2- || true)}
  [ -n "$host" ] || { echo "ORIGIN_HOST is not set and /opt/clor/.env has none" >&2; exit 1; }
  console=$(grep '^CONSOLE_IMAGE=' .env 2>/dev/null || true) # the Console's line outlives an API release
  printf 'API_IMAGE=%s\nAPI_TAG=rel-%s\nORIGIN_HOST=%s\n' "$1" "${1##*:}" "$host" > .env
  [ -z "$console" ] || echo "$console" >> .env
}

# What the Console reads (console/api/src/aws.ts). World-readable, no secrets.
record() { # record <file> <json>
  mkdir -p state; printf '%s\n' "$2" > "state/$1.tmp"; chmod 644 "state/$1.tmp"; mv "state/$1.tmp" "state/$1"
}
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

case "${1:-}" in
  secrets) secrets ;;
  serving) serving ;;
  migrate)
    IMAGE=${2:?image}; secrets; docker pull --quiet "$IMAGE"
    if docker run --rm --env-file api.env --env-file secrets.env -e MIGRATE_ONLY=1 "$IMAGE"; then
      record migration.json "{\"ok\":true,\"endedAt\":\"$(now)\",\"image\":\"${IMAGE##*:}\"}"
    else
      record migration.json "{\"ok\":false,\"endedAt\":\"$(now)\",\"image\":\"${IMAGE##*:}\"}"
      exit 1
    fi
    ;;
  stage)
    IMAGE=${2:?image}; secrets; docker pull --quiet "$IMAGE"
    docker rm -f clor-api-next >/dev/null 2>&1 || true
    # Two connections per database: it is here to prove it starts, not to serve.
    docker run -d --name clor-api-next --env-file api.env --env-file secrets.env \
      -e DB_POOL_MAIN=2 -e DB_POOL_PLATFORM=2 -e DB_POOL_PEOPLE=2 -e DB_POOL_PAYROLL=2 \
      -p 127.0.0.1:8081:8080 "$IMAGE" >/dev/null
    if ready 8081 36; then echo "staged image is ready"; docker rm -f clor-api-next >/dev/null
    else docker logs --tail 60 clor-api-next >&2 || true; docker rm -f clor-api-next >/dev/null; echo "staged image did not become ready; the live one was not touched" >&2; exit 1; fi
    ;;
  switch)
    IMAGE=${2:?image}; secrets; docker pull --quiet "$IMAGE"
    WAS=$(serving)
    write_env "$IMAGE"
    docker compose up -d --remove-orphans
    if ready 8080 36; then
      echo "now serving $IMAGE (was ${WAS:-nothing})"
      record serving.json "{\"tag\":\"${IMAGE##*:}\",\"since\":\"$(now)\"}"
    else
      docker compose logs --tail 60 app >&2 || true
      if [ -n "$WAS" ]; then write_env "$WAS"; docker compose up -d; echo "$IMAGE did not come up; put $WAS back" >&2; fi
      exit 1
    fi
    docker image prune -af --filter "until=336h" >/dev/null 2>&1 || true
    ;;
  console)
    IMAGE=${2:?image}; docker pull --quiet "$IMAGE"
    umask 077
    aws ssm get-parameters-by-path --path /clor/console --with-decryption --recursive \
      --query 'Parameters[].[Name,Value]' --output text \
      | awk -F'\t' '{ n=$1; sub(/^.*\//,"",n); print n "=" $2 }' > console.env.new
    for need in CONSOLE_SESSION_SECRET CONSOLE_EDGE_SECRET CONSOLE_DATABASE_URL; do
      grep -q "^$need=" console.env.new || { echo "Parameter Store has no /clor/console/$need" >&2; rm -f console.env.new; exit 1; }
    done
    mv console.env.new console.env
    grep -v '^CONSOLE_IMAGE=' .env > .env.new; echo "CONSOLE_IMAGE=$IMAGE" >> .env.new; mv .env.new .env
    mkdir -p state
    docker compose --profile console up -d console
    n=1; until docker compose --profile console exec -T console node -e "fetch('http://127.0.0.1:4010/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
      [ "$n" -lt 20 ] || { docker compose --profile console logs --tail 40 console >&2; echo "the Console did not come up" >&2; exit 1; }
      n=$((n + 1)); sleep 3
    done
    echo "the Console is serving $IMAGE"
    ;;
  *) sed -n '2,14p' "$0" >&2; exit 2 ;;
esac
