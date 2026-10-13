# Clor Multi-App Development Rules

Read this before every task.

Clor is a platform containing independently owned applications, not one
program with modules. Current apps:

- **Accounting** — the most mature, and previously treated as the base
  application. It is now one app among several, not the host.
- **Payroll**
- **Projects**
- **People**

Each app is a bounded domain.

## Core rules

1. Never directly query another app's database.
2. Never create cross-database foreign keys.
3. Never import another app's internal services, Prisma models, repositories
   or business logic.
4. Cross-app communication uses **API contracts, adapters, events or stable
   shared identifiers** — nothing else.
5. Each app owns its business logic, database and schema, migrations, routes,
   API and domain tests.
6. Shared platform code owns authentication, tenant/company context, the app
   registry, shared UI, the permissions framework, shared API and event
   contracts, and platform navigation.
7. Do not duplicate shared UI primitives.
8. Do not modify another app while solving a local app task.
9. Avoid formatting or rewriting unrelated files.
10. Shared package changes must be narrowly scoped and justified in the commit
    message.

## Ownership

| Agent | May edit | Treats as read-only |
| --- | --- | --- |
| Payroll | Payroll-owned files | Accounting, except explicit integration contracts |
| Accounting | Accounting-owned files | Payroll |

If an app needs a capability another app does not expose, **define the
contract** rather than bypassing the boundary. A missing API is a thing to
specify, not a reason to reach into a database.

## Database ownership

| Database | Owns |
| --- | --- |
| Platform | tenants, companies, users, roles, app subscriptions, platform settings |
| Accounting | ledgers, journals, vouchers, accounting documents |
| Payroll | salary components, structures, assignments, runs, payslips, statutory configuration, payments |
| Projects | projects and project-owned data |
| People | employee/workforce master, once it exists |

Cross-app references are held as plain external ids — `companyId`,
`employeeId`, `ledgerId`, `costCentreId` — with no foreign key across a
boundary.

## Integration

    App A  →  App B's API or adapter  →  App B
    App A  ✗  App B's database

Posting and other write integrations must be **idempotent**, keyed on
something stable — for payroll, `payroll-run:{payrollRunId}:accounting-posting`.
A repeated request must never produce a second journal entry.

## Git

Two agents work this repository at once. Do not share a feature branch.

    Payroll:     feat/payroll
    Accounting:  feat/accounting or fix/accounting

Keep commits narrowly scoped and within one app. Do not mix an Accounting fix
into a Payroll commit. Do not run repository-wide automated fixes.

## Why this exists

So that a failure, a rewrite or a bad week in one app does not require
rewriting the others, and so that each app stays independently understandable,
testable and eventually deployable — while the person using Clor sees one
product.
