# Workspace route map

The shell has no path router: an app and screen are named by `?app=<id>&open=<screen>`, the company by `/o/<CODE>/`, and an app may own a host (`accounting.clor.in`). app.clor.in (the front door) opens the Workspace (`app=admin`). Spec route intentions map as below.

| Spec route | Where it is | Who sees it (server rule) | Status |
|---|---|---|---|
| `/` Workspace home | `?app=admin&open=home` (`AdminHome`) | any member | built |
| `/welcome`, `/onboarding` | setup checklist on the home; `CompanySetup` for the first company | owners/admins | partial |
| `/applications` | home → Your apps; More apps | any member | built |
| `/companies`, `/companies/:id` | Account & plan (list); Company profile (current company) | owners/admins/billing; company permission | partial |
| `/members`, `/members/:id` | `open=members` + drawer | account OWNER/ADMIN (`requireAccountRole`) | built |
| `/invitations` | `open=invitations` | account OWNER/ADMIN | built |
| `/access`, `/access/roles` | `open=roles` (grouped), `open=permissions` | company SETTINGS::Roles | built |
| `/subscriptions`, `/billing`, `/billing/usage` | Account & plan, Billing (preview) | OWNER/ADMIN/BILLING_ADMIN | partial (no provider) |
| `/security`, `/security/sessions` | Login & security; Members → privileged access, sign out everywhere | company SETTINGS::Users / account admins | built |
| `/audit` | Audit trail (company); Account activity (account) | company Audit trail / account admins | built |
| `/settings` | Account & plan → Rename the account | account admins | partial |
| `/settings/profile` | My profile (header) | the person | existing |
| `/support` | home → Support group | everyone | built |
| `/access-denied` | in-place panel naming the missing permission | — | built |
| 404 | in-place "This page isn't here" for an unknown `?open=` | — | built |
| Invited person | `/invite?token=…` (`InviteAccept`) | token holder | built |
| Sign-in / sign-up | `/signin`, `/signup`, `/forgot-password` | public | built |
| Clor Operator | `/api/billing/accounts…` (operator allowlist + step-up); no console | operators | not built (W-8.2) |
