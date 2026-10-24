"""Build PEOPLE-TEST-SHEET.xlsx in the house format of docs/NEEV-TEST-CASES.xlsx.

Run from the repo root:  python3 docs/people/scripts/build_test_sheet.py
Columns: # | Area | Test case | Before you start | Steps | What must happen | Pri | New | Result | Remark
Result is a dropdown (Pass / Fail / Blocked / N/A). P1 rows (money, legal, access, data loss) are shaded;
New = built this round and never exercised.
"""
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

OUT = "docs/people/PEOPLE-TEST-SHEET.xlsx"
HEAD = ["#", "Area", "Test case", "Before you start", "Steps", "What must happen", "Pri", "New", "Result", "Remark"]
WIDTHS = [6, 20, 40, 30, 62, 52, 6, 6, 10, 34]
HEAD_FILL = PatternFill("solid", fgColor="1F2937")
P1_FILL = PatternFill("solid", fgColor="FDE2E2")
NEW_FILL = PatternFill("solid", fgColor="FEF3C7")

# (area, req id, test case, before, steps, must happen, pri, new)
SHEETS = {
    "1. Setup and organisation": (
        "Company structure People needs before anyone is added. Done once per company.",
        [
            ("Organisation", "ORG-01", "Add a legal entity and two establishments in different states", "Signed in as HR head", "Settings > Organisation > Company (legal) > Add. Then Establishments > Add: 'Bengaluru office' (KA, Office) and 'Pune shop' (MH, Shop).", "Both appear with state and type pills. No raw colour classes (check dark mode too).", "P2", "Y"),
            ("Organisation", "FND-07", "Work state comes from the establishment", "Person in Pune shop whose home address is in Karnataka", "Open the person > Job tab.", "Work state shows Maharashtra. Home address state stays Karnataka. No 'Work state' change appears in the Timeline after editing the home address.", "P1", "Y"),
            ("Organisation", "ORG-01", "Delete a department that is in use", "Department with one person", "Settings > Departments > ⋮ > Delete.", "Refused with 'In use by 1 person' and a link to the list.", "P2", "N"),
            ("Organisation", "ORG-02", "Change a manager from a future date", "Two managers", "Person > Job > Reports to > choose new manager, Takes effect = first of next month.", "Profile shows the old manager and 'Changes on 1 <month>'. Org chart as of next month shows the new one.", "P1", "Y"),
            ("Organisation", "ORG-03", "Org chart with 300 people", "Synthetic company of 300", "People > Org chart. Expand all. Use keyboard only to move.", "Renders within 2 seconds. Focus moves with arrows; Enter opens a person.", "P2", "Y"),
            ("Organisation", "ORG-04", "Create a seat and place a person", "Team exists", "People > Teams and seats > Request a seat > approve > place person.", "Seat shows Filled with the name; before placement it showed Open on the org chart.", "P2", "Y"),
            ("Access", "FND-01", "Company B cannot see company A's establishments", "Two companies, one user in each", "Sign in as company B. Call GET /api/orgs/<A>/people/establishments with B's session.", "403 or empty; never A's rows.", "P1", "Y"),
            ("Access", "FND-09", "Same PAN in two companies", "Person with PAN X in company A and another in company B", "Open each person's Statutory tab.", "No link, warning or hint about the other company.", "P1", "Y"),
            ("Setup", "CORE-08", "Add a custom field visible to HR only", "HR head", "Settings > Custom fields > Add 'Blood group', choice, view = Statutory Details.", "Field shows for HR head; manager's profile view has no such field; API response for the manager has no key.", "P1", "Y"),
            ("Setup", "APR-02", "Create an approval rule with a condition", "HR head", "Settings > Approval rules > New: Job change; step 1 manager; step 2 HR head only if grade changes; due 2 working days; overdue hands on to HR head.", "Rule saved as version 1. Editing creates version 2; version 1 stays readable.", "P2", "Y"),
            ("Setup", "PRIV-06", "POSH committee with too few women", "HR head", "Settings > Private case committee > add 4 members, 1 woman.", "Warning: 'At least half the members must be women.' Save still allowed; obligation shows Review.", "P1", "Y"),
            ("Setup", "AIG-01", "AI off by default", "New company", "Settings > AI controls.", "Shows Off. Only an owner can turn it on and must accept the terms first.", "P1", "Y"),
        ],
    ),
    "2. People and profile": (
        "Adding people, their records, timeline and statutory details.",
        [
            ("Add person", "CORE-02", "Add a person with the required fields", "Establishment and team exist", "People > Directory > Add person. Fill number, name, joining date, type, team, establishment, manager.", "Saved; status Joining until the joining date. Timeline shows 'Added' with Why?.", "P2", "N"),
            ("Add person", "CORE-02", "Duplicate phone", "Existing person with phone 98xxxxxx01", "Add another person with the same phone.", "Warning with a link to the existing person. Saving needs a reason. Reason appears in the change log.", "P1", "Y"),
            ("Directory", "CORE-01", "Directory beyond 500 people", "Synthetic company of 2,000", "People > Directory. Page to the end. Search a name on page 9. Export.", "All pages reachable; search finds the person; export has 2,000 rows.", "P1", "Y"),
            ("Directory", "CORE-01", "Bulk update department", "Select 50 people", "Bulk > Change department > choose > reason.", "50 Timeline rows, one correlation id in the change log; Why? on any of them shows the bulk reason.", "P1", "Y"),
            ("Directory", "FND-03", "Directory as of a past date", "People moved departments last month", "Directory > As of > pick last month's date.", "Departments shown match last month's Timeline rows.", "P2", "Y"),
            ("Profile", "CORE-05", "Tabs by permission", "A manager and an HR user", "Open a direct report as the manager, then as HR.", "Manager: no Statutory tab. HR: all tabs.", "P1", "Y"),
            ("Profile", "CORE-04", "Bad PAN format", "HR", "Statutory > PAN = 'ABCDE12345'.", "Refused: 'PAN looks like ABCDE1234F'.", "P1", "Y"),
            ("Profile", "CORE-04", "Reveal a masked identifier", "HR with Statutory Details permission", "Statutory > PAN > Show.", "Step-up dialog. After confirming, value shows for 60 s. Access log lists the view.", "P1", "Y"),
            ("Profile", "CORE-04", "Reveal without step-up", "HR, API call", "POST .../statutory/reveal without X-Step-Up.", "403 with 'Confirm it's you first'.", "P1", "Y"),
            ("Profile", "CORE-06", "Timeline grouped by stint", "Person who left and rejoined", "Profile > Timeline.", "Two groups: '1st stint' and '2nd stint'. Every row has Why?.", "P2", "Y"),
            ("Profile", "FND-04", "Change log has before and after", "Edit a designation", "Edit > save > open Why?.", "Shows 'Designer → Senior designer', who, when, reason.", "P1", "Y"),
            ("Profile", "FND-04", "Sensitive field logs no value", "Edit a PAN", "Edit > save > open the change log.", "Row says 'changed' with no before or after value.", "P1", "Y"),
            ("Self-service", "CORE-03", "Employee changes phone", "Company setting: contact edits need HR approval", "Me > My profile > Phone > Ask for a change.", "Request appears in HR's To do. Phone unchanged until approved.", "P2", "Y"),
            ("Import", "CORE-07", "Import preview with bad rows", "CSV of 200, 3 with bad dates", "Settings > Import > upload > map fields > Preview.", "3 rows listed with reasons; 197 ready.", "P1", "Y"),
            ("Import", "CORE-07", "Import undo", "Imported batch under 24 h old", "Import > History > batch > Undo.", "Exactly 197 people removed, their events and plans gone, log row for the undo.", "P1", "Y"),
            ("Import", "CORE-07", "Import in update mode", "Existing people, CSV with new phones", "Import > Update existing by employee number.", "No duplicates; phones changed; change log rows with source IMPORT.", "P1", "Y"),
            ("Rejoin", "LIFE-06", "Rejoin keeps the first joining date", "Person who left in 2024, joined 2022", "Profile > Rejoin > rejoin date today.", "Status Joining; Timeline shows stint 2; first joining date still 2022.", "P1", "Y"),
            ("Rejoin", "LIFE-06", "Rejoin without a date", "Left person", "API POST /employees/:id/rejoin with no date.", "400 'Give the rejoin date'.", "P1", "Y"),
        ],
    ),
    "3. Joining, changes, leaving": (
        "The lifecycle plans: before day one, joining, probation, changes, leaving.",
        [
            ("Before day one", "LIFE-01", "Send an invite", "Person in status Joining with email", "Join and leave > Before day one > Send invite.", "Status Sent; email in the outbox; link is single use and expires in 14 days.", "P2", "Y"),
            ("Before day one", "LIFE-01", "Joiner fills details at 375 px", "Invite link, phone-sized window", "Open the link; fill details; upload ID; accept the policy; submit.", "Usable at 375 px; status becomes Sent back to HR; data marked 'not checked'.", "P1", "Y"),
            ("Before day one", "LIFE-01", "Invite link used twice", "Submitted invite", "Open the same link again.", "'This link was already used.' No data shown.", "P1", "Y"),
            ("Before day one", "LIFE-01", "Invite sees only own data", "Two joiners", "Change the person id in the invite page's API calls.", "403; nothing from the other joiner.", "P1", "Y"),
            ("Joining", "LIFE-02", "Joining plan with named owners", "IT admin user exists", "Start joining for a person joining next Monday.", "Plan shows HR, manager, IT, Payroll, employee tasks each with a name and due date.", "P2", "Y"),
            ("Joining", "LIFE-02", "Overdue task on IT's Home", "IT task due yesterday", "Sign in as IT admin > Home.", "Task shown under Overdue with the person's name.", "P2", "Y"),
            ("Joining", "LIFE-07", "Task done from an email link", "Task owner's email", "Click the 'Mark done' link in the email.", "Task Done; log row with the user and time; Why? on the task shows it.", "P2", "Y"),
            ("Joining", "FND-08", "Form, import and hire create the same things", "One of each", "Add via form, via import, via Hiring > Hire.", "Each person has an 'Added' Timeline row, a joining plan and a created event in the outbox.", "P1", "Y"),
            ("Probation", "LIFE-03", "Probation reminder", "Person with probation end in 14 days", "HR Home.", "'Probation ends: <name>, in 14 days' with Start review.", "P2", "Y"),
            ("Probation", "LIFE-03", "Confirm after probation", "Review filled", "Decide > Confirm.", "Status Confirmed; Timeline row; employee notified; event probation_confirmed.", "P2", "Y"),
            ("Probation", "LIFE-03", "Extend probation", "Review filled", "Decide > Extend.", "Asks for a new end date; refuses a past date.", "P2", "Y"),
            ("Changes", "LIFE-04", "Start a transfer KA → MH", "Person in Bengaluru office; Pune shop exists", "Join and leave > Changes > Start a change > Transfer > Pune, takes effect 1st next month, reason.", "Comparison shows Now vs From <date>. 'What else this affects' lists holiday list, PT state, leave policy. Sent to the manager.", "P1", "Y"),
            ("Changes", "LIFE-04", "Approve and schedule", "Transfer waiting", "Manager approves; HR head approves.", "Status Scheduled; profile shows 'Changes on 1 <month>'; nothing changed in Payroll's screens.", "P1", "Y"),
            ("Changes", "FND-02", "Scheduled change applies once", "Scheduled change, date reached", "Run the scheduled-changes job twice.", "Applied once; one Timeline row; review tasks created once; event sent once.", "P1", "Y"),
            ("Changes", "APR-05", "Requester is also the approver", "Manager promotes their own report where rule step 1 = manager", "Submit.", "Step 1 shows Skipped; goes to step 2.", "P1", "Y"),
            ("Changes", "APR-03", "Overdue approval hands on", "Step due 2 working days ago", "Run the approval-dues job.", "Step shows Handed on; HR head now has it; reminder sent earlier.", "P2", "Y"),
            ("Changes", "APR-04", "Stand-in receives the request", "Manager set a stand-in for this week", "Submit a change under that manager.", "Request waits with the stand-in; Why? shows 'standing in for'.", "P2", "Y"),
            ("Leaving", "LIFE-05", "Employee resigns", "Employee in Me", "Me > My requests > Resign > last working day.", "Request to manager; status On notice after approval; leaving plan with hand-back list.", "P1", "Y"),
            ("Leaving", "LIFE-05", "Final settlement handed to Payroll", "Approved leaving", "Open the leaving plan.", "'Final settlement due <LWD + 2 working days>' and 'Told to Payroll' with the event time. People shows no amounts.", "P1", "Y"),
            ("Leaving", "LIFE-05", "Last working day reached", "On notice, LWD today", "Run the job.", "Status Left; separated event sent once; relieving letter available to issue.", "P1", "Y"),
            ("Leaving", "LIFE-08", "Work permit expiring", "Document of kind Work permit expiring in 30 days", "Run the expiry job.", "Tasks for HR and manager; profile shows 'Permit expiring'; on expiry 'Permit expired' and a Health check item.", "P1", "Y"),
            ("Leaving", "DOC-04", "Issue a relieving letter", "Left person", "Profile > Documents > Issue letter > Relieving.", "PDF with merged fields; stored as a document with template version.", "P2", "Y"),
        ],
    ),
    "4. Documents and letters": (
        "Uploads, who can see them, versions, expiry, letters and acknowledgements.",
        [
            ("Access", "DOC-01", "HR-only document hidden from Attendance Manager", "Document classified HR only; a user with the Attendance Manager role", "Sign in as that user; open the person's Documents; call GET /documents/:id.", "Not listed; direct call returns 403.", "P1", "Y"),
            ("Access", "DOC-01", "Employee sees only 'Employee can see'", "Mixed classifications", "Me > My documents.", "Only EMPLOYEE_VISIBLE items.", "P1", "Y"),
            ("Access", "DOC-01", "Confidential needs its own permission", "HR executive without Confidential Documents", "Open a Confidential document.", "Not listed; 403 on direct call.", "P1", "Y"),
            ("Versions", "DOC-02", "Replace a document", "Existing ID card v1", "Documents > ⋮ > Replace > upload.", "v2 current; v1 under 'Earlier versions' for HR.", "P2", "Y"),
            ("Expiry", "DOC-03", "Reminder thresholds", "Contract expiring in 60, 30, 7, 0 days (four documents)", "Run the expiry job on three consecutive days.", "One reminder per threshold per document, not one per day.", "P2", "Y"),
            ("Expiry", "DOC-03", "Expired document in Health check", "Expired contract", "Checks > Health check.", "Item 'Contract expired' with why it matters and a link.", "P2", "N"),
            ("Letters", "DOC-04", "Appointment letter with prescribed fields", "Template active", "Profile > Issue letter > Appointment.", "PDF has name, DOB, designation, type, wages reference (from Payroll if permitted), establishment; Aadhaar shown as last 4.", "P1", "Y"),
            ("Letters", "DOC-07", "Service certificate due in 7 days (Karnataka)", "Person in a KA establishment", "Profile > Issue letter > Service certificate > Request.", "Due date 7 days out; Health check item if missed.", "P1", "Y"),
            ("Acknowledge", "DOC-05", "Ask 50 people to read a document", "Group of 50", "Documents > Ask to read > choose group.", "50 tasks; after 48 accept, report lists 2 pending with Remind.", "P2", "Y"),
            ("Storage", "DOC-06", "Expiring download link", "Object storage configured", "Documents > Download; copy the link; wait 6 minutes; open again.", "First open works; second returns 403.", "P1", "Y"),
            ("Storage", "DOC-06", "Malware test file refused", "EICAR test file", "Upload it.", "Refused with 'This file failed the safety check'.", "P1", "Y"),
            ("Storage", "DOC-01", "Upload over 5 MB without object storage", "No storage configured", "Upload a 6 MB PDF.", "Refused with the limit stated.", "P2", "N"),
        ],
    ),
    "5. Policies and approvals": (
        "Policy library, versions, who it applies to, acceptance; the approval engine.",
        [
            ("Policies", "POL-01", "Employee sees only applicable policies", "Policies for KA staff and MH contractors", "Sign in as an MH contractor > Help > Policies.", "Only the MH contractor policy.", "P1", "Y"),
            ("Policies", "POL-02", "Version as of a date", "Policy with v1 (Jan) and v2 (Jun)", "Policies > open > As of 1 Mar.", "Shows v1. v2 not overwritten.", "P1", "Y"),
            ("Policies", "POL-04", "Acceptance tasks", "Publish v2 with 'needs acceptance'", "Publish.", "Each person in scope gets a To do; report shows pending names.", "P2", "Y"),
            ("Policies", "POL-05", "Draft hidden from employees", "Draft policy", "Sign in as employee > Policies.", "Not shown.", "P1", "Y"),
            ("Policies", "POL-06", "Conflicting policies flagged", "Two published leave policies for the same department and dates", "Checks > Health check.", "Item 'Two leave policies apply to Design' with both names.", "P2", "Y"),
            ("Policies", "POL-05", "Publishing needs approval", "Policy owner submits", "Submit for approval.", "Waiting for HR head; not visible until approved.", "P2", "Y"),
            ("Approvals", "APR-01", "Each request type goes through the engine", "Rules for all types", "Submit one of each: profile change, job change, leaving, letter request, policy publish.", "Each appears in To do > Approvals with steps; each decision writes one log row.", "P1", "Y"),
            ("Approvals", "APR-02", "Condition adds a step", "Rule: HR head only if grade changes", "Submit a promotion with grade change, then one without.", "First has 2 steps; second has 1.", "P1", "Y"),
            ("Approvals", "APR-05", "Ask for more information", "Waiting request", "Approver > Ask for more > comment.", "Status Asked for more; requester replies; back to Waiting with the same approver.", "P2", "Y"),
            ("Approvals", "APR-06", "Approvals list order and Overdue pill", "Three requests with different due dates, one overdue", "To do > Approvals.", "Sorted by due; overdue row shows a pill reading 'Overdue'.", "P2", "Y"),
            ("Approvals", "APR-07", "Double click submits once", "Change form", "Click Send twice quickly.", "One request; second click shows the same request.", "P1", "Y"),
            ("Approvals", "APR-01", "Leave stays on its own chain", "Leave request", "Apply for leave.", "Uses the existing leave approval screen; not in People's rule engine.", "P2", "N"),
            ("Approvals", "TRACE-05", "Policy changed after a decision", "Approved change citing leave policy v2; later v3 published", "Open Why? on the change.", "Still shows v2.", "P1", "Y"),
            ("Approvals", "APR-03", "Reminder before hand-on", "Step due tomorrow", "Run the dues job.", "Reminder sent once; no hand-on yet.", "P2", "Y"),
            ("Approvals", "APR-04", "Stand-in outside the dates", "Stand-in set for next week", "Submit today.", "Goes to the manager, not the stand-in.", "P2", "Y"),
            ("Approvals", "APR-05", "Withdraw a request", "Waiting request", "Requester > Withdraw.", "Status Withdrawn; approvers' To do cleared; log row.", "P2", "Y"),
        ],
    ),
    "6. Help desk and private cases": (
        "Help requests from employees; private cases that only members see.",
        [
            ("Help desk", "DESK-01", "Raise a request from the employee app", "Employee signed in", "Help > Ask HR > category Payroll, subject, description, attachment.", "Appears in HR's Help desk within a minute with reply-by and resolve-by.", "P2", "Y"),
            ("Help desk", "DESK-02", "Internal note hidden", "Open request", "HR adds an Internal note; employee opens the request.", "Employee sees replies only; API response has no internal message.", "P1", "Y"),
            ("Help desk", "DESK-03", "Queue and resolve-by", "Payroll queue configured 3 working days", "Assign to Payroll queue.", "Resolve-by = 3 working days; overdue goes to the queue lead.", "P2", "Y"),
            ("Help desk", "DESK-04", "Reopen after 8 days", "Resolved 8 days ago", "Employee > Reopen.", "Refused: 'Raise a new request'.", "P2", "Y"),
            ("Help desk", "DESK-05", "Move to private cases", "Request describing harassment", "HR > ⋮ > Move to private cases.", "Help desk shows only 'Moved on <date>'; details gone; case created.", "P1", "Y"),
            ("Help desk", "DESK-06", "Answer from a template", "Template linked to leave policy v2", "Reply > Use template.", "Reply cites the policy and version.", "P2", "Y"),
            ("Private cases", "PRIV-01", "Owner without membership", "Case exists; owner not a member", "Owner opens Help > Private cases; calls GET /private-cases/:id.", "List empty; direct call 404.", "P1", "Y"),
            ("Private cases", "PRIV-02", "Named member excluded", "Complaint names a committee member", "That member opens the case.", "404; conflict check logged.", "P1", "Y"),
            ("Private cases", "PRIV-03", "Deadlines shown", "Case received today", "Member opens the case.", "Inquiry due +90 days; filing window shown; report and action dates appear when reached.", "P1", "Y"),
            ("Private cases", "PRIV-03", "Evidence open logged", "Case with evidence", "Member opens evidence.", "Access row visible to the presiding officer.", "P1", "Y"),
            ("Private cases", "PRIV-04", "Not in search or export", "Case exists", "Search the complainant's name; export company data.", "Nothing from the case anywhere.", "P1", "Y"),
            ("Private cases", "PRIV-05", "Annual report counts only", "Several cases", "Private cases > Annual report.", "Counts received, resolved, pending >90 days; no names.", "P1", "Y"),
            ("Private cases", "PRIV-01", "Employee files a case", "Employee signed in", "Help > Private cases > New.", "Confirmation says who will see it; HR executive cannot see it.", "P1", "Y"),
            ("Private cases", "PRIV-06", "Committee warnings", "Committee missing external member", "Settings > Committee.", "Warning shown; obligation Review.", "P2", "Y"),
        ],
    ),
    "7. Compliance and privacy": (
        "Rules with versions and proof; privacy notices, requests, retention, breaches.",
        [
            ("Compliance", "COMP-01", "Edit a rule creates a version", "Seeded rule IN-POSH-IC", "Compliance rules > edit due day.", "Version 2 created; version 1 readable; both show effective dates.", "P1", "Y"),
            ("Compliance", "COMP-02", "Maharashtra items appear for a Maharashtra shop", "Company with a Pune shop", "Checks > Compliance.", "MH S&E items present; after deactivating the shop they are not.", "P1", "Y"),
            ("Compliance", "COMP-03", "No score anywhere", "Any company", "Browse Compliance and Home.", "No percentage or 'compliant' badge.", "P1", "Y"),
            ("Compliance", "COMP-05", "Unchecked rule banner", "New rule, nobody checked it", "Open the rule.", "'Check with your adviser' banner; after a named check, 'Last checked by <name> on <date>'.", "P1", "Y"),
            ("Compliance", "COMP-04", "State transfer review tasks", "Transfer KA → MH", "Approve the transfer.", "Review tasks for each rule whose jurisdiction differs; no automatic legal change.", "P1", "Y"),
            ("Compliance", "COMP-06", "Employee register export", "Establishment with 20 people", "Compliance > Registers > Employee register > export.", "File has the fields the rule names; only that establishment's people.", "P2", "Y"),
            ("Compliance", "C-POSH-01", "IC obligation at 10 employees", "Company grows from 9 to 10 active people", "Add the 10th person; run the obligations job.", "'Constitute an Internal Committee' appears as Due.", "P1", "Y"),
            ("Compliance", "C-LC-02", "Final settlement due in 2 working days", "Resignation approved, LWD on a Friday", "Open the leaving plan.", "Due = next Tuesday (2 working days); weekends skipped.", "P1", "Y"),
            ("Privacy", "PRV-01", "New notice version re-asks", "Notice v1 read by all", "Publish v2.", "Everyone asked to read again; v1 receipts kept.", "P2", "Y"),
            ("Privacy", "PRV-02", "Erasure with payroll history", "Left person with payslips", "Data requests > Erasure > approve.", "Payroll records kept with the retention reason shown; other data anonymised.", "P1", "N"),
            ("Privacy", "PRV-04", "Anonymisation leaves nothing", "Left person with HR cases, notes, candidate record", "Anonymise; search name, email, phone across all screens and exports.", "0 results everywhere.", "P1", "Y"),
            ("Privacy", "PRV-05", "Breach notice reaches 'email' only people", "Person with only the personal email field set", "Record a breach; send notices.", "That person receives it; none listed under 'no email'.", "P1", "Y"),
            ("Privacy", "PRV-05", "72-hour and 6-hour clocks", "New breach", "Open the breach.", "Board detailed report due in 72 h; CERT-In report due in 6 h shown separately.", "P1", "Y"),
            ("Privacy", "PRV-03", "Deletion review, nothing automatic", "Data past retention", "Run the retention job.", "Items appear in Deletion review; nothing deleted until a person approves.", "P1", "Y"),
            ("Privacy", "PRV-06", "Auditor access", "Grant for 2 days to 3 evidence files", "Sign in as the auditor.", "Sees only those files; cannot open a profile; after 2 days access ends; views logged.", "P1", "Y"),
            ("Privacy", "PRV-07", "Access log report", "Several statutory reveals", "Settings > Privacy > Access log > this month.", "Lists who viewed whose statutory details and when.", "P1", "Y"),
        ],
    ),
    "8. Why and health": (
        "The Why? panel and the Health check.",
        [
            ("Why", "TRACE-01", "Why? on a promotion", "Approved promotion", "Profile > Job > Designation > Why?.", "Panel shows what changed, asked by, approvals with rule version, rules used, proof, what it caused, each a link.", "P1", "Y"),
            ("Why", "TRACE-02", "Unknown stated plainly", "Change made before history started", "Why? on it.", "'No approval recorded: changed before history started on <date>'.", "P2", "Y"),
            ("Why", "TRACE-03", "Raise a correction from Why?", "Any change", "Why? > Raise a correction.", "Change request pre-filled with the change id.", "P2", "Y"),
            ("Why", "TRACE-04", "Pay link by permission", "User without Payroll permission", "Why? on a pay-related change.", "No payslip link; text says 'Ask Payroll' instead.", "P1", "Y"),
            ("Why", "TRACE-01", "Hidden items counted", "Why? containing a Confidential document, viewer without that permission", "Open the panel.", "Panel says '1 item you can't see'.", "P1", "Y"),
            ("Health", "HLTH-01", "Items link to the fix", "Person without a manager; expired document", "Checks > Health check.", "Each item opens the person at the right tab.", "P2", "N"),
            ("Health", "HLTH-02", "Every item has a reason", "Any", "Read all items.", "No item without 'why it matters'.", "P2", "Y"),
            ("Health", "HLTH-03", "Snooze returns", "Snooze an item to tomorrow with a reason", "Next day open Health check.", "Item back; snooze logged.", "P2", "Y"),
            ("Health", "HLTH-04", "Headcount as of", "Movements this quarter", "Checks > Reports > Headcount > as of last month.", "Numbers equal the change log for that date.", "P2", "Y"),
            ("Health", "C-SS-01", "No hard-coded EPF ceiling", "Rule version shows ₹25,000 from 17 Sep 2026", "Compliance rules > EPF ceiling.", "Value and date come from the rule version; changing the version changes the Health check text.", "P1", "Y"),
        ],
    ),
    "9. Access and security": (
        "Who can do what. Every row is P1.",
        [
            ("Access", "FND-01", "No company set returns nothing", "Direct database session as clor_app without clor.org_id", "SELECT from each new People table.", "0 rows on every table.", "P1", "Y"),
            ("Access", "NFR-01", "Cross-company on every new route", "Two companies", "Call each new route with the other company's id in the path.", "403 or 404; never data.", "P1", "Y"),
            ("Access", "§4", "Manager sees team only", "Manager with 5 reports", "Directory as manager.", "5 people plus their reports; no one else.", "P1", "Y"),
            ("Access", "§4", "Employee cannot open another profile", "Two employees", "Open the other's profile URL.", "No permission screen; API 403.", "P1", "Y"),
            ("Access", "R-12", "HR Manager preset can open leave screens", "User with HR Manager role", "People > Time > Leave requests.", "Opens; no permission error.", "P1", "Y"),
            ("Access", "§4", "Compliance officer preset", "New preset assigned", "Browse.", "Sees Compliance, Health check, Policies; no Directory edit.", "P1", "Y"),
            ("Access", "§4", "IT admin preset", "New preset assigned", "Browse.", "Sees To do and own tasks; cannot open Statutory or Documents.", "P1", "Y"),
            ("Security", "CORE-04", "Step-up expires", "Reveal done 16 minutes ago", "Reveal again.", "Step-up asked again.", "P1", "Y"),
            ("Security", "LIFE-01", "Invite token scoped", "Valid invite", "Use the token against another route.", "401.", "P1", "Y"),
            ("Security", "PRV-06", "Auditor token time-boxed", "Expired grant", "Open the link.", "'Access ended'.", "P1", "Y"),
            ("Security", "FND-04", "Change log cannot be edited", "Database session as clor_app", "UPDATE a ChangeLog row.", "Refused: append_only.", "P1", "Y"),
            ("Security", "AIG-04", "AI cannot write", "AI on", "Ask for 'change Meera's designation'.", "Refused; offers a draft change request for a person to submit.", "P1", "Y"),
            ("Security", "AIG-05", "AI retrieval respects permission", "Employee asks about another's pay", "Ask.", "Refused; no data in the log answer.", "P1", "Y"),
            ("Security", "NFR-09", "No silent impersonation", "Support access request", "Staff opens a company.", "Company sees the access grant and its end time in Settings.", "P1", "Y"),
        ],
    ),
    "10. Design and screens": (
        "DESIGN.md rules and the owner's instruction to keep Accounting's layout.",
        [
            ("Design", "OD-06", "People matches Accounting's type scale", "Accounting invoice list and People Directory open side by side", "Compare the page title, section title and a button.", "Same 28px/700 title, 16px section, 8px control radius; People override block absent from index.css.", "P1", "Y"),
            ("Design", "NFR-08", "No raw palette classes", "Run test/design-rules.test.js", "npm run test:web -- design-rules", "Passes; no bg-gray-*, text-stone-* etc. in apps/people.", "P2", "Y"),
            ("Design", "NFR-08", "Dark mode", "Toggle dark", "Browse Directory, Profile, Why?, Compliance.", "No white blocks, no unreadable text.", "P2", "N"),
            ("Design", "NFR-04", "Employee screens at 375 px", "Phone-sized window", "Me, Ask HR, Approvals, Policies.", "Usable; no horizontal page scroll; primary action reachable.", "P1", "Y"),
            ("Design", "NFR-05", "Empty states", "New company", "Open every list.", "Each shows what it is and one action, per 04 §6.", "P2", "Y"),
            ("Design", "NFR-05", "Offline", "Disable network", "Try to save.", "'You're offline...' message; nothing silently lost.", "P2", "Y"),
            ("Design", "DESIGN", "One primary action", "Every screen", "Count top-right primary buttons.", "Exactly one per screen.", "P2", "N"),
            ("Design", "DESIGN", "Status pills carry words", "Any list", "Read pills.", "Exact words from 04 §5; tint is background only.", "P2", "Y"),
        ],
    ),
}


