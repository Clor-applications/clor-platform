# Clor India HR Product Research

## Building a Problem-Solving HR Platform for India

**Prepared:** 21 October 2026  
**Product:** Clor People, Attendance, Payroll and Compliance platform

## Executive direction

The Indian HR market is crowded with employee records, leave, attendance, payroll, onboarding, performance, mobile apps, workflows and reports. Clor should not compete by copying every module. The strongest opportunity is an India-first workforce control system that proves every attendance, leave, payroll and compliance result before money is paid or a filing is submitted.

The central product promise:

> **What is wrong, why is it wrong, what money or compliance is at risk, and what should be corrected?**

## Market landscape

| Segment | Examples | Strength | Common buyer pain |
|---|---|---|---|
| India SMB | greytHR, Keka, Zoho People | Payroll, leave, attendance, employee self-service | Setup complexity, support dependency, weak explanations across modules |
| Global SMB | BambooHR, HiBob | Employee experience, records, onboarding, performance | Limited India-specific statutory and device depth |
| Enterprise | Workday, SAP SuccessFactors, UKG, Darwinbox | Deep workflows, permissions, global scale | Expensive implementations and specialist administration |
| Workforce management | Deputy, UKG, Connecteam | Rostering, shifts, field workforce | HR records and payroll remain fragmented |
| Finance-connected | Zoho, Rippling | Automation and integrations | Sync failures and unclear data ownership |

Zoho People already markets time-off policy configuration, attendance restrictions, mobile HR, integrations, analytics and automation. greytHR markets payroll, statutory compliance, leave, attendance, employee self-service and AI capabilities. BambooHR now combines HR data, payroll, benefits, time, performance, compliance and embedded AI. Clor needs a sharper operational wedge rather than another broad feature checklist.

