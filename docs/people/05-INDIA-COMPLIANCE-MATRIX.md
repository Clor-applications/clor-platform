# Clor People: India compliance matrix

Version 1.0 · 24 Oct 2026 · **Legal review required before any compliance claim is marketed.**
Source for every row: [sources/india-compliance-research-2026-10-24.md](sources/india-compliance-research-2026-10-24.md) (links and dates). Confidence from that file: **V** verified against a primary document or two reputable firms; **S** one reputable secondary source; **U** uncertain, check before encoding. Product behaviour here is what People does; Payroll's part is named, not specified.

Three things in the owner's brief are out of date and corrected below: the EPF wage ceiling (now ₹25,000 from 17 Sep 2026), the DPDP timetable (substantive duties start 13 May 2027; Nov 2026 is consent managers only), and RPwD s.23 (government establishments, not every employer).

---

## 1. Dates that drive the roadmap

| Event | Date | Confidence | Effect on People |
|---|---|---|---|
| Four Labour Codes in force | 21 Nov 2025 | V | Rule library seeded with Code-era rules; old state rules still apply where a state has not notified new ones |
| Central rules and Model Standing Orders | 8 May 2026 | V | Apply only where the Centre is the appropriate government; most customers follow state rules |
| State rules notified (AP, Arunachal, Bihar, Gujarat, Rajasthan, UP, Uttarakhand, J&K, Ladakh, Lakshadweep) | by 1 Oct 2026 | S | Per-state values differ; **Karnataka, Maharashtra, Tamil Nadu, Telangana, Delhi not yet notified** (U, re-check monthly) |
| EPF wage ceiling ₹15,000 → ₹25,000 | 17 Sep 2026 | V | Payroll's rule; People's Health check must not hard-code ₹15,000 anywhere |
| Bonus ceilings ₹21,000 / ₹7,000, retrospective to 21 Nov 2025 | 25 Aug 2026 | S | Payroll's rule; People shows the obligation |
| DPDP Rules notified; Board starts | 13 Nov 2025 | V | — |
| DPDP consent-manager registration | 13 Nov 2026 | V | Not an employer duty |
| **DPDP substantive duties** (notice, s.7(i), security, breach, rights, children, SDF, penalties) | **13 May 2027** | V (possible shortening consulted Jan 2026, no amendment found: U) | Privacy features must be live and tested before this date; People's PRV requirements |
| CERT-In directions | in force since mid-2022 | V | 6-hour incident report, 180-day logs in India, NTP sync: platform duties, tracked in People's breach playbook |
| UIDAI Aadhaar Data Vault circular 14/2025 | 4 Nov 2025 | V | No full Aadhaar outside a vault; People stores last 4 only |
| Karnataka S&E amendment (service certificate in 7 days; no retaining originals) | 4 Sep 2026 | S | DOC-07 |
| Telangana gig workers law | 2 Jun 2026 | S | Out of People P0 scope (contractor module later) |

---

## 2. Rules matrix

Columns: what the law asks → what People does (requirement ids) → what stays with Payroll or Attendance → confidence.

### 2.1 Labour Codes

