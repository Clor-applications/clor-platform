# Changelog

All notable changes to this project will be documented in this file.

## rel-75a7a55 - 2026-11-14

API revision `clor-api-00131-wl6`. Previous release `rel-4483a92` (roll back there).

- #267 R&D brand rebuild: shell, Workspace, Ops, People; audit fixes
- #272 Release record: rel-9883173
- #271 App icons: the pack's icon on every app subdomain, and versioned icon links
- #269 clor.in: Web Interface Guidelines fixes (header overflow, focus, images, a11y)
- #268 People outbox: log every failed delivery
- #264 LICENSE: all rights reserved, now that the repository is public
- #258 Release: roll back by revision, and stop wiping the previous tag
- #257 Release record: rel-75e6ebc
- #260 CI on GitHub's machines: the repository is public
- #265 Release record: rel-4483a92

## rel-9883173 - 2026-11-14

API revision `clor-api-00130-d9b`. Previous release `rel-4483a92` (roll back there).

- #271 App icons: the pack's icon on every app subdomain, and versioned icon links
- #269 clor.in: Web Interface Guidelines fixes (header overflow, focus, images, a11y)
- #268 People outbox: log every failed delivery
- #264 LICENSE: all rights reserved, now that the repository is public
- #258 Release: roll back by revision, and stop wiping the previous tag
- #257 Release record: rel-75e6ebc
- #260 CI on GitHub's machines: the repository is public
- #265 Release record: rel-4483a92

## rel-4483a92 - 2026-11-14

API revision `clor-api-00129-pg9`. Previous release `rel-75e6ebc` (roll back there).

- #256 Support grants: CLOR staff see a customer's company only when the customer says yes

## rel-75e6ebc - 2026-11-14

API revision `clor-api-00128-6ms`. First recorded release.

No earlier `rel-` tag to count from: these are the last pull requests merged before this release.

- #255 The brand pack: the open CL frame and its letters, everywhere
- #254 Overview panels: two lines that only read wrong on real data
- #253 Workspace Overview: show the figures the server was already sending
- #252 Workspace: write down what is actually left, before #132 is closed
- #250 Migrations run before the deploy, not inside every serving container
- #249 Checklist: Stage 0 says what actually shipped
- #248 Orange C on a blue tile, and logo file names that beat the cache
- #246 The new CLOR logo: the word drawn, with the dot in the C
- #247 Compliance proofs open again under the enforced policy
- #245 clor.in: note why www is redirected on the zone, not in _redirects
- #244 Workspace and operator sign-in pictures, and quotes in quotation marks
- #243 Workspace Integrations: what connects the company, and whether it works
- #241 clor.in rebuilt in full-width bands; sign-in pages tidied with checked quotes
- #242 Workspace Inbox: what waits on you in every app
- #240 App CSP: allow the Cloudflare analytics beacon
- #237 Release 13 Nov: PRs 222–228, 231, 232, 234–236 together
- #229 clor.in: Team page
- #221 Audit stage 1: trial emails, approval emails, plan changes, demo pipeline, clor.in CSP
- #218 Audit stage 0: timed jobs, /signup trial, People/Attendance boundary, launch checklist
- #216 Ops: nightly database copy to Delhi

## [0.0.1] - 2026-11-06

### Changed
- Brand identity updated to neon orange C-mark logo across all surfaces (favicon, PWA icons, app chrome)
- Money and amount figures now render in JetBrains Mono throughout the app (`.ui-money`, `.ui-amount`, `.ui-col-amount`, `.ui-detail-mono`, `.ui-money-lg`)
- People app uses Pitaya Coral (#FF1356) accent; Workspace uses Blaze Orange (#FF5400)
- Logo is now the ribbon-arc C-mark icon paired with LOR in Inter 900 — together they read "CLOR"

### Removed
- Old oxblood/marigold CLOR wordmark SVG paths (`clorPaths.js`) retired
- Legacy brand kit files (`public/brand/`, `public/logo.svg`, `public/logo-stacked.svg`, `public/clor-logo.png`) removed
