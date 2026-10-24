# A-30 / A-37 browser check (local dev, 2026-10-24)

These change where the company is set for the database, so the check is that the token-served pages still work under it (local A03 Test Traders):

- **Share link:** owner made a share link for INV-2627-00001; the viewer's own request, sent with no session (`GET /api/public/invoice/<token>`, credentials omitted) → **200**, invoice INV-2627-00001, total ₹94,400.
- **Pay link:** owner made a ₹100 UPI pay request on the same invoice; the public page `/pay/<token>` (API host) renders A03 Test Traders, Invoice INV-2627-00001, ₹100.00, the payee UPI ID and QR (`browser-pay-page.jpg`).
- Reader pushes (HTTP push, Hikvision, Matrix, ZKTeco ADMS) and SCIM have no browser surface; `tenantBackstop.test.ts` checks a push runs as its company, and the reader suites pass in the full run.

Observation (not this change): opening a `/?share=` link in a browser that is signed in shows the app, not the shared invoice. A customer is not signed in, so the viewer shows for them; noted as a follow-up.
