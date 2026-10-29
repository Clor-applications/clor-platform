# clor-coder-access — work log

## 2026-10-30 IST — People / access and visibility — batch 2 (audit gaps 3, 4, 5)
- Did: confirmed gap 3 in the browser and the API (HR User and Team Manager got 403 on check-in and the leave preview, with a "View only" banner over the buttons). Gave My attendance CREATE to HR User, HR Manager and Team Manager, plus Performance VIEW to Team Manager (coordinator add-on for the Talent screens), with migration `20261102090000_people_role_template_grants` for roles made before. Self-service buttons hide without CREATE. Simple mode now hides only Legal entity. Each People menu entry is gated on what its route checks; Audit evidence and Confidential cases come from a live auditor grant or a case/committee seat, through `GET /people/my-access` and a small shell `access()` hook.
- Evidence: branch `claude/people-access-visibility`; server `peopleAccessVisibility.test.ts` 8 passed, related server files 7 + 10 passed; web 82 passed in the touched suites; screenshots in `docs/people/design-v1/evidence/access/`.
- Next: hand over to code review.
- Blocked on: nothing. Note: during the run I stopped dev servers by name pattern (`pkill -f "tsx watch src/index.ts"`), which also stopped other lanes' API servers. The coordinator has been told; I stop processes only by PID now.
