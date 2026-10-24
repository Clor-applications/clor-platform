# A-18 browser check (local dev, 2026-10-23)

- Local test user `a18.exporter.*@example.com` in A03 Test Traders, role with only `SETTINGS::Company data::EXPORT`.
- Company admin → Data export (`?app=admin&open=export`) now shows for this user (menu item was gated on Company Profile VIEW, which never matched the server's EXPORT check).
- "Download data" (file save stubbed in the page, nothing downloaded): `GET /api/orgs/<org>/export?scope=data` → 200.
  - `export.withheld` = people ("You cannot view employees in People."), payroll ("You cannot view payroll profiles and pay runs.").
  - `data` keys: accounting only — no `people.*`, no `payroll.*`.
- Screen shows "Left out of this copy" with both reasons; toast "13 records downloaded. people and payroll left out."
- Screenshot: `browser-export-only-user.jpg`.
