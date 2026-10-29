# Clor People: decisions and risks

Version 1.0 · 24 Oct 2026.
**Decided** = settled by the owner; **Open** = needs the owner; each open item has a recommendation.

---

## 1. Decisions already made

| Id | Date | Decision | Source |
|---|---|---|---|
| OD-01 | 22 Oct 2026 | Leave and holidays belong to HR; one leave engine serves People and Attendance | founder, code comments in `server/src/services/people/guards.ts` |
| OD-02 | 23 Oct 2026 | Company admin (users, roles, security, audit, billing) is a platform workspace; apps link out (ADR-010) | `tenant-platform-upgrade-2026-10-23/DECISION_LOG.md` |
| OD-03 | 23 Oct 2026 | The module is called "People", never "HR" | `docs/people-app-tracker-2026-10-23.md` |
| OD-04 | 21 Oct 2026 | Erasure only for LEFT people, by anonymisation; payroll, TDS, PF kept 8 years, attendance 3 years | tracker LX-07 |
| OD-05 | 24 Oct 2026 | **People is the main app for this build.** Attendance and shared modules are fixed separately. | owner, this session |
| OD-06 | 24 Oct 2026 | **Keep Accounting's layout and type scale** in People; typography checked against `DESIGN.md`; People's override CSS block is removed. | owner, this session |
| OD-07 | 24 Oct 2026 | Payroll's five capabilities (PayTrace, Readiness, Replay, Statutory Guard, Pay Reconciliation) come from a separate payroll research pack after People. | owner, this session |
| OD-08 | 24 Oct 2026 | Rules first, AI assisting; no automated employment decisions; no attrition prediction; no hidden scoring. | owner's brief |
| OD-09 | 24 Oct 2026 | Same Express, Prisma, PostgreSQL, shell, sign-in. No microservices, Kubernetes or second AI platform. | owner's brief |
| OD-10 | 24 Oct 2026 | People accent is Burnished Rose with Fluent colour icons; chrome graphite; layout and type from Accounting (see D-01). Batch 1 starts; D-02..D-10 run on their recommendations until the owner says otherwise. | owner, this session |
| OD-11 | 30 Oct 2026 | Simple mode hides organisation detail only (Legal entity). Year end, delegates, policies, compliance and privacy are always in the menu. Each menu entry shows to whoever its route lets in. **Confidential cases** shows to the case grant holders, and to anyone named on any case or sitting on a committee. A past case member (case closed, or since removed from the committee) keeps the menu entry and sees only the cases still naming them, often none. That is accepted: the route never shows a case they are not on. | People audit gaps 4 and 5, PR #68 |

---

## 2. Open decisions

### D-01 People's colour and icons — DECIDED 24 Oct 2026
**Owner's decision:** Burnished Rose (`#A45761`) as People's accent (`--brand`: primary buttons, active navigation, focus, selection), **with the Fluent colour icons kept**. Chrome stays graphite; layout, type scale, radii and shadows are Accounting's (OD-06). Implemented as a shared `[data-palette='rose']` block beside Blaze, with People's manifest set to `palette: 'rose'`; the People override block is removed. `DESIGN.md` gets a per-app accent rule in its decisions log. Dark theme uses the soft rose (`#D89FA8`) where rose is type, so contrast holds.

### D-02 Do employee self-edits need HR approval by default?
**Options:** (A) Contact details save directly, everything else needs approval. (B) Everything needs approval. (C) Nothing needs approval, HR is notified.
**Recommendation:** A, as a company setting defaulting to A. Fewer tickets for phone changes; identity and address changes still checked.

### D-03 Object storage for documents
**Question:** files are bytes in Postgres today (5 MB cap). The brief names Cloudflare R2.
**Options:** (A) R2 (S3 API) with Mumbai-adjacent region not available; data outside India. (B) S3-compatible in India (AWS ap-south-1 or a local provider). (C) Stay in Postgres for P0.
**Recommendation:** B for pilots with real data (DPDP residency is not required by law but customers ask); C acceptable through phase 2 since the contract keeps the database fallback. Decide before phase 3.

### D-04 AI provider and residency
**Options:** (A) Anthropic API behind the gateway, India residency "ANY". (B) Privately hosted model in India. (C) Both, per company setting.
**Recommendation:** C with the gateway built once; default off per company (AIG-01). No sensitive records to any provider without the processing agreement.

