# clor.in — confirm before publishing

The site only says what the platform does today (checked against the code on 2026-10-24). These are the
items a person must confirm or supply first. Most live in `src/site.js` or `src/content.js`.

## Supply

| What | Where | Today |
|---|---|---|
| Final logo (SVG preferred) | `public/brand/clor-logo.png`, favicon `clor-mark*.png`, `og.png` | Placeholder from the attached PNG, background removed |
| Enquiry addresses | `SITE.contactEmail` / `salesEmail` / `supportEmail` | info@, sales@, support@clor.in (confirmed 2026-10-24) |
| Company details in the legal pages | `website/.env`: the same `VITE_OPERATOR_*`, `VITE_GRIEVANCE_*`, `VITE_HOSTING_PROVIDER`, `VITE_GOVERNING_LAW`, `VITE_POLICY_EFFECTIVE_DATE` the app uses (`packages/platform/operator.js`) | Filled from `website/.env.production`. Still open: CIN (registration in progress), GSTIN, and how long sign-in attempt history is kept (`AUTH_EVENT_RETENTION_DAYS`, one placeholder on Privacy) |
| Prices | `/pricing` | "Being finalised", with "Ask about pricing" |
| Real screenshots | `src/components/Windows.jsx` draws the screens with sample data | Captioned as drawn; replace with screenshots of a demo company |
| Sign-up link | `SITE.signUpUrl` | app.clor.in/signup (live since 24 Oct 2026) |

## Confirm (each claim is in the code; confirm it is live in production)

- Books: e-invoice and e-way bill generation; GSTR-1 and GSTR-3B; UPI payment links; Tally import of masters and opening balances; batches and serials; bank reconciliation; recurring invoices; approvals above an amount.
- Payroll: PF ECR, ESI, professional tax by state, TDS, Form 16; gratuity and leave encashment in final settlement; a second person's approval for bank-detail changes; authenticator code to open payroll figures.
- Attendance: ZKTeco and eSSL push, Hikvision, Matrix, the on-site connector; geofenced phone punch with optional selfie; selfie retention per company.
- People: documents with expiry reminders; joining and leaving checklists; letters; org chart; employee app with payslips, leave and requests.
- Integrations: greytHR, Keka and Zoho People sync; SAML and OpenID Connect single sign-on; SCIM; API keys and webhooks.
- Security page: "the database itself refuses a query that does not name its company" and the credential pause/rotate/expiry rules are in the tenant-platform upgrade (PR #23) — publish that page after it is deployed.
- Hosting: "Google Cloud, Mumbai region" comes from the Cloud Run service address; confirm the database is in the same region.
- Accounting firms: the firm workspace is described as planned (it is being built); today's description (client invites the accountant) is live.
- Coming soon: what is listed for Projects and Timesheet is direction, labelled as such.

## Before the first deploy

- Cloudflare Pages project: root directory `website`, build command `npm ci && npm run build`, output `dist`, custom domain `clor.in` (and `www.clor.in` redirecting to it).
- Pages serves `products/books.html` at `/products/books` (the canonical address) and `404.html` for unknown addresses.
- Font: Plus Jakarta Sans, SIL Open Font License, self-hosted from `@fontsource-variable`.
