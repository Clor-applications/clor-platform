# Server messages and emails: UX copy fixes (audit of 20 Nov 2026)

Paths are under `server/src/`. Line numbers are those of the audit (before the fix).

## Findings

- [x] #2 middleware/errors.ts:28 — `Validation error: <Zod's own text>` → the schema's own words, or a plain sentence naming the answer ("The leave type is missing or is not the right kind of answer. Check it and try again."), via `issueWords()` in middleware/validate.ts; `words()` no longer prints field keys or "Validation error:"
- [x] #5 middleware/auth.ts:91 — server start-up fault message is generic → "Something went wrong on our side. Try again in a moment."
- [x] #6 routes/users.ts:111 and 16 other non-Books files (44 places) — `orgId mismatch` → "This is a different company from the one you have open. Switch company and try again." (`otherCompany(res)` in utils/companyWords.ts)
- [x] #7 middleware/tenantContext.ts:166, 167, 173, 181 — `No access to org` → "You do not have access to this company. Ask its owner or administrator to add you."
- [x] #8 middleware/rbac.ts:175, 197 — `Permission denied` → "Your role does not allow this. Ask an administrator of this company to change your role." (`permission` / `anyOf` fields kept)
- [x] #9 middleware/auth.ts:82, 104, 106 — `Missing token` / `Invalid token` / `Invalid/expired token` → "You have been signed out. Sign in again."
- [x] #10 services/subscriptions.ts:108 — `Your CLOR subscription is ${sub.status}…` → status said in words (`statusWords`: "overdue", "cancelled", "paused")
- [x] #11 services/subscriptions.ts:140 — `The subscription is ${access.status}; X is paused until it is renewed.` → "This subscription is cancelled, so X is paused. An owner can renew it under Workspace → Billing."
- [x] #16 middleware/errors.ts:16, 70 — `Server error` → "Something went wrong on our side. Try again in a moment. If it keeps happening, give CLOR support this reference: <request id>."
- [x] #17 middleware/errors.ts:37 — `Already exists` → "Something with this name or number already exists. Change it and save again." (the web's `/already exists/i` checks still match)
- [x] #20 services/people/approvals/engine.ts:848, 849, 1457, 1458 — `Due 2026-11-20.` / `Was due 2026-11-20.` → "Due 20 Nov 2026." / "It was due on 20 Nov 2026." (bell and email)
- [x] #21 services/attendance/leaveJobs.ts:330 — `Step 2 was due 2026-11-20.` → "This was due on 20 Nov 2026."; also services/attendance/leaveEngine.ts:659 and its history note
- [x] #22 services/people/desk.ts:328, 238 — `Reply was due 2026-11-20 10:00` (UTC) / `Resolve-by was …` / `Resolve by 2026-11-20.` → "A reply was due by 20 Nov 2026, 3:30 pm." (India time) / "It was to be resolved by 20 Nov 2026; nobody is assigned to it." / "Resolve by 20 Nov 2026."; desk.ts:285 "Moved on 20 Nov 2026" (test updated)
- [x] #23 services/outsideAccess.ts:29 — `…ended on 2026-11-20.` → "Your access to this company ended on 20 Nov 2026. Ask the company to add you again."
- [x] #40 routes/auth.ts:450, 931; routes/security.ts:483, 553, 648, 669; routes/email.ts:158 — `Unauthorized` → "You have been signed out. Sign in again." (routes/internalJobs.ts kept: a machine-only endpoint)
- [x] #41 middleware/auth.ts:123, services/auth.ts:147 — `This account is no longer active` / `Account is no longer active` → "Your sign-in has been switched off. Ask an owner or administrator of your account." (code `inactive` kept)
- [x] #42 middleware/tenantContext.ts:72–74, 393, 394; middleware/rbac.ts:88–89 — `Missing x-org-id` / `Missing x-branch-id` / `Missing x-warehouse-id` / `Missing auth context` / `Missing tenant context` / `No access to branch` / `No access to warehouse` → "Choose a company first, then try again." / "Choose a branch first…" / "Choose a warehouse first…" / "You have been signed out. Sign in again." / "You do not have access to this branch (warehouse). Ask an administrator of this company to add you to it." (services/ops/denials.ts now recognises the new words)
- [x] #1 routes/auth.ts:687 — sign-up duplicate-address reply now matches the new-address reply as far as this endpoint allows: 200, "Check your email to continue.", the existing `signup.already` email is sent, no session is made (see the client note at the end)
- [x] #3 routes/auth.ts:303 (and routes/security.ts:640) — text-message provider's own reason → "We could not send the code by text message. Use your authenticator app or a recovery code." (provider reason now logged for staff; code `SMS_NOT_SENT` kept)
- [x] #4 services/sms.ts:160 — no longer reaches the person signing in (#3); kept as it is for the operator console's own test send (routes/pricing.ts), where it is the right instruction
- [x] #12 middleware/rbac.ts:123 — `The people app is not on this account's subscription.` → "People is not on this account’s subscription. An owner can add it under Workspace → Billing." (app name from the catalogue; services/appGate.ts says the same; rbac.ts:129 names the app too)
- [x] #13 routes/governance.ts:605 — `The accounting app is not on…` → "Books is not on this account’s subscription. An owner can add it under Workspace → Billing."
- [x] #14 services/auth.ts:380–386 — four reset-link texts → "This reset link has expired or was already used. Choose Forgot password on the sign-in page to get a new one." (tests updated)
- [x] #15 services/auth.ts:417–422 — four verification-link texts → "This confirmation link has expired or was already used. Sign in to ask for a new one."
- [x] #18 routes/peoplePortal.ts:106 and 19 other People/portal route files (33 places) — five "Something went wrong…" wordings → one sentence with the reference (`ourFault()`); bulk decisions (leave.ts:2063, peopleApprovals.ts:348) → "This one could not be decided because of a fault on our side. Try it again on its own."; job application page → "Your application was not sent because of a fault on our side. Try again in a few minutes." (opsApprovals.ts:184 and scim.ts:300 kept: staff and machine text that already says what happened)
- [x] #19 routes/users.ts:223 (9 places), routes/governance.ts:224, 811 — `User not found in org` → "This person is not in this company."
- [x] #24 services/people/documentReminders.ts:142, constants/emailTemplates.ts:530–531 — ISO date and "(0 days)" → "expires on 20 Nov 2026 (in 7 days / tomorrow / today)"; subject "… expires in 7 days"; the bell body and HR task title use the same date
- [x] #25 routes/payrollAssignments.ts:211 — `joined on 2026-11-04` → "joined on 4 Nov 2026"
- [x] #26 services/people/lifecycle/probation.ts:90 — `extend probation to 2027-02-20` → "extend probation to 20 Feb 2027"
- [x] #27 routes/auth.ts:846 — reset email greeted the address ("Hello name@company.in,") → the person's name, else "Hello,"; the same fallback removed in opsCustomers.ts, trialReminders.ts, support/tickets.ts, ops/approvals.ts, ops/alerts.ts, billing/invoiceEmail.ts, billing/renewals.ts
- [x] #28 constants/emailTemplates.ts:39, 54, 69 — subjects → "Confirm your email for CLOR", "Reset your CLOR password", "Your CLOR authenticator app was removed"; auth.user_invited → "{{inviterName}} added you to {{orgName}} on CLOR"
- [x] #29 constants/emailTemplates.ts:46, 61, 287, 304, 336, 504, 567 — six expiry wordings → one pattern: "This link works once, for 24 hours." / "…until {{expiresOn}}." / "The code works once, until {{expires}}."
- [x] #30 constants/emailTemplates.ts:304 — "The link works once and for {{days}} days. If it has run out…" → "This link works once, for {{days}} days. If it no longer works…"
- [x] #31 constants/emailTemplates.ts (whole file) + services/mailer.ts — no consistent sign-off → `framed()` adds "— CLOR" to CLOR's mail and "— {{orgName}}" to mail a company sends (offer, interview, join, candidate, portal code, bank change, automation, breach notice); the trailing bare `{{orgName}}` lines removed; Books and staff-internal templates untouched (`signOff: 'none'`)
- [x] #32 constants/emailTemplates.ts:279, 330, 347, 727 — "Hello," kept where no name is known (invitations, trial links); `framed()` turns any "Hello ," left by a missing name into "Hello,"
- [x] #33 constants/emailTemplates.ts:659 — `{{count}} joining and leaving tasks for you today` → "Joining and leaving tasks for you today: {{count}}"
- [x] #34 constants/emailTemplates.ts:493, 496 — "employee portal" → "employee app" (subject and body), matching the WhatsApp text; "e-mail" → "email" in every template
- [x] #35 routes/account.ts:262 — `Role must be OWNER, ADMIN, BILLING_ADMIN or MEMBER.` → "Choose a role: owner, administrator, billing administrator or member." (code `BAD_ROLE` kept)
- [x] #36 routes/portal.ts:1090, 1238, 1250, 1269, 1270 (and the schema at 1266) — `decision must be…` / `month must be YYYY-MM.` / `date must be YYYY-MM-DD.` / `kind must be OVERTIME or COMP_OFF.` → "Choose approve or reject." / "Choose a month." / "Choose a day." / "Choose overtime or comp-off." (tests updated)
- [x] #37 routes/people.ts:483 — `…pan, uan, esic, account, passportNumber or workPermitNumber.` → "Choose what to show: PAN, UAN, ESIC number, bank account, passport or work permit."
- [x] #38 routes/people.ts:2841, routes/leave.ts:2221, routes/dataExport.ts:274, routes/attendanceInsights.ts:1410 — field-style texts → "Choose resolved or rejected." / "Choose approve or reject." / "Choose what to export: the data, the settings, or both." / "Choose approve or reject."; people.ts:1391/1473/1492 `Checklists are JOINING or LEAVING.` → "No such checklist: choose the joining or the leaving checklist."; leave.ts:739 import row → "In the half-day column, write FIRST or SECOND, or leave it blank." (a file column, so the values stay)
- [x] #39 routes/auth.ts:74 — `Invalid login payload` → "Enter your email and password."
- [x] #43 routes/users.ts:1064, 1073 — `Org <id> does not belong to this account` / `…do not belong to org <id>` → "One of the companies is not in this account." / "One of the branches is not in that company."
- [x] #44 routes/users.ts, roles.ts, branches.ts, governance.ts, permissions.ts — "X not found", "Invalid X", "Cannot …" and unpunctuated texts → house style ("No such role.", "One of the branches is not in this company.", "This role is given to 3 people. Give them another role first.", "One of the permissions is not one CLOR knows. Reload the page and try again." — `permissions` fields kept; test updated)
- [x] #45 services/accountInvitations.ts:198, 220 — `This invitation was revoked; …` / `No open invitation with that id.` → "This invitation was already withdrawn. Send a new one instead." / "No such open invitation. It may have been accepted or withdrawn; reload the list."
- [x] #46 routes/leave.ts:1509, 2520, 2524 — "Only 1 days … are left" → day/days and is/are said right (`countWords`)
- [x] #47 routes/auth.ts:297, 330, 351 — `Too many failed attempts. Try again in 5 minute(s).` → "Too many wrong tries. Try again in 5 minutes." (1 minute when one)
- [x] #48 services/policy.ts:217–229 — one rule per attempt, no full stop → every rule at once: "Choose a password with at least 12 characters, upper and lower case letters, a number and a symbol." ("too common" text kept, with a full stop)
- [x] #49 routes/peoplePrivacy.ts:91, services/people/bulk.ts:60 — `Erasing needs the Privacy delete grant.` / `<key> cannot be changed in bulk.` → "Your role does not allow erasing personal data. Ask an administrator of this company." / "The <field in words> cannot be changed for many people at once. Change it on each person’s record." (code `FORBIDDEN` kept)
- [x] #50 routes/auth.ts:901, 831 — "Password reset successfully. Please sign in again." / "If an account exists, a reset link has been sent…" → "Your password is changed. Sign in with the new one." / "If this email signs in to CLOR, a reset link is on its way. It works once, for 30 minutes." (still the same answer for every address)

