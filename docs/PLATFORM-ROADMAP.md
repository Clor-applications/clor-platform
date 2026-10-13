# Authentication and Platform Extensibility

Written 17 Aug 2026, checked against the code. Covers the two areas asked about:
login and identity, and the extensibility set — theming, custom fields,
dashboards, integrations.

**Everything below registers in the feature catalog** (`featureCatalog.ts`), per
the standing rule that each capability is switchable per organisation.

---

## Part 1 — Authentication

### Where it stands today

| Element | Current state |
|---|---|
| Login | Local only: email or username plus bcrypt password |
| Token | JWT, 8 hours, no refresh, no server-side revocation |
| Token storage | `localStorage` — readable by any XSS |
| Logout | Clears the local key; the token stays valid until it expires |
| Password reset | Token generated with `Math.random()`, held in a **module-level Map** — lost on restart, not shared across instances |
| Rate limiting | None on login, signup or reset |
| Account lockout | None |
| 2FA | None |
| Email verification | None — every signup silently creates a live tenant |
| SSO / LDAP | None |
| Auth audit trail | None (the `AuditLog` table exists and is used for user CRUD only) |

**The honest summary:** the local login is functional but it is the weakest part
of the product. Before adding a second identity method, the first one needs to be
sound — an SSO integration sitting next to a login with no rate limiting simply
moves the attack to the weaker door.

### What to build, in order

| # | Item | Effort | Why this position |
|---|---|---|---|
| A1 | **Auth hygiene**: rate limiting, lockout after N failures, `crypto.randomBytes` reset tokens stored in the DB with single use, refresh-token rotation, real server-side logout, session list with revoke | 5–7 d | This is a liability today, and every item below assumes it |
| A2 | **Email verification** on signup | 2 d | Stops junk tenants; needed before any public sign-up push |
| A3 | **2FA (TOTP)** — authenticator app, recovery codes, per-org "require 2FA for admins" | 3 d | Cheap, and the first thing a security-conscious buyer asks for |
| A4 | **Google / Microsoft sign-in (OIDC)** | 4–5 d | Covers the large majority of real SSO requests at SMB and lower mid-market, at a fraction of SAML's cost |
| A5 | **Auth audit log** — logins, failures, password changes, role changes, with IP and user agent | 2 d | Asked for in every security review; trivial once A1 exists |
| A6 | **SAML 2.0** (Okta, Azure AD, ADFS) | 6–8 d, plus per-IdP testing | Only when a deal requires it. Each customer IdP is its own support burden |
| A7 | **SCIM provisioning** — users created and deactivated from the IdP | 5 d | Follows SAML; mid-market IT asks for it so leavers lose access automatically |
| A8 | **LDAP / Active Directory bind** | 4–5 d **plus deployment work** | See the caveat below |

### The LDAP caveat, stated plainly

LDAP and Active Directory live **inside a customer's network**. A cloud
application cannot reach them without one of:

- a **VPN or tunnel** from your infrastructure into theirs (they will resist),
- an **on-premise agent** you build, install and support at each customer, or
- an **IdP that already fronts AD** — Azure AD, Okta, JumpCloud — which turns
  the problem back into A4 or A6.

For a cloud product the third option is the only sane one. My recommendation:
**do not build direct LDAP**. When someone asks for "AD login", what they almost
always mean is "our staff should sign in with their work account", and Azure AD
via OIDC or SAML delivers exactly that with no agent to maintain.

Build direct LDAP only if you ship an on-premise edition, which is a separate
product decision with its own release, upgrade and support model.

### Recommended sequencing

**Now:** A1 and A2 — they close real holes.
**When you have paying customers:** A3, A5.
**When a specific deal asks:** A4, then A6 and A7 for that deal.
**Probably never:** A8.

---

## Part 2 — Extensibility

Several of these were designed in `COMPETITORS-CUSTOMIZATION-MIGRATION.md` §2 and
are waiting to be built rather than needing design from scratch.

| # | Item | State | Effort |
|---|---|---|---|
| B1 | **Custom fields** — user-defined fields on customers, vendors, items, documents; typed, searchable, printable | Designed (`CustomFieldDef`), not built | 6–8 d |
| B2 | **Branding and theme** — logo, accent colour, document templates per company | Token layer exists; needs an org-level override and an upload | 3–4 d |
| B3 | **Saved views** — per-list columns, filters and sorting, shareable to a role | Designed (`UiPreset`), not built | 3 d |
| B4 | **Custom dashboards** — choose and arrange widgets, set as landing page per role | Designed, not built | 5–7 d |
| B5 | **Public API + API keys** — scoped tokens, per-key rate limits, documented endpoints | Not started | 5–7 d |
| B6 | **Webhooks** — subscribe to document events, with retries and a delivery log | Not started | 4 d |
| B7 | **Integrations** — payment gateway, WhatsApp, bank feeds, GSP for GST filing, Tally import/export | Not started | 3–6 d each |
| B8 | **Customer portal** — customers view and pay their invoices | Not started | 10–15 d |
| B9 | **Print/PDF designer** — user-editable document layouts | Fixed templates today | 8–10 d |

### What matters for your market, and what does not

**Build early — every Indian SMB asks for these:**

- **B1 custom fields.** The single most requested extensibility feature in this
  category. "Can I add vehicle number?" "Can I add route?" "Can I add a
  transporter field on the invoice?" Without it, every such request becomes a
  code change by you.
- **B2 branding.** Their logo on the invoice, their colour on the portal. Cheap,
  and it is what makes the product feel like theirs.
- **B5 + B6 API and webhooks.** Not because customers integrate directly, but
  because it lets *someone else* build the integration you have not got to yet.
  The highest leverage per day of work on this list.

**Build when asked:**

- **B3 saved views** — matters once lists get long.
- **B7 integrations** — pick by demand. For India the order is usually payment
  gateway, then bank feeds, then GSP filing, then WhatsApp.

**Later or never:**

- **B4 custom dashboards.** Impressive in demos, rarely used daily. A good fixed
  dashboard beats a configurable one most of the time.
- **B8 customer portal.** Real value, but it is a second product surface with its
  own auth, design and support load.
- **B9 print designer.** Expensive to build well; a good set of fixed templates
  plus B2 branding covers most of the need.

### Two things to get right early, cheaply

1. **Custom fields belong in the schema now**, even if the UI comes later. Adding
   a JSON column and a definition table is easy today and awkward once there is
   customer data in every table.
2. **API keys should be designed alongside the permission model**, not bolted on.
   A key is just another principal, and it should resolve through the same
   `services/access.ts` path that users do — otherwise there are two permission
   systems to keep in step.

---

## Combined recommendation

If it were my call, in order:

1. **A1 auth hygiene** — closes the real hole (1 week)
2. **Finish the masters block** — still the blocker for eight of the sixteen
3. **B1 custom fields** — the most-asked extensibility feature
4. **A2 + A3** — email verification and 2FA
5. **B2 branding**, **B5 API**, **B6 webhooks**
6. **A4 Google/Microsoft sign-in** when the first buyer asks
7. Everything else on demand

SSO and LDAP feel urgent because they are on every enterprise checklist. They are
not urgent for a product selling to Indian SMBs through CAs. The auth work that
*is* urgent is the unglamorous part: rate limiting, real reset tokens, revocable
sessions.