| Id | Framework and point | Law (summary) | People does | Elsewhere | Conf. |
|---|---|---|---|---|---|
| C-LC-01 | Code on Wages: wage definition (50% rule) | Excluded allowances above 50% of remuneration count as wages; affects PF, gratuity, bonus, leave encashment | Records employment type and category that Payroll's rule needs; no calculation | Payroll computes | V |
| C-LC-02 | Code on Wages s.17(2): final settlement in 2 working days | Wages due within 2 working days of resignation, removal, dismissal, retrenchment, closure; no ceiling; whether gratuity and encashment count is debated | Leaving plan sets "Final settlement due" = last working day + 2 working days; hands the request to Payroll by event (LIFE-05); Health check flags a leaver with no settlement started | Payroll pays | V (statute) / U (scope) |
| C-LC-03 | OSH Code s.6(1)(f): appointment letters | Mandatory for every employee; prescribed format includes Aadhaar number (state additions vary) | Letter template "Appointment" with the prescribed fields; Aadhaar shown as last 4 in People, full number only where a company's vault exists (C-AAD-01); Health check: active person with no appointment letter | — | V |
| C-LC-04 | OSH Code s.32: annual leave | Eligible after 180 days; 1 day per 20 worked; carry forward ≤30; excess encashed; applies to "workers" | Policy library holds the company's leave policy versions with these parameters; shows them on "Why?" for a balance (SH-01 interface) | Shared leave engine computes | V (Code) / U (state application) |
| C-LC-05 | OSH Code: hours, rest, overtime | 8 h/day or 48/week; 30-min rest after 5 h; OT at 2x; central cap 144 h/quarter, states 115 to 150 | Establishment carries its state so the right cap is shown in policies and in Health check | Attendance measures; Payroll pays | V |
| C-LC-06 | OSH Code s.43: women at night | Allowed before 6 am and after 7 pm with written consent, transport, CCTV, POSH compliance; state additions | Consent recorded as an acknowledged document per person; Compliance obligation per establishment | Attendance schedules | V |
| C-LC-07 | Fixed-term employees | Same conditions pro rata; gratuity after 1 year (Gujarat 5 years) | Employment type FIXED_TERM with contract end; expiry watch (DOC-03, LIFE-08); Health check shows FTEs crossing 1 year | Payroll computes gratuity | V / S (Gujarat) |
| C-LC-08 | Registers and returns | Consolidated registers (employee, muster, wages), electronic allowed; unified annual return in several states | Employee register export per establishment (COMP-06); obligation "Annual return" per state | Payroll produces wage register; Attendance the muster | S |
| C-LC-09 | IR Code: Grievance Redressal Committee at 20+ workers | Committee required, max 10 members | Committee set-up (PRIV-06) with GRIEVANCE kind; warning when headcount ≥20 and none exists | — | S |
| C-LC-10 | IR Code: standing orders at 300+, retrenchment permission at 300+ | Thresholds | Obligation appears when headcount crosses 300 | — | S |
| C-LC-11 | Crèche at 50+ employees | Or allowance ≥₹500/child/month | Obligation when headcount ≥50 | Payroll pays allowance | S |
| C-LC-12 | Health check from age 40/45 | Annual free check, state-dependent age | Obligation per person reaching the age; state value from the rule version | — | S |
| C-LC-13 | Gig/platform workers | Aggregator duties, Aadhaar registration, 45-day upload | Not in People P0 | — | V |

### 2.2 Social security thresholds

| Id | Point | Law | People does | Elsewhere | Conf. |
|---|---|---|---|---|---|
| C-SS-01 | EPF wage ceiling | **₹25,000/month from 17 Sep 2026** (was ₹15,000); EPS enrolment for ₹15k to 25k members | Health check: active person with no UAN and wages likely in range (count only, from Payroll's read interface); no threshold hard-coded; rule version carries the value and date | Payroll computes and files | V |
| C-SS-02 | ESI wage ceiling | ₹21,000 (₹25,000 for persons with disability); revision discussed Aug 2026, not notified | Same as above for ESIC number | Payroll | V/S |
| C-SS-03 | Gratuity | 15 days' wages per year; 5 years (1 for FTE); ceiling ₹20 lakh; pay within 30 days | Timeline shows service per episode (FND-06) so Payroll's eligibility is explainable; obligation "Gratuity due" on leaving | Payroll computes | V |
| C-SS-04 | Maternity | 26 weeks (first two children), 12 weeks adoption; 80 days' work to qualify; work-from-home option; crèche at 50+ | Policy template; protected record (leave type is shared module's); return-to-work task in Changes | Shared leave engine | V/S |
| C-SS-05 | Bonus | Eligibility ≤₹21,000; calculation on ₹7,000 or minimum wage; retrospective | Obligation and deadline shown | Payroll | S |
| C-SS-06 | SS Code dues interest 12% p.a. from 29 May 2026 | — | Obligation note | Payroll | S |

### 2.3 Data protection

