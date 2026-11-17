# Changelog

All notable changes to this project will be documented in this file.

## rel-f92d74e - 2026-11-17

API revision `clor-api-00136-d7j`. Previous release `rel-0aa4225` (roll back there).

- #289 Launch checklist: add the 17 Nov audit findings
- #292 Ledger: a second reversal of a document no longer brings the first amount back
- #291 Payroll: fix the five high findings of the 17 Nov audit
- #290 Workspace: Apps, Users, Plan, Security and Settings pages in the Overview's style
- #288 Workspace Overview redesign; Books under the one platform bar
- #286 Books: wrap long panel names, empty-state text, Trial Balance header
- #285 Books audit against the 14 Nov build: Trial Balance, Settings, panel emoji, list headers
- #282 Redesign phase 1: one accent, warm paper, Instrument Sans, Lucide only
- #280 Console: GitHub connected; two fixes from the first run against real GitHub
- #279 Release record: rel-0aa4225
- #278 Release record: rel-e0df646

## rel-0aa4225 - 2026-11-15

API revision `clor-api-00134-24x`. Previous release `rel-e0df646` (roll back there).

- #276 Books: port the Books developer's 14 Nov build, new palette and split rail, audit fixes
- #277 Engineering Console: console.clor.in, Phase 1

## rel-e0df646 - 2026-11-15

API revision `clor-api-00133-vlx`. Customers were on `rel-4483a92` (`clor-api-00129-pg9`) before this release: the 14 Nov releases `rel-9883173` and `rel-75a7a55` had been moved back by hand. Roll back to `rel-75a7a55` (`clor-api-00131-wl6`) or `rel-4483a92`.

- #266 Stage 1 security: authenticator for access changes, new-company admin 2FA, one sign-in answer, SSO account reach
- #275 People: last R&D screens (07, 08, 10, 16, 22, 23, 26)
- #270 Ops console: notes and tags, status page posts, saved replies, insights, form switches
- #274 Release record: rel-75a7a55

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
