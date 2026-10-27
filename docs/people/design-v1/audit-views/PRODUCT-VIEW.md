# People + Attendance: product-manager view (27 Oct 2026)

**Scope.** People modules Workforce, Organization and Time & Leave, plus Attendance, which shares the Time & Leave screens. This is a read-only audit with no code changes.

**Read.**
- The tracker, the decision, research and closure-audit docs in `docs/people/design-v1/`.
- `apps/people/manifest.jsx` and `apps/attendance/manifest.jsx`.
- `server/src/services/features.ts`, `services/people/guards.ts`, `services/entitlements.ts`, `constants/appCatalog.ts` and `constants/featureCatalog.ts`.
- `AttendanceSetup.jsx`, `PeopleOverview.jsx`, `PeopleSettings.jsx`, `services/notifications.ts`, `services/attendance/leaveJobs.ts` and `native/attendance-android/README.md`.

**Legend.** Claims about the market cite a URL in §9. **[U]** means unverified: from a third party, inferred, or not confirmed on the vendor's own page. **[code]** means checked in this repo.

---

## 1. Positioning

### The job, by company size

| Size | Who runs HR | Job to be done | What CLOR offers today | Fit |
|---|---|---|---|---|
| **5 people** (shop, clinic, CA office) | Owner, in the evenings | "Know who is off, keep a leave count nobody argues with, pay the right days." Sometimes there is no attendance device at all. | People: directory, leave with a date-by-date preview, working week, web check-in, employee app; Payroll *From leave* | Strong engine, but too much product. ~60 People nav items and 27 settings pages for a job that needs ~8 [code] |
| **20 people** (trading firm, small factory, agency) | Owner plus one accountant or office manager | "Staff mark attendance on a phone or a reader, I approve leave and WFH from my phone, and month-end payroll is not a fight." | Attendance capture (readers via ADMS, Hikvision/Dahua/Anviz/BioStar pull, phone punch with geofence and selfie), requests, month close, payroll readiness | Good. The gaps are a manager's phone approval and WhatsApp (§4) |
| **50 people** (multi-branch, 2–3 shifts) | A part-time or first HR person | "Shifts, overtime, comp-off, branch holidays, statutory registers, an audit trail an inspector accepts." | Shifts and rotations, OT and comp-off, branches, stand-ins, append-only audit, state starting points | Close. Statutory gaps: OSH earned leave by days worked, Form XX register (closure audit O-02, O-03) |

### Who buys what

| Buyer | Buys | Why | Risk |
|---|---|---|---|
| Owner with no device, or an office team | **People alone** | Leave, holidays, directory, documents, web check-in | People already has check-in (`HomeCheckIn`), so Attendance looks redundant to them. That is fine, but say so on the pricing page |
| Factory or retail owner with an eSSL or ZKTeco reader | **Attendance alone** | Punches become payable days and then payroll | Attendance carries a whole "People" section (directory, resignations, transfers, departments). The buyer gets most of People without paying for it |
| Anyone running Payroll on CLOR | **Both + Payroll** | One record from punch to payslip, never counted twice [code] | Two apps with ~70% of their Time & Leave screens identical. It feels like paying twice |

### Is the split clear on screen? No.

| Issue | Evidence | Effect |
|---|---|---|
| Attendance contains a People app | Attendance rail `personnel`: Employees, Contractors, Resignations, Transfers, Departments, Designations, Locations & Sites, Onboarding & Exit | The People product has no clear reason to exist for an Attendance buyer |
| Same screen, different names | People "Overview" / "Balances" / "Stand-ins" / "Calendar" against Attendance "Leave Overview" / "Leave Balances" / "Stand-Ins" / "Leave Calendar" | Support and help docs have to name both |
| Same label, different thing | People's Work Sites (establishments, legal) against Attendance's Work Sites (geofence). People's Locations (areas) against Attendance's Locations & Sites | A real data-model confusion for a 20-person firm with 2 branches |
| Three answers to "which day is off?" | People: Working Week. Attendance: Working Week **and** Weekly Off Policy **and** Shifts | The owner cannot tell which one wins. The rule exists in TIME-LEAVE-DECISIONS M2 but is not shown on screen |
| Two "My Attendance" entries | People `myDays` "My Attendance", Attendance `me` "My Attendance" | Two different screens under the same name |
| Inconsistent catalog copy | `appCatalog.ts` People: "The staff directory every app refers to." The manifest: "Every HR job in one place." | The marketing story is not decided |
| People modules on by default | Hiring, Performance, Engage, Benefits are `defaultEnabled: true` | A 5-person owner sees Jobs, Candidates, Goals, Training, Announcements and Events on day one |