| Id | Point | Law | People does | Conf. |
|---|---|---|---|---|
| C-DP-01 | DPDP s.7(i) legitimate use for employment | Employer may process employee data for employment and to protect itself from loss, without consent; "employment purposes" undefined | Privacy notice per purpose (PRV-01) records the basis per data type: employment use vs consent (wellness, photos for marketing, extra background checks) | V |
| C-DP-02 | Notice (s.5, Rule 3) | Plain language, itemised data, purposes, rights, complaint route, withdraw as easily as given; English or 8th-Schedule language | Notice versions in English plus enabled languages; read receipts | V |
| C-DP-03 | Rights (ss.11 to 14) and grievance (Rule 14(3)) | Access, correction, erasure, nomination; grievance answered within 90 days | PRV-02 requests with a 90-day clock; erasure respects retention (OD-04) | V |
| C-DP-04 | Breach (s.8(6), Rule 7) | Affected people told without delay; Board told without delay then a detailed report within 72 hours | PRV-05 register with both clocks; notices to every address on file; CERT-In 6-hour clock as a separate playbook item | V |
| C-DP-05 | Security safeguards (s.8(5), Rule 6) | Encryption or masking, access control, logs, backups, **logs kept 1 year**, processor contracts | Masking (CORE-04), access log (PRV-07), append-only logs; NFR-07 keeps logs ≥1 year | V |
| C-DP-06 | Retention and erasure (s.8(7), Rule 8) | Erase when purpose served unless law requires; 3-year platform rule does not apply to employers; labour and tax law drive HR retention | PRV-03 retention schedule with legal hold; defaults from OD-04 (payroll 8 years, attendance 3 years); state register periods marked U | V/U |
| C-DP-07 | Significant Data Fiduciary | DPO in India, auditor, yearly DPIA and audit | Not expected to apply to Clor itself; customers who are SDFs can export the access log and audit for their own DPIA | V |
| C-DP-08 | Children (s.9) | Verifiable parental consent; relevant to dependants' data | Dependant and nominee fields marked as collected on the employee's behalf; no processing beyond benefits | V |
| C-DP-09 | Penalties | Up to ₹250 cr (security), ₹200 cr (breach notice, children), ₹150 cr (SDF), ₹50 cr other | Shown in the Compliance rule detail as context, never as a score | V/S |
| C-DP-10 | CERT-In directions (2022) | 6-hour incident report; 180-day logs in India; NTP sync; point of contact | Platform duty; People's breach playbook has the 6-hour line; log retention takes the longer of 180 days and 1 year | V |

### 2.4 POSH

| Id | Point | Law | People does | Conf. |
|---|---|---|---|---|
| C-POSH-01 | Internal Committee at 10+ employees | Presiding officer a senior woman; ≥2 employee members; 1 external member; ≥half women; term ≤3 years | Committee set-up (PRIV-06) with warnings for each failed condition; obligation appears at headcount ≥10 | V |
| C-POSH-02 | Complaint within 3 months (+3 extendable) | — | Private case filing deadline computed from the incident date; extension recorded with reason | V |
| C-POSH-03 | Inquiry 90 days; report 10 days; employer acts 60 days | — | Case timeline (PRIV-03) with the three deadlines; overdue shown to members only | V |
| C-POSH-04 | Confidentiality (s.16) | Identities and proceedings never published; penalty ₹50,000 | Separate tables, membership-only access, encrypted evidence, excluded from search, export and AI (PRIV-01, 04) | V |
| C-POSH-05 | Annual report (s.21, Rule 14) | Complaints received, disposed, pending >90 days, workshops, action taken; included in the company's annual report | PRIV-05 counts-only report; obligation each January | V |
| C-POSH-06 | SHe-Box registration; Maharashtra inspection checklist (May 2026); NCW audit advisory (Jun 2026) | IC registration expected; audits recommended | Obligation "Register IC on SHe-Box" with proof upload; audit as an optional obligation | V/S |

### 2.5 State-specific

| Id | Point | Law | People does | Conf. |
|---|---|---|---|---|
| C-ST-01 | Shops & Establishments registration | State acts; MH, KA, Haryana exempt OSH-registered 10+ establishments; MH under-10 intimation; Bihar repealed; timelines 30 to 90 days | Establishment registrations recorded with validity; obligation per establishment from the state's rule version | S |
| C-ST-02 | Karnataka amendment 2026 | Service certificate within 7 days; no retaining original documents; 7 days to notify changes | DOC-07 due dates; document upload refuses "original held" flag for KA establishments; obligation on establishment change | S |
| C-ST-03 | Tamil Nadu 365-day permission (24 Aug 2026) | Conditions include weekly holiday rotation, women's night consent, IC under POSH | Obligations attached to TN establishments | S |
| C-ST-04 | Telangana S&E | Register within 30 days; deemed registration; changes within 15 days | Obligation on new TN establishments | S |
| C-ST-05 | State leave entitlements under S&E | Figures conflict across sources (e.g. MH 8 CL; KA 18 EL, 12 SL, 12 CL; TN 12 EL) | Not encoded. Companies set their own policy; the rule detail shows "figures to be checked" | U |
| C-ST-06 | Professional Tax | Capped ₹2,500/yr; MH ₹200 and ₹300 in February, gender-specific slabs; KA, TS slabs vary; TN half-yearly; Odisha abolished 1 Apr 2026 | People records the work state per establishment and transfer review tasks (COMP-04); slabs are Payroll's dated config | S/U |
| C-ST-07 | Labour Welfare Fund | ~16 states; annual, half-yearly or monthly; rates conflict across vendor tables | Same as PT: state recorded; obligation calendar per state; rates are Payroll's | S/U |

### 2.6 Aadhaar, disability, gender identity