### D-05 Form and workflow studio timing
**Options:** (A) Full studio in P0 phase 3 (as PRD). (B) Move the studio to P1; P0 has custom fields and approval rules only.
**Recommendation:** A if phases 1-2 land on time; otherwise B. The protected-field rule (FORM-04) is non-negotiable either way.

### D-06 Who checks compliance rules legally
**Question:** COMP-05 shows "Last checked by". Who is that for the seeded rules?
**Options:** (A) A named adviser engaged by Clor checks the seed set before pilot. (B) Each customer's own adviser checks; seeds ship as "unchecked". (C) Both.
**Recommendation:** C: Clor-checked seeds for central rules and the first 5 states, customers check their own; the banner stays until a named person checks.

### D-07 Leave ownership cut-over
**Question:** the leave engine lives under Attendance paths; founder says leave is HR's.
**Recommendation:** no cut-over in this build (OD-05). Record the target: engine moves to `services/people/leave/` with People permissions, in the cross-app fix.

### D-08 Leave screen names across apps
**Recommendation:** "Leave requests" in both apps; Attendance's "People" group becomes "Staff". Done in the cross-app fix.

### D-09 Encryption key for private cases
**Options:** (A) `PEOPLE_CASE_KEY` env var per environment. (B) Cloud KMS.
**Recommendation:** A for pilot with a documented rotation job; B before general availability.

### D-10 Generic registers
**Question:** announcements, events, goals, training, assets, benefits still use `PeopleRecord`.
**Recommendation:** leave announcements and events on it; replace help desk now (P0), assets, hiring, goals, training in P1 with their own tables.

---

## 3. Risks

| Id | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| RK-01 | Merge conflicts with the tenant-security branch (A-35 fail-closed RLS, A-50/51 audit rows) | High | Medium | Follow the new policy shape from day one; rebase weekly; keep People changes out of shared files where possible | build session |
| RK-02 | Effective dating done half-way again (G1) | Medium | High | FND-02/03 are phase-1 exit criteria with tests; no phase-2 screen starts before | build session |
| RK-03 | Compliance content wrong or stale (EPF ceiling changed Sep 2026; state rules still rolling out) | High | High | Rules versioned with "last checked"; banner until checked; adviser review (D-06); monthly re-check task | owner |
| RK-04 | DPDP obligations misdated (substantive duties start 13 May 2027, not Nov 2026) | Medium | Medium | Compliance matrix states dates with sources; obligations carry effective dates | build session |
| RK-05 | Private cases leak through search, exports, AI or admin roles | Low | Very high | Separate tables, membership gate, 404 for non-members, excluded from every index; tests PRIV-04 | build session |
| RK-06 | Payroll and Attendance interfaces (PI/AI) not ready, so "Why?" on pay is thin at pilot | High | Medium | Panel says what is missing; People's own Why? (changes, approvals) is complete regardless | owner (cross-app) |
| RK-07 | Scope creep from the 20-module brief | High | High | P0 list fixed in PRD §6; anything else needs a PRD change entry | owner |
| RK-08 | Design drift (People CSS override, colour icons) | Medium | Low | OD-06 removes overrides; `test/design-rules.test.js` gate | build session |
| RK-09 | Free-tier infrastructure used with real HR data | Medium | High | Release gate 10; pilots run on synthetic data until paid-grade backup and restore are shown | owner |
| RK-10 | Local Postgres connection exhaustion makes test runs flaky (seen in the baseline) | High | Low | Run People suites with `--no-file-parallelism` in local runs; CI uses its own database | build session |
| RK-11 | Seven employee-creation paths keep diverging | Medium | Medium | FND-08 service; non-People paths listed for the cross-app fix | build session / owner |

---

## 4. Assumptions to validate with design partners

1. Companies of 20-300 people in India will pay for "explain and prevent" over a cheaper record-keeper.
2. HR teams accept named-person task ownership (not role-only) for joining and leaving.
3. Employees will use "Why?" before raising a help request.
4. Customers want policy Q&A (Ask) enough to accept AI processing terms.
5. Compliance officers prefer obligations with proof over a score.

Each becomes an interview question in the pilot plan; none is claimed publicly before it is validated.
