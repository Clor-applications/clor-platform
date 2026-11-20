# UX copy audit fixes: Ops console (packages/ops, console/web)

- [x] #1 packages/ops/Customers.jsx:352 — '402 if called' → 'Not on their plan'
- [x] #2 packages/ops/Customers.jsx:391 — 'Entitlement: legacy fail-open / explicit subscription / no subscription' → 'Access: older account, every app open / follows their subscription / no subscription, every app closed'
- [x] #3 packages/ops/Customers.jsx:393 — 'Effective access = membership ∩ role ∩ …' → 'A person can open something only if they belong to the company, their role allows it, the subscription covers it, the feature is on and a seat is free.' (also 'Not on the legacy fail-open rule.' → 'Apps open and close with the subscription.')
- [x] #4 packages/ops/Customers.jsx:398 — 'Without a subscription every app is refused (402).' → 'Without a subscription, nobody in this account can open any app.'
- [x] #5 packages/ops/Lists.jsx:350 — tile labels were already plain on the current main ('App not subscribed', …); 'Denials today' → 'Refused today'
- [x] #6 packages/ops/Lists.jsx:398 — Reason filter options showed raw codes → plain words from new kit REASON_SHORT (code kept as value)
- [x] #7 packages/ops/Lists.jsx:454 — row showed raw code plus HTTP method/route and an HTTP column → plain reason with its one-line meaning; method, route and HTTP column removed; 'Reason code' → 'Reason', 'Correlation ID' → 'Request ID', 'Organization' → 'Company'
- [x] #8 packages/ops/Invoices.jsx:138 — 'Nothing unpaid' shown while loading → no count line until the list arrives
- [x] #9 packages/ops/Procurement.jsx:47 — 'None outstanding' shown while loading → no count line until the list arrives
- [x] #10 packages/ops/Payments.jsx:359 — 'Live: … Real money moves once checkout is built.' → 'Live: the live keys are in use. Customers who pay an invoice online pay real money.'
- [x] #11 packages/ops/Payments.jsx:492 — 'Live keys are real. Once checkout is built, …' → 'From now on, customers who pay an invoice online pay real money into CLOR’s account. Test the live keys straight after switching.'
- [x] #12 packages/ops/StatusPage.jsx:224 — window.confirm('Remove “…” from the status page? …') → confirmDialog 'Remove this post from clor.in/status?' / '“…” stops showing to customers at once. Use this only for a post made by mistake.' / 'Remove post' · 'Keep post'
- [x] #13 packages/ops/SavedReplies.jsx:90 — window.confirm('Remove the saved reply “…”?') → confirmDialog with 'It is deleted for everyone in Support. …' / 'Remove reply' · 'Keep reply'; toast 'Removed.' → 'Saved reply removed.'
- [x] #14 packages/ops/kit.jsx:111 — dismiss button always 'Cancel' → new cancelLabel prop; 'Keep subscription' beside 'Cancel subscription' (Customers.jsx) and 'Keep invoice' beside 'Cancel invoice' (Invoices.jsx)
- [x] #15 packages/ops/Payments.jsx:710 — 'Subscription ${status}' (raw 'past_due') → 'Subscription: overdue, paid until …' via new kit subWord
- [x] #16 packages/ops/OpsSearch.jsx:68 — invoice status lower-cased raw ('issued', 'void') → 'Unpaid', 'Cancelled', 'Paid', 'Draft', as on Invoices
- [x] #17 packages/ops/Customers.jsx:898 — gateway event names ('payment captured') → word map ('Payment received', 'Payment failed', …) with a sentence-case fallback; Applied cell 'Yes' → 'Applied'
- [x] #18 packages/ops/Home.jsx:106 — 'Legacy all-apps accounts' / 'Fail-open: must move to a plan' → 'Older accounts with no plan' / 'Every app is open to them: move each to a plan'
- [x] #19 packages/ops/Deals.jsx:279 — 'Legacy fail-open' / 'Every app, no plan: move to a plan' → 'Older accounts, no plan' / 'Every app open: move each to a plan'; also Customers.jsx:292 'Fail-open: every app' → 'No plan: every app open' and Customers.jsx:433 'Legacy, every app' → 'Older account, every app'
- [x] #20 packages/ops/Lists.jsx:585 — '…switch keys; a refused module shows as MODULE_OFF in Entitlement denials.' → 'Customers never see these names. When a feature is off, the refusal is listed under Access refused as “Feature switched off”.'
- [x] #21 packages/ops/Customers.jsx:534 — 'Row-level security: every row …' → 'Each company’s data is kept apart: nobody in one company can read another’s.' (also Lists.jsx:108 and :187; Organizations page and menu → 'Companies', 'Org ID' → 'Company ID')
- [x] #22 packages/ops/OpsConsole.jsx:201 — menu and page 'Entitlement denials' → 'Access refused' (Lists.jsx:371 title, search label 'Search refusals')
- [x] #23 packages/ops/OpsConsole.jsx:200 — menu and page 'Jobs & workers' → 'Background jobs' (Health.jsx:45; OpsSearch hint)
- [x] #24 packages/ops/Health.jsx:46 — 'Background work outside requests: … Fixing a stopped worker stays with engineering.' → 'Work CLOR does in the background: … If a job has stopped, tell engineering.'
- [x] #25 packages/ops/Tickets.jsx:243 — 'Error code' / 'Look up this error code' → 'Request ID' / 'Look up this request ID'; Customers.jsx:460 'Correlation ID' → 'Request ID', its 'Reason code' column shows plain reasons
- [x] #26 packages/ops/Tickets.jsx:83 — 'Owner' (ticket assignee; also :242) → 'Looked after by'
- [x] #27 packages/ops/Customers.jsx:127 — 'Name, company ID or owner email' → 'Name, account ID or owner email'; 'client ID' → 'account ID' in Invoices.jsx:361, Payments.jsx:720, InvoiceSettings.jsx:469 (Payments.jsx:432 note for customers left: it is the customer’s own wording)
- [x] #28 packages/ops/Pricing.jsx:95 — 'It goes on the operator log.' → 'It goes in the Staff audit log.' (also Invoices.jsx:830, Payments.jsx:455, 508, 760)
- [x] #29 packages/ops/Settings.jsx:145 — 'Only billing operators can change this.' → 'Only Finance can change this.'; Limits.jsx:175 'Billing changes them.' → 'Finance changes them.'
- [x] #30 packages/ops/OpsConsole.jsx:408 — 'CLOR operators sign in…' → 'CLOR staff sign in…'; nav aria-label 'Operator console' → 'Staff console'; DemoRequests.jsx:346 fallback 'operator' → 'Staff'
- [x] #31 packages/ops/Deals.jsx:277 — 'Past due' tile, 'Payment due' pill and tab → 'Overdue'; Insights.jsx:13/38 'Payment late' → 'Overdue', 'On trial'/'Paying' state words → 'Trial'/'Active'; Deals tab 'On trial' → 'Trial'
- [x] #32 packages/ops/Lists.jsx:194 — 'Admin' / 'Billing admin' → 'Administrator' / 'Billing administrator'; Breaches.jsx:80 'Tell their admins' → 'Email their administrators'
- [x] #33 packages/ops/Lists.jsx:263 — 'With 2FA' / 'Without 2FA' / '2FA' / 'SSO' → 'With an authenticator' / 'Without an authenticator' / 'authenticator' / 'Single sign-on'
- [x] #34 packages/ops/Pricing.jsx:661 — 'Done' → 'Add to draft' (new plan) / 'Keep changes' (edit); drawer description names the same button
- [x] #35 packages/ops/InvoiceSettings.jsx:64 — 'Clor Applications Private Limited …' → 'CLOR Applications Private Limited …'
- [x] #36 packages/ops/OpsConsole.jsx:371 — 'Not done.' → errorWords: 'Could not set up the authenticator. Try again.' (or the server's own sentence)
- [x] #37 packages/ops/Invoices.jsx:527 — 'Not sent.' → 'The invoice did not reach Books. Check the connector under Invoice settings, then send it again.'
- [x] #38 packages/ops/Payments.jsx:546 — 'Still not applied.' → 'Still not applied: it could not be matched to an account. Record it by hand with Record a payment.'; 'Applied.' → 'Applied to the account.'
- [x] #39 packages/ops/Settings.jsx:39 — raw unstyled load error → 'Could not load the tax settings. Try again. If it keeps failing, tell engineering.' in the danger style
- [x] #40 packages/ops/Deals.jsx:261 — CSV wrote raw 'month'/'year' and ISO dates → 'Monthly'/'Yearly' and '14 Nov 2026'; column 'State' → 'Status'; Lists.jsx:227 users CSV 'Last sign-in' ISO timestamp → '14 Nov 2026, 3:30 pm' (Staff audit log CSV is built by the server; its file name keeps the sortable date)
- [x] #41 packages/ops/Alerts.jsx:48 — '0 open · 0 urgent · 0 not acknowledged' → new kit countLine drops zero clauses; 'No open alerts' when all are zero
- [x] #42 packages/ops/Procurement.jsx:126 — '${n} in the last while' → '${n} proformas' (nothing when none)
- [x] #43 packages/ops/Deals.jsx:328 — 'None here.' → 'No subscriptions with this status.'; Invoices.jsx:161 'None here.' → 'No invoices with this status.'
- [x] #44 packages/ops/Tickets.jsx:71 — 'No customer is waiting on CLOR. Nice.' → 'No customer is waiting on CLOR.'
- [x] #45 console/web/src/Pulls.jsx:78 — Merge ran at once → confirm 'Merge #N into main?' / '"…" goes into main and out to customers with the next release. A merge cannot be undone from here.' / 'Merge pull request' · 'Keep it open'; Releases.jsx:100 Approve → confirm 'Approve this run?' / 'Approve run' · 'Not yet' (new ConfirmDialog in console/web/src/kit.jsx)

