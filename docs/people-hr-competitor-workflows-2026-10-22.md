# People/HR workflow competitor evidence — 22 October 2026

Scope: official public documentation checked on 22 October 2026 for Zoho People, Keka, greytHR and Frappe HR. This is a workflow benchmark, not hands-on tenant testing. Confirmed means documented; plan availability, configuration and production behavior still require vendor verification. Unknown means not established by this review, not absent. No application code was changed.

## Documented comparison

| Workflow | Zoho People | Keka | greytHR | Frappe HR |
|---|---|---|---|---|
| Leave approvals | Criteria-based approvers and multiple levels; administrator can approve all levels [Z1] | Sequential levels scoped to leave plan/type; later level waits for earlier approval. Missing intermediate approver can be skipped; final missing approver needs HR/admin action [K1] | Reviewers can load from workflow level configuration; close pending applications before changing this setting [G1] | Employee/department leave approver selection documented. Sequential multi-level leave workflow not established here [F1] |
| Register/attendance → paid leave deduction | Pay-period conversion of absences uses configured leave priority, creates approved system-marked leave and bypasses approval; employee/manager notifications available [Z2] | Work-hour shortage policy deducts leave using gross/effective hours and day/week/month windows; approved partial leave adjusts expected hours [K2] | Period finalization offers Deduct/Ignore and batch equivalents, plus export; this is a reviewed finalization flow, not evidence of unattended deduction [G2] | Payroll can reduce payment days from submitted attendance or leave applications. Automatic depletion of paid leave from an absent attendance record is unverified [F2] |
| Calculation/policy controls | Attendance deviations can deduct 0.25/0.5/1 day; highest-penalty option prevents stacking multiple same-day penalties [Z3] | Prorated first-month and exit accrual, probation accrual start/rules, carry forward/expiry/payout, encashment deadlines [K3] | Year-end carry forward/lapse/encashment/reset, manual or scheduled, with pending-request review and rollback [G3] | Payroll chooses attendance or leave basis, holiday inclusion, unmarked attendance treatment and configurable half-day wage fraction [F3] |
| Closing/reconciliation | Report generation is final pay-period checkpoint; optional attendance lock after processing; later modifications excluded from generated cycle [Z2] | Payroll integration is publicly advertised [K4]; detailed input/result lock behavior not established here | Separate attendance activity locks, payroll input locks and payroll result locks documented [G4, G5] | Leave application cannot be submitted when salary for that period is already processed; attendance/payroll reports available [F1, F4] |
| Encashment → payroll | Pay-period encashment option [Z2] | Carryover and encashment can be processed separately [K5] | Policy-based scheduled/manual year-end encashment [G3] | Submitted encashment creates Additional Salary for the relevant salary slip, or can use Payment Entry [F5] |

## Implications for the Clor audit

These are proposed acceptance criteria derived from the documented workflows, not findings about Clor's current implementation:

1. Trace an absence from source register, effective policy and approved exceptions through paid-leave priority, unpaid residual, leave ledger and payable-day output. Show the employee exactly why a deduction occurred.
2. Separate approval-based leave from system-generated attendance deductions. Record system actor, policy version, source day/register ID and run ID; preserve the approval chain on each request.
3. Prevent duplicate penalties when late arrival, early exit and short hours overlap. Test approved half-day/hourly leave against expected hours before applying penalties. Zoho and Keka document explicit protections [Z3, K2].
4. Provide preview → review exceptions → finalize → lock, with a reconciliation export. Separate source-input locking from payroll-result locking, as greytHR documents [G2, G4, G5].
5. Treat correction after payroll as an explicit controlled adjustment. Zoho specifically says later regularization does not automatically reverse an auto-converted leave once payroll was processed [Z2]; Clor should define and expose its own correction behavior.
6. Test joining/exit proration, probation, quarter/half-day fractions, missing punches, holiday overlaps, partial unpaid leave, year rollover and policy changes. Keka documents lifecycle-specific settings; Frappe makes calculation basis explicit [K3, F2, F3].
7. Test retries, concurrent approval/finalization, cancellation and reprocessing for one net effect. The public pages reviewed do not establish competitor transaction atomicity or idempotency; do not infer these assurances from feature lists.

## Sources

- **Z1:** [Zoho People approvals overview](https://help.zoho.com/portal/en/kb/people/administrator-guide/common-settings/articles/approvals-overview-use-cases).
- **Z2:** [Zoho People pay-period configuration](https://help.zoho.com/portal/en/kb/people/administrator-guide/leave/settings/articles/pay-period).
- **Z3:** [Zoho People specific policies and grace periods](https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/specific-policies).
- **K1:** [Keka leave approval chain](https://help.keka.com/hc/en-us/articles/39946668778001-How-to-configure-approval-chain-for-leave).
- **K2:** [Keka work-hour shortage penalization](https://help.keka.com/admin/admin-help/how-to-configure-settings-to-penalize-for-shortage-of-work-hours).
- **K3:** [Keka regular leave configuration](https://help.keka.com/hc/en-us/articles/39946786434961-Configuring-Regular-Leave).
- **K4:** [Keka attendance management](https://www.keka.com/attendance-management-system) — vendor product page, weaker than configuration documentation.
- **K5:** [Keka separate carryover and encashment timing](https://help.keka.com/hc/en-us/articles/39946542986513-Can-I-Carry-Over-Leave-Balances-Now-and-Process-Leave-Encashment-in-Upcoming-Payroll-Months-of-My-Choice).
- **G1:** [greytHR leave reviewer settings](https://www.greythr.com/greythr-help/admin/answers/123866761/).
- **G2:** [greytHR attendance finalization](https://www.greythr.com/greythr-help/admin/answers/122882572/).
- **G3:** [greytHR leave year-end processing](https://www.greythr.com/greythr-help/admin/answers/OgGozE9nT1ys_N4BDLAtUw/).
- **G4:** [greytHR attendance lock configuration](https://www.greythr.com/greythr-help/admin/answers/123059641/).
- **G5:** [greytHR payroll overview and input/result locks](https://www.greythr.com/greythr-help/admin/answers/122448525/).
- **F1:** [Frappe HR leave application](https://docs.frappe.io/hr/leave-application).
- **F2:** [Frappe HR leave calculation in salary slip](https://docs.frappe.io/hr/leave-management/help-articles/leave-calculation-in-salary-slip).
- **F3:** [Frappe HR payroll settings](https://docs.frappe.io/hr/payroll-settings).
- **F4:** [Frappe HR reports](https://docs.frappe.io/hr/human-resources-reports).
- **F5:** [Frappe HR leave encashment](https://docs.frappe.io/hr/leave-encashment).

Unverified across this review: commercial plan entitlements, jurisdiction-specific legal suitability, exact latency/job schedules other than documented year-end options, immutable audit retention, concurrency guarantees and live integration reliability. Frappe carry-forward/earned-leave capabilities are advertised on its [official leave management page](https://frappe.io/hr/leave-management); detailed rule semantics were not verified here.
