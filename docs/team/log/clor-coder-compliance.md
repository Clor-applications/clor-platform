# clor-coder-compliance

## 2026-10-30 IST — People / Compliance depth — batch 4 (audit gaps 2, 10, 12, 16, 21)
- Did: Compliance is the one compliance screen now. Obligations have an owner, a reference, a note, proof files, and done/checked by with dates. HR can add its own deadlines and its own state rules (versioned, checked again). The old calendar's deadlines moved over through a data migration. Work-site registrations feed renewals. The POSH annual report downloads from Confidential cases. The People report reads the headcount API.
- Evidence: branch `claude/people-compliance-depth`, commit c0b6e53c. Server: 12 files, 80 passed (incl. new peopleComplianceDepth 6). Web: people-compliance-depth 6 passed, People nav/design tests passed. Browser checks as HR and owner at 1440×900 and 390×844; screenshots in `docs/people/design-v1/evidence/compliance-depth/`.
- Next: review fixes on the PR.
- Blocked on: nothing. Two things for the coordinator: the shell bell drops `link.params`, so a notice opens Compliance but not the item; Attendance still has the old calendar screen.
