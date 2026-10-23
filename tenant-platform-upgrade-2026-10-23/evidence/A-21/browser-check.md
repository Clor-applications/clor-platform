# A-21 browser check (local dev, 2026-10-23)

1. Non-administrator (`a20.usermgr.*`, company-wide user manager) → Company admin → Close company: "Only an administrator of this company can close it." and no form (`browser-non-admin.jpg`). Page description now says administrator + authenticator code.
2. A03 Owner (administrator, no authenticator) → Download full export (file save stubbed) → typed the company name → "Close company after 30 days": `POST /api/orgs/<org>/closure` → **403** `TWO_FACTOR_SETUP_REQUIRED`, toast "Closing a company needs an authenticator app. Set one up in your profile first…" (`browser-admin-no-authenticator.jpg`). Nothing scheduled.
- Before the fix the same request was accepted for the creator with no code (`before-fix.txt`: 201 where 403 expected), and a creator who had stepped down could still close.
- The with-code path (enrol, step-up, 201) is covered by `companyClosure.test.ts`; it was not driven in the browser to avoid enrolling an authenticator on the shared local owner account.