## Extra items (coordinator, 20 Nov 2026)

- [x] E1 routes/demoRequests.ts:115 — "Choose how many people work there." → "Choose the number of employees."
- [x] E2 routes/demoRequests.ts:122, 126 — "Tick at least one app." → "Tick at least one product." (both the type error and the empty-list check)
- [x] E3 dates elsewhere: services/credentials.ts:338, services/companyClosure.ts:87, routes/companyClosure.ts:57 (audit line), services/anonymiseEmployee.ts:61, services/payroll/run.ts:1824, routes/supportGrants.ts:71 (audit line, India time) — ISO dates → "20 Nov 2026"

## Classes (section 2 of the audit)

- [x] C1 `orgId mismatch` (50) — 44 non-Books places → `otherCompany(res)`; the 33 left are in Books routes (bankBook, batchSerial, currencies, einvoice, inventoryAdjustments, invoices, items, ledger, orgMasters, parties, payments, pos*, purchaseDocs, quoteDocs, recurring, revaluation, share, stockDocuments, stockLedger, transfers, warehouses) and imports.ts — skipped: Books is another developer's; they can use the same helper
- [x] C2 "Something went wrong…" (37) — see #18; 2 kept (staff and machine endpoints)
- [x] C3 "X not found" / "Not found" (68) — non-Books ones moved to "No such X." (users, roles, branches, governance, features, dataExport, security, people, peopleMoneyPortal, the global 404: "No such page or record. It may have been removed, or the link is out of date."); Books ones and routes/internalJobs.ts (machine) left
- [x] C4 "Invalid …" (23) — `Invalid query` ×8 → "Those filters are not right. Clear them and try again."; `Invalid request` / `Invalid change` / `Invalid draft.` / `Invalid subscription` / `Invalid branch` / `Invalid warehouse` / `Invalid approval scope` / `Invalid login payload` / tokens → plain sentences; `Invalid item` and warehouses.ts `Invalid branch` left (Books)
- [x] C5 "Unauthorized" (10) — 7 → signed-out sentence; 3 in routes/internalJobs.ts kept (scheduler-only endpoint, never shown to a person)
- [x] C6 "Missing …" (10) — see #42; routes/imports.ts `Missing required column(s)` left (Books import)
- [x] C7 "No access to org/branch/warehouse" (7) — see #7, #42
- [x] C8 "Permission denied" (2) — see #8; `No roles assigned` → "You have no role in this company yet. Ask an administrator of this company to give you one."; stockDocuments.ts:125 left (Books)
- [x] C9 "`field` must be …" (18) — see #36–#38; publicApi.ts and scim.ts `userName must be…` left (developer and identity-provider endpoints, where the field name is the instruction)
- [ ] C10 "Unknown …" (41) — partly: `Unknown state`, `Unknown permission`, `Unknown preset`, `Unknown list.`, `Unknown status.`, `Unknown document kind.` rewritten; skipped: "Unknown request type.", "Unknown HR tool.", "Unknown People module.", "Unknown action.", "Unknown request kind." — each is a short, true sentence reached only by a stale screen or a crafted request; left for a later pass
- [x] C11 ISO dates in user text — see #20–#26, E3 (`dateWords` / `timeWords` in utils/istDate.ts); stored values, IDs and machine payloads untouched
- [x] C12 raw Zod text through the global handler (56 call sites) — see #2: every ZodError now goes through `issueWords()`
- [x] C13 "Server error" / "Already exists" fallbacks — see #16, #17; "Invalid JSON body" → "The request could not be read. Reload the page and try again."