Sources: [Zoho People](https://www.zoho.com/en-us/people/features.html), [greytHR](https://www.greythr.com/), [BambooHR](https://www.bamboohr.com/platform/)

## Problems users repeatedly face

### Data and payroll trust

Attendance, biometric, leave, payroll and employee records drift apart. Unknown employee IDs, duplicate punches, delayed reader sync, incorrect opening balances and manual spreadsheet corrections create payroll disputes.

### Configuration overload

HR teams need rules by location, department, employee type, tenure, shift, state, policy and salary component. Powerful systems often become difficult to configure and require consultants.

### Poor explanations

Users can see a final number but cannot answer why it changed, which rule was applied, who changed it, or which source record is wrong.

### Compliance fragmentation

Companies must track central and state obligations, filings, evidence, due dates, employee notices and policy updates across several portals and files.

### Implementation risk

Migration is underestimated. Duplicate employees, wrong leave balances, missing UAN/PAN/ESIC data and historical attendance errors are discovered only after payroll starts.

### Employee friction

Many mobile apps collect forms but do not explain approval status, balance impact, rejection reasons, missing attendance or salary changes.

### Reporting limits

Standard reports exist, but managers still need manual exports to answer staffing, absence, overtime, liability and payroll-impact questions.

## India compliance requirements to design for

India requires a versioned compliance engine because labour is a concurrent subject and central and state rules both matter. The four Labour Codes were announced for implementation from 21 November 2025, with rules and state variation still requiring active monitoring.

Build coverage for:

- EPF, EPS, EDLI, UAN and ECR validation
- ESIC
- Professional Tax by state
- Labour Welfare Fund by state
- Salary TDS, employee declarations and Form 16
- Bonus
- Gratuity
- Maternity benefits and crèche obligations
- Minimum wages and overtime
- Notice pay, deductions and full-and-final settlement
- State Shops and Establishments requirements
- Contractor and principal-employer compliance
- POSH/ICC controls and confidential case handling
- Digital Personal Data Protection requirements

EPFO's revamped ECR includes system validations, automatic interest and damages calculation, supplementary returns, revised returns and chronological month-wise filing. The Income Tax Department requires quarterly salary TDS reporting and Form 16. Labour guidance covers maternity, gratuity, fixed-term employees, nominations, nursing breaks and crèche requirements. POSH requires an Internal Committee and annual reporting while protecting complaint confidentiality.

Sources: [Labour Codes](https://labour.gov.in/sites/default/files/pib2192463.pdf), [EPFO ECR revamp](https://www.epfindia.gov.in/site_docs/PDFs/Circulars/Y2025-2026/ECRRevamp_26092025.pdf), [Salary TDS statement](https://www.incometax.gov.in/iec/foportal/newformpage/forms/form138-um), [Labour compliance handbook](https://www.labour.gov.in/static/uploads/2026/02/83978455025732b99b0165def80ab171.pdf), [POSH Act](https://www.indiacode.nic.in/handle/123456789/17057?sam_handle=123456789%2F2490), [DPDP Rules](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025)

## Recommended platform architecture

### People system of record

Employee lifecycle, effective-dated history, departments, positions, locations, contractors, documents, bank/PAN/Aadhaar/UAN/ESIC data, transfers, promotions, salary revisions, resignations and full-and-final settlement.

Every change must retain effective date, source, approver, previous value, new value and payroll impact.

### Workforce operations

Attendance, readers, mobile and web punches, offline capture, shifts, rostering, breaks, overtime, holidays, weekly offs, leave, comp-off, corrections, contractor sites and payroll lock.

### Payroll and statutory engine

A versioned rules engine should calculate, validate and explain payroll and statutory outputs. Legal rules must be data-driven and updateable without redeploying the entire application.

### Employee experience

Mobile-first attendance, leave, payslips, tax proofs, HR letters, e-signatures, grievances, notifications, local-language policy search and low-bandwidth support.

### Compliance control plane

Compliance calendar, responsible owners, due dates, evidence vault, approvals, exception risk, audit packs, retention and data-rights workflows.

## Product that can make Clor stand out

### Clor Workforce Control Tower

A shared intelligence layer across People, Attendance, Payroll and Accounting.

It should show:

- Payroll readiness score
- Employees blocking payroll close
- Attendance and leave anomalies
- Statutory filing risk
- Financial impact of each unresolved issue
- Source record and rule that caused the issue
- Recommended fix and approver
- Complete evidence trail

### AI features worth building

1. **Data reconciliation agent**
   Finds duplicate employees, mismatched IDs, orphan punches, wrong UAN/PAN/ESIC mappings and inconsistent department or salary records.

2. **Payroll-risk detector**
   Predicts payroll blockers and calculates impacted salary, LOP, overtime, statutory contribution and tax.

3. **Attendance investigator**
   Explains missing punches and detects duplicate punches, proxy patterns, impossible travel, reader failures and repeated manual corrections.

4. **Leave intelligence**
   Forecasts staffing shortages, detects unusual absence patterns, recommends approvals and shows policy and balance impact.

5. **Compliance copilot**
   Generates state-specific checklists, identifies changed rules, maps affected employees and prepares evidence packs.

6. **Employee assistant**
   Answers “Why is my salary lower?”, “Why was my leave rejected?”, “What is missing from my tax declaration?” and “Which punch affected my payslip?” using actual records and policy versions.

7. **Implementation auditor**
   Audits imported Excel and payroll data before go-live, identifying wrong balances, duplicates, missing documents and historical inconsistencies.

AI must show evidence, confidence, rule version, impact and approval requirement. It must never silently change payroll or attendance.

## India-specific differentiators

- Multi-state compliance and establishments
- English plus regional-language employee experience
- WhatsApp, mobile and low-bandwidth workflows
- Offline reader and field attendance
- Contractor and principal-employer workflows
- Fixed-term, apprentice and gig-worker records
- Salary advances, deductions and variable pay
- UAN, Aadhaar and bank data quality checks
- State Professional Tax and Labour Welfare Fund
- Excel migration with error detection
- Payroll lock and evidence packs
- HR consultant and payroll accountant collaboration
- Open APIs, webhooks and accounting integration

## Build order

### Phase 1: Trust foundation

- Effective-dated employee master
- Attendance-to-payroll reconciliation
- Leave and attendance rules
- Payroll readiness dashboard
- Audit history and approvals
- Migration auditor
- EPF, ESIC, PT and LWF master data

### Phase 2: India compliance

- Versioned state and central rules
- Compliance calendar
- ECR and TDS/Form 16 outputs
- Gratuity, bonus, maternity and full-and-final workflows
- Contractor compliance
- POSH and grievance controls
- DPDP governance

### Phase 3: Intelligence

- AI anomaly detection
- Payroll impact prediction
- Compliance copilot
- Employee assistant
- Staffing and absence forecasting
- Natural-language reporting

### Phase 4: Ecosystem

- Accounting and banking integrations
- Filing connectors where permitted
- Biometric reader integrations
- WhatsApp and Teams
- Partner workspace for HR consultants and accountants
- Public APIs and webhooks

## Final recommendation

Clor should become the **India-first workforce control system that proves every attendance, leave, payroll and compliance result before money is paid or a filing is submitted**.

The defensible product loop is:

> **Employee identity → attendance evidence → leave decision → payroll impact → compliance proof.**

Do not begin by building every HR category. Build the layer that makes existing HR and payroll systems trustworthy, explainable and audit-ready.

# Open-Source Reference Decision

## Horilla assessment

Horilla is a better open-source reference for Clor than Frappe HR because it is a more conventional Django HRMS rather than a full ERP framework. Its current repository contains separate areas for employee management, attendance, leave, payroll, recruitment, onboarding, performance, assets, helpdesk, audit, documents, APIs, LDAP, biometrics, and geofencing.

Sources: [Horilla repository](https://github.com/horilla/horilla-hr), [Horilla overview](https://www.horilla.com/about/)

Horilla is useful for studying:

- Employee profile structure
- Department and reporting hierarchy
- Onboarding and offboarding checklists
- Leave approval screens
- Attendance correction requests
- Employee self-service
- Asset assignment
- HR helpdesk workflows
- Permission patterns
- Audit concepts
- Mobile employee actions

Horilla should still be treated as a reference, not a direct foundation for Clor. It remains a sizable Django monolith. Direct adoption would introduce a second backend, authentication model, permission model, employee database, attendance model, leave engine, deployment process, and upgrade path.

## License verification requirement

Horilla's public materials are inconsistent about licensing. The GitHub repository identifies LGPL-2.1, while the marketing features page displays MIT. The repository license, tagged version, dependency licenses, and any copied files must be reviewed before code reuse. The safest approach is to study Horilla's workflows and implement them natively in Clor.

Sources: [Horilla GitHub license](https://github.com/horilla/horilla-hr), [Horilla features page](https://www.horilla.com/features/)

## Reference comparison

| Reference | Use in Clor | Weight | Decision |
|---|---|---:|---|
| Frappe HR | Edge-case checklist and broad HR requirements | Heavy | Do not adopt as the code base |
| Horilla | Core HR workflows, screens, lifecycle and India-oriented concepts | Medium | Primary functional reference |
| OrangeHRM | Employee administration and self-service UX | Light to medium | Secondary UX reference |
| IceHrm | Simple employee and organization ideas | Light | Use selectively; advanced open-source modules are limited |
| Random Node/Laravel HRMS repositories | API and UI ideas | Unknown | Never use as a production foundation without full audit |

## Native Clor implementation

Build People as a native Clor service using the existing authentication, design system, API patterns, database conventions, deployment process, and audit platform.

```text
Clor People
  ├── Employee and employment
  ├── Organization structure
  ├── Documents and statutory IDs
  ├── Onboarding and offboarding
  ├── Employee self-service
  ├── Leave policy and approvals
  └── Lifecycle events
```

Integration boundaries:

```text
People → Attendance
People → Payroll
Payroll → Accounting
All apps → Audit and compliance layer
```

People owns employee identity, employment history, departments, positions, managers, sites, contracts, documents, statutory identifiers, onboarding, exits, leave policies, approvals, and effective-dated changes.

Attendance owns raw punches, readers, mobile attendance, shifts, corrections, and attendance calculations.

Payroll owns salary calculation, statutory deductions, payroll periods, payslips, and final settlements.

Accounting owns journals, ledgers, payables, expenses, and payments.

## First People release

The first release should contain only the foundation needed by the existing Attendance and Payroll apps:

1. Employee master
2. Employment history
3. Departments, positions, managers, sites, and cost centres
4. Documents and statutory identifiers
5. Onboarding and exit checklists
6. Effective-dated changes
7. Roles and permissions
8. Audit history
9. Attendance integration
10. Payroll integration
11. Import and migration validation

Defer recruitment, performance, learning, engagement, surveys, and succession planning until this shared foundation is stable.

## Canonical identifiers

All Clor applications should use the same identifiers:

```text
person_id
employment_id
organization_id
establishment_id
department_id
position_id
cost_center_id
```

Attendance must not create a separate employee table. Payroll must not maintain another HR identity. Accounting must not become the employee master.

## Lifecycle events

### Employee creation

People creates the employee and employment record, then emits `EmployeeCreated` and `EmploymentStarted`. Attendance creates access and ID mappings. Payroll creates salary and statutory setup. Accounting receives cost-centre and allocation mappings.

### Transfer

People owns the transfer and emits `EmployeeTransferred`. Attendance updates site and shift eligibility. Payroll updates cost-centre and policy applicability. Accounting updates allocation.

### Leave approval

People owns the request, policy, balance, and approval. It emits `LeaveApproved`. Attendance marks the affected dates. Payroll calculates paid leave or loss of pay. Accounting receives the final payroll impact.

### Payroll close

Payroll emits `PayrollPeriodLocked`. Attendance becomes read-only for affected dates. People displays the employee result. Accounting posts the payroll journal.

### Exit

People owns resignation and termination and emits `EmploymentEnded`. Attendance disables future access. Payroll calculates notice pay, leave encashment, gratuity, and full-and-final settlement. Accounting posts the settlement.

## Final recommendation

Use Horilla as the primary open-source product reference, OrangeHRM as a secondary employee-experience reference, and Frappe HR as an edge-case checklist. Build the actual People module natively inside Clor.

This provides the practical HR workflows of Horilla without inheriting its second backend platform, while preserving a clean source of truth across People, Attendance, Payroll, and Accounting.
