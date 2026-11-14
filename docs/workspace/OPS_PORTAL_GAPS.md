# Ops portal — what is there, what is missing (14 Nov 2026)

Owner's ask: "full customization ops portal for CLOR". The rule behind it:
every job CLOR staff do runs from ops.clor.in, with no scripts and no code
changes. Compared with the back offices of Stripe, Chargebee, Zendesk and
Freshdesk, Intercom, and HR SaaS consoles (Keka, Zoho).

## Already built

| Area | Screens |
|---|---|
| Customers | Customers list, one page per customer (overview, subscription, limits, invoices and payments, requests, users, connections, support access, timeline), search by any code, unlock, sign out everywhere, reset link, authenticator reset, retry emails |
| Sales | Trials, demo requests, Explore links, deals |
| Money | Pricing (price books with publish and roll back), custom plans, offers, subscriptions, approvals (two-person), invoices, payments, gateways, tax, invoice settings, renewals |
| Product | App catalogue, sample company, announcements |
| Email | Sender addresses, templates with preview and test, log with resend |
| Support | Tickets, consented support access |
| System | Alerts, system health with background jobs and request-ID lookup |
| Team | Staff and roles, operator two-factor, audit log with export |

## Missing, in build order

| # | Module | What staff get | Size |
|---|---|---|---|
| 1 | **Notes and tags** on a customer | Internal notes ("called owner, e-invoice details wrong"), pinned notes, tags such as `CA firm`, `pilot`, `VIP`; filter customers by tag | S |
| 2 | **Status incidents** | Post an incident or planned maintenance for a part of CLOR, update it, resolve it; clor.in/status shows it next to the automatic checks | S |
| 3 | **Saved replies** for tickets | Reply templates with the customer's name filled in, picked in the ticket reply box | S |
| 4 | **Insights** | Monthly recurring revenue, paying customers, trials started and converted, cancellations, by app, last 12 months | M |
| 5 | **Platform switches** | Sign-ups open or paused with a message; Explore on or off; set from Settings, audited | S |
| 6 | Customer health and attention lists | Going quiet, setup never finished, broken connections; red, amber, green | M |
| 7 | Legal documents | Terms, privacy and DPA edited and versioned in ops (today in `packages/shell/legal/documents.jsx`); customers accept the new version | M |
| 8 | Help centre | Help articles written in ops instead of `packages/shell/helpContent.js`; search, per app | L |
| 9 | Global feature flags | Beta switches for all customers or a share of them (per-customer switches exist) | S |
| 10 | Cancellation reasons and win-back | Why customers leave, asked in the cancel flow, reported in Insights | S |
| 11 | Bulk email to segments | Email chosen customers (by app, plan, tag) from the template system | M |
| 12 | Refunds and credit notes | Once a payment gateway is live | M |

Items 1 to 5 are the first batch (branch `claude/ops-modules`).
