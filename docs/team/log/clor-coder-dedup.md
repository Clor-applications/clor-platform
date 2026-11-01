# clor-coder-dedup

## 2026-11-01 09:30 IST — Dedup batches 3 and 7 — branch claude/dedup-shared-helpers
- Did: one shared home each for the org guard (requireOrgId, 47 copies), query strings, SettingsScreenHeader and settingsFrame, LoadFailed, can(), PAN/GSTIN validators, rupee formatters (client and server) and HTML escaping (client and server). Behaviour unchanged; the three weaker print-window escapes and the API docs page now use the five-character escape, with tests showing the page reads the same. CSV cell guards were not merged: the five copies differ (listed in the PR).
- Evidence: web 296 files, 2136 passed; build; lint 0 errors; server tsc clean; 18 affected server files on 5434, 185 passed; e2e smoke 44 passed (web 5203, API 4023, clor_e2e_dedup).
- Next: batches 5 and 6 (IST dates), branch claude/dedup-ist-dates.
- Blocked on: nothing.
