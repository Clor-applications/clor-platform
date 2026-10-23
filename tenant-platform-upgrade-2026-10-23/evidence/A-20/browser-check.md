# A-20 browser check (local dev, 2026-10-23)

- Local test user `a20.usermgr.*@example.com`: company-wide custom role (Users VIEW/EDIT, Roles VIEW/EDIT, Invoices VIEW), **not** an administrator, restricted by the owner to CUSTOMER `big-buyer` ("Big Buyer only").
- Accounting → Settings → Approval Workflows → Document restrictions.
  1. User = themselves → bin icon on "Big Buyer only": `DELETE …/users/<self>/permissions/<id>` → **403**, "You cannot change your own access. Ask another administrator."; the restriction stays (`browser-own-restriction-refused.jpg`).
  2. User = A03 Owner (administrator) → Customer `big-buyer` → Add: `POST …/users/<owner>/permissions` → **403**, "Only an administrator may restrict what an administrator sees."; owner still "No restrictions" (`browser-restrict-admin-refused.jpg`). First attempt showed the role wording ("…administer an Administrator role"); message changed and re-checked.
- Before the fix both requests were accepted (`before-fix.txt`).
