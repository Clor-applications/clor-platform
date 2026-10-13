#!/usr/bin/env sh
# Expose the local Docker stack to the internet for QA, via a Cloudflare
# quick tunnel. Free, no account, HTTPS. The URL is random per run and only
# as private as its obscurity — treat it as a QA link, not production.
#
#   ./deploy/share-qa.sh          # starts stack (if needed) + tunnel, prints URL
#
# Stop with Ctrl-C. A new run gets a new URL.
set -eu

cd "$(dirname "$0")/.."

command -v cloudflared >/dev/null || { echo "brew install cloudflared first"; exit 1; }

if ! curl -sf http://localhost:8080/ >/dev/null 2>&1; then
  echo "Starting Docker stack…"
  API_PORT="${API_PORT:-4101}" docker compose up -d
  until curl -sf http://localhost:8080/ >/dev/null 2>&1; do sleep 3; done
fi

echo "Stack healthy on :8080 — opening tunnel (URL below, Ctrl-C to stop)…"
exec cloudflared tunnel --url http://localhost:8080
