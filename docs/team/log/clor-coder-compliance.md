# clor-coder-compliance

## 2026-10-30 IST — People / Compliance depth — review fixes on PR #69
- Did: Fixed the blocker and the four should-fixes from review. Proof uploads get a 7 MB body limit. The old calendar's write routes now answer 410, and Attendance's entry opens People's Compliance. The migration maps POSH_REPORT onto the IN-POSH-REPORT rule, so there is one row per year. Reads are whole-company only, and statutory rows need the statutory view. buildObligations takes a lock per company. Nits done: renewal settles only on a newer registration and appends to the note; proof add/remove lock the row with FOR UPDATE; removing a proof soft-deletes it; a new rule version must start later; the attrition wording; real suggestions in more fields. Rebased on main after PR #67, so a notice now opens the obligation itself.
- Evidence: server 12 files, 87 passed; web: compliance, nav and design tests passed. Browser: a 2 MB proof attached; a notice opened its obligation. Screenshots 13 and 14 in `docs/people/design-v1/evidence/compliance-depth/`.
- Next: re-review.
- Blocked on: nothing. Attendance's Compliance entry was not opened in a browser: the test company could not switch Attendance on (400).

## 2026-10-30 IST — People / Compliance depth — batch 4 (audit gaps 2, 10, 12, 16, 21)
- Did: Compliance is the one compliance screen now. Obligations have an owner, a reference, a note, proof files, and done/checked by with dates. HR can add its own deadlines and its own state rules (versioned, checked again). The old calendar's deadlines moved over through a data migration. Work-site registrations feed renewals. The POSH annual report downloads from Confidential cases. The People report reads the headcount API.
- Evidence: branch `claude/people-compliance-depth`, commit c0b6e53c. Server: 12 files, 80 passed (incl. new peopleComplianceDepth 6). Web: people-compliance-depth 6 passed, People nav/design tests passed. Browser checks as HR and owner at 1440×900 and 390×844; screenshots in `docs/people/design-v1/evidence/compliance-depth/`.
- Next: review fixes on the PR.
- Blocked on: nothing. Two things for the coordinator: the shell bell drops `link.params`, so a notice opens Compliance but not the item; Attendance still has the old calendar screen.
