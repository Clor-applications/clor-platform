# A-19 browser check (local dev, 2026-10-23)

- A03 Test Traders: new "Branch B"; local test user `a19.branchmgr.*@example.com` is a member of Branch B only, holding a custom role (Users VIEW/EDIT, Roles VIEW, Invoices CREATE) assigned **for Branch B only**.
- Company admin → Users → "Export Only" → Edit → Role "Branch user manager …" (the manager's own branch role, every permission of which they hold in Branch B) → Save Changes.
- `PUT /api/orgs/<org>/users/<id>/role` → **403**; banner: "You manage this for one branch only. Company-wide roles are changed by somebody who manages them across the company." Role unchanged (still "Exporter …, Whole company").
- Before the fix this request passed the grant check: the caller's permissions were resolved for Branch B, which included the branch-only role (see `before-fix.txt`, case "cannot hand anybody else a company-wide role").
- Screenshot: `browser-branch-manager-refused.jpg`.