## Patterns (section 4 of the audit)

- [x] P1 global handler fallbacks and Zod text — middleware/errors.ts uses `issueWords()` / `ourFault()` / plain constants
- [x] P2 one company guard — utils/companyWords.ts (`otherCompany`, company/branch/warehouse access and choose-first texts); services/ops/denials.ts reads the new texts to keep its NO_MEMBERSHIP / NO_ROLE_GRANT notes
- [x] P3 one signed-out sentence — `SIGNED_OUT_TEXT` ("You have been signed out. Sign in again.") in middleware/auth.ts, tenantContext.ts, rbac.ts, services/auth.ts (all session-refresh refusals), routes/auth.ts, security.ts, email.ts; code `refresh_raced`, `session_ended`, `inactive` kept
- [x] P4 one fault helper — `ourFault(requestId)` in middleware/errors.ts, used by every People and employee-app route file
- [x] P5 status to words — utils/statusWords.ts, used in leave, people, portal, attendance requests, self-service, payroll runs and revisions, invitations, subscriptions, approvals engine, clearance, review cycles, account-role audit line
- [x] P6 one date formatter — `dateWords` / `timeWords` / `countWords` in utils/istDate.ts
- [x] P7 email frame — `framed()` in services/mailer.ts (sign-off, "Hello," fallback, blank-line tidy) and `signOff` on each template
- [x] P8 old-layer wording — see #44
- [x] P9 term sweep in user messages (non-Books) — "this organisation" → "this company", "e-mail" → "email", "CLOR login" / "Your login" / "That login" → "sign-in" (about 40 strings; tests updated); "Reload" vs "Refresh" not swept: — [ ] skipped, 13 "Refresh" texts left as they are (both are understood; a rename touches staff screens' own button words)
- [x] X4 server/src/billing/round67.ts:129, invoices.ts:215 — fallback seller name 'Clor Applications Private Limited' → 'CLOR Applications Private Limited'.
