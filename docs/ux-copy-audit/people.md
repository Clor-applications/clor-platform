# People (apps/people) UX copy fixes, 20 Nov 2026

Line numbers are from the audit, taken before the edits; files that gained the errorWords import moved down by one line.

## Findings

- [x] #1 src/screens/Approvals.jsx:193 — `String(e?.message || 'Not done.')` → `errorWords(e, 'save your decision')` ("Could not save your decision. Try again."); also 406, and 151, 215, 460 with their own objects
- [x] #2 src/money/Expenses.jsx:174 — 'Not paid.' → "The claim was not marked paid and nothing went to Payroll. Try again."
- [x] #3 src/time/LateMarks.jsx:52 — 'Not applied.' → "Late marks were not applied. No leave or pay was changed. Try again."
- [x] #4 src/workforce/EmployeeRecord.jsx:188 — 'Not deleted.' → "{name} was not deleted. A record Payroll has used cannot be deleted; mark them as left instead."
- [x] #5 src/workforce/Directory.jsx:182 — 'Export failed.' → errorWords(e, 'export the employees') ("Could not export the employees. Try again.")
- [x] #6 src/screens/Privacy.jsx:211 — "This cannot be undone." / "Erase" → "Their name, contacts, address, photo, notes and documents are erased for good. Pay and statutory records stay for their legal period." / "Erase personal data"
- [x] #7 src/workforce/AddEmployee.jsx:274 — "Adding employees needs the Employees create permission." → "You do not have access to add employees. Ask an admin to allow it in Roles & permissions."
- [x] #8 src/workforce/ImportEmployees.jsx:61 — "Importing employees needs …" → "You do not have access to import employees. Ask an admin to allow it in Roles & permissions."
- [x] #9 src/screens/HelpDeskSettings.jsx:104 — "Choosing a lead needs the Users grant." → "Only someone who can see the user list can choose a lead. Ask an admin."
- [x] #10 src/screens/PrivateCases.jsx:307 — "Listing users needs the Users grant." → "Only someone who can see the user list can add members. Ask an admin."
- [x] #11 src/screens.js:142 — 'Roles & Access' → 'Roles & permissions'
- [x] #12 src/screens.js:140 — 'Users & Security' → 'Users & security'
- [x] #13 src/screens.js:129 — 'Audit Logs' → 'Audit logs'
- [x] #14 src/screens/ReportsHome.jsx:80 — "Reports" → "All reports"
- [x] #15 src/screens/MyRequests.jsx:74 — "HR sees it in Approvals." → "Choose a request above. HR sees it in their Inbox."
- [x] #16 src/screens/ShiftSwaps.jsx:118 — "Open in Approvals" → "Open in Inbox"; empty state at 91 "approves in Approvals" → "approves in the Inbox"
- [x] #17 src/money/Expenses.jsx:342 — "You decide in Approvals." → "You decide in the Inbox."
- [x] #18 src/screens/PeopleOverview.jsx:384 — "HR cases" → "Help desk" (button and quick link at 394); workspaceConfig helpdesk title and noun follow
- [x] #19 src/screens/PrivateCases.jsx:159 — "Private case" → "Confidential case"
- [x] #20 src/screens/Privacy.jsx:95 — "Private cases counts only" → "Confidential cases (counts only)"
- [x] #21 src/screens/Approvals.jsx:414 — "Refuse" / "Not approved" → "Reject" / "Rejected" (Approvals, MyRequests, RequestsReport, ShiftSwaps, Expenses, SalaryRevisionsRead; hiring "Not taken forward" and "Turn down" → "Reject" / "Rejected" in CandidateDrawer, talent/shared, Referrals, Openings)
- [x] #22 src/talent/Reviews.jsx:105 — breadcrumb 'Talent' → 'Performance'; ReferSomeone.jsx:15 → 'Hiring'
- [x] #23 src/talent/Interviews.jsx:99 — "Talent › Candidates" → "Hiring › Candidates"; also workforce/Offers.jsx:124
- [x] #24 src/screens/Registers.jsx:116 — "Establishment" → "Work site"; "for an establishment" → "for a work site" (line 106)
- [x] #25 src/workforce/OfferDrawer.jsx:97 — "Position *" → "Designation *"; "E-mail *" → "Email *"
- [x] #26 src/screens/Approvals.jsx:49 — "Seat" → "Position"
- [x] #27 src/workforce/EmployeeRecord.jsx:402 — "Login" / "Choose a login" / "No unlinked logins in this company" → "Sign-in" / "Choose a sign-in" / "Every sign-in in this company is already linked" (also 412)
- [x] #28 src/screens/Tags.jsx:58 — "Yes, delete" → "Delete tag"
- [x] #29 src/workforce/EmployeeRecord.jsx:1182 — "Confirm change" → the drawer's own action ("Reactivate", "Suspend", or the operation title such as "Change manager")
- [x] #30 src/screens/Approvals.jsx:273 — "Done" → "Mark done"
- [x] #31 src/time/LateMarks.jsx:98 — "Apply {Month}" → "Apply {Month} penalties"
- [x] #32 src/screens/HelpDesk.jsx:151 — "Raise" → "Raise request"; Compliance:352 "Add" → "Add deadline"; CandidateDrawer:298 "Move"/"Set" → "Move interview"/"Set interview"; Absences:282 "Release"/"Hold" → "Release settlement"/"Hold settlement"; EmployeeRecord:408 "Link" → "Link sign-in"
- [x] #33 src/screens/PeopleDocuments.jsx:100 — "Upload" / "New document" → "Upload document" in both
- [x] #34 src/time/LateMarks.jsx:63 — "Done." → "Waiver for {name} taken back." / "Penalty undone; {leave} is back in {name}’s balance." / "Penalty for {name} undone."
- [x] #35 src/time/NightWork.jsx:86 — "No women on the books" → "No women employees recorded"
- [x] #36 src/screens/Compliance.jsx:442 — "No rules" → "No rules yet" / "CLOR adds its rules when this page first loads. Reload the page, or add a rule of your own with Add a rule."; ApprovalRules:173 "No kinds of request yet", HelpDeskSettings:60 "No categories yet", each with a support@clor.in line
- [x] #37 src/organization/StructurePage.jsx:295 — "People are filed under {noun} once there is one to file them under." → "The {noun} you add appear here, with how many people are in each."
- [x] #38 src/screens/WorkspaceList.jsx:124 — "The first {event} starts the list." → "Each {singular} you add appears here."
- [x] #39 src/time/Absences.jsx:99 — "None here" → "No closed cases" / "Nobody recorded as absconded"; ShiftSwaps:91 → "No swaps with this status"
- [x] #40 src/workforce/Directory.jsx:719 — "Nothing waiting" → "No pending actions" with a description; saved views empty state (752) gained a description
- [x] #41 src/organization/StructurePage.jsx:39 — "Teams and who heads them. Heads approve leave when the reporting manager is away." → "Departments and who heads each. The head approves leave when the manager is away."
- [x] #42 src/screens/Privacy.jsx:253 — "State" → "Status"
- [x] #43 src/screens/PrivateCases.jsx:172 — "Clock" → "Deadlines"; toast at 149 "Added, sealed." → "Evidence added. Only the committee can open it."
- [x] #44 src/screens/workspaceConfig.js:7 — "Value (₹), recovered if not returned" → "Value, recovered if not returned"; ApprovalRules:253 "Amount (₹)" → "Amount"; RequestForms:38 "Amount, ₹" → "Amount"
- [x] #45 src/screens/PeopleModules.jsx:23 — "Accounting" → "Books"
- [x] #46 src/screens/ApprovalRules.jsx:108 — "(2 d)" → "(2 days)"; HelpDeskSettings:59 "reply in 4 h" → "reply in 4 hours"; Policies:188 "v3 in force" → "version 3 in force"
- [x] #47 src/settingsGroups.js:117 — "Webhooks, API keys and HR tool sync" → "Connect other HR tools and send data to them"
- [x] #48 src/screens/Approvals.jsx:500 — raw field key fallback → "Other detail"; line 51 raw request type → enumWords(requestType)
- [x] #49 src/people-core.css:72 — `text-transform: uppercase` and letter-spacing removed from `.pc-facts dt` and `.pc-kpi-label`
- [x] #50 src/screens/PeopleDocuments.jsx:95 — figure tiles → CountLine (zero clauses hidden); also workforce/Directory.jsx:404 and money/SalaryRevisionsRead.jsx:42