**Recommendation.** Make the line one sentence: **People = the person and their time off. Attendance = the clock.**
- Attendance's Personnel section should become a read-only "People" link with "Add person". Full HR (documents, letters, transfers, exits) should say "in People".
- Leave screens can stay shared, but with **identical labels** in both apps.
- Hide Weekly Off Policy when Working Week covers it, or merge the two.

---

## 2. Activation

### Shortest path today (owner, fresh company)

| Milestone | Steps today | Blockers | Target |
|---|---|---|---|
| **A1 First employee added** | People → Workforce → Add Employee: a four-step wizard with 38 fields [code], or Import (upload, map, check, review) | The wizard is long for a 5-person firm. People Home has no setup checklist, only "All caught up" when empty [code] | ≤ 2 min: a "quick add" of name, phone, joining date and type; everything else later |
| **A2 Leave set up** | Settings → Leave Policy → a state starting point (KA/MH/TN/DL/Factories/OSH), then Holidays, then Working Week | Three separate settings pages. The state sets carry a wrong earned-leave basis (O-02), and Maharashtra shows the old Act's 21 days | One "Set up time off" step: state → types + holidays + working week in one go |
| **A3 Employee can ask for leave** | Settings → Employee Portal Access → activate each person, who gets an activation code, then the app or web portal | Activation is per person and manual. There is no SMS or WhatsApp invite [U: no channel found in code] | Bulk invite by phone link |
| **A4 First leave approved** | Employee asks → in-app bell, or the next morning's digest → owner approves on the web | Notices are in-app only (`notifyUsers` writes bell rows; no e-mail or push for leave) [code]. Android has an Approvals tab, but its parity is partial (O-10) | Push or WhatsApp to the approver within a minute |
| **A5 First payroll from attendance** | Attendance: people → reader IDs → shifts + default → holidays → reader → first punch → leave types; then Month Close → Payroll Readiness → Payroll run | Attendance Setup has 7 required steps, and **"Connect a reader" is required** even for phone-only firms [code]. Payroll still reads live rows, not the closed snapshot (O-04) | Make the reader step optional when phone punch is on. One "Close month and run payroll" path |

### What blocks first value

| Blocker | Severity | Fix |
|---|---|---|
| No People onboarding checklist. The Attendance setup checklist is a good pattern but is not reused | High | Reuse the `AttendanceSetup` pattern for People Home: add people, set up leave, invite staff, approve the first request |
| Production jobs are not woken: no Cloud Scheduler, no `JOBS_TOKEN` (O-01) | **Critical**. The digest, hand-on and lapse notices do not run in production | Owner runs the DEPLOY.md commands (~5 min) |
| 27 settings pages are visible on day one | Medium | Simple mode (§6) |
| Import is strong (undo, reports), but there is no "from Tally/Excel payroll sheet" preset | Medium | A template that matches common Excel muster and Tally employee exports [U] |
| Employee activation code instead of a phone-number login | Medium | OTP on the phone number (cost: SMS or WhatsApp; §5) |

---

## 3. Retention and the habit loop

### What exists [code]

| Trigger | Who | Channel | Frequency | Gap |
|---|---|---|---|---|
| Leave digest | Each approver | In-app bell only | Daily, 09:00–11:00 IST | Does not reach an owner who has not opened CLOR. **Inert in production until O-01** |
| New request / decision notice | Approver / employee | Bell (employee app for the employee) | Per event | No push for the approver on web; no e-mail |
| Lapse warning | Employee | Bell | Once, 30 days before period end | Good. Unique in market [market research §c] |
| Hand-on to HR | HR | Bell | Hourly job | Inert until O-01 |
| Books digest | Accounting owner | `booksDigest.ts` | Daily | **No People/Attendance equivalent** |
| Scheduled reports | Attendance | E-mail (`reportSchedules.ts`) | Configurable | Only in the Attendance app, not offered from People |
| Punch reminders | Employee | Android WorkManager, on the phone | ~30 min | Android only. No iOS native (Capacitor wrapper exists under `mobile/attendance`) [U on store status] |

### What brings a 5–50 person owner back weekly (proposed)

