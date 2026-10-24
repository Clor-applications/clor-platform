# A-24 browser check (local dev, 2026-10-24)

Server-side fix; checked from the app page in the browser pane with the local A03 owner, who also belongs to their sister company A01 in the same account (the case A-23's cross-tab bleed produces):

- `GET /api/orgs/<A01>/warehouses` → A01's "Main Store".
- `POST /api/orgs/<A03>/invoices` with `warehouseId` = A01's Main Store → **400** `WAREHOUSE_NOT_IN_COMPANY`, "That warehouse is not in this company." Nothing stored.

Before the fix this was stored and the stock check read and moved A01's stock from an A03 invoice (`before-fix.txt`, "cannot be named on an invoice": 201).
