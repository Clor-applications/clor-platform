# UX copy audit fixes: marketing website (website/)

- [x] #1 website/src/pages/Pages.jsx:725, :769 — on-premise sections removed from the refund and delivery pages (owner, 20 Nov 2026: no on-premise edition); both pages now say last updated 20 Nov 2026
- [x] #2 website/src/pages/Pages.jsx:735 — "Free tier and trials / Free plans and trial periods carry no charge and nothing to refund." → "Free trials / A free trial carries no charge, so there is nothing to refund."
- [x] #3 website/src/pages/Demo.jsx:278 — "with the apps you chose, on a 30-day trial" → "with the products you chose, on a free trial" (no plan data on that page; the "14 days" at line 169 is the sample-company link, not the trial, so it stays)
- [x] #4 website/src/components/Blocks.jsx:33 — "See CLOR with your own company’s figures." → "See CLOR doing work like yours."; also Home.jsx:736 "See it with your own figures" → "See it doing work like yours", Product.jsx:196 "See {name} with your own data." → "See {name} doing work like yours."
- [x] #5 website/src/pages/Pages.jsx:146 — Firms "Request a demo" pointed at /contact?about=firm → now opens the demo form (/demo); closing at line 188 also opens /demo; "Write to us" keeps /contact?about=firm
- [x] #6 website/src/pages/Pricing.jsx:57 — "For up to {n} users. No charge for more users." → "Includes {n} users. Extra users are free." (and "Includes {n} users, then ₹X a month for each extra user.")
- [x] #7 website/src/pages/Pages.jsx:86 — "There is no bundle to buy." → "You don’t have to buy a bundle."; Pricing.jsx:192 FAQ "Each product is subscribed to on its own, for the companies in your workspace" → "You can subscribe to each product on its own, for the companies in your account"
- [x] #8 website/src/pages/Home.jsx:72 — "File GST returns / File GSTR-1 and GSTR-3B from…" → "Prepare GST returns / GSTR-1 and GSTR-3B are prepared from…"; Home.jsx:117 "and file GSTR-1…" → "and prepare GSTR-1…"; content.js:14 "built" → "prepared"; content.js:31 step "File" → "Prepare the returns"; Windows.jsx GSTR-1 sample "File return / Ready to file" → "Review return / Return prepared / Prepared"
- [x] #9 website/src/pages/Home.jsx:136 — "Leave balances and requests from the employee app, approved by the manager." → "Leave requests from the employee app, approved by the manager, with CLOR Attendance."
- [x] #10 website/src/pages/Product.jsx:99 — "…share one login… Projects joins them when it is ready." → "…share one sign-in… {product} joins them when it is ready."
- [x] #11 website/src/routes.jsx:23 — "for small Indian companies, under one login." → "for Indian companies, under one sign-in."
- [x] #12 website/src/pages/Demo.jsx:149 — "body.error || Not sent. Try again in a minute." → "We could not send your request. Try again in a minute, or write to sales@clor.in." (429: "Too many requests came from your connection just now. Wait a few minutes and try again, or write to …"); network error line 151 → "We could not reach CLOR, so your request was not sent. Check your connection and try again, or write to …"
- [x] #13 website/src/content.js:103 — "Professional tax is set per state for each employee’s work location." → "Every state that charges professional tax on salaries. Each employee pays the rate of the state they work in, and you can correct a state’s rates from a date if they change." (checked against server statePt.ts: every levying state is seeded, companies correct by dated version)
- [x] #14 website/src/components/Sections.jsx:56 — "CLOR Applications Private Limited / 29AAACA1234F1Z5" → "Anand Traders / 27AAKFA4821L1Z3" (sample from Windows.jsx); site.css typing steps(33) → steps(13) to match
- [x] #15 website/src/team.js:17 — "to make business management simpler, smarter and more affordable through technology" → "He started CLOR to make running a business simpler and cheaper with software." (whole file rewritten in the plain register: every name, role, years and field kept, no new claims; line 64 triad also gone)
- [x] #16 website/src/team.js:54 — "secure, intelligent, and accessible solutions that empower every business to grow" → "Software should make a business simpler to run, not more complicated, and keep its data safe."
- [x] #17 website/src/team.js:35 — "bridge the gap between traditional accounting practice and modern technology…" → "Her aim is accounting software that works the way accountants already do."
- [x] #18 website/src/team.js:19 — "software for accounting, payroll, human resources, attendance, project management and other business needs" → "software for accounting, payroll, HR and attendance, with projects to follow" (same at line 51)
- [x] #19 website/src/pages/Home.jsx:85 — "Access the client controls / The client chooses what you can see and change, and can end it whenever they like." → "The client controls your access / They choose what you can see and change, and can end it at any time."; item 1 "Your own login / Your client invites you with your own login and decides what you may see and change." → "Your own sign-in / Your client invites you by email; you never use their password."; Pages.jsx:128 heading → "The client controls your access"
- [x] #20 website/src/pages/Home.jsx:373 — "See all solutions" (always /solutions/businesses) → the open tab's own link ("CLOR for businesses", "CLOR for accounting firms", "CLOR Books", "CLOR People"); the same link inside the open accordion item removed so it is not shown twice
- [x] #21 website/src/pages/Home.jsx:433 — "Choose the apps your company needs" → "Choose the products your company needs"
- [x] #22 website/src/components/Nav.jsx:84 and :208 — "Employee portal" → "Employee app"
- [x] #23 website/src/pages/Pricing.jsx:194 — "Employees using only the employee app are not users who sign in. Plans counted per employee…" → "Employees who use only the employee app are not counted as users. Plans priced per employee…"
- [x] #24 website/src/pages/Pricing.jsx:110 — "adding a product later never means changing plans." → "you can add a product later without changing the plans you have."
- [x] #25 website/src/pages/Pricing.jsx:172 — "Prices are being set now. Ask for a demo and we will tell you what your company would pay." → "We have not published prices yet. Request a demo and we will quote for your company."
- [x] #26 website/src/pages/Demo.jsx:216 — "People who work there" → "Number of employees"; error line 36 "Choose how many people work there." → "Choose how many employees your company has." (the server's own 400 message in server/src/routes/demoRequests.ts:115 still says the old words; outside website/)
- [x] #27 website/src/pages/Demo.jsx:231 — "Which apps" → "Products you want to see"; error line 39 "Tick at least one app." → "Tick at least one product." (server message at demoRequests.ts:122 unchanged, outside website/)
- [x] #28 website/src/pages/Demo.jsx:161 — thank-you page title "Request a demo" → "Demo requested"
- [x] #29 website/src/pages/Demo.jsx:209 — placeholder "98450 12345…" → "98450 12345"
- [x] #30 website/src/pages/Pages.jsx:710 — "Refund & cancellation" → "Refund and cancellation"
- [x] #31 website/src/pages/Pages.jsx:723 — "contact us — we will refund the affected period" → "contact us and we will refund the affected period"; line 692 status update " — {body}" → ": {body}"; the "— " before a quote's author (bands.css:3189) kept: it is the usual mark for an attribution, not a flourish
- [x] #32 website/src/pages/Pages.jsx:732 — "5–10 business days" → "5 to 10 working days"
- [x] #33 website/src/pages/Pages.jsx:716 — "billed monthly or annually" / "annual plans" (×2) → "monthly or yearly" / "yearly plans"
- [x] #34 website/src/pages/Pages.jsx:711, 751, 792 — "11 October 2026" / "9 November 2026" / "11 November 2026" → "11 Oct 2026" / "9 Nov 2026" / "11 Nov 2026"; Windows.jsx:158 "3 June 2024" → "3 Jun 2024"
- [x] #35 website/src/pages/Pages.jsx:692 — "POST_STATE[u.state] || u.state" → falls back to "Update"; line 686 "PART_WORD[p] || p" → falls back to "Other parts of CLOR" (deduplicated), so no raw codes reach the status page
- [x] #36 website/src/pages/Home.jsx:380 — tab "Featured" → "All"
- [x] #37 website/src/pages/Home.jsx:717 / 744 — "Take the next step" → "Start with CLOR"; "Learn at your own pace" → "Read the setup guides"
- [x] #38 website/src/pages/Home.jsx:418 — "Explore the product" → "See CLOR {name}"
- [x] #39 website/src/pages/Home.jsx:517 — "Attendance feeds payroll. Payroll posts to Books." → "Attendance feeds Payroll. Payroll posts to Books."
- [x] #40 website/src/pages/Home.jsx:105–107 — "Joining and exit checklists / Joining and exit checklists that HR, IT and the manager each tick off." → "Joining and leaving checklists / HR, IT and the manager each tick off their own tasks."; "Documents remind you before they expire." → "You get a reminder before an ID or certificate expires."; "One record per person, from offer letter to final settlement." → "From the offer letter to the final settlement."

