# A-29 browser check (local dev, 2026-10-24)

A03 Test Traders owner → Attendance → Readers → Add reader, serial `API-clortestkey1` (the shape of the serial an API key's punches were recorded under), name "Squat probe" → Add:
`POST /api/orgs/<A03>/attendance/devices` → **400**, "That is not a reader serial number. Enter the serial printed on the reader." No reader created (`browser-api-serial-refused.jpg`).

Before the fix the same request returned 201 (`before-fix.txt`, case "cannot be claimed as a reader by another company"). Locally, a squatted serial then made the victim's own punches fail (409: row-level security hid the squatter's reader from the victim's upsert, which collided on the unique serial). Where RLS does not apply — a connection as the table owner (A-36) — the same request writes the victim's punches into the squatter's company.

The punch path is covered by `punchRouting.test.ts`: with a squatted `API-<prefix>` reader present in another company, the key's punches land in its own company, under a reader named after the key's id, and none reach the other company.
