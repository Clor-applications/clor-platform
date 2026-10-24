# B5-U4 browser check (2026-10-24, local dev, API as `clor_app`)

Throwaway owner made through the API on localhost; invoice INV-ut7d58 for Asha Textiles.

| Step | Result |
|---|---|
| POST share twice | 201 then 200, same token; `expiresAt` 2027-02-17 (due 2026-11-19 + 90 days) |
| GET /api/public/invoice/<token> | 200; `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer` |
| Open `/?share=<token>` signed out | The invoice (`share-link-opens.jpg`) |
| Cancel the invoice, reload | "This invoice was cancelled by B5U4 Traders ut7d58." (`share-link-cancelled.jpg`) |
| Reinstate (Unpaid) | Same token opens again (200) |

Found and fixed during this check:

1. `/?share=` never reached the invoice page since the shell arrived: the viewer lived inside the Accounting app, which loads only for a signed-in person, so a customer saw the public home page and a signed-in colleague saw their own books. `main.jsx` now renders the shared invoice before the session or the shell when `?share=` is present (closes the follow-up "`/?share=` link in a signed-in browser shows the app").
2. Local dev only: the app role had been granted on existing tables without default privileges, so new tables were refused (42501). Re-granted with `ALTER DEFAULT PRIVILEGES`, which `scripts/provisionAppRole.mjs` already does for real environments.
