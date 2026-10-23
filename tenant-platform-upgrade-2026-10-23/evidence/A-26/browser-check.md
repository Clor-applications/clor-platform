# A-26 / A-25 browser check (local dev, 2026-10-24)

Local owner `a03.owner.*` belongs to A03 Test Traders (`ATES-C100`) and A01 Sister Pvt Ltd (`ASIS-C100`). Two browser tabs, A and B.

## Before the fix (shell files at HEAD)

| Step | Result |
|---|---|
| Tab A on A03; tab B switches to A01; tab A reloads at `/` | **Tab A opens A01** — the other tab's company. Address stays `/`. |
| Open `/o/ZZZZ-C999/` (not one of the user's companies) | **A01 opens silently**; nothing says the link was for another company. |

## After the fix

| Step | Result |
|---|---|
| Open `/` | Address becomes `/o/ATES-C100/` (written in place, no extra history entry). |
| Tab B opens `/o/ASIS-C100/` | Tab B shows A01 Sister. |
| Tab A on A03; tab B switches to A01 (address `/o/ASIS-C100/`); tab A reloads at bare `/` | **Tab A stays on A03**, address `/o/ATES-C100/` (`browser-tab-keeps-company.jpg`). |
| Open `/o/ZZZZ-C999/` | "You don't have access to ZZZZ-C999" with the user's own companies to pick; nothing opened (`browser-no-access.jpg`). Picking A03 → `/o/ATES-C100/`. |
| Switch company with the picker to A01 → Back | `/o/ASIS-C100/`, then Back → `/o/ATES-C100/`, picker A03 Test Traders. |
| Deep link `/o/ATES-C100/?app=admin&open=users` | Company admin → Users for A03; the code stays in the address when the shell changes app in place. |

A-25 (crossing app hosts with the company) needs the `*.clor.in` hosts, which localhost does not have: covered by `orgUrl.test.js` (`appAddress`, `frontDoorForward`). Notification clicks go through `openApp`, so they carry the code too.
