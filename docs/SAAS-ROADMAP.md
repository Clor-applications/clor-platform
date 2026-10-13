# SaaS platform — what is done, what is pending, and when to add it

Written 2026-09-09. The multi-tenant work is done in layers; this records which
layers stand, which do not, and — for each pending item — the moment it stops
being premature.

The recurring lesson from the layers already built: each of these has a
*prerequisite*, and doing it before the prerequisite means building it twice.
That is the whole reason for the "best time" column rather than a priority
number.

---

## Standing

| Layer | State |
|---|---|
| Plans and entitlements | Built. `planCatalog` + `entitlements` service; company and seat limits enforced |
| Module packs | Built. Five packs, in Settings and in signup |
| Global identity | Built. Account derived from membership, not from the token |
| Invitations | Built. An existing email is invited, not refused |
| Tenant isolation | Built, and asserted from outside by 13 cross-tenant cases |
| Org slug | Built. Generated, unique per account, shown at signup |
| Signup | Built. Account → Company → Modules, with a stepper |

---

## Pending

### 1. Account-level admin area

**What.** One screen holding the plan, the seat count, billing, the list of
companies, and cross-company user assignment.

**Why it is not built.** Nothing forced it. Each turn had a more specific ask in
front of it.

**Best time: next, and before anything else on this list.** Three of the four
remaining items need somewhere to live, and this is that place. It is also what
unblocks moving company creation out of Master Data — which cannot happen until
there is another route to creating a company, or the product loses the ability
entirely.

**Prerequisite:** none. This is the unblocker.

---

### 2. Company creation moved out of the running app

**What.** `Add company` currently sits in Master Data → Companies. It belongs in
the account admin area, beside the plan that limits it.

**Why it is not built.** Removing it today would leave no way at all to create a
second company: signup makes the first one only. The order has to be build the
admin area, move creation into it, then remove it from Master Data. Doing the
removal first is not a tidier product, it is a missing feature.

**Bounded in the meantime.** It runs through `setup-company`, so
`companyLimitReason` applies and it cannot exceed the plan.

**Best time: immediately after (1).** Same change, second half.

**Prerequisite:** (1).

---

### 3. Sidebar shows "on a higher plan" instead of hiding

**What.** A module the plan does not carry currently vanishes from the nav,
identically to one the customer switched off. It should show, locked, naming the
plan that carries it — which is what Settings already does.

**Why it is not built.** The nav gates on a single boolean, `isEnabled(feature)`
(`src/App.jsx`). Showing an upsell needs a third state — *off because they chose
to* versus *off because the plan excludes it* — which means the client fetching
entitlement alongside features and the nav renderer taking that state. It
touches the config gating roughly forty entries, and the nav is load-bearing.

**It is also a product decision, not only plumbing.** Zoho deliberately does not
upsell in the sidebar; QuickBooks does. Worth deciding deliberately.

**Best time: when the first paid plan actually exists and somebody can act on
the prompt.** An upsell that leads nowhere is worse than a hidden module.

**Prerequisite:** billing, so the upsell has a destination.

---

### 4. Multi-company dashboard

**What.** A firm-level view across every company the person can reach: who owes
what, whose return is due, which books are behind.

**Why it is not built.** Needs (1) plus a cross-org query path — every query in
the product is scoped to one org by construction, deliberately, and this is the
first thing that reads across several. That is a real design question and not a
screen.

**Worth knowing:** this is the one genuine wedge against Zoho. Zoho Books has no
firm-level dashboard — that is why Zoho Practice exists as a separate product.

**Best time: once more than a handful of accounts hold more than one company.**
Until then it is a dashboard over one row. The signal to watch is the
`usage.companies` figure the entitlement endpoint already returns.

**Prerequisite:** (1), plus a decision on how a cross-org read stays safe given
isolation is currently guaranteed by every query being single-org.

---

### 5. Bulk user assignment (UI only)

**What.** Assign one person to many companies in one action.

**Why it is not built.** Only the UI is missing. `POST /users` already accepts
`branchIdsByOrg` and creates memberships across several orgs in one call.

**Best time: with (1), as a panel inside it.** It is the smallest item here and
it has no prerequisite beyond a screen to sit on.

---

### 6. Subdomain routing and custom domains

**What.** `acme.clor.in` resolving to that tenant, and later a customer's own
domain.

**Why it is not built.** The slug exists and is generated; nothing resolves a
hostname to it. The rest is infrastructure rather than code: wildcard DNS and a
wildcard TLS certificate on the host.

**The caveat that has not gone away:** a wildcard certificate cannot be revoked
for one tenant. Revoking it hits every subdomain at once.

**Best time: when a customer asks for a branded URL, or when a second
environment makes host-based tenant resolution useful.** Not before — the slug
is already stored, so nothing is lost by waiting, and the certificate is an
operational commitment.

**Prerequisite:** host DNS and TLS, which is your call rather than a code change.

---

## Suggested order

1. Account admin area
2. Move company creation into it, remove from Master Data
3. Bulk assignment panel (same screen)
4. Billing — then the sidebar upsell becomes worth doing
5. Multi-company dashboard, when the usage figures justify it
6. Subdomains, when a customer asks