1. **Monday WhatsApp or e-mail summary.** Who is off this week, what waits, who was late most, and the payroll days at risk, with one-tap links. This is the single largest habit lever. Zoho People ships native WhatsApp approvals; Keka and greytHR rely on Slack/Teams or third parties.
2. **Approve from the notice.** WhatsApp or push with Approve/Reject buttons, plus a reject note.
3. **Month-end countdown.** "Payroll in 4 days: 3 missed punches, 2 pending leaves" (from readiness and O-06).
4. **Employee-side pull.** Balance, payslip and holiday list in the employee app. Employees opening the app make the owner answer requests, which is the loop.

**Missing:** e-mail or WhatsApp delivery for any People notice, a manager's push on iOS, a weekly summary, and owner-visible job status (market research §d #6).

---

## 4. Competitive gaps (small Indian firms)

### Pricing (INR per month, before 18% GST; vendor pages fetched 27 Oct 2026 unless marked)

| Vendor | Entry | Mid | Model | Free tier | Source |
|---|---|---|---|---|---|
| **greytHR** | Essential ₹2,495 for up to 50 employees, +₹45/emp | Growth ₹4,495 for up to 50, +₹85/emp (adds attendance, shifts, OT, geofence) | Flat bundle per 50 | No (7-day trial) | P1 |
| **Keka** | Foundation ~₹9,999 for up to 100 [U] | Strength ~₹12,999 / Growth ~₹15,999 [U] | Flat bundle per 100. Pricing page says "talk to sales" | No | P2, P3 |
| **Zoho People** | ~₹48–60 per user [U, sources disagree up to 4×] | ~₹96–144 [U] | Per user; Payroll extra | Yes, ~5 users [U] | P4, P5 |
| **RazorpayX Payroll** | Prime ₹3,499 for up to 20, +₹150/emp | Elite ₹6,499 for up to 100 (offer price) | Flat bundle | No | P6 |
| **sumHR** | ₹1,428/emp/year (~₹119/emp/mo) | — | Per employee | "Free" via Jupiter Money tie-up (terms unclear) [U] | P7 |
| **factoHR** | Free up to 20 (no attendance/leave/payroll); Core ₹4,999 for up to 50, +₹99 | Premium ₹5,999 / Ultimate ₹6,999 for up to 50 | Flat bundle per 50 | Yes (directory only) | P8 |
| **CLOR** | **Not set.** `appCatalog.ts`: "Pricing is deliberately NOT here." People tiers CORE/FULL only switch modules [code] | — | — | — | code |

**Read.** The market floor for a 20–50 person firm with leave, attendance and payroll is **₹2,500–5,000 a month flat** (greytHR, factoHR, RazorpayX). Keka sits at ~₹10k and up. A 5-person firm has **no good paid option**: bundles price for 20–50. That is CLOR's opening.

### Feature gaps that lose deals

| Gap | Keka | greytHR | Zoho | RazorpayX | sumHR | factoHR | CLOR | Deal impact |
|---|---|---|---|---|---|---|---|---|
| Native mobile app, iOS + Android, with **manager approvals** | Y | Y | Y | ? | Y (stores) | Y | Android native (employee + Approvals tab), parity partial (O-10). iOS is a Capacitor wrapper [U] | **High.** The first question in every demo |
| WhatsApp approvals / self-service | Third-party only | Not found | **Y (native)** | Not stated | Contact link only | Not stated | N | **High** for owners who live in WhatsApp; a differentiator, since most rivals lack it |
| Statutory pack: PF/ESI/PT/LWF/TDS + registers | Y (Foundation) | Y | Payroll add-on | Y (filings) | Y | Y | Payroll has PF/ESI/PT/TDS modules [code]. **Leave Form XX, state leave books, muster roll print: N** (O-03) | **High** for factories and 20+ shops (inspection) |
| OSH earned leave by days worked | ? | P | Y | — | ? | ? | **N** (O-02); state sets carry wrong figures | Statutory risk; rivals mostly configurable |
| Biometric devices | Y [U] | Y [U] | Y [U] | ? | Y (listed) | Y (listed) | **Y**: ADMS push, Hikvision/Dahua/Anviz/BioStar pull, eTimeOffice; vendors named eSSL, ZKTeco, Matrix COSEC, Realtime [code] | CLOR at parity or ahead. **Say it on the site** |
| Tally integration | Accounting integration (Foundation) | ? | Zoho Books first | ? | "Accounting apps" | "Accounting apps" | Payroll → Tally vouchers via an on-site connector (`payroll/tally.ts`), **and CLOR is itself the books** [code] | **CLOR's strongest wedge**: payroll posts to its own GST ledger, no export |
| Bank salary payout | ? | ? | ? | **Y (core)** | ? | ? | Payroll payments module [code; bank-file formats not verified] | Medium. RazorpayX wins "pay salaries in one click" |
| Slack/Teams | Y | 3rd party | Y | ? | ? | ? | N | Low for a 1–50 Indian firm |
| LOP as excess over balance; LOP reversal next month | ? | Y (reversal) | Y | ? | ? | ? | N (G6, G7) | Medium. Complaint #4 in our research |

