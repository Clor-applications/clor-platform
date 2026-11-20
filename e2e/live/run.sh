#!/usr/bin/env bash
# One command: signs QA accounts in, runs the live QA, writes e2e/live/report/REPORT.md.
# An account that cannot sign in is skipped; it never stops the rest.
set -u
cd "$(dirname "$0")/../.."
rm -rf e2e/live/report/raw e2e/live/report/shots
CFG=e2e/live/playwright.live.config.ts
if [ $# -eq 0 ]; then
  npx playwright test -c $CFG --project=public --project=signed-in
else
  npx playwright test -c $CFG "$@"
fi
code=$?
node e2e/live/report.mjs
exit $code
