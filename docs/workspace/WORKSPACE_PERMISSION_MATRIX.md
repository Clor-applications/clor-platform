# Workspace permission matrix (account level)

| Action | OWNER | ADMIN | BILLING_ADMIN | MEMBER | Extra condition | Test |
|---|---|---|---|---|---|---|
| See account overview / plan | ✓ | ✓ | ✓ | — | | accountMembership |
| Add a company | ✓ | ✓ | — | — | plan's company limit, under quota lock | accountMembership, quotaLock |
| List members / directory / access detail | ✓ | ✓ | — | — | | accountMembers |
| Change account role (not OWNER) | ✓ | ✓ | — | — | target not an owner unless actor is owner | accountMembership |
| Make or remove an OWNER | ✓ | — | — | — | step-up; never the last owner | accountMembership |
| Invite (ADMIN/BILLING_ADMIN/MEMBER) | ✓ | ✓ | — | — | company roles only where inviter is company admin | accountInvitations |
| Resend / withdraw invitation | ✓ | ✓ | — | — | | accountInvitations |
| Suspend / reinstate member | ✓ | ✓ | — | — | owners only by owners; not self; not last owner | accountMembers |
| Remove member from a company | ✓ | ✓ | — | — | not the company's only admin | accountMembers |
| Sign a member out everywhere | ✓ | ✓ | — | — | owners only by owners; not self | accountMembers |
| See account activity | ✓ | ✓ | — | — | | accountMembers |
| Rename the account | ✓ | ✓ | — | — | | accountMembership |
| Make someone a company administrator | company `SETTINGS::Users::EDIT` | | | | step-up when the granter has an authenticator | accountMembers |
| Open business data (ledger, payroll, HR) | company roles only — no account role grants it | | | | | accountMembership ("opens no business data") |

Every refused account-level write is recorded as `ACCESS_DENIED` (or the action's own DENIED event) in `AccountAuditEvent`.
