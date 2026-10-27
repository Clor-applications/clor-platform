# Clor People → Workforce | Unified delivery directory
**Design package:** WF-UX v1.0  • **Prepared:** 26 October 2026  • **State:** Specification / visual reference, NOT implemented or tested

This package consolidates all **pending Employee-module design and delivery work** under a single user-facing **Workforce** module, without changing employee data ownership, underlying IDs, or the shared platform architecture. It includes reusable specification documents, approved-direction split-sidebar references, structured inventories, and a phase-gated agent prompt.

> **Important:** Previous platform source audit was based on an uploaded repository archive dated 23 Oct 2026; current Git HEAD, live database, effective subscription guard behavior and latest People PRD were not available for live verification at package creation. The implementation agent MUST audit current source and reconcile PRD before coding. No task in this package is marked complete.

## Start here
1. `WORKFORCE_MASTER_SPEC.md` — single consolidated specification (all specs combined).
2. `assets/gallery.html` — open in browser for available images, with canonical versus exploratory references identified.
3. `agent/AGENT_IMPLEMENTATION_PROMPT.md` — paste into Claude/Codex while in repository root.
4. `checklists/workforce_acceptance.csv` — requirements / implementation / testing tracker, all `TODO`.
5. `checklists/test_cases.csv` — scenarios, including negative security and mobile tests.

## Directory map
```
Clor_People_Workforce/
├── README.md
├── WORKFORCE_MASTER_SPEC.md
├── specs/                         # All design and functional contracts
├── ui_tokens/                     # Proposed People tokens and interaction variables
├── assets/
│   ├── gallery.html                # Offline visual reference gallery
│   └── visual_references/*.png     # Existing generated UI concept images
├── checklists/
│   ├── workforce_acceptance.csv
│   ├── test_cases.csv
│   ├── field_inventory.csv
│   ├── authorization_matrix.csv
│   └── route_manifest.json
└── agent/
    ├── AGENT_IMPLEMENTATION_PROMPT.md
    └── EVIDENCE_REGISTER.csv
```

## Hard rules
- **Workforce** replaces the visible sidebar label **Employees**. Keep employee records and IDs; do not rename persistence models merely for navigation.
- Reuse existing **Clor shared split sidebar** (global app rail + local People navigation). Company switcher in its currently approved shared shell position, exactly once.
- Preserve existing React/TS shared shell, Node/Express TS API, Prisma/PostgreSQL domains, Cloudflare/R2 contracts, and People/Payroll/Attendance source ownership. Real code decides exact component filenames.
- Existing `Org` = legal-company identifier until an approved migration. Do not silently rename or rewrite.
- Respect **account scope + company scope + subscription entitlement + named app grant + action permission + record/field scope + approval rule** in every backend path.
- Do not implement recruitment, performance, learning, AI/RAG, or independent payroll/attendance processing as part of Workforce without a separately approved PRD/ADR.
- Source presence and UI mockups are **not** implementation/test evidence. Release gates remain unverified.

## Working order
**WF-00 Audit → WF-01 Shared shell/components → WF-02 Directory → WF-03 Profile → WF-04 Add/Edit → WF-05 Operations → WF-06 Import/Export/Bulk → WF-07 Audit → WF-08 Mobile/States → WF-09 Security/Test → WF-10 Release review.**

## Visual usage
`split_sidebar_canonical.png` illustrates intended navigation hierarchy; spacing, sidebar widths, icons and collapse behavior must come from the real shared shell. Other concept PNGs are inspiration, not requirements. Do NOT blindly reproduce the text or fake employee numbers in generated mockups.