**Where CLOR leads** (market research §c): a date-by-date leave preview, private leave, a policy tried on five people, year-end with undo, came back early, stand-ins as themselves, one engine (no double LOP), an append-only audit, state starting points, and **Accounting + Payroll + HR in one sign-in**.

---

## 5. Monetisation

Pricing is not set [code]. The switchboard exists (`APP_TIER_MODULES`, `extraFeatures` add-ons, `upgradeHintFor`), so tiers are a config change.

### Proposed packaging

| Tier | Who | Includes | Price idea [U, set against §4] |
|---|---|---|---|
| **Free** (≤ 5 employees, forever) | Owner-run shop | Directory, Add/Import, leave types from a state starting point, leave requests + preview, holidays, working week, web check-in, employee web portal, bell notices, basic register | ₹0. Undercuts all bundles; the hook into Accounting |
| **People Standard** | 6–50 | + Documents, letters, onboarding/exit checklists, approval rules, stand-ins, year-end run, attendance requests (WFH/OD/permission), e-mail digest, Android/iOS employee app | Flat ~₹999–1,999 for 25, then per head (below greytHR's ₹2,495) |
| **Attendance** (add-on or app) | Device or phone punch | Readers (ADMS/pull), phone punch + geofence + selfie, shifts/rotations, OT + comp-off, month close, payroll readiness | Per device or flat ~₹999 + per head |
| **Compliance pack** (add-on) | Factories, 20+ establishments | OSH earned leave by days worked, Form XX / state leave books, muster roll, NFH minimum check, 5-year retention, inspector export | ₹499–999/mo [U]. Pays for legal review |
| **WhatsApp** (metered add-on) | Any | Approve/reject, weekly summary, employee balance/payslip by chat, OTP login | Pass-through + margin. WhatsApp Business messages cost per conversation, so it cannot be free at no-infra budget |
| **Growth** | 50+ | Multi-branch with branch holidays, detailed structure, multi-level approval, Hiring, Performance, Engage, Benefits | Higher tier |

### Keep free, to win adoption

- Leave preview and private leave: the "aha" moment, not a paywall.
- State starting points: setup speed.
- Employee self-service web portal: employees are the distribution.
- Audit log and the no-self-approval rule: trust, and the law. Never paywall controls.
- Import and export: lock-in by paywall loses trust.
- Payroll *From leave* for People-only: the bridge into Payroll revenue.

**Do not charge for multi-branch alone.** A 15-person firm with 2 shops is common. Charge for *detailed structure* (`peopleOrgDetail` is already off by default).

---

## 6. Risk: complexity creep

### What a 1–2 person owner should never see by default

| Area | Screens or settings | Why hide |
|---|---|---|
| Organization → Detailed | Teams, Positions, Business Units, Grades, Cost Centres, Job Roles, Locations, Work Sites | Already off (`peopleOrgDetail`). Keep it so |
| Workforce | Private Cases, Help Desk + Help Desk Settings, Policies acknowledgement, Assets, Benefits, Salary Revisions | Nobody files an HR case against the owner in a 5-person firm |
| Modules on by default | Hiring (Jobs, Candidates), Performance (Goals, Training), Engage (Announcements, Events) | `defaultEnabled: true`. Turn them **off** for new companies under 10 people |
| Time & Leave | Stand-ins, Leave Year End (manual run), Request Rules quotas, per-type approval chains, auto-approve, hand-on days, entitlement slabs, probation HOLD/LOCK | Defaults should just work; show them when a second approver exists |
| Insights | Compliance, Compliance Calendar, Privacy, Audit Evidence, Data Health | Keep one "Things to fix" tile on Home instead |
| Settings | Custom Fields, Employee Self-Edits, Approval Rules, Employment Types, Work Modes, Tags, Company (legal), Integrations, Data Requests, Data Protection, Recycle Bin, SSO, Roles & Access | 27 pages [code]. A 1–2 user owner needs ~6 |
| Attendance | Reader Health, Sync Monitoring, Reader Logs, Punch Transactions, Unmatched Punches, ID Mapping, Department/Temporary Schedules, Rotations, Employee Confirmations | Device-ops surface. Show it only after a reader is connected |
| Roles | Maker-checker, team scope | With one user, `SELF_APPROVED` is already handled [code]. Never ask |

### Proposed "Simple mode"

- **On by default** while the company has ≤ 10 employees **and** ≤ 2 users. The owner can switch it off in one place (Settings → Modules & Apps).
- **Rail:** Home · People · Time off · Attendance (only if the person punches) · Settings.
- **Settings:** Company · Leave & holidays (one page: state set, types, holidays, working week) · Employee app · Users · Import/Export · Audit log.
- **Behaviour:**
  - The approval chain is the owner.
  - Year-end runs on a date with a preview e-mail.
  - Stand-ins are hidden.
  - Detailed structure is off.
  - Hiring, Performance and Engage are off.
- **Exit triggers:** a 2nd approver added, a branch added, more than 10 employees, or a reader connected. Each shows a **one-time suggestion**, never an automatic switch.
- **Build cost:** small. `feature` flags and `permission` already filter nav [code]. Simple mode is a feature key that the manifest's `nav` entries check, plus defaults at company creation.

---

## 7. Metrics: what to instrument

No product analytics found in `apps/`, `packages/` or `server/src` [code]. `AuditLog` and `JobRun` exist but are not product telemetry. Proposal: one `ProductEvent` table (org, user role, app, event, props), written server-side so it stays cheap and free of third-party trackers (DPDP).

| Funnel / question | Events | KPI | Target [U] |
|---|---|---|---|
| Activation | `company_created`, `employee_added` (source: wizard/quick/import/attendance), `leave_setup_applied` (state set), `holidays_added`, `portal_invited`, `portal_activated`, `leave_requested` (channel), `leave_decided` (channel, latency), `punch_received` (source), `month_closed`, `payroll_run_from_attendance` | % reaching A1→A5 in 7 / 14 / 30 days; time to first approval | A4 within 7 days ≥ 50% |
| Habit | `digest_sent/opened`, `notice_clicked`, `approval_from` (web/app/whatsapp), weekly active approvers, employee-app WAU/MAU | Weekly owner sessions; median approval latency | Approval < 24 h |
| Engine health | `preview_shown` → `request_submitted` (drop-off), `policy_refused` (code), `balance_adjusted` (manual fixes), `month_reopened` (reason), `PAYROLL_TAKEN` refusals, `lop_mismatch` (O-06) | Manual balance fixes per 100 requests (the "wrong balance" complaint) | Trend down |
| Automation | `job_run` (job, touched, failed), from `JobRun` | Days with no digest run | 0 |
| Complexity | Screen views per nav key, settings pages opened, simple-mode exits (trigger) | % of nav keys never opened by orgs with fewer than 10 employees | Candidates to hide |
| Monetisation | `upgrade_hint_shown/clicked` (`upgradeHintFor`), `module_toggled`, `addon_enabled` | Conversion by hint | — |
| Support signal | `error_shown` (code: 402/403/409), `import_failed_rows` | Top refusal codes | — |

---

## 8. Roadmap: next 3 releases (6–8 weeks each)

Score = impact (1–5) × (6 − effort (1–5)).

### R1 "Works in production, first value in a day" (weeks 1–7)

| Item | Impact | Effort | Score |
|---|---|---|---|
| Turn on Cloud Scheduler + `JOBS_TOKEN` (O-01): owner, 5 minutes | 5 | 1 | **25** |
| People setup checklist on Home (reuse the AttendanceSetup pattern) | 5 | 2 | 20 |
| Simple mode + Hiring/Performance/Engage off by default for small orgs | 5 | 2 | 20 |
| Quick add employee (4 fields) | 4 | 1 | 20 |
| One-page "Leave & holidays" setup from the state set | 4 | 2 | 16 |
| E-mail delivery for the leave digest and decisions (`mailer.ts` exists) | 4 | 2 | 16 |
| Attendance setup: reader step optional when phone punch is on | 3 | 1 | 15 |
| Unify labels across apps; merge Working Week / Weekly Off on screen | 3 | 1 | 15 |
| `ProductEvent` + activation funnel events | 4 | 2 | 16 |
| **Set prices** (Free ≤ 5, Standard, Attendance) | 5 | 2 | 20 (owner decision) |

### R2 "Approve from your phone" (weeks 8–15)

| Item | Impact | Effort | Score |
|---|---|---|---|
| Android parity: WFH, OD, permission, leave preview, edit, shorten (O-10), plus manager approvals with a reject note | 5 | 3 | 15 |
| Push notices (FCM) for approvers and employees | 4 | 2 | 16 |
| Monday owner summary (e-mail first, WhatsApp-ready template) | 4 | 2 | 16 |
| Payroll reads the closed snapshot (O-04) + LOP reconciliation in readiness (O-06) | 5 | 3 | 15 |
| Over-balance taken as LOP (G6) | 3 | 2 | 12 |
| Shift edits respect closed months (O-05) | 3 | 2 | 12 |
| Bulk invite to the employee app by phone link | 4 | 2 | 16 |
| Owner-visible "Automation last ran" line | 2 | 1 | 10 |

### R3 "Compliance pack + WhatsApp" (weeks 16–23)

| Item | Impact | Effort | Score |
|---|---|---|---|
| OSH earned leave by days worked + corrected state sets (O-02; needs legal sign-off) | 5 | 3 | 15 |
| Form XX / state leave book print, 5-year retention (O-03) | 4 | 3 | 12 |
| NFH minimum check per state (G4) | 3 | 1 | 15 |
| WhatsApp Business: approve/reject, balance, OTP login (metered add-on) | 5 | 4 | 10 |
| iOS employee app (wrap or native) | 4 | 3 | 12 |
| LOP reversal into the next run (G7) | 3 | 3 | 9 |
| Supporting document above N days (G5) | 2 | 2 | 8 |

### Cut, or defer past R3

| Item | Reason |
|---|---|
| Hiring, Performance, Engage, Benefits feature work | No signal from 1–50 firms. Keep them as they are, off by default |
| More detailed-structure lists, position budgeting | Larger-company needs |
| Clubbing rules, sandwich options, hourly leave from balance, marital/age eligibility (G10–G13, G17–G18) | P2/P3 in our own research |
| Slack/Teams | Indian SMB owners use WhatsApp |
| Shift swap requests, coverage, rosters forecasting | Attendance P2 |
| AI copilot | After explanations and telemetry exist |
| More reader vendors | Already ahead; finish trust rules (O-11) only when a customer asks |

---

## 9. Sources

Pricing and market (fetched or searched 27 Oct 2026):

- P1 greytHR pricing: https://www.greythr.com/pricing/
- P2 Keka pricing page (no prices shown, sales call): https://www.keka.com/pricing
- P3 Keka prices, third-party [U]: https://hyring.com/insight/keka-pricing ; https://zoftwarehub.com/en-ae/products/keka/pricing
- P4 Zoho People INR, partner sites, which disagree [U]: https://itforsme.in/pricing/zoho-people-india ; https://precisiontech.in/software/zoho/zoho-people/
- P5 Zoho People vs others, third-party [U]: https://asanify.com/blog/competition/asanify-vs-zoho-people/
- P6 RazorpayX Payroll pricing: https://razorpay.com/payroll/pricing/
- P7 sumHR pricing: https://sumhr.com/pricing/
- P8 factoHR pricing: https://factohr.com/pricing/
- W1 Zoho People native WhatsApp integration: https://blog.zoho.com/people/introducing-the-whatsapp-integration-for-zoho-people.html
- W2 Keka Slack integration (no native WhatsApp found): https://help.keka.com/hc/en-us/articles/39946724410897-Slack-Integration-for-Time-Tracking-and-Leave-Management ; third-party WhatsApp connector: https://viasocket.com/integrations/keka/2chat
- W3 greytHR mobile app leave (no WhatsApp self-service found): https://www.greythr.com/help-ess-mobile/leave-updates/apply-withdraw-leave-greythr
- M1 Keka mobile app: https://help.keka.com/user-guide/managing-leave-and-attendance-with-kekas-mobile-app

Feature and statute claims: see `../TIME-LEAVE-MARKET-RESEARCH.md` §(e) (K1–K12, GR1–GR10, Z1–Z6, S1, F1, L1–L17).

**Unverified, to confirm before external use:**
- Keka and Zoho INR figures.
- Biometric support claims for Keka, greytHR and Zoho.
- Whether greytHR, factoHR or RazorpayX have WhatsApp.
- Store status of CLOR's Android and iOS apps.
- CLOR bank-file formats.
- All price ideas in §5.