def build():
    wb = Workbook()
    how = wb.active
    how.title = "How to use"
    rows = [
        ["Clor People test sheet (v1.0, 24 Oct 2026)"],
        [""],
        ["One sheet per area. Row 1 says what the area covers; row 2 is the header."],
        ["Columns: # | Area | Test case | Before you start | Steps | What must happen | Pri | New | Result | Remark"],
        ["Pri: P1 = money, legal, access or data loss (shaded red). P2 = everything else."],
        ["New (amber): built this round and never exercised. Test these first."],
        ["Result: Pass / Fail / Blocked / N/A (dropdown). Fill it only with evidence under docs/people/evidence/<ID>/ and a PEV row in 09-EVIDENCE-REGISTER.md."],
        ["Remark: the PEV id, or what went wrong in one line."],
        ["Requirement ids in 'Test case' prefix match docs/people/02-PRD.md; cross-app rows are marked in 06-BUILD-CHECKLIST.md as parked."],
        ["Test data: synthetic workforce only (07-TEST-PLAN.md §2). Never real employee data."],
    ]
    for r in rows:
        how.append(r)
    how["A1"].font = Font(bold=True, size=14)
    how.column_dimensions["A"].width = 120

    total = 0
    for name, (intro, cases) in SHEETS.items():
        ws = wb.create_sheet(name[:31])
        ws.merge_cells("A1:J1")
        ws["A1"] = intro
        ws["A1"].font = Font(italic=True, color="6B7280")
        ws.append(HEAD)
        for i, h in enumerate(HEAD, 1):
            c = ws.cell(row=2, column=i)
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = HEAD_FILL
            c.alignment = Alignment(vertical="center", wrap_text=True)
        for i, w in enumerate(WIDTHS, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.freeze_panes = "C3"
        dv = DataValidation(type="list", formula1='"Pass,Fail,Blocked,N/A"', allow_blank=True)
        ws.add_data_validation(dv)
        for n, (area, req, case, before, steps, must, pri, new) in enumerate(cases, 1):
            r = ws.max_row + 1
            ws.append([n, area, f"{req}: {case}", before, steps, must, pri, new, "", ""])
            total += 1
            for col in range(1, 11):
                cell = ws.cell(row=r, column=col)
                cell.alignment = Alignment(vertical="top", wrap_text=True)
                if pri == "P1":
                    cell.fill = P1_FILL
            if new == "Y":
                ws.cell(row=r, column=8).fill = NEW_FILL
            dv.add(ws.cell(row=r, column=9))
    wb.save(OUT)
    print(f"wrote {OUT}: {len(SHEETS)} area sheets, {total} test rows")


if __name__ == "__main__":
    build()
