#!/usr/bin/env bash
# One command: runs the live QA and writes e2e/live/report/REPORT.md.
set -u
cd "$(dirname "$0")/../.."
rm -rf e2e/live/report/raw e2e/live/report/shots
npx playwright test -c e2e/live/playwright.live.config.ts "$@"
code=$?
node e2e/live/report.mjs
exit $code