## Terminology

- [x] T1 sign-in over login (noun) — 18 visible uses changed: Demo.jsx:231 hint, Home.jsx:152, 155, 440, 589, Pages.jsx:61, 126, 127, 135, 143, 803 ("give a login" → "give access to"), Product.jsx:209, Nav.jsx:48, Sections.jsx:104, content.js:38, 69, 142, site.js:113; the verb "sign in" was already consistent
- [x] T2 product over app — Home.jsx:25/472 "Inside each app" → "Inside each product", :474 "See the work each app does" → "…each product does", tab label "App" → "Product"; Pages.jsx:414 "in the app" → "in CLOR itself", :519 "Help with the app" → "Help using CLOR", :531 "Help in the app" → "Help in CLOR", :763/766 "apps you chose / an added app / the new apps" → products; Demo.jsx:176 "Explore the apps now" → "Explore the sample company"; routes.jsx:30 "the CLOR apps you want to see" → "products"; content.js:42 "every app" → "every product", :63 "Invite to the app" → "Invite to the employee app"; Demo form labels/errors under #27; "employee app", "authenticator apps" and "your email app" kept
- [x] T3 Employee app in the nav — under #22
- [x] T4 workspace for the customer's tenant → account — Pricing.jsx:192 and :193 ("your workspace" → "your account"), Home.jsx:155 and Pages.jsx:176 ("a workspace for the firm" → "an account for the firm"), content.js:69; "Workspace" kept where it names the Workspace product (Access, then Invitations)
- [x] T5 pay run over salary run — Home.jsx:94 (under #40 batch), Pages.jsx:387
- [x] T6 yearly over annual — under #33 ("annual support (AMC)" kept: it spells out AMC)
- [x] T7 working days over business days — under #32
- [x] T8 licence (Indian spelling) — Pages.jsx:725, 727, 769, 770 (the on-premise text itself stays, see #1)
- [x] T9 dates "11 Oct 2026" — under #34
- [x] T10 one connector name — content.js:36 "the Tally connector" → "the on-site connector"
- [x] T11 at any time — Sections.jsx:86 "whenever you like" → "at any time", Home.jsx:85 and :155 (under #19 / T1)
- [x] T12 joining and leaving over exits/onboarding — Home.jsx:105 (under #40), content.js:53 "Onboarding and exits" → "Joining and leaving"
- [x] T13 tagline order — Footer.jsx:40 "Accounting, HR, attendance and payroll" → "Accounting, HR, payroll and attendance" (matches About and the About meta); hero and home title kept as written
- [x] T14 contact link — Home.jsx:314 "Ask us" → "Write to us"; "Talk to us" kept as the contact page title, "Contact sales" kept as the nav label
- [ ] T15 "Accountants and CA firms" (Home.jsx:79) vs "accounting firms" — skipped: the tab names the person, the page names the firm; both read correctly

## Patterns

- [x] A uppercase labels — removed `text-transform: uppercase` and `letter-spacing: 0.08em` from all 8 rules: bands.css `.fx-eyebrow`, `.pg .fix-label`, `.pg .steps > div dt::before`, `.tcard-role`, `.fx .setup-copy::before`, `.ft-title`, `.mega-cat`, and site.css `.mega-cat`; the four 11px labels went to 12px (0.75rem) so sentence-case text stays readable
- [x] B "one login, one list of employees, one set of books" — the triad now appears in full only in the home hero (Home.jsx:589); Nav.jsx:49 → "Books, People, Payroll and Attendance work from the same employees.", Home.jsx:441 → "Add products as you need them. Each one joins the same employees and the same books.", Product.jsx:209 → "Bought together, they share one sign-in and the same records."
- [x] C team.js bio filler — under #15–#18 (whole file rewritten, facts kept)
- [x] D link labels — product pages: "See CLOR {name}" everywhere (Home.jsx highlights "See Attendance/Payroll/People", "Explore the product", "More about CLOR {name}", "Explore {name}"); product list: "See all products" (Product.jsx:57 "All products", Product.jsx:100 "See every product", Pages.jsx:910 "See the products"); footer column item "All products" kept as a list label
- [x] E title repeated in body — Home.jsx solutions accordion: owners (Tally, bank), firms (#19), finance and HR (#40) bodies no longer restate their titles; Pages.jsx:126 Firms "Your client invites you" no longer repeats the Access, then Invitations path that the steps section gives at line 134
- [x] T1 (addendum) website/src/routes.jsx:24 — meta description "with your own login" → "with your own sign-in" (found by rendering every page)
- [x] extra website/src/content.js:80 — 'PF ECR, ESI contributions, PT and Form 16 come out of the payslips themselves.' → 'PF ECR, ESI contributions and Form 16 come out of the payslips themselves, and PT is totalled by state for each return.' (CLOR does not make the state PT upload file; checked server/src/constants/stateLevies.ts)
