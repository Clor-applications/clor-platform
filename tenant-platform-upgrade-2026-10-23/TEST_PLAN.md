# Platform Upgrade Test Plan

## TP-00 focused automated baseline

Run type checking and the existing suites for tenant isolation, RLS, tenant scope, global identity, sessions, permissions, entitlements and billing operators. Save exact output in `evidence/test-results.txt`.

## Required negative matrix

For each human role and non-human principal, test:

- no credential, invalid credential, expired credential, revoked credential;
- correct tenant, another org in same account, another account, deleted/disabled tenant;
- object ID from another org in path, query, body and nested relation;
- missing/invalid branch and warehouse scope;
- valid membership with no role, insufficient role, stale role, expired delegated grant;
- unsubscribed app, disabled org feature, exhausted seat limit, past-due/cancelled subscription;
- direct API calls that bypass the shell;
- repeated/replayed mutation and concurrent duplicate delivery;
- audit event presence with request ID, actor/principal, account, org, action and outcome.

## Database/RLS matrix

- Run under the deployed application role, not a schema owner or administrator.
- Exercise SELECT/INSERT/UPDATE/DELETE for representative tenant tables in all four stores.
- Verify unset tenant context behavior intentionally for HTTP, worker and migration roles.
- Verify pooled connections cannot retain the prior request’s tenant setting.
- Verify `outsideTenant` call sites are enumerated, reasoned and tested.

## Completion evidence per implementation task

Every task must record:

1. acceptance criteria;
2. source files and migration IDs;
3. before/after behavior;
4. exact test command and result;
5. live evidence when configuration-dependent;
6. rollback steps;
7. unresolved risks;
8. reviewer and completion date.

