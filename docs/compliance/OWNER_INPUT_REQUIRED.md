# Owner input required

These are decisions and facts that only the business running Clor can supply. Code cannot settle them. Until they are supplied, the legal pages show a **Draft** banner and marked placeholders. See [COMPLIANCE_AUDIT.md](./COMPLIANCE_AUDIT.md) for the findings behind each item.

## 1. Operator details

Set these as build-time variables for the web app, for example in the root `.env` used by `vite build`. They are read in `packages/platform/operator.js`.

| Variable | What | Example shape |
|---|---|---|
| `VITE_OPERATOR_NAME` | Legal name of the business running the service | "<Company> Private Limited" |
| `VITE_OPERATOR_ADDRESS` | Registered address | — |
| `VITE_OPERATOR_REGISTRATION` | CIN or other registration (optional) | — |
| `VITE_CONTACT_EMAIL` | Support and general contact | — |
| `VITE_GRIEVANCE_OFFICER` | Grievance officer (and Data Protection Officer, if required) | — |
| `VITE_GRIEVANCE_EMAIL` | Their address. This also turns on "Ask to close my account" in Profile | — |
| `VITE_HOSTING_PROVIDER` | Where servers and database run, including the region | — |
| `VITE_GOVERNING_LAW` | Courts for disputes | "Bengaluru, Karnataka" |
| `VITE_POLICY_EFFECTIVE_DATE` | Date the documents take effect (YYYY-MM-DD) | — |

Also set the server's `MAIL_FROM` and `APP_NAME`. Mail currently defaults to `no-reply@localhost`.

## 2. Legal review of the drafts

The four documents are in `packages/shell/legal/documents.jsx`. They need a lawyer's review before they are published as in force. In particular:

- **Roles:** confirm the operator is the Data Fiduciary for account data and processes business records on the business's behalf.
- **Lawful basis:** decide, per purpose, between consent and the "legitimate uses" under DPDP s.7.
- **Terms placeholders:** limitation of liability (wording and any cap), and fees.
- **Promises the notice makes on the operator's behalf**, which must be kept in practice:
  - advance email notice of material changes;
  - breach notification to users and the Data Protection Board;
  - handling erasure requests within the statutory time.
- **Significant Data Fiduciary:** whether notification is likely, and whether a DPO, audits or a DPIA are needed.
- **Cross-border transfer:** if hosting, SMTP or TypeSafe (`api.typesafe.ai`) process data outside India.
- **Indian languages:** whether the notice must be offered in any of them.
- **Notice version:** when a change in substance happens, bump `NOTICE_VERSION` in `packages/shell/legal/version.js`.

## 3. Retention periods

| Record | Current behaviour | Decide |
|---|---|---|
| Sign-in attempt history (`AuthEvent`: email, IP, browser) | Kept forever unless `AUTH_EVENT_RETENTION_DAYS` is set | Period (for example 180 days) |
| Ended sessions (IP, browser) | Deleted 90 days after ending (`SESSION_RETENTION_DAYS`) | Confirm |
| Reset and verification tokens | Deleted 7 days after expiry or use (`TOKEN_RETENTION_DAYS`) | Confirm |
| Account data after closure | No closure process exists yet | Period, set against legal obligations |
| Email outbox bodies | Kept (tokens removed after sending) | Period |
| `ImportRow.raw` (original CSV rows) | Kept forever | Delete after the import is confirmed? |
| Backups | Last 30 daily, on the same host, unencrypted | Encryption, an off-host copy, and a period |
| Audit log | Kept; deleted with its company | Period; whether it should survive deleting the company |

## 4. Erasure and account closure (DPDP)

There is no deletion feature. Requests go to the grievance email. Decide:

- what gets deleted and what gets anonymised;
- what must be kept, and for how long, under GST and company law;
- who approves a request, and the response time;
- what happens to a company when its last admin leaves.

## 5. Product and security decisions found by the audit

- **Share links** (H6): what lifetime should a public invoice link have, and should creating one need CREATE rather than VIEW?
- **Account overview** (M9): should "Company Profile → View" in one company show PAN, GSTIN and users of every company in the account?
- **Security events** (M10): who may see all users' IP addresses?
- **SMTP and e-invoice URLs** (M11): may a self-hosted install point these at internal network addresses? If not, the server can block private ranges.
- **Password policy** (M14): enforce the org policy everywhere, or keep 8 characters? The `requireVerifiedEmail`, `accessTokenMinutes` and `sessionDays` settings are not enforced: enforce them or remove them.
- **Enumeration** (M15): accept a neutral sign-up reply ("check your email") instead of "User already exists"?
- **Tenant isolation** (H2): schedule the move to `withTenant` and deny-by-default policies.
- **Proxy topology** (H3): if the API sits behind anything other than Caddy or nginx on the same host or Docker network, set `TRUST_PROXY`.
- **CSP** (M2): watch the browser console on production for Report-Only violations, then switch to enforcing `Content-Security-Policy`.

## 6. Design

- **Field borders** (M17) are 1.48:1 against white. WCAG 1.4.11 asks 3:1 for the visible edge of an input. Choose a darker `--border-field`, or rely on another indicator.
- **Orange theme tokens:** Graphite is the live theme (as `DESIGN.md` says), and its block in `index.css` overrides the older orange tokens. The orange tokens were still corrected for contrast, in case they return. Delete them if they will not.

## 7. Marketing copy

- Was "self-hosted" meant as a product edition? If so, describe it per edition. The universal claim was removed because the hosted deployment contradicts it.
- Do you want to keep "The boring guarantees, written down" (`Home.jsx:357`)? "Guarantee" can be read as a contractual promise.
- Evidence is needed for "Six things most accounting software leaves to you" (`Home.jsx:305`).
- "Four applications that already know each other" (`Home.jsx:266`): two are not built yet.

## 8. Assets

- **`packages/ui/src/assets/hero-illustration.webp`**: its source and licence are unknown. Confirm you hold commercial rights, or replace it.
- **Clor name and logo**: confirm ownership and do a trademark check.
- **Third-party notices**: add a licence notices file to distributions. Apache-2.0 echarts asks for its NOTICE.

## 9. Fees and refunds

Clor takes no payments today, so no refund policy was added. If billing starts, supply:

- the fees and the billing cycle;
- the refund and cancellation terms;
- the tax invoice details for the operator's own GST;
- the payment processor (who becomes another data recipient).