## Menu and section mismatches

- [x] M1 src/screens.js:142 — "Roles & Access" → "Roles & permissions" (as #11)
- [x] M2 src/screens.js:140 — "Users & Security" → "Users & security" (as #12)
- [x] M3 src/screens.js:129 — "Audit Logs" → "Audit logs" (as #13)
- [x] M4 src/screens/ReportsHome.jsx:80 — "Reports" → "All reports" (as #14)
- [ ] M5 manifest.jsx:689 — "All settings" vs "Settings" — skipped: the title lives in packages/ui/src/settings/SettingsHub.jsx (shell/UI agent's file), and renaming the menu item to "Settings" would repeat the rail section's name
- [x] M6 manifest.jsx:554 — "Organisation overview" → "Organisation" (matches the page title)
- [x] M7 src/talent/*.jsx — `module="Talent"` → "Hiring" (Openings, Candidates, Interviews, Referrals) and "Performance" (Goals, Reviews, OneOnOnes, Plans, Trainings)
- [x] M8 src/screens/Registers.jsx:104, RequestsReport.jsx:86, ReportsHome — "Reports" section/breadcrumb → "Insights"; HrReport.jsx:117 breadcrumb → "All reports"
- [x] M9 src/screens/Compliance.jsx:147 — `section="Settings"` → "Insights"
- [x] M10 src/money/Expenses.jsx:59, SalaryRevisionsRead.jsx:49 — "Pay & assets" / "Pay, benefits & assets" → "Pay & benefits"
- [x] M11 src/screens/MyRequests.jsx:44 — "My profile" → "Me"
- [x] M12 manifest.jsx:625 — "Attendance fixes" → "Attendance corrections" (short "Corrections"), to match the Attendance app's label for the same shared screen

## Repeating patterns

- [x] P1 about 114 sites — `String(e?.message || 'Not X.')` → `errorWords(e, '<what>')`; 0 `?.message ||` sites left in src (EmployeeRecord photo keeps its 409 sentence, Delegates alert uses errorWords)
- [x] P2 about 45 sites — `MAP[v] || v` raw enum fallback → `MAP[v] || enumWords(v)`
- [x] P3 bare verbs — PrivateCases "Add" → "Add evidence"; MyRequests "Send" → "Send request"; HelpDesk "Send" → "Send reply"; Expenses "Add" → "Add category"; Plans and CandidateDrawer "Add" → "Add note"; CandidateDrawer form "Add" → "Add candidate"; Directory filters "Apply" → "Apply filters" (plus #32)
- [ ] P3b drawer primaries "Save" (about 30) — skipped: DESIGN.md has no rule against "Save"; the verb comes first and the drawer title already names the object
- [x] P4 bare success toasts — StructurePage/WorkspaceList/Openings "Deleted." → "{name} deleted."; Trainings "Deleted." → "Training deleted.", "Removed." → "Seat removed."; Goals and round53Goals "Saved." → "Goal updated."; Referrals "Saved." → "Referral rule saved."; Expenses category "Saved." → "{name} saved."; EmployeeRecord "Saved." → "{name} saved.", "Withdrawn." → "Scheduled change withdrawn."; MyRequests and Approvals "Withdrawn." → "Request withdrawn."; CandidateDrawer "Saved." → "{name} rejected." / "{name} withdrawn."
- [ ] P4b remaining "Saved." toasts after a form save (PrivateCases, RequestForms edit, Compliance, ReferralSettings, Openings edit, CandidateDrawer edit) — skipped: they follow a drawer the user just saved, so the object is on screen
- [x] P5 empty states without a first-item action — Delegates:120 "Add delegate"; Tags:82 "Add tag"; Organization Overview:141 "Open branches" (and departments "Open departments"); Policies:102 "New policy"
- [x] P6 "e-mail" → "email" — AppAccessSend 58/66/67, round62 CopyWord, Offers and Candidates search placeholders, OfferDrawer, RecordExtras "By email", Absences channel, label and checkbox, CandidateDrawer labels, plus comments
- [x] P7 "Approvals" as a destination (4) → "Inbox" (#15–#17)
- [x] P8 "Talent" as a section (13) → "Hiring" / "Performance" (#22, #23, M7)
- [x] P9 permission wording (4) → plain "You do not have access … Ask an admin" (#7–#10)
- [x] P10 rupee sign in labels (3) removed (#44)
- [x] P11 "Search" placeholder with no object — Tags:78 → "Search tags"; StructurePage:266 → "Search {noun}"
- [x] P12 figure tiles on list pages (3) → CountLine (#50)
- [x] X1 apps/people/src/screens/registers.css `.rg-date-month` — uppercase month label → as written (DESIGN.md: no uppercase labels).
