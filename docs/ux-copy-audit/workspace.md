# Workspace (apps/admin) UX copy audit: fixes

- [x] #1 apps/admin/src/screens/SettingsRoles.jsx:253 — 'Please confirm' / 'Delete this role?' / 'Yes, continue' → 'Delete the role “{name}”?' / 'People who hold it lose what it allowed. This cannot be undone.' / 'Delete role'
- [x] #2 apps/admin/src/screens/AccountActivity.jsx:240 — 'Details' + raw JSON → known metadata keys as labelled rows (Company, Email, Role, Reason…), the rest left out
- [x] #3 apps/admin/src/screens/AccountActivity.jsx:241 — 'Request' → 'Error code'
- [x] #4 apps/admin/src/screens/SettingsUsers.jsx:140 (also 146, 154) — 'Roles: {server text | Failed to load}' → 'Could not load the roles. Try again.' (errorWords via local failWords.js; plain server sentences kept)
- [x] #5 apps/admin/src/screens/SettingsUsers.jsx:315 (also 327, 335, 348, 361, 373, 401, 413, 425) — 'Failed to create user' etc. → 'Could not add the user. Try again.' etc.; role-rule codes keep their own next step
- [x] #6 apps/admin/src/screens/PlanChange.jsx:270 (also 92, 290, 400, 420, 530, 596) — raw `String(e?.message || e)` → 'Could not work out the price. Try again. Nothing was charged.' and the same shape for each call (also BillingDocs.jsx:20 msg())
- [x] #7 apps/admin/src/screens/InvoiceDrawer.jsx:29 (also 98) — raw error → 'Could not open this invoice. Try again.' / 'Could not open the payment page. Try again. Nothing was charged.'
- [x] #8 apps/admin/src/screens/AdminHome.jsx:410 — 'Status: past_due.' → planSentence(status), e.g. 'Your payment is overdue. Pay the open invoice to keep your apps working.' (local planWords.js says plan, not subscription)
- [x] #9 apps/admin/src/screens/BillingPreview.jsx:121 — 'Status: {RAW}' → planWord(status), e.g. 'Payment overdue'; 'Not read' / 'Reading the plan…' → 'Could not load' / 'Loading the plan…'
- [x] #10 apps/admin/src/screens/AccountOverview.jsx:440 — 'Status: {RAW|unknown}' → planWord(status) / 'Not loaded yet'
- [x] #11 apps/admin/src/screens/AdminHome.jsx:886 — lowercased raw status pill → planWord(status)
- [x] #12 apps/admin/src/screens/AdminHome.jsx:113 — 'Good morning/afternoon/evening, {name}' h1 → h1 'Home', with 'Hello, {name}' at the start of the line under it
- [x] #13 apps/admin/src/screens/SettingsBranches.jsx:478 — 'UNREGISTERED' (raw enum) → 'Regular' / 'Composition' / 'Unregistered'
- [x] #14 apps/admin/src/screens/SecuritySettings.jsx:260 (map at :60) — humanised enum ('Login success', 'Token refreshed') → fixed map ('Signed in', 'Wrong password', 'Account locked', 'Stayed signed in'…), fallback avoids 'login' and 'token'
- [x] #15 apps/admin/src/screens/AdminHome.jsx:952 (also AccountActivity.jsx:136/155/225, Landings.jsx:125/214) — `ACTION_WORDS[a] || a` → actionText(a): unmapped codes as words, 'Made a change' when empty
- [x] #16 apps/admin/src/screens/SecuritySettings.jsx:37 — 'Access token lifetime (minutes)' → 'Apply access changes within (minutes)' (the token lifetime is how soon a suspension or role change reaches a signed-in person)
- [x] #17 apps/admin/src/screens/SettingsUsers.jsx:419 — 'Remove {name}?' / 'They lose this company and every role in it.' / 'Remove' → 'Remove {name} from this company?' / '…their seats here are freed. You can add them again later.' / 'Remove from company'
- [x] #18 apps/admin/src/screens/PlanChange.jsx:305 (also 435) — 'Add 3 users' / 'Add Payroll' → 'Add 3 users · pay ₹{total}' / 'Add Payroll · pay ₹{total}' once the price is worked out
- [x] #19 apps/admin/src/screens/BillingPreview.jsx:35 (to 38) — 'A seat = a person who can sign in to Accounting.' → 'A seat is one person who can open Books.' (same shape for each app)
- [x] #20 apps/admin/src/screens/Members.jsx:35 (also wsKit.jsx:331, AuditTrail.jsx:23 and :38, SettingsRoles.jsx:40/42/43) — 'Accounting' → 'Books' (RoleSelect.jsx:13 left: it orders the server's own role-group names)
- [x] #21 apps/admin/src/screens/AuditTrail.jsx:24 — 'People & Attendance' → 'People' or 'Attendance', whichever the company has (the server keeps one filter for both, and the two apps are never on together)
- [x] #22 apps/admin/src/screens/AdminHome.jsx:42 — 'Account Owner' / 'Account Admin' / 'Billing Admin' → 'Owner' / 'Administrator' / 'Billing admin'
- [x] #23 apps/admin/src/screens/AdminHome.jsx:60 — 'Subscription required' → 'Not in plan'
- [x] #24 apps/admin/src/screens/AdminHome.jsx:875 — panel 'Subscription' → 'Plan'
- [x] #25 apps/admin/src/screens/AccountOverview.jsx:138 (also 144) — 'Monthly run rate' → 'Cost each month' (unpriced app ids now shown by name)
- [x] #26 apps/admin/src/screens/AccountOverview.jsx:299 — 'The account could not be read: {server text}' → 'Could not load Workspace settings. Try again.' (also :89 rename error)
- [x] #27 apps/admin/src/screens/AccountOverview.jsx:436 — invented plan name 'Full' → 'Plan not loaded'
- [x] #28 apps/admin/src/screens/Landings.jsx:102 — 'Visible to owners and administrators.' → 'Only the account’s owners and administrators can see who has access. Ask one of them.'
- [x] #29 apps/admin/src/screens/OutsideAccess.jsx:230 — 'Nobody from outside. Add an accountant or auditor under Users.' → 'No accountant or auditor has access yet.' + button 'Add accountant'
- [x] #30 apps/admin/src/screens/SettingsUsers.jsx:625 — 'Add them under Company → Branches.' → 'Add them in Home → Branches.'
- [x] #31 apps/admin/src/screens/SettingsRoles.jsx:108 (also RolePermissionManager.jsx:243) — 'Give it from Users.' → 'Give it from Company users.'; 'Record visibility comes from branches, set under Users.' → 'Which records a person sees comes from their branches, set under Company users.'
- [x] #32 apps/admin/src/screens/AdminHome.jsx:411 — 'Open Billing to pay.' → 'Open Billing & seats to pay.'
- [x] #33 apps/admin/src/screens/Companies.jsx:222 — '{n} seats' under Members → '{n} members, counted by company' (the note under it still says one person in two companies counts in each)
- [x] #34 apps/admin/src/screens/AccountOverview.jsx:403 — 'Deactivated' → 'Inactive' (the word Company users uses for the same per-company login state; 'Suspended' stays for the account-wide state in Members)
- [x] #35 apps/admin/src/screens/SecuritySettings.jsx:46 — 'Owners and admins need two-step sign-in' → 'Owners and administrators must use an authenticator app'
- [x] #36 apps/admin/src/screens/Integrations.jsx:40 — 'User provisioning (SCIM)' → 'Directory sync'
- [x] #37 apps/admin/src/screens/SettingsBranches.jsx:371 (also 369, 376, 439–443) — 'GSTIN is mandatory while GST is enabled.' → 'Enter the branch’s GSTIN. GST is on for this company.'; 'Branch code is required' → 'Enter a branch code.' etc.
- [x] #38 apps/admin/src/screens/DataBackup.jsx:127 — 'Could not take the backup: {server text}' → 'Could not download the export. Try again.'
- [x] #39 apps/admin/src/screens/DataBackup.jsx:67 — browser-locale `toLocaleString()` → dayTimeText ('14 Nov 2026, 3:30 pm', India time)
- [x] #40 apps/admin/src/screens/DataBackup.jsx:187 — 'Not available yet.' → 'Restoring from an export is not available yet. If you need records put back, ask CLOR support under Help and support.' (test regex still matches)
- [x] #41 apps/admin/src/screens/RoleSelect.jsx:42 (also 53, UserLocationAccessTable.jsx:160) — '— No role —' / '+ Create new role…' / 'Select role' → 'No role' / 'Create a role…' / 'Choose a role'
- [x] #42 apps/admin/src/screens/Credentials.jsx:91 (also :82) — placeholder 'Blank = anywhere; e.g. 203.0.113.10' → placeholder '203.0.113.10' + helper 'Leave it empty to allow any address.'; 'Name *' → 'Name' with the hidden required marker other forms use
- [x] #43 apps/admin/src/screens/Invoices.jsx:85 — 'Paid this FY' → 'Paid this financial year' (the note keeps 'FY 2026–27', the usual Indian form)
- [x] #44 apps/admin/src/screens/SsoSettings.jsx:233 (also 326, 378) — 'e-mail' / 'E-mail' → 'email' / 'Email'
- [x] #45 apps/admin/src/screens/SupportAccess.jsx:27 (also :25) — 'Refused' / 'Ran out' → 'Not let in' / 'Expired' (REVOKED covers a request refused here or withdrawn by CLOR before approval: supportGrants.ts:181/195)