Menu name vs page title and crumbs:
- [x] M1 packages/ops/Home.jsx:431 — 'Audit log →' → 'Staff audit log →'
- [x] M2 packages/ops/Home.jsx:142 — 'All jobs →' → 'Background jobs →' (page renamed, #23)
- [x] M3 packages/ops/Invoices.jsx:826 — 'chased under TDS certificates due' → 'chased under TDS certificates'
- [x] M4 packages/ops/OpsSearch.jsx:66 — result group 'Customers' → 'Accounts', the page it opens
- [x] M5 list-page crumbs repeated the page title (Announcements, Alerts, Approvals, Custom plans, Invoice settings, Offers, Saved replies, Forms on clor.in, Status page, Tickets) → section only, as Pricing, Invoices, Payments, Tax, Trials
- [x] M6 packages/ops/Pricing.jsx:265, 459 and DemoRequests.jsx:242 — one-string crumb 'Billing and setup · Pricing' → two crumbs ['Billing and setup', 'Pricing'] (same for Demo requests)
- [ ] M7 Explore.jsx:156, AppCatalogue.jsx:48 — skipped: the crumb names the rail section ('Billing and setup'), which is where these pages sit; the group label 'Product' is a sub-heading, so the crumb is right
- [x] M8 packages/ops/OpsConsole.jsx:208 — menu group 'Comms' → 'Messages'

Repeating patterns:
- [x] A raw server message as the whole error (~111 sites in packages/ops) → errorWords(e, '<what>') with a specific action per site ('load the invoices', 'save the draft', 'mark the invoice paid', …); ReasonDrawer errors too (kit.jsx)
- [x] A2 two-word fallbacks 'Not done.' / 'Not asked.' / 'Not saved.' / 'Not changed.' / 'Not removed.' / 'Not sent.' (OpsConsole, SupportAccess ×2, AccessRequests, CustomerNotes, Switches, StatusPage, SavedReplies, Invoices) → errorWords sentences; console/web/src/api.js 'That did not work. Try again.' → status-specific sentences (signed out / role / changed by someone else / too many tries / 'The Console server could not do that (error N). Try again; if it keeps happening, tell engineering.'); YourSignIn.jsx 'failed' likewise
- [x] B developer vocabulary around access → entitlement, fail-open, legacy, 402, correlation ID, row-level security, raw reason codes and switch keys replaced (#1–7, #18–22); 'module' → 'feature' on Feature switches (Lists.jsx:509, 513, 529); webhook kept only where Payments explains it to whoever sets up the gateway
- [x] C count lines → countLine() in kit.jsx drops zero clauses (Alerts, Announcements, Offers, Email templates, Approvals, DemoRequests, Explore, CustomPlans, Tickets, Breaches); metas show nothing while loading instead of '0 …' (Invoices, Procurement)
- [x] D bare empty states 'None here.' / 'Nobody here.' / 'None waiting.' / 'Nice.' → a sentence saying what is empty and, where there is one, the next step (Deals, Invoices, Lists, Customers, Tickets, Procurement, Breaches, Announcements, DemoRequests, Pricing)
- [x] E generic buttons → verb + object: Offers:108 'Save' → 'Save offer'; CustomPlans:157 → 'Save plan'; AppCatalogue:78 → 'Save listing'; TextMessages:83 → 'Save text settings'; Settings:72 → 'Save tax settings'; Payments:328 → 'Save keys' (tooltip 'Save first' → 'Save the keys first'); SavedReplies:44 → 'Save reply'; Approvals:173 → 'Save limit'; InvoiceSettings:127 → 'Save numbering'; DemoRequests:327 → 'Save status and note'; Email:301 'Reset' → 'Reset wording'; StatusPage:76 'Post' → 'Post notice'; Alerts:91 'Open' → 'Open page'; Health:98 'Open' → 'See failed emails'
- [x] F date helpers: local `when` in Payments.jsx:19, DemoRequests.jsx:50, Explore.jsx:20 now shows the year like kit.jsx `when` ('20 Nov, 3:05 pm' → '20 Nov 2026, 3:05 pm'). Merging the duplicate local day/may/Err helpers into kit.jsx left for a code clean-up; the words they show already match
- [x] G hand-written 'Loading…' paragraphs → kit `<Loading />` (DemoRequests ×2, Explore ×2, Payments ×2, Pricing ×2, Settings, Trials ×2); button busy words ('Loading…' on Show older) kept
- [x] H paging DemoRequests:166/168 and Explore:344/346 'Newer' / 'Older' → 'Previous' / 'Next', matching kit Pager
- [x] I tab counts AccessRequests:69–70 'Waiting · 3' / 'Open · 2' → 'Waiting (3)' / 'Open (2)'
- [x] J Customers:1070 Authenticator column 'Yes' / 'No' → 'Set up' / 'Not yet'; Trials:143 'never' → 'Never'
- [x] K abbreviations: Home:160 and Health:125 'Failed (24 h)' → 'Failed, last 24 hours'; Deals:351 '/ yr' '/ mo' → '/ year' '/ month'; Invoices:389 'Qty' → 'Quantity'

Tests: 18 test files in packages/ops updated to the new wording (button names, menu names, Staff console, reason placeholder, count lines, tab counts, request ID, plain reasons). `npx vitest run packages/ops console/web`: 29 files, 196 tests pass. They were run with a scratch config that stubs `@base-ui/react/menu`, because that package is in package.json but is not installed in this checkout; without the stub, 27 files fail on that import before any test runs.
