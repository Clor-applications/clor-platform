#!/bin/bash
# Runs a command while holding a lock that every runner on this Mac shares, so
# only one such command runs on the machine at a time (docs/CI-ON-MAC.md,
# "End-to-end tests"). The lock is the kernel's (lockf): it goes when the
# process does, also when a job is cancelled or killed, so nothing is left to
# clean up.
#
#   scripts/ci/one-at-a-time.sh <lock file> <command> [args...]
set -euo pipefail
lock=$1
shift
asked=$(date +%s)
if ! /usr/bin/lockf -s -k -t 0 "$lock" /usr/bin/true; then
  echo "Another end-to-end run is using this Mac ($lock); waiting for it to finish."
fi
# shellcheck disable=SC2016
exec /usr/bin/lockf -k "$lock" /bin/bash -c 'echo "Got the end-to-end lock after $(( $(date +%s) - $0 ))s."; exec "$@"' "$asked" "$@"
