# Changelog

All notable changes to this project will be documented in this file.

## rel-4483a92 - 2026-11-14

API revision `clor-api-00129-pg9`. Previous release `rel-75e6ebc` (roll back there).

- #256 Support grants: CLOR staff see a customer's company only when the customer says yes

## [0.0.1] - 2026-11-06

### Changed
- Brand identity updated to neon orange C-mark logo across all surfaces (favicon, PWA icons, app chrome)
- Money and amount figures now render in JetBrains Mono throughout the app (`.ui-money`, `.ui-amount`, `.ui-col-amount`, `.ui-detail-mono`, `.ui-money-lg`)
- People app uses Pitaya Coral (#FF1356) accent; Workspace uses Blaze Orange (#FF5400)
- Logo is now the ribbon-arc C-mark icon paired with LOR in Inter 900 — together they read "CLOR"

### Removed
- Old oxblood/marigold CLOR wordmark SVG paths (`clorPaths.js`) retired
- Legacy brand kit files (`public/brand/`, `public/logo.svg`, `public/logo-stacked.svg`, `public/clor-logo.png`) removed
