# A-23 / A-27 / A-28 browser check (local dev, 2026-10-24)

Local owner of A03 Test Traders (`ATES-C100`) and A01 Sister Pvt Ltd (`ASIS-C100`). Tab A on `/o/ATES-C100/`, tab B on `/o/ASIS-C100/`. The warehouse each tab's requests carry was read from the app's own instance of `packages/platform/context.js` (the module `apiFetch` builds `x-warehouse-id` from; `workplace.test.js` checks the header itself).

## A-23 — before the fix (all A-23 files at HEAD)

| Step | `x-warehouse-id` tab A would send |
|---|---|
| Tab A (A03) chooses its Head Warehouse (`cmvkz1qo…`), the way the old picker stored it | `cmvkz1qo…` (A03's) |
| Tab B (A01) chooses its Main Store (`cmvkrt41…`) | — |
| Back in tab A, still on A03 | **`cmvkrt41…` — A01's Main Store**, on A03's requests |

## A-23 — after the fix

| Step | Result |
|---|---|
| Tab A (A03) `selectWarehouse(Head Warehouse)` | header `cmvkz1qo…` |
| Tab B (A01) `selectWarehouse(Main Store)` | tab B header `cmvkrt41…` |
| Back in tab A | **`cmvkz1qo…` — still A03's own** (`stillA03sOwn: true`) |

## A-27 — Accounting's own "Switch company" menu

Accounting → company name → Switch company → A01 Sister Pvt Ltd: the shell switched (address `/o/ASIS-C100/`, shell picker "A01 Sister Pvt Ltd", Accounting remounted for A01) — `browser-accounting-menu-switch.jpg`. Before, this menu wrote its own `activeOrgId` and reloaded, which the shell no longer read.

## A-28

Per-company keys (`lastSelection`, dashboard branch filter) are covered by `workplace.test.js`. The People manifest is chosen by host (`people.clor.in`), which localhost does not have; People uses the CLOR mark until it has its own icon.

## Web suite

`web-suite-after.txt`: 59 failures. Against the main-checkout baseline (57), the differences are: the CSP hash for index.html's inline script (changed by the People manifest line; fixed in `public/_headers`, test now passes), `accountArea.test.jsx` (3, the same baseline failures under the file's new path after the Company admin move), and `homeBoard.test.jsx` "overdue 9 days" (builds dates in UTC; fails just after midnight IST at HEAD too — not this change).
