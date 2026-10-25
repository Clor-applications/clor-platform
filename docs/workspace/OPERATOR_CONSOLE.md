# Clor operator console (W-8.2)

The back office for **Clor Applications staff only**. Customers never see it.

## Where

- `https://app.clor.in/ops` (works today, no DNS change)
- `https://ops.clor.in` once a DNS record points `ops` at the `clor-app` Pages project (the app already recognises the host).

## Who can get in

1. **Bootstrap super admins** — Clor user ids listed in the API's `CLOR_OPERATOR_USER_IDS` setting (Cloud Run → `clor-api` → Variables). Comma-separated ids, not emails.
2. **Operators added in the console** by a super admin (Operators → Add operator), with a role:

| Role | Can |
|---|---|
| Super admin | Everything, including adding, changing and switching off operators |
| Support | See accounts; suspend and reinstate an account |
| Billing | See accounts; grant a plan (free or offline), extend a trial |

Every operator must have an **authenticator app** on their Clor login (My profile → Authenticator). Without it the console refuses to open. Every change asks for a **fresh authenticator code**.

## What it shows

Account metadata only: owners and members, companies, apps, plan and trial, sign-in dates, security events. Never a customer's invoices, employees or payroll.

## What it records

Every change is written to the **operator log** (append-only in the database: no update, no delete, by anybody) and to the **customer's own security activity**, so the customer can see what Clor did.

## Suspending an account

Every company in the account stops opening, for everybody, until reinstated. The customer sees a plain "This account is suspended" page with Contact support and Sign out. Their data is untouched.

## First-time setup (production)

1. Sign in to app.clor.in with your own Clor login and set up an authenticator (My profile).
2. Find your user id (Workspace → Access → Members shows it, or ask engineering).
3. Set `CLOR_OPERATOR_USER_IDS=<your id>` on the `clor-api` Cloud Run service and deploy a new revision.
4. Open `https://app.clor.in/ops`. Add the rest of the team under Operators.
