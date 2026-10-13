#!/usr/bin/env bash
#
# Start CLOR and print the address it is reachable on.
#
# The shared link kept breaking because it was a trycloudflare quick tunnel:
# those get a new random hostname every time they start and drop on their own,
# so every restart handed out a different URL and the browser lost the session
# and the working book that were keyed to the old one.
#
# This serves the built app on the machine's own network address instead. That
# address does not rotate, so the link stays good across restarts, reboots and
# rebuilds — any phone or laptop on the same network can use it.
#
#   ./serve.sh          build, then start the API and the app
#   ./serve.sh --skip-build   start without rebuilding
#
set -euo pipefail

cd "$(dirname "$0")"

API_PORT="${API_PORT:-4001}"
APP_PORT="${APP_PORT:-4173}"

lan_ip() {
  # The address other devices can reach. en0 is Wi-Fi on a Mac; fall back to
  # whatever non-loopback IPv4 exists.
  ipconfig getifaddr en0 2>/dev/null && return 0
  ipconfig getifaddr en1 2>/dev/null && return 0
  ifconfig 2>/dev/null | awk '/inet /{if ($2 != "127.0.0.1") {print $2; exit}}'
}

is_up() { curl -s -o /dev/null --max-time 3 "$1"; }

if [ "${1:-}" != "--skip-build" ]; then
  echo "Building…"
  npx vite build >/dev/null
fi

# The API. Left alone if something is already answering on its port, so running
# this twice does not end up with two servers fighting over the database.
if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "API already running on $API_PORT."
else
  echo "Starting API on $API_PORT…"
  ( cd server && npm run dev >/tmp/clor-api.log 2>&1 & )
  for _ in $(seq 1 30); do
    is_up "http://127.0.0.1:$API_PORT/api/health" && break
    sleep 1
  done
fi

if lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "App already running on $APP_PORT."
else
  echo "Starting app on $APP_PORT…"
  npx vite preview --port "$APP_PORT" >/tmp/clor-app.log 2>&1 &
  for _ in $(seq 1 30); do
    is_up "http://127.0.0.1:$APP_PORT/" && break
    sleep 1
  done
fi

IP="$(lan_ip || true)"

echo
echo "CLOR is running."
echo "  On this Mac:        http://localhost:$APP_PORT"
if [ -n "$IP" ]; then
  echo "  On this network:    http://$IP:$APP_PORT"
  echo
  echo "The network address is the one to share. It survives restarts."
  echo "If it ever changes, this machine was given a new address by the router —"
  echo "reserve one for it in the router to pin it for good."
fi
echo
echo "Logs: /tmp/clor-api.log and /tmp/clor-app.log"