## Menu name vs page title

- [x] M1 apps/admin/src/screens/AdminHome.jsx:541 — h1 'Good morning, {name}' → 'Home' (same change as #12)
- [x] M2 apps/admin/src/screens/OutsideAccess.jsx:147 — title 'Accountant access' → 'Accountants' (matches the menu and the crumb)
- [x] M3 apps/admin/src/screens/CompanyProfile.jsx:102 — title '{company name}' → 'Company profile'; the name moves to the line under it
- [x] M4 apps/admin/src/screens/CloseCompanyPage.jsx:105 — title 'Close {name}' → 'Close company'; the name moves to the line under it
- [x] M5 apps/admin/src/screens/AuditTrail.jsx:323 — export file 'Audit trail' → 'Activity' (the page's menu name; 'Audit log' is the other page)
- [ ] M6 apps/admin/manifest.jsx:224 — skipped: 'Company users' short label 'Users' sits in the 176px panel, the module's 'Users' in the rail; changing either needs a look at the panel width and no dev server may run in this fix pass
- [ ] M7 apps/admin/manifest.jsx:184/231 — skipped: '&' in 'Users & access' and 'Billing & seats' is the owner's naming (17 Nov 2026) and breaks no DESIGN.md rule

## Repeating patterns

- [x] P1 raw server message `String(e?.message || …)` — about 77 places across 26 files → errorWords(e, '<what>') (or failWords for role and user changes): a plain server sentence is kept, codes, field names and library errors become 'Could not <what>. Try again.' Role save also says which permission is missing in words, not as SALES / CREATE
- [x] P2 two-word toasts 'Not done.', 'Not saved.', 'Not made.', 'Not removed.', 'Not revoked.', 'Not changed.', 'Not scheduled.', 'Not cancelled.' (19) → 'Could not <what>. Try again.' through errorWords
- [x] P3 'Failed to …' (16, SettingsUsers, SettingsRoles, SettingsBranches) → errorWords / failWords
- [x] P4 'That did not work.' (Members.jsx:128, Invitations.jsx:112, Support.jsx:324) → 'Could not make the change. Try again.' / 'Could not send the reply. Try again.'
- [x] P5 bare 'Loading…' label (12 screen uses) → named, e.g. 'Loading invitations…', 'Loading your devices…'; 'Reading invoices…' / 'Reading your apps…' / 'Not read' → 'Loading …' / 'Could not load'. Button states 'Loading…' on Refresh / Load older left: they sit on the control they describe
- [x] P6 empty states with no way forward — Company users, Roles, Branches, Credentials, Permissions, Workspace settings → Companies now say what will be listed and carry one add button (permission-checked through a new `actionNode` on wsKit Empty); Invoices (×2) and Purchase orders say what will appear (CLOR raises invoices, so no add button). Activity/sign-in/session empties left: nothing to add there
- [x] P7 count line — Invoices.jsx:83: three figure tiles (Paid this FY, Next to pay, GST input credit) → one CountLine ('₹X to pay, next due 2 Dec 2026 · ₹Y paid in FY 2026–27 · ₹Z GST you can claim as input credit'), zero figures dropped. Companies and Branches already carry a zero-dropping count line in their toolbar. Workspace settings, Access overview and Security overview keep their tiles — skipped: they are overview pages, not lists, and the rule is for list pages
- [x] P8 confirm buttons that were one bare verb (5) → name the object: 'Remove PO', 'Suspend in the account', 'Reactivate and take a seat', 'Revoke token', 'Remove provider'; titles name what is acted on and the message says what happens
- [x] P9 search placeholders (7 forms) → one shape, 'Search by <what it searches>': Audit log 'Search' → 'Search by person, action or detail'; Activity, Members, Branches, Roles, Company users follow; Companies already did
- [x] P10 four separate app-name maps said 'Accounting' in two of them (Members.jsx:35, wsKit.jsx:331) → 'Books' everywhere (see #20); AdminHome.jsx:66, Inbox.jsx:24, outsideAccessModel.js:3 already said Books. Merging the maps into one is left: a refactor, not copy
- [x] P11 optional markers ('(optional)', '· optional', 'Optional — kept in the history' as a placeholder; 8 fields) → one form: the label followed by a quiet '(optional)'; the history note stays as the placeholder 'Kept in the history'

## Shared items (not in apps/admin)

- [ ] S1 packages/ui/src/permissions/rbacErrors.js:25 — owned by shared UI: default 'Something went wrong'. Workspace no longer relies on it (apps/admin/src/screens/failWords.js falls back to errorWords)
- [ ] S2 confirmDialog defaults, CountLine, NotConnected — owned by shared UI

## Tests

- 35 files, 167 tests, all passing, run from a scratch tree that links this worktree's apps/, packages/, test/ and server/ to a node_modules that has `@base-ui/react` installed.
- `npx vitest run apps/admin` run in place: 30 of 35 files fail before any test runs, because `@base-ui/react` (packages/ui/src/components/ui/Menu.jsx, from commit 3f934dbc) was not installed in this checkout. That was an install gap, fixed by `npm ci`; after it the whole suite passes.
- Tests changed to the new wording: AdminHome, addSeats, addApp, accountOverviewPanels, roleGroups, branchesClose, billingInvoices, SupportAccess, OutsideAccess, securityScreens, NotificationSettings, accountArea, dataBackup, AccountActivity.
- [x] X1 apps/admin/src/screens/AdminHome.jsx + ws-overview.css — "Hello, {name}" wave emoji sat on a line of its own → inline on the greeting line. Found in browser check.
- [x] X2 apps/admin/src/screens/ws-plan.css, ws-access.css, ws-security.css, ws-overview.css, workspace.css — uppercase, tracked labels ("PLAN", "TO PAY", "USAGE") → sentence case as written (DESIGN.md: no uppercase labels). Found in browser check.
- [x] X3 apps/admin/src/screens/Invoices.jsx:68, InvoiceDocument.jsx:58 — 'Clor Applications Pvt Ltd' / 'Clor Applications Private Limited' → 'CLOR Applications Private Limited' (one form of the legal name, as the footer).