| Id | Point | Law | People does | Conf. |
|---|---|---|---|---|
| C-AAD-01 | UIDAI circular 14/2025 | Full Aadhaar only in a separate vault with a non-hash reference key, AES-256, HSM; masked display = last 4 digits; core biometrics never shared or stored | People stores **last 4 only**; a company that must hold the full number (appointment letter format) does so in its own vault and People stores the reference key (P1 integration); reader biometrics stay on devices and in Attendance | V |
| C-AAD-02 | Puttaswamy: private bodies cannot require Aadhaar except under law | — | Aadhaar fields optional; the form says why it is asked when a law requires it | U (statute from memory) |
| C-RPWD-01 | RPwD s.21 and Rule 8: Equal Opportunity Policy | Every establishment; fuller contents at 20+; register with the Commissioner; publish | Policy template; obligation "Register EOP"; liaison officer named at 20+ | V/S |
| C-RPWD-02 | RPwD s.23 Grievance Redressal Officer | **Government establishments** (not every employer); good practice for private ones | Optional GRO in Committee set-up; no warning when absent for private companies | V |
| C-TG-01 | Transgender Persons Act s.11 complaint officer; Rules 12 to 13 | Every establishment designates one; equal opportunity policy; complaint acted on within 15 days (U) | Complaint officer in Committee set-up; private case kind GRIEVANCE routes to them; gender identity field confidential | S/U |

---

## 3. Rule record format (COMP-01)

Every rule above becomes one or more versioned rows with these fields (contract `ComplianceRule`):

```
ruleId            IN-POSH-IC
version           1
jurisdiction      IN
establishmentKinds [SHOP, FACTORY, OFFICE, SITE, WAREHOUSE]
employeeCategories [ALL]
legalSource       POSH Act 2013 s.4
notificationRef   —
effectiveFrom     2013-12-09
effectiveTo       —
supersedesVersion —
obligation        Constitute an Internal Committee
threshold         { minHeadcount: 10 }
ownerRole         HR_HEAD
dueRule           { kind: "EVENT", after: "HEADCOUNT_REACHED", days: 0 }
requiredProof     [IC_CONSTITUTION_ORDER, SHEBOX_REGISTRATION]
reviewStatus      DRAFT          ← stays DRAFT until a named person checks (COMP-05)
checkedBy / at    —
```

Never overwrite an old version. A transfer between states lists the rules whose jurisdiction differs and creates review tasks (COMP-04); the system does not decide the legal effect.

---

## 4. Compliance screen (illustrative state, not real data)

```
Compliance                                              [ Add obligation ]
Obligations 24      Review needed 4      Missing proof 2
Obligation                         Establishment   Due        Owner   Proof     Status
Register IC on SHe-Box             Pune office     30 Nov     Asha    missing   Due
Policy read: POSH v2               All             15 Nov     Asha    —         Review
Appointment letters: 3 people      Bengaluru       —          Ravi    —         Action
EPF ceiling rule version checked   All             done       Payroll ✓         Checked
```
Each row opens source, scope, proof, owner, history and "Last checked by". No overall percentage anywhere.

---

## 5. DPDP controls built from the start (brief §9, mapped)

| Control | Requirement |
|---|---|
| Privacy notices and processing-purpose records | PRV-01, C-DP-01 |
| Lawful-use and consent records where needed (not blanket consent) | PRV-01 basis per data type |
| Access and correction workflows | PRV-02 |
| Erasure with legal-retention exceptions | PRV-02, PRV-03, OD-04 |
| Data processing agreements for customers and sub-processors | Legal deliverable, tracked as an obligation on Clor (not a product feature) |
| Restricted, encrypted storage of sensitive documents | DOC-01 classification, DOC-06, PRIV-03 encryption |
| Field-level masking for identifiers and bank information | CORE-04 (bank stays in Payroll, masked there) |
| Data export and tenant offboarding | Existing company export (`docs/COMPANY-DATA-EXPORT.md`) and closure; People data included |
| Incident response with notifications and evidence preservation | PRV-05, `docs/compliance/INCIDENT_RESPONSE.md` |
| Configurable retention schedule with statutory periods | PRV-03 |

---

## 6. Re-check list (monthly until stable; owner of the task: D-06)

1. DPDP timetable: any gazette amendment shortening 13 May 2027.
2. State rules for Karnataka, Maharashtra, Tamil Nadu, Telangana, Delhi.
3. OSH annual-leave mechanics per state and coverage of managerial staff.
4. Scope of "wages" in the 2-working-day settlement rule.
5. Register retention periods under new state rules.
6. PT and LWF slabs (vendor tables conflict).
7. S&E leave entitlements by state.
8. ESI ceiling revision.
9. Transgender Persons Rules numbering and 15-day timeline.
10. CERT-In MSME extension date.
