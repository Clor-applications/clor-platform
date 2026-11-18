# Design System — CLOR

Preview (rendered): https://claude.ai/code/artifact/b5f06c26-a4de-4879-979f-fbb1e88ad45a

## Product Context
- **What this is:** GST accounting and business SaaS for Indian SMEs, expanding from Sales / Purchase / Inventory into People (HR), Payroll, Attendance, CRM and Projects.
- **Who it's for:** CAs, accountants and SME finance teams who live in the software all day; first, small businesses of one owner and one or two staff (2026-10-25), often on a phone.
- **Space:** Tally, Zoho Books, Vyapar, QuickBooks India. All either dated or generic.
- **Project type:** dense data web application.
- **Memorable thing:** *Serious software for serious work.* Calm, obviously accurate, never shouts. Trust is the product.
- **What we say (8 Nov 2026):** accounts, GST, staff and salaries for small businesses in India, in plain words. No slogan or tagline on screens (*Done, daily* and *ticked off before tea* retired: they read as machine-made).

## Owner's style picks (17 Nov 2026 — current, everywhere except Books)

The owner chose one style for each building block on a picker page. The picks apply in
Workspace, People, Payroll, Attendance, Ops and the Console. **Books is untouched** and keeps
every rule below as written. All of it lives in `packages/ui/src/picks.css`, loaded last
(`main.jsx`, `console/web/main.jsx`) and scoped away from `[data-palette='indigo']`. Where a
pick and a rule further down this file disagree, the pick wins outside Books.

| Building block | Pick | What it replaces outside Books |
| --- | --- | --- |
| Buttons | Square and compact: 3px corners, 36px, second button has an ink border | 8px button radius |
| Text fields | Soft grey fill (`--field-fill` `#F1F1F1`), no border until focus; error is a red fill and border | White field with a `#D6D6D6` border; "grey is hover only" |
| Dropdown | Search box on top (from 5 options up in `PopupSelect`) | Search from 8 options |
| Tick boxes, switches | Sharp corners (1px box, 3px switch track) | Rounded |
| Data table | Bold 2px ink rule under the header, white header, no lines between rows | `--list-head` header row, row hairlines |
| Card | Glassy wash: app colour at 7% fading to white, white edge, soft shadow, 16px corners | Hairline border, 12px, no shadow; "two radii" |
| Tabs | Pills; the open tab takes the app colour at 10% | Underline tabs |
| List filters | Quick chips with counts (`.ui-filter-chips`, the `FilterTabs` row) | Underline status tabs |
| Status | Solid tag: filled in the status colour, white text, 4px corners, no dot | Soft pill with a 6px dot |
| Page header | Slim toolbar: 16px/600 title, hairline below, 32px buttons | 28px page title |
| Side menu | Narrow rail, icon over name; the current item takes the app colour at 10% | Green selection wash |
| Confirm dialog | Centred text, buttons stacked full width, action on top | Buttons on the right |
| Toast | White with a green tick | — |
| Empty screen | Centred with a picture | — |
| Date picker | Rounded-square day (8px) | Square day |
| Page controls | "Show more" button — **picked, not built yet**: lists still page from the server | Numbered pages (still in place) |

Not built yet, each needs screen-by-screen work: show-more paging; search inside the plain
`.ui-select` dropdowns; chips in place of dropdown filters; the Console side menu as a narrow
rail. Dialogs that hold a form keep their buttons on the right.

### Round 3 (17 Nov 2026)

Built in `picks.css`:

| Building block | Pick | What it replaces outside Books |
| --- | --- | --- |
| Links | Bold, app colour, underline on hover; an arrow after links that go to another page (`a.ui-link`) | Ink text with a quiet underline |
| Counts | Pill in the app colour, white figure (`.ui-tab-count`, `.ui-side-count`, `.ui-segment-count`, `.ui-split-item-count`, `.ws-count`) | Grey figure |
| Must-fill fields | A small "Required" tag in place of the star (`.ui-required` on the star) | Red star |

Built later the same day (component work):

| Building block | How it is built |
| --- | --- |
| Your name menu | Your face in the top bar opens a menu: who you are, the company in use (switch here), My profile, Sign out. The bar's separate company picker and sign-out button are gone outside Books (`Shell.jsx`) |
| Notifications | Each notice shows its app's mark in the app's colour; the unread dot sits on the right (`NotificationBell.jsx`). Notices do not record who sent them, so the mark is the app, not a face |
| Tooltips | White with a soft shadow, drawn by `TipLayer` from any element's `title` (mounted at the app root and in the Console) |
| Long text | A text box with a `maxlength` shows "74 / 500" under it while typing (`TipLayer`) |
| Folding sections | Every `<details>` sits in its own box (dropdown-style ones excluded) |
| Comments | Chat bubbles in a record's activity (`.ui-activity-item.is-comments`) |
| Row actions | `DataTable` shows up to three row actions as words in the row; more than three stay behind ⋮ |
| Record header | The employee record's summary sits under a band of the app's colour (`.pc-summary`) |

Picked and already how the app works: white top bar with a hairline, app switcher as a list
with a line about each app, search everything as a command box with grouped results, "Help"
in the top bar, soft colour notice strip, details as label above value in two columns, minus
sign for money below zero, an arrow on the sorted column only, a bold totals row at the end,
files as list rows.

Built in the second batch (17 Nov 2026):

| Building block | How it is built |
| --- | --- |
| Form sections | Heading and note on the left, fields on the right from 1024px (`.ui-form-part`; Add employee) |
| Help text | Behind an "i" beside the label (`HelpTip`); keyboard focus shows it too |
| Money fields | "INR" after the amount (`MoneyInput`; drawn by CSS so it never joins a label's text) |
| Phone | Country code picker before the number (`PhoneInput`) |
| Choosing many | A tick list (`TickList`; rotations, data protection) |
| Date range | Quick periods first: this month, last month, last 3 months, this financial year (`RangePresets`) |
| Copy | The word "Copy" beside masked numbers, GSTIN and employee codes (`CopyWord`) |
| Approvals | Tick and cross buttons (`.ui-decide`; Approvals, Leave requests). Outside Books this replaces "Approve secondary, Reject as text"; the cross still asks for a reason |
| Board cards | Soft shadow; the opening's hiring manager under the date; lane counts are pills |
| Leave on calendars | Solid block in the app colour; waiting leave keeps its dashed outline |
| Save | Top right in the page header (Attendance rules moved; other settings pages already were). Step-by-step wizards keep Continue at the bottom |
| Success after a big task | A green note on the page (`SuccessNote`; payroll approved, payroll locked). Small saves keep the toast |

Still **not built**: opening a record as list left, record right (needs each list screen
reworked). Bar charts as square bars in the app colour: there are no bar charts outside Books
yet, so this is the rule for the first one.

### Round 4 (17 Nov 2026)

Built in `picks.css` and small component changes:

| Building block | Pick |
| --- | --- |
| Row height | Roomy rows |
| Long lists | The header stays while rows scroll (`DataTable`'s scroll box) |
| Ticking rows | Tick boxes show on hover, on a ticked row, or once any row is ticked; always on touch screens |
| Dialogs on a phone | Full screen (sheets marked as sheets still rise from the bottom) |
| Labels on a record | Coloured dot and the word (`.ui-tag`) |
| Profile photo | Initials with "Add photo" / "Change photo" under them; no camera badge |
| Person in the org chart | Face over name (stacked cards keep the face beside the name) |

Picked and already how the app works: save feedback as a white toast with a tick; lists on a
phone as two-line rows; no access as a page with a lock (the "Ask" button is still to add).

Picked, **not built yet** (component or screen work): tabs along the bottom on a phone; trial
and plan strip across the top; no internet as a box with Try again; large home greeting; quick
actions as tiles with pictures; who is away with the reason; birthdays as cards; to-dos grouped
by app; choosing a person with face, name, team and ID; big choices as round buttons in a list;
yes or no as a tick box; small numbers as a slider; time as hour and minute columns; SMS code
as six boxes; password with "Show" and a strength bar; fields you cannot change as plain text
with "Ask HR"; unsaved changes as a strip that stays; editing a cell in a list by clicking it;
address as separate fields, PIN last; grouped rows as separate small lists; choosing columns
as a tick list you can reorder; nothing matches showing close matches; activity grouped by
day; payslip as one list; profile completeness as a bar with a percentage; long jobs as a list
of steps; a round add button bottom right on a phone.

### Round 5 (17 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| While something loads | A spinner with "Loading…" (`SkeletonCard`, `SkeletonRows`, `SkeletonStats`, `TableSkeleton` and `DataTable` draw it outside Books; Books keeps grey shapes) |
| Faces | Circle with a ring in the app's colour (`.ui-avatar-initials`, `.ui-avatar-photo`) |
| Money owed back | Red figure (`.ui-amount-neg`), with its minus sign |
| After ticking rows | The bar turns the app's colour with white words, and stays at the top while scrolling (`.ui-bulkbar`) |
| Steps in a long form | Dots; the current step is long and named (`.pc-steps`) |
| Holidays on calendars | An orange line under the day |
| Search box | "/" jumps to the page's search box; the key is drawn in the box until you type (`TipLayer`) |

Picked and already how the app works: big amounts in Indian grouping (12,45,600); dates as
17 Nov 2026; files as list rows; nothing between table rows.

Picked, **not built yet**: one back link instead of a full path; previous and next names at
the bottom of a record; times with how long ago; a key number with a small trend line; trend
charts with a soft fill; parts of a whole as a bar for each part; company news as a coloured
banner on home; camera first when adding a file on a phone; a list of mistakes at the top of a
form plus the line under each field (`FieldErrorSummary` exists but no form uses it yet);
joined buttons for two or three choices; a row of filter buttons; overlapping faces for
several people; job history as a line with dots; where a request is, as a sentence; a soft
amber warning box with the way to fix it; delete first and offer Undo for big deletes; upload
progress as a ring with a count; nothing found offering a close name; team leave as a row per
person across the days; a colour for each shift on rosters; "?" to list keyboard shortcuts
outside Books.

### Round 6 (17 Nov 2026)

Built in `picks.css`:

| Building block | Pick |
| --- | --- |
| Keyboard focus | A thick 3px ring in the app colour on buttons and links; fields show their own border with a soft halo |
| Pointing at a row | A tint of the app colour |
| Scroll bars | Thin, seen only while pointing at the box that scrolls |
| Side panels | Half the screen on a laptop or bigger (sheets keep their own size) |
| Splitting a long page | Section headings on a tinted band |
| Movement | Lively: panels arrive with a small overshoot |

Sign-in pages (owner, same day: "fix login layout properly"): the picture side is three rows,
the title above, the whole picture in the middle with rounded corners, the quote card below,
all on one left edge, and the side never taller than the screen. Nothing lies over the
drawing. On a phone or tablet the picture is a rounded image across the form's width. A
focused field shows one ring.

Picked and already how the app works: a calendar that pops up for dates; search first in long
dropdowns; small page titles; full-width pages; a split sign-in page with a picture; a side
panel that opens from the right with the list still there.

Picked, **not built yet**: an icon and a word on every button; "Add" links on details not
filled in; long text cut with a "more" link; the most used action then ⋯ for the rest; "NEW"
in coloured letters; percentages as whole numbers with a bar; people shown with face, name,
code and team; phone numbers as +91 98765 43210; status as the last column; settings as tiles;
a setup guide as tiles; on/off settings as cards with a note; first visits with a short note
and a guide link; a "What's new" box on the first sign-in after a change; help as a link to a
help page; plain emails; a centred header on printed payslips and letters; a red line where
content failed to load.

### Round 7 (17 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Punch in button | A big round button in the app colour on the phone punch page |
| A day on the attendance calendar | A solid coloured box with a white letter: green present, deep amber half day, red absent, slate on leave |
| Leave balance | The number with a bar under it in the app colour (employee portal and leave balances) |
| Late marks | An amber tag with the minutes ("Late 12m") on attendance records and the employee portal |
| Payroll run progress | Steps across the top of a run: Draft, Calculated, In review, Approved, Locked, done steps ticked |

Picked and already how the app works: English only.

Picked, **not built yet**: tapping days on a calendar to ask for leave; change history as a
sentence with a face; paying salaries in one tap from CLOR (needs a bank link); a birthday card
with a message box; salary structure as bars with percentages; document requests as a note on
the home page; employee cards with a coloured band behind the face; dates ahead when someone
leaves; hours worked as a timeline of punches; the next CLOR bill first; cards about today on
the phone home; phone notifications with Approve on them; payslip with net pay first and
details on tap; pull down to refresh; who can do what as a grid of ticks; seats as a ring with
seats free; faces of who else is away on a leave clash; change since last month as a tag with
the percentage; Workspace apps as icons in a row.

### Round 8 (17 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Shift on the roster | A solid block in the shift's colour with white letters |
| Overtime | An amber tag on the day ("+2h 05m OT") in the employee app |
| Holiday list | A date tile (month over day) before each holiday in the employee app |
| Goals | A ring per goal with the percent beside it; green once done |
| Review rating | Five stars in the app colour, with the words kept beside them |

Picked, **not built yet**: a short form to fix a missed punch; "Use where I am now" to set the
office punch area; one form for a leave type; the team leave calendar day by day with faces;
old and new tax regimes side by side on the declaration; Form 16 as a list of files; the
advance's repayment plan; back pay as a tag with details on tap; expense claims gathered and
sent together; joiner checklist as progress and the next step; letters made in one step and
sent to sign; company things as icons; company news as posts with reactions; asking HR as a
chat; reports as tiles with a small preview; downloads with a file type to pick; connecting
apps as tiles; sign-ins as a small chart; a big punch button in the middle of the phone's
bottom bar; the phone payslip with net pay first.

### Round 9 (17 Nov 2026)

Built: a payment that did not go through shows as a red strip under the top bar on every
page (it was amber).

Picked and already how the app works: inviting someone by email and role; people who use CLOR
as a list with their role; switching company from a dropdown in the top bar; who approves what
as a chain of steps ("Manager → HR"); the CLOR staff customer list with a plan tag per company.

Picked, **not built yet** (most need new data or new screens): two-step sign-in by SMS code
(a security change, held for the owner's say); alerts as a grid of email and phone; job openings
with place and counts; interview times picked by the candidate in a form; interview feedback as
stars per skill; the offer letter with a sign button; thanks as monthly medals; surveys with
faces; a pay rise as two bars; exit interview reasons to tick; imports through CLOR's own Excel
template with failures fixed in place; plans as three cards; plan use in words; support access
as a switch that turns itself off; a punch button phone widget; phone sign-in by email and
password.

### Round 10 (17 Nov 2026)

Built: branches as tiles with the headcount on a laptop or bigger (a `tiles` option on
`DataTable`; each tile keeps its row menu, phones keep the plain cards).

Picked, **not built yet** (most need new data or new screens): PF and ESI as a year of months;
held pay as a faded row with the amount struck through; final settlement as steps; a bonus
with a choice of how it is worked out; payroll cost as six months of bars; a timesheet timer;
attendance machines as counts; a travel request form; policies with a "to read" tag; end of
probation with Confirm and Extend on the row; one-to-ones as a list of meetings; training,
only what is due; expiring documents as a note on home; a referral form with a CV; company
details as a profile card; taking your data out as monthly copies kept ready; closing the
account with an offer to talk first; Ops price changes in a table; seeing what a customer sees
with a "read only, time left" tag; staff actions as a line each.

### Round 11 (17 Nov 2026)

Built: a department in a list is a coloured tag (`DeptTag`, colour from the department's name,
one of `--cat-1..8`, name always written out); used in the People directory.

Picked, **not built yet** (each needs new behaviour, data or a screen): a page that does not
exist offers suggested pages; a warning before being signed out; a status page link while CLOR
is being updated; print as a preview, then PDF; the first-time tour as a short video; confetti
and a cheer on a big moment; an employee's own change to their details goes to HR to check;
bank details typed, with the bank name filled from the IFSC; a red prompt when the emergency
contact is missing; the company directory as face cards; the shared gate tablet shows a QR to
scan with your phone; a week of attendance as a grid of letters; the payslip email carries the
amount and a link; earnings and deductions set up as a list with Add; unpaid days marked on a
calendar; CLOR bills paid as a list with PDF links; adding another CLOR app offers a free
trial; the phone explains before asking for location; a punch with no signal is saved and
sent later.

### Round 12 (17 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Label colour | A row of dots from a fixed set of nine (`ColorDots`, radios named by colour); shifts and leave types use it, and a colour saved before keeps showing as an extra dot |
| Shortcut keys in menus | None shown (`.ui-menu-kbd` hidden outside Books) |
| Something went wrong | The icon in a soft round of the app colour, the line, then "Try again" (`ErrorState`; Books keeps "Retry") |
| Search results | One list, best match first, each row's kind as a tag (`.ui-palette-kind`) |
| Board column heading | A tinted band in the app colour with the count (`.pt-lane-head`) |
| Password | The word "Show" beside the eye, and a strength bar on new passwords (`PasswordInput strength`) |
| Phone numbers | +91 98765 43210 (`formatPhone`; landlines and foreign numbers left as typed) |
| Failed to load | A red line down the left edge (`LoadFailed`) |
| Files | A row with a type badge (PDF, IMG, DOC, XLS) and the size (`FileBadge`; People Documents) |
| Board column heading | Applied carries a "+" to add a candidate (new candidates always start there) |
| Choosing a week | A month of week rows, Monday first; the chosen week is lit, the row under the pointer tinted (`WeekPicker`; Attendance roster) |
| Matching columns on import | The file's columns and what each was read as, side by side with an arrow (Attendance import) |
| Accepting a policy | A tick box "I have read and accept this policy", then Accept (employee app) |

Picked and already how the app works: numbers with small arrows; notification settings as a
switch per alert; tags typed in a field with chips below (no tag field exists yet).

Picked, **not built yet**: office location as a small map with a circle (needs a map source
allowed by the security headers); "Ask CLOR" in a side panel (no helper exists); writing tools
as an icon bar (no rich editor exists); monthly or yearly as a switch (pricing page); changing
an import column's match from a dropdown; signing offer letters (candidates accept offers
outside the app today).

### Round 13 (17 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Typing a date | The calendar opens on a click anywhere in a date box, not only its icon (`TipLayer`, `openPickerOnClick`) |
| Giving a reason | Quick chips (radios), then the note; the chip fills the note if it is empty (missed punch, employee app) |
| A section with nothing in it | "Not added yet" with Add, which opens that section's form (employee record) |
| Too many tabs | Seven or more tabs become a list down the side on a laptop or wider (`RecordTabs`) |

Picked and already how the app works: "Edit" on each section of a record; the copy button
saying "Copied"; 25 / 50 / 100 rows per page; side menu counts as a number in a pill; Save at
the top only.

Picked, **not built yet**: notifications page as one list marked by app colour; one Like and
comments on company news; time worked as start and end; a small card when pointing at a name;
overlapping faces for many people (no screen shows a group yet); a toast with Download when an
export is ready; pull down to refresh on a phone.

### Round 14 (17 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Closing a side panel | A Back arrow at the top left (`Drawer`; Books keeps the ✕ on the right) |
| Long names | Wrap to two lines instead of being cut (`.pc-who-name`) |
| Today's attendance | A ring of present out of headcount with the percentage (Attendance home) |

Picked and already how the app works: the employee code as a grey line under the name; salary
shown in full; a reason needed to reject; ticking this page first, then "Select all N
matching"; a plain confirm for big deletes; solid blocks on calendars; a green or red arrow on
a figure that moved; leave asked on one short page.

Picked, **not built yet**: "Keep me signed in" on the sign-in page (changes how long a
session lasts); times written as 9:42 AM (no shared time format yet, each screen writes its
own); no paise in lists (needs a pass over every money column); an example in the box plus a
hint line under it; the company's own logo beside CLOR (no logo is stored yet).

Rules these picks relax outside Books: *white only* (fields are grey), *two radii* (3px, 4px
and 16px now exist), *no card shadow*. Tokens only, tabular money, one primary action per
screen and colour-has-one-job all still hold.

### Round 15 (17 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Row density | A "Compact rows" / "Roomy rows" switch in the name menu (`useDensity`) |
| Wide tables | The first (name) column stays put when the table scrolls sideways |
| Clearing filters | The button reads "Reset" |

Picked and already how the app works: a spinner inside a busy button (`Button loading`); a
green note on the same form after sending (`SuccessNote`); units written in the label.

Picked, **not built yet**: search this app first, then others (the palette searches all apps
alike); saved views as a dropdown by the title (no saved views yet); a row opening its detail
below itself; an approval step line with times (approvals keep no step history yet); a thin
setup bar across the top; a short guided tour for what is new; an anniversary card with face
and years; payslip PDF with net pay big at the top (the PDF is drawn on the server); sort from
the heading and a dropdown both; starring a screen so it shows at the top of the menu.

### Round 16 (17 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Optional holidays | A tick per holiday with "2 of 2 chosen" (employee app and My leave) |
| Where a punch was made | The place name after a small pin (phone punches) |
| Locked payroll month | A "Locked" tag beside the month's name (payroll periods) |
| Things given to an employee | An icon before each asset on the record |

Picked and already how the app works: leave left shown beside each leave type when asking;
training progress as a bar with the percent.

Picked, **not built yet**: a small photo beside the punch time (photos load one at a time
today); a manager's team as face cards with today's status; the expense bill as a file row
(the server does not send the bill's type yet); ratings as faces; help pages as questions and
answers; the leaving checklist with who does each step; a status tag on each tax proof; a line
under a changed day saying who changed it and why; a shift swap on a calendar; overtime hours
shown with the pay they cost.

### Round 17 (17 Nov 2026)

This round repeated some earlier topics; where a pick differs, the newer one wins.

Built:

| Building block | Pick |
| --- | --- |
| My shift | Today's shift as a small card on the employee app's Today page |
| Expense claim status | Steps with dates: Sent, Approved (or Not approved), Paid (employee app) |

Picked and already how the app works: the employee's month as a calendar of coloured days
(round 7); the org chart as boxes top to bottom; the directory as a grid of faces; cancelling
leave from the day; company news as posts.

Picked, **not built yet**: birthdays as a banner across the top (replaces cards); the salary
structure as a table of monthly and yearly figures (replaces bars); the payslip on screen with
earnings and deductions side by side (replaces net pay first); profile details missing as a
list (replaces the percentage bar); notifications in tabs, All and Needs action; end of
probation as a card with Confirm and Extend; a document to sign as a home card with "Sign
now"; the next holiday as a card with days to go; team leave as bars per person across the
days; fixing a missed punch right on the day in my calendar.

### Round 18 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Limits on expenses | The category's limit shows under the form while the amount is typed, with how much is left or over (employee app, Add a bill) |
| Cancelling approved leave | "Cancel leave" on the leave; the confirm now says whoever approved it is told (the server already tells them) |
| A "Remind" button on my own request | "Remind" on my waiting leave (employee app, and My leave's row menu) tells whoever it waits on again, through the leave notice; once a day, then "Reminded" until tomorrow (`remindLeave`, history "Reminded the approvers") |

Picked, **not built yet**: approvals going up to the next manager while one is away (today a
stand-in is set by hand); an ID card sideways with a QR code (no ID cards yet); statutory due
dates as a home card when one is near; work from home as a request type beside leave (it sits
with attendance requests today); a branch move shown as From → To with a date; resigning from
the app with the last day worked out; late-mark rules written as a sentence you fill in; weekly
offs as a grid of weeks and days; nominees as a table per
scheme; family as faces with relation and age; past jobs and education as two lists; skills as
chips; leave carried to next year as one sentence ("10 carried, 4 lapse"). Most need records
CLOR does not keep yet.

### Round 19 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Bigger text | Small, Medium, Large in the name menu (`useTextSize`, scales the root font; Books ignores it) |

Picked, **not built yet** (each needs new data or a screen): salary bands as a table of job,
min, mid, max; a bank account shown verified with the holder's name; background checks with a
tag each; the buddy's face on a new joiner's home; a complaint form that asks who to tell
first; consent as one "I agree" with a link; contract staff ending as a card with Renew and
End; your own fields as a list with Add; a gratuity estimate with how it is worked out; PAN and
Aadhaar with a small green tick once checked; a list of everyone paid below minimum wage; open
shifts marked on my week; open positions as filled out of planned per team; a page listing
scheduled report emails; incentives typed into a table for the month.

### Round 20 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Weekend between leave days | The leave form says which days off in between count, and why ("2 days off in between count, by your company's leave rule"), apart from the dates not counted (`DateNotes`, My leave and the employee app). They used to be listed under "Dates not counted". |

Picked and already how the app works: field staff as a list with place names (phone punches,
with the pin from round 16); a fixed break taken off the day automatically (shifts).

Picked, **not built yet**: two employees compared in two columns; rotating shifts built as a
repeating strip; leave building up shown month by month; a countdown card before attendance
closes; mileage typed in kilometres with the rate applied; monthly tax worked out in steps;
payroll going to Books by itself when it locks; an edit clash showing both versions to pick
from; dragging a column's edge to resize it; a profile photo centred on the face; next year's
holidays suggested for the state to tick; a top list of who is absent most; Approve and
Reject buttons inside the email.

### Round 21 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| My hours this week | One bar per day, Monday to Sunday, with the week's total, above My days in the employee app (`WeekBars`, current month only). Days still to come show as an empty dashed bar. |
| Telling the manager someone is late | The Today page's list is called "Not in yet", with the time it was read, as a morning look at who has not come. |

Picked and already how the app works: signed-in devices listed with Sign out on each (employee
app, Security settings); Rehire on the old record, history kept; a warning while adding someone
with the same PAN or phone, with a link to the other record; delete only while payroll has never
used the record, everyone else is marked as having left.

Picked, **not built yet**: leave cashed in shown as days and amount together; the morning
"not in yet" list sent as an alert; health insurance as a list of who is covered and how much;
flexible pay parts with amounts and the total left; a handover list with who takes each item;
an "Add to my calendar" link for approved leave; WhatsApp requests with Approve and Reject;
changing one field for many people with a preview of who changes; night allowance as its own
payslip line; a phone reminder at shift end to punch out; private HR notes with a lock and who
wrote them.

### Round 22 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Joiners and leavers each month | On People → Headcount & attrition, a "Joined and left" chart across the full width: a bar up from the middle line for joiners, a bar down for leavers, `+7 −3` under each month (`JoinLeaveBars`). Joiners in the first chart colour, leavers in the third. |
| Sending someone a link to this list | "Copy link" (ghost button, link icon) in a list's header once anything is filtered. The address already holds the filters (`s.<key>`), so the link opens the same list; the other person's own access still applies (`CopyListLink`, every `DocumentListShell` list outside Books). |
| Maternity leave | One request with the return date worked out: on the leave form, a maternity type shows "26 weeks · back at work on Wed 2 Jun 2027" and a "Fill 26 weeks" link that sets the last day (`LongLeaveSpan`, calendar days). |

Picked and already how the app works: two hours off taken with a from and to time on the leave
form, with the hours left this month (hourly leave types); a mid-month joiner's payslip shows the
days paid with the amount ("13 of 30 days").

Built later (server picks, batch 2): the professional tax state picked from the work site. Payroll →
a person's details asks "Professional tax state" once PT is ticked; left blank it reads "From the
work site (Maharashtra)" and the save fills in the site's state, as a transfer does; a state chosen
stays; "See Maharashtra's slab" opens Compliance at the PT bands (`PtStateField`, `ptFromSite`).

Picked, **not built yet**: a holiday on a weekly off moved to the Monday; a written warning letter from a template
sent to sign; Ops list of customers who may stop using CLOR, with the reason; a switch letting
anyone with the company email join without an invite; a locked feature offered as a 14-day free
try; "Report a problem" in Help with a screenshot added; comp off added by itself from punches on
a holiday; the Ops support queue as an inbox with waiting time (Ops console); @ mentions in
comments; booking a cab drop for a late shift.

### Round 23 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| How long people have stayed | On People → Headcount & attrition, a "How long people have stayed" chart: everyone working today in four bars, under 1 year, 1–3, 3–5 and 5+ years since joining. People without a joining date are left out and counted in the note (`tenureBands`, `TenurePanel`). |
| File too big to upload | The limit is written before choosing, beside the upload: the bill on My money ("A photo, or a PDF up to 5 MB"), a leave document, a night-work consent copy, a compliance proof, a training certificate and a résumé. The check on choosing stays. |
| When a short day counts as half day | The shift form says the rule in one sentence under the half-day field: "Less than 4 h worked is absent; 4 h up to 8 h is a half day", from the half-day and full-day minutes as typed, the way the server works the day out (`halfDaySentence`). |

Picked and already how the app works: a shift that ends after midnight is counted on the day it
starts; the doctor's note is asked on the leave form only when the type and length need it
(`LeaveDocumentField`); the home page is the same for everyone (no arranging).

Picked, **not built yet**: labour welfare fund as its own payslip line in the month it is taken;
a "For" field on the leave form so a manager can ask leave for someone; days short of notice with
the amount to pay back; switches on an Ops customer's page to turn a feature on for that
customer; password rules as ticks for the whole company; a strip in the phone app saying a new
version is out; take-home rounded to the nearest rupee; a discount set on the customer in Ops;
a "From" date on an edit shown as coming up; payroll problems listed with a "Fix" link each
before the run. All need server work.

### Round 24 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Taking leave you do not have yet | The leave form's preview shows a balance that goes below zero in red, "balance after −2 days", with "The days below zero come out of the leave you earn next." Whether it is allowed stays the leave type's rule on the server (`LeavePreview`). |
| How new employee codes are numbered | Adding a person shows the next code in the company's own series under Employee ID, "Next: KT-0143 · Use it", read from the codes already in use: the prefix most codes share and the number after the highest, same width (`nextEmployeeCode`). |
| Two parts in one shift | A shift with an unpaid break of two hours or more that has its own times reads with both parts in the Shifts list: "Split · 07:00–11:00, 17:00–21:00" (`splitShiftLabel`). |
| Today's numbers on an office screen | Attendance → Today has "Show on a screen": In, Late and Away in big figures on a white screen, with "412 of 450 in" under them; Esc or Close returns (`TodayScreen`). |

Picked and already how the app works: none this round.

Picked, **not built yet**: canteen charges with count and rate on the payslip line; arrivals by
15 minutes with the shift start marked; sign-up to paying as narrowing bars in Ops; handing over
the owner role with the new owner accepting by email; company-wide quiet hours for notices; a
new manager picked before a manager with a team leaves; fingerprint offered once in the phone
app; a notice to the manager two days before a short-staffed shift; payment mode on each person
with a printed cash sheet; bounced emails in Ops with the reason and "Send again"; a rule's "Who"
list (branch, team, type); "Preview pay" on one person. All need server or phone-app work.

### Round 25 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| PF number (UAN) for a new joiner | Payroll's person form asks "Had PF before, at an earlier job?" before any box. Yes opens the UAN field (digits only, 12, with where to find it); No says "No UAN yet. One is made when they are first on a PF return." and clears a typed number. A UAN already on file answers Yes (`UanQuestion`). |
| Company licences and renewals | People → Compliance → Registrations already listed each work site's registrations with the valid-till date; a valid one now says how long it has left, "Valid, 214 days left", as the ones about to lapse already did. |

Picked and already how the app works: the registers an inspector asks for (People → Statutory
registers lists them, each printable to PDF or exported); customers behind on payment (Ops →
Invoices → Overdue, by days late with "Remind"); a message to every customer (Ops announcements,
a banner inside the app).

Picked, **not built yet**: a supervisor's team list with "In" beside each for workers without
phones; a note with the end date when pay crosses the ESI limit; a pay rule written as a sentence
with blanks; a team's pay-rise budget bar; a time zone on the person (B); a flag after a set
number of days' absence without word; the company's year start with what each choice changes;
file space as a bar by kind; "Copy from" another branch with ticks; payslips by SMS with a short
link; pay groups with their own pay day. All need server work.

### Round 26 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Footer on printed pages | Every printed screen outside Books ends with "Printed by Anita Rao from CLOR · 18 Nov 2026, 4:12 PM", at the foot of each page; the time is taken as printing starts. Hidden on screen. Printed documents with their own frame (invoices, vouchers) are untouched (`PrintFooter`). |
| Men and women in each team | The Gender mix report adds a "% women" column worked out from the counts, per group and for everyone. Where the counts are masked ("Fewer than 5") the percent stays blank, and a fully masked table gets no column (`withWomenShare`). |
| Moving down a list with the keyboard | In the Inbox's To approve list, J moves to the next request, K to the one before, Enter opens it and A approves it, with a hint line under the list. Keys are ignored while typing, with a dialog open, or in Books (`useJkList`). |
| Too many wrong codes | After too many wrong sign-in codes the code step shows "Too many tries · Try again in 4:58", counting down, and holds the Sign in button until the time is up (`lockoutSeconds`, `clockText`). |

Picked and already how the app works: none this round.

Built later (server picks, batch 2): a check list before "Download ECR". Reports → Returns to file
says "82 ready · 2 without a UAN" over the people left out, each with "Fix", which opens their
payroll details (`checklistLine`, the server's `ecr.checklist`).

Picked, **not built yet**: a table of punch-machine numbers beside a name picker; "New date" or "Cancel joining" for a joiner
who did not turn up; a role given "for" one branch; an outage timeline in Ops, newest on top;
swipe right to approve, left to reject in the phone app; previous employer's pay, tax and PF this
year; a punch from a phone faking its location blocked with a plain reason; suspension as sign-in
turned off with a note only HR sees; "Continue with Google / Microsoft" on the sign-in page; a
credit note raised from the invoice in Ops; daily or monthly pay type on the record. All need
server or phone-app work.

### Round 27 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Two punches a minute apart | Attendance → Transactions greys a punch made within 60 seconds of the same person's previous one, with "Repeat · the day counts the first" under its time. Nothing is removed; the day already reads first in and last out (`repeatPunchIds`). |
| Marking a draft payslip | A payslip whose payroll is not approved yet (slip or run still draft, calculated or in review) opens with a coloured strip, "DRAFT Payroll is not approved yet, so these figures can still change." It prints too (`DraftStrip`). |
| An old browser | A browser older than the build's line (late 2022: Chrome or Edge 107, Firefox 104, Safari 16) gets one page naming the browsers that work, with links, instead of broken screens. Not on Books' host or a shared invoice link (`OldBrowserPage`). |
| Giving a customer more trial days | Ops → a customer → Extend trial has +7, +14 and +30 days beside the days box; one click fills it. |
| "Take back" on an approval until the leave starts | Leave requests drawer → "Take back approval" for whoever approved it, or HR for the whole company, before the first day: it waits again, its days come off the attendance record and the person is told (`takeBackLeave`). Leave decided by the approval rule or steps is cancelled instead. |

Picked and already how the app works: a day at a client's office is an "On duty" request with the
place, counted as present once approved (employee app → Requests). A no-pay leave type for a long
break (a sabbatical): Leave settings → a type with "Paid leave" unticked; its days go to payroll as loss of pay,
as every unpaid type's do, and the form says "Without pay" (round 42).

Built later (server picks, batch 2): a row per month with "Add challan" for TDS. Tax declarations →
TDS deposits lists April to March with the tax deducted, deposited and left, the due date (the 7th;
March's 30 April) and "Late"; "Add challan" takes the BSR code, serial, date and amount (the balance
filled in). The 24Q download carries each month's BSR code, serial and date, and names any month with
no challan (`TdsDepositsPanel`, `PayrollTdsChallan`).

Picked, **not built yet**: an "Office only" switch on roles; Ops comparing two sign-ups of one company side by
side; sharing a payslip from the phone's share list (needs a payslip PDF file from the server);
payslips by sign-in link with no PDF password; leaving steps that start on their own at retirement age; a list of leavers due for
clearing with one button; a payslip line showing pieces × rate. All need server work. Chart
names at the end of each line wait for a chart with several lines; none has more than one yet.

### Round 28 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| A buzz when you punch | A punch saved from the phone buzzes twice for in and once for out, where the browser can buzz (`buzzForPunch`, `PhonePunch`). Nothing else changes where it cannot. |
| Overtime close to the legal limit | Approving overtime that runs past the company's cap asks first: "Approving this takes Babu past the company’s overtime limit: 4:00 over the cap of 50:00 a quarter", with Approve anyway (`overCapQuestion`, Overtime requests). |
| Removing a department that still has people | A department with people in it keeps Delete… in its menu; it says "14 people are in Field Sales. Move them to another department first, or retire it" and offers "See the 14 people", which opens Employees filtered to it (`blockedDelete`, Organisation → Departments). |

Picked and already how the app works: the punch uses CLOR's own time, not the phone's (the
server stamps it); pointing at a chart bar shows a small white box with the month and amount
(the shared chart tooltip); pinning rows is left to saved views until pins can follow a person
across pages.

Picked, **not built yet**: perks picked with the taxed value worked out by the rule; family
members hidden from the directory under a locked tab for admins; keys for your own software with
last used and Remove; deleted items restored one at a time from Ops; letter checks by a digital
signature in the PDF; PF capped at ₹15,000 by default with a choice per person; phone punch
allowed for one person whose fingerprint will not read; a small sign-in for former staff to get
their papers; ideas counted from tags on support tickets; salary split between two bank accounts.
All need server work. Pinning a person to the top of People needs pins kept on the server.

### Round 29 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Several messages at once | Outside Books, quick messages stand open one above the other, newest in front, three at most, so each is read (Sonner `expand`, `visibleToasts` 3 in `Toaster`). Books keeps its collapsed pile of five. |
| A chart with nothing to show yet | A chart with no figures is not drawn: a People report's chart with every value at nought, and "Joined and left" when nobody joined or left, are left out; the table or empty state under them says it in words (`ReportChart`, `JoinLeaveBars`). |
| The name someone likes to be called | Lists and the record's title show the full legal name only, as on papers; the preferred name stays on the Personal tab and in friendly sentences (`Directory`, `EmployeeRecord`). |

Picked and already how the app works: right-click on a row opens the browser's own menu (no
custom menu anywhere); the roster has no dragging, a shift is moved by choosing the day; Ops
staff roles are fixed (Support, Billing, Sales, Admin).

Picked, **not built yet**: salary paid by mistake taken back from next month's pay; a roster
warning when night-shift consent is not on file; the manager told when someone applies for a
job inside the company; a CA's client list with this month's status; monthly revenue in Ops as
a big number with a 12-month line; joining the company in the phone app by phone number and
OTP; a joiner asked for their PAN before the first payroll; a billing email separate from the
owner; a joining bonus line with its "returnable until" date. All need server or phone-app work.

Picked and already how the app works: voting-day leave is a leave type a company adds in Leave
settings (one day a year, paid); it is asked for and approved on its own like any type.

### Round 30 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Calling a colleague from the app | Call and WhatsApp buttons beside the number on the employee record's overview and on an absence case: Call opens the phone, WhatsApp opens a chat with that number (only for a ten-digit Indian mobile; a landline gets Call only) (`CallButtons`). |
| This year against last year in a chart | Headcount & attrition shows "This year against last year": the period's month-end headcount as a solid line in the app colour, the same months a year earlier faint and dashed behind, and "+18 on a year before" under it. Drawn only when the year before has people (`YearOnYearLine`). |
| Landlord’s PAN for rent above ₹1 lakh | Payroll's tax declaration form now asks for the landlord's PAN only once rent passes ₹1,00,000 a year (or one is already on file); below that it says when it will be asked. |
| Since April on the payslip | The employee app's payslip (and its printed copy) ends with "Since 1 Apr 2026": pay, income tax, your PF and take-home over this financial year up to that payslip, from final payslips only; read from the payslips, nothing worked out again (`SinceApril`, `sinceApril` in `payslipYear.ts`). |

Picked and already how the app works: the employee app's tax form already shows the landlord's
PAN field only above ₹1 lakh of rent a year, and makes it required there; vehicle numbers are
not stored (a custom field can hold one).

Picked, **not built yet**: moving this week's off day with "work on" and "off on" dates; a month's attendance taken as
agreed unless raised by the 28th; a punch on a leave day asking to cancel the leave or ignore the
punch; either of two managers approving; the health check before joining locking the joining
date; a code to the owner's phone to release salaries; PF and ESI codes on each branch page; a
split column in the cost report; injury logged on the record; "Stop" on an app card ending at the
bill date; resetting two-step sign-in after a code to the old email. All need server work.

### Round 31 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| A joiner under 18 | Typing a date of birth that makes the person under 18 on the joining day (today if no joining day yet) shows an amber "Under 18" tag under the field, in both add forms (People's Add employee and the Employees form): "Night work and some jobs are not allowed. You can still add them." The save is never blocked (`UnderEighteen`). The reason HR goes on with is not kept yet. |

Picked and already how the app works: leave for part-time staff stays a leave type of its own for
the part-time employee type (a leave type can be limited to employee types); pay by gender is not
shown anywhere, only diversity counts.

Picked, **not built yet**: the supplying agency's name as a tag on a contract worker's record;
a reminder email to an agency on the 16th for its PF and ESI challans; a "Freelancer" type paid by
bill with TDS and no payslip; a monthly list of NAPS apprentice shares to claim; an internship
certificate made on the last day and sent to sign; an intern's same record taking a new job from a
date; the skill category asked only when pay is near the state minimum; a "Works in" state apart
from the branch; the ESI dispensary typed at joining; the POSH committee's faces and phones on a
help page; a weekly list of days whose spread passed 10½ hours; festival temporaries as joiners
marked "Temporary till"; a creche request form approved by HR. All need server work.

### Round 32 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Who is paid differently from last month | A payroll run's Review step lists the people whose take-home moved from last period above the payslip table, biggest move first, each with the change and the reason this month's inputs give: days unpaid, overtime, variable pay, days paid ahead, or "First payslip"; otherwise "Salary or deductions changed" (`PayChanges`). |
| Checking money sent matches payroll | Once a run is approved, one answer under its totals: "All 140 paid", "139 of 140 paid" or "Not paid yet", and "1 came back from the bank" when a payment failed, from each payslip's payment status (`PaidCount`). |
| Pay due to family after a death | A normal leaving with the reason "Passed away": the reason now reads "Passed away" everywhere, the record and the attrition report included (it read "Deceased" and "Died"). |

Picked and already how the app works: a missed amount after the month is locked goes in as an
adjustment in the next month (Payroll → Adjustments, arrear); approved expenses paid with the
next salary on their own payslip line ("With salary"); what the company also pays, NPS included,
listed under its own heading on the payslip; pay so far this year brought in from one file per
company ("Earlier this year").

Picked, **not built yet**: a salary the bank sent back with the employee asked to update his bank
on the phone (the employee app is told only paid or not); a fine split over months on its own;
pay stopping at zero with the rest carried to next month; a small extra run for a bonus between
payroll months; pay divided by the days in the month as the company's chosen rule; extra PF set
by the employee on the phone; the leave travel claim with "trips left 1 of 2"; a "Revised" tag
with what changed on a reissued payslip (payslips keep no record of being reissued yet); notes
shown at the top of next month's run. All need server work.

### Round 33 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| First half or second half of the day | One day of leave on the HR and My leave forms is chosen with three buttons side by side, Whole day, First half, Second half, one tap each (`HalfDayChoice`, `.ui-half-choice`). The employee app keeps its own select. |
| Asking leave for a day already gone | The approver's leave list tags a request asked after its first day: "Asked 2 days late" under the dates (`lateText`, `.ui-late-tag`). How far back it may go stays the leave type's rule on the server. |
| Week starting Monday or Sunday | Monday. Weekly off on a shift and the Weekly off policy table list Mon … Sun; the days a shift has off read Monday first. Stored day numbers are unchanged (`mondayFirst`). |

Picked and already how the app works: leave that crosses into a new leave year is split on the
form, "saved as two requests, one per leave period", with each part's days and balance; hours
are written 7h 30m. A bereavement leave type with no proof asked: a type whose "Document needed
when longer than" is left at Never. On probation only casual and sick leave: every other type set
to "Builds up, usable when confirmed" under During probation; the server refuses a locked type while the
person is on probation. No leave during notice: "While serving notice" set to Not allowed on the
type; the person is stopped, HR entering it is told.

Picked, **not built yet**: a busy period needing a second approver (approvals); the leave balance
paid out at notice (final settlement); "1 of 3 left" on the punch fix form; uploading the paper register for a
day the machine was down; a guessed shift a supervisor confirms; asking staff to volunteer for a
holiday; attendance kept to the calendar month with late days carried to next pay; calling
someone back from leave with the days returned; a day off owed added after six days in a row.
All need server work.

### Round 34 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| How the financial year is written | "FY 2026–27", with an en dash, wherever a year is shown: Payroll's tax declarations (year picker, export subtitle, a person's declaration), the earlier-this-year figures panel and the employee app's Income tax page (`fyLabel`). File names keep their plain hyphen. |
| What a screen reader says for a status | A waiting leave or attendance request is read as the word and how long, "Waiting, 2 days" (hidden text beside the pill; the screen still shows only "Waiting") (`waitingSaid`). |
| Opening a notice after being signed out | A sign-in through the company's own provider now comes back to the page that was being opened, not Home (`returnPath`; the API already accepted a safe return path). Password sign-in already stayed on the same address. |
| Chart colours for colour-blind users | The Attendance calendar's day counts no longer lean on green against red: blue for in, orange for absent, grey for leave, and each count carries its word ("12 in · 2 absent · 1 leave"). |
| Languages someone speaks | Chips on the Personal tab (Enter adds, × removes, one spelling each); the directory finds people by a language in its search, a "Speaks" filter and a Languages column (hidden at first) (server picks theme A). |
| Initials | An Initials field under Name on the Personal tab (server picks theme A). |

Picked and already how the app works: "Skip to main content" on the first Tab (the shell and Ops
have it); figures only on letters (no amount in words outside Books' printed documents); a
People report's chart always has its table of the same figures with it; the shared tablet is for
punching only, leave is not looked up there; amounts outside Books are never shortened (when one
is, it reads "₹18.42 lakh", not "₹18.4 L").

Picked, **not built yet**: a new phone allowed only after HR approves it; punching blocked on a
tampered phone while payslips still open; asking to turn notices back on after a missed
approval; asking the worker to let the app track when battery saver stops it; the phone app
read only (payslips open, punching paused) when the company's plan stops; initials shown before
the name in lists. All need server or phone-app work.

### Round 35 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Private notes on a customer in Ops | Pinned notes sit at the top of the customer page, above the tabs, with who wrote them and when, and "All notes" opens the Notes tab. Nothing shows when there is no pinned note (`PinnedNotes`). |
| Checking a caller is really the customer | No changes by phone: the customer's Users tab in Ops says staff do not change an account over the phone, and the owner makes the change signed in or opens a ticket (`PhoneRule`). |
| Booking a setup call with CLOR | "Call me" under the setup steps on Workspace home while setup is not finished: a mobile number, then "Ask for a call" opens a support ticket CLOR sees in Ops, "CLOR will call you within one working day" (`CallMe`). |

Picked and already how the app works: opening leave balances by uploading a sheet (person, leave
type, days) is Attendance → Import, Leave balances; each company in a group is kept apart, with
no group-wide headcount.

Picked, **not built yet**: a duplicate charge kept as credit for the next bill unless the customer
asks for the money back; a data deletion request sent from a form on clor.in to the person's old
company; the customer editing the name or GSTIN on bills from the next bill on; a smaller plan
right away with credit for unused days; sample data removed on its own when the first real person
is added; a discount to the client instead of a CA partner's share; emails from the customer's own
address after they add DNS records; 90 days before a closed account is wiped, with a copy of the
data emailed on day 1; a record in each group company, linked, for one person paid by two; the
customer's own letterhead PDF as the page background; the signer signing each letter online. All
need server work.

### Round 36 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| An offer with no answer yet | A sent offer on the candidate shows an amber chip, "Answer by 25 Nov · 7 days left" (or "Answer by today"); once the date passes it turns red, "Answer date passed". The offer form already asks "Open until", a week ahead by default (`OfferAnswerBy`, Candidates → a candidate → Offers). |

Picked and already how the app works: "Move to screening", "Set an interview", "Send an offer",
one button for the next stage; HR sets the interview time; a job's apply link made and copied to
share on job sites; closed candidates stay searchable by name, e-mail or phone.

Picked, **not built yet**: a reminder two days before the answer date; skills rated 1–5 on the
interviewer's form; a welcome email with time, place and who to meet; a first-week task list for
the joiner; one upload box for joining documents; HR ticking laptop and SIM on the joiner record;
the work email created on joining; a director approving a new job with the yearly budget shown;
the agency and its fee worked out on joining; a kind not-chosen email to the rest when the job is
filled; a careers page in the company's colours; the joiner asking for a new joining date in the
app. All need server work.

### Round 37 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Writing your own review | The self-review asks what the manager is asked (a rating and what went well and what to work on); once neither can still be edited, a review opens with the two side by side, the person's words on the left and the manager's on the right, one above the other on a phone (`showSideBySide`, `.ui-review-pair`). |
| Review cycle dates | A new cycle asks for one "Reviews due by" date, used for self-reviews and manager reviews alike; a cycle shows "Reviews due by" when its two dates match, and an older cycle with two dates keeps both (`oneDueDate`, `withOneDueDate`). |
| Making a course compulsory | A training someone is put down for stays on the employee app's Today tab, "A training to finish", until HR marks it completed or missed (`TrainingsDue`, `trainingsDue`). There is no separate "compulsory" flag: being put down for it is the ask. |

Picked and already how the app works: an improvement plan with what is expected, dates and notes
along the way, seen by HR and the manager (and the person in the employee app); updating a goal is
On track / At risk / Behind with a note (the check-in); the person ticks "I have read it" on a
shared review; ratings stay as managers give them, with HR's final rating needing a reason when it
differs and the calibration view only showing the spread (no suggested share); open jobs inside
the company show under Me with "Apply" where HR allows it.

Picked, **not built yet**: a "★ Nov star" badge on the profile with no post; HR adds colleagues as
reviewers; one-tap mood face once a week at punch-in; answers shown after a course test with no
pass mark; a mentor the person asks, who accepts, with monthly meetings logged; named successors
for a key role, ready now or in a year; staff rating their manager by name in the review; the
promotion letter made and sent with the job change. All need server work.

### Round 38 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Seeing what a role can see | Workspace → Roles shows the chosen role as a plain list by screen: Screen, Can see, Can change ("Yes: add, edit and approve"), read from the same server catalogue as the grid; only screens the role reaches are listed. The full permission grid stays under "Every permission, as a grid" (`RoleAccessList`). |
| Copying a role to make a new one | The role's button and menu say "Copy role" / "Copy"; it opens the new-role form with every permission ticked, named "… (copy)", to untick what to remove. |
| Chatting with CLOR support | The Help menu in every app but Books has "Ask CLOR support": a short ticket form (subject, what happened, urgent) sent as a support ticket for the app you are in; the answer comes by email and the ticket shows in Workspace → Help and support (`AskSupport`). |
| CLOR service status | The same Help menu has "CLOR service status", opening clor.in/status, which shows each check green or not. |

Picked and already how the app works: a History tab on each record (the employee record's History
and Activity tabs, with every change and why); planned maintenance shown as a strip in the app
(Ops → Status posts it and the in-app announcement strip shows "Planned maintenance" until closed).

Picked, **not built yet**: staying signed in until the browser closes (a session cookie, server);
the account owner becoming admin when the last HR admin is removed; a failing connection shown
in an error log; a security page on clor.in naming where data is kept (the website is the
owner's); an email to the person and the company admin on a sign-in from a new place; editing
each email CLOR sends with fill-in names and a preview; small requests approved when nobody
answers in 3 days; ticking CLOR bills and downloading one zip (needs invoice PDFs from the
server); the card CLOR charges on the Billing page with "Change" (needs the payment gateway);
active staff only as paid seats, with the Billing page listing who counts. All need server work.

### Round 39 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Two emergency contacts, HR only | A "Second emergency contact" section on the Personal tab; the server sends it only to whoever may edit records and to the person (server picks theme A). |
| Shoe and uniform size | On the Personal tab under "Food and uniform", with the personal details (server picks theme A). |
| Choosing old or new tax regime | The employee app's tax form works out both regimes side by side on a year's salary (started from the latest payslip's earnings times twelve, changeable) and what is declared, marks the lower one with "New saves you about ₹8,300 this year", and offers "Use the new regime". An estimate: standard deduction, slabs, rebate and cess; payroll still works out the exact tax (`TaxCompare`, `regimeTax`). |
| PF saved so far | The employee app's Payslips opens with "PF saved so far": from your pay, from the company, and the pension (EPS) kept separately, summed from final payslips made in CLOR, with "Your PF account's balance on the EPFO site also counts interest and any earlier job" (`PfSaved`, `pfSaved` in `payslipYear.ts`). |

Picked and already how the app works: a name change keeps the legal name for PF and tax while
the preferred name shows elsewhere (round 29's legal name in lists, preferred name on the
Personal tab).

Picked, **not built yet**: a signed salary certificate downloaded by the employee; a bank account
change approved by HR before payroll uses it; Form 16 in
the employee app with a six-step filing guide; IT as a topic on the same Ask HR desk, sent to IT staff; visitor QR passes on WhatsApp; a desk given for a
booked day; booking a room from the calendar; live poll bars in company news; events posted as
news; a line in company news on a leaver's last day; a Friday reminder to hand over before
leave. All need server work.

### Round 40 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Going home early | A day where someone left before the shift ended gets its own tag beside the late mark, "Left 2h early" or "Left 40 min early", in the employee app's Today card and day list and in Attendance → Records. It uses the `earlyOutMinutes` the server already works out (`EarlyGoTag`). |
| Showing how many rows match | The Employees list title carries the matching count, "Employees (6)", once the list has loaded; any list on `ListHeader` can pass `count`. Not in Books (`titleWithCount`). |
| Short salary register | Payroll's Salary register opens short: Employee, Gross, Deductions, Take-home; a name opens that person's earnings and deductions under the row, and "Show every part" lays out the full table with a column per component (`Register`, `FullRegister`). |

Picked and already how the app works: a "Columns" button with ticks and an order per column on
data tables (moved with arrows rather than dragged); grouping is a filter on one branch at a
time; leave left is shown as days, not money; a plain bank sheet of names, accounts and amounts
is Payments' bank advice download (full account numbers, so it needs the payroll export
permission).

Built later (server picks, 18 Nov 2026): exit-interview reasons read one by one, People → Reports →
"Reasons for leaving": each leaver's main reason and "could have been kept", and the reasons counted
in the chart; only for readers who see every leaver's reason (`exitReasonsReport`).

Picked, **not built yet**: absence pay given back next month with a line saying why; attendance
uploaded from any sheet with its columns matched; holiday work paid or taken as a day off, chosen
each time; your own reports from fields, filters and groups; a phone notice with the amount when salary is sent; planned
headcount as one number on home; a PDF of a list to print; a download with every field. All
need server work, or a per-list field set that does not exist yet.

### Round 41 (18 Nov 2026)

Field and site staff. Built:

| Building block | Pick |
| --- | --- |
| Where the field team is now | Attendance → Mobile punches has a "Where now" tab: each person who punched from a phone in the chosen days, once, with the place (street address for a field punch, else the work site) and time of their last punch, and the map and selfie buttons. A list, no map (`latestPlaces`). |
| When location is followed | The phone punch notice now says it plainly: "Only the place at the moment you punch is kept; CLOR does not follow you between punches." That is how it works: the location is saved with each punch and nowhere else. |

Picked and already how the app works: a field day can start from home, because people set to Field under Portal access punch from anywhere (their punches show with the address, waiting for approval if the company wants); a fixed fuel amount a month is a fixed earning on the salary structure, with no card to check.

Picked, **not built yet**: "Check in here" at the customer's shop found from his location; Ravi's own visit plan for the day, seen by his manager; outcome chips and a note after a visit; a gallery photo as proof at a site; one customer and site list kept by the office, with new shops suggested from the field; a fixed night-halt amount from the tour dates; daily allowance by city group (metro, other city, town); "28 of 40 visits this week" on his home; a punch kept on the phone with no signal and sent later with its real time (the server stamps the time today); the site in-charge's daily crew count by trade; HR marking a site closed for the day as a paid day for everyone there; an area on each salesperson's record with its shops. All need server work.

### Round 42 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Leave when a child is ill | Sick leave on the leave form asks "Who is ill": Me or My child. My child takes it from the person's own sick leave (one balance) and starts the reason with "For my child:" so the approver sees it (`ForWhom`, `reasonFor`). |
| Asking for leave without pay | Unpaid leave already shows as a type on the form, marked unpaid; under the day count it now says "Without pay: your pay for the month is cut for these 3 days" (`UnpaidNote`). The rupee figure needs the salary from the server. |
| Leave after adopting a child | An adoption leave type on the form says "For a child under 3 months: 12 weeks from the day the child comes home" and offers "Fill 12 weeks", with the back-at-work day, as maternity does with 26 weeks (`LongLeaveSpan`). |
| A monthly work-from-home limit | Leave settings → a type → "Most days in a month" (blank = no limit, halves allowed). The server counts waiting and approved days of the type in each calendar month the request touches; past the limit the person is refused ("Work from home is at most 4 days a month. November has 1 day left; this asks 2 days."), HR entering it is warned. Every leave form (HR, My leave, employee app) shows "November: 1 day of 4 left after this" (`maxDaysPerMonth`, `monthlyUse`, `PreviewNotes`). |
| Team already away | Leave settings → a type → "Warn when this many of the team are away" (blank = never). The form warns "2 of the team are already away on some of these days" when that many of the person's department (else people with the same manager) have waiting or approved leave overlapping; a warning only, the request still goes (`teamAwayWarnAt`, `teamAway`). |

Picked and already how the app works: paternity leave (10 days within 3 months of the birth) and
marriage leave (5 days, once) are leave types a company sets up with its own days and rules in
Leave settings.

Picked, **not built yet**: period days worked from home; a yearly number of study days; extra paid
days the company gives for emergencies; adding a newborn to cover from the
phone with the birth date; children's education allowance per child, up to two, in salary; a
greeting card post on the news feed for a wedding; weeks of work from home to care for a parent;
moving days off plus a one-time moving allowance; a long-service gift with a news feed post. All
need server work. The employee app's own leave form keeps its current fields for now.

### Round 43 (18 Nov 2026)

The employee record. Picks: bloodgroup B, twoaddress A, passport B, drivinglicence B,
disability A, maritalchange A, spokenlang A, dietpref A, medicalnote A, signaturespec A,
aadhaarmask A, linkedin A, hidebirthday B, selfedit B, workphone A, joinsource A.

Built:

| Building block | Pick |
| --- | --- |
| Showing Aadhaar numbers | Statutory details show Aadhaar as "XXXX XXXX 1234" in JetBrains Mono, so it reads as a masked number (`maskedAadhaar`). |
| Record extras (server picks theme A) | Personal tab: blood group, disability and a short health note under "Health", and the second emergency contact, sent only to whoever may edit records and to the person (not Viewer or Auditor, nor its history lines); "Permanent address" with "Same as the address above", which hides its fields; food (Veg, Non-veg, Eggetarian, Jain) with counts under By employee type on Employees, for those who see personal details; languages as chips; office extension beside the phone in the header ("Ext. 204") and in Contact; Employment shows "How they were hired", filled from the candidate's source on hire. |
| Change in marital status | When someone changes their marital status in the employee app, the confirmation adds what to update next: after marrying, the nominee and the health cover; after a divorce or a death, a check of both (`maritalNextStep`, My details). |

Picked and already how the app works: CLOR keeps only Aadhaar's last four digits, never the full
number, and passport and work permit numbers show in full only with an authenticator code, logged
(safer than "Show with a reason"); birthdays reach colleagues as a day and month (This week panel,
Overview, Today), never the year; which details save at once and which go to HR is the company's
self-service setting, so "every change goes to HR" is that setting turned to all.

Also already how the app works: passport number and expiry sit in IDs and statutory, and a driving
licence or disability certificate is a file in Documents (marked HR only for the certificate).
There is no first-aid role, so the health note is HR's to read out.

Picked, **not built yet**: the passport section shown only for people who travel; the signer's
uploaded signature on letters after approval; a work profile link on the directory card. All need
new fields on the server.

### Round 44 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Payroll dates for the month | Payroll's overview opens with a strip of the month's steps: Inputs close (the period's last day), Run and review, Approve, Pay (the period's pay date), the step the month is at marked, and "Pay in 12 days", "Pay today" or, in amber, "Pay was due 2 days ago" (`PayCalendarStrip`, `payCalendar`). |
| Working out take-home from a salary offer | Typing the yearly CTC on an offer shows "In hand, about ₹46,200 a month" under it, with pay, PF, ₹200 professional tax and income tax spelt out. An estimate on the new tax regime (half the pay as basic, PF on basic up to ₹15,000, surcharge left out); the payslip works out the exact figure (`TakeHomeEstimate`, `takeHome`). |
| Help with PF withdrawal | The employee app's money page ends with "Taking money out of your PF": four steps (UAN linked, sign in, Claim, confirm with the Aadhaar code) and a link to the EPFO member page (`PfWithdrawSteps`). |
| Pension share on the payslip | Under Deductions, the employee app's payslip shows "Company's PF this month": to your PF account (EPF) and to your pension (EPS), as the payslip recorded it, "paid by the company on top of your pay"; the printed copy says the same (`CompanyPf`). |

Picked and already how the app works: loans with interest worked out (Payroll → Loans takes the
rate a year and shows the EMI schedule before saving); a salary advance request instead of
earned-wage access (employee app → money); the joiner brings any bank account (bank details on
the record); a deduction is told, not agreed (it shows on the payslip).

Built later (server picks, batch 2): the ESI monthly file in the ESIC upload format with a check list
first. Reports → Returns to file → "Download ESIC file" gives an Excel sheet with only the ESIC
template's six columns and rows (IP number, name, days, wages, reason code, last working day), under
"1 ready · 1 without an ESI IP number" with "Fix" on each person left out (`esicRow`).

Picked, **not built yet**: a meal card amount chosen by staff and taken out of taxable pay; a
full-attendance bonus that allows one late mark; a stay bonus on the record with its due date, paid by itself; extra health
cover chosen in the app with the premium taken over 12 months; the ESI card downloaded from the
phone app; the month's service charge split by days worked; family members marked "Covered by ESI". All need server work.

### Round 45 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Age mix of the staff | Headcount & attrition adds "Age mix": bars by age band (under 25, 25–35, 35–45, 45–55, 55+) for everyone working today, with how many have no date of birth left out. Counts only; nobody's date of birth is shown (`ageBands`, `AgePanel`). |
| How many people each manager has | Headcount & attrition adds "Team size per manager": managers with how many report to them today, largest team first, ten shown and "and N more" after, with how many have no manager set (`managerSpans`, `SpanPanel`). |
| Absence over time | People → Reports → "Absence rate": days lost to absence and leave (a half day counts half) over working days, month by month, drawn as one line; weekly offs and holidays are not working days (`absenceReport`, `ReportChart` kind `line`). |
| Overtime | "Overtime hours": hours (not money) worked past the shift each month, approved and not yet approved, stacked (`overtimeReport`). |
| Late comers | "Late comers": one line a person with days late, average and most minutes late, last 30 days by default, most late first (`lateReport`). |
| Leave by type | "Leave taken by type": approved days, requests and people per kind of leave, this year by default; a private kind reads "Private leave" for anyone but whole-company HR (`leaveTypesReport`). |
| Branches side by side | "Branches side by side": headcount, leavers, attrition and absence rate per branch; pay cost (employer cost on approved and paid slips) only for readers with Payroll's salary slip right (`branchesReport`, `payCost`). |
| Planned and present per shift | "Shifts: planned and present": for each shift on the day, who was due in (less full-day leave, weekly offs and holidays), present, not in, on leave (`shiftsReport`). |
| Sick days by weekends | "Sick days next to weekends": per person, sick spells and how many start right after or end right before their weekly off or a holiday (`sickSpellsReport`). |
| Probation outcomes | "Probation outcomes": confirmed, extended (a decided review) and let go, month by month; kept from whoever the company keeps leavings from (`probationOutcomesReport`). |
| Who is off soon | "Who is off soon": approved leave in the next four weeks, names under the week the leave starts, people off per week in the chart; a private kind reads "Away" (`offSoonReport`). |

Picked and already how the app works: none this round.

Picked, **not built yet**: cost per hire by channel; days to fill a job by job type; training hours
against the yearly target (CLOR keeps no hiring channel cost, job opening dates or training hours
yet); lowest, middle and highest pay per job; a weeks × days grid shaded by people present.

### Round 46 (18 Nov 2026)

Documents and letters, outside Books.

Built:

| Building block | Pick |
| --- | --- |
| How a person's documents are arranged | A person's Documents sit in folders: Identity (ID, address proof, permits), Joining (contract, education, certificates), Letters, Payroll, Other, each with its count; empty folders are left out. Books keeps one plain list (`docFolders`, `EmployeeDocuments`). |
| Certificates that expire | People → Documents has an "Expiring in December" tab: everything whose valid-until date falls in the next calendar month, to renew together. The month names itself (`nextMonthRange`, `expiresNextMonth`). |
| Filling a letter template | Under the letter's text, "How it reads" shows the letter with each field as a grey chip in plain words ("Date of joining", "Effective date") instead of `{{codes}}`; fields still go in with a click from the list beside it (`LetterFieldsPreview`). |

Picked and already how the app works: a replaced document shows the new one with the earlier
versions kept under "Earlier versions"; one Documents screen across people, filtered by type,
with an export; who sees a document is set per document (the person and HR by default, managers
none).

Picked, **not built yet**: "Ask for it" on the record giving the person an upload task; one
letter to many people with a preview of each and a PDF per person; a faint "Downloaded from CLOR ·
date" across downloaded pages; the relieving and experience letter ready in the employee app on
the last day after clearance; "Opened 19 Nov, 10:12" beside a letter; a camera scan that crops
pages into one PDF; the NDA signed in the app as a joining step; automatic letter reference
numbers per letter type (KAVE/HR/2026/014); the manager copied on a letter; letters delivered in
the employee app with email only for those not on the app; a branch and date filter and "download
all" on Documents. All need server work.

### Round 47 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Showing the steps of an approval | A leave request's Approval section says only the step it is at, as a small chip: "With HR", "Yours to decide" or "Decided", with the due date. The full trail folds under "All steps" (`stepChipText`, Leave requests drawer). |
| What the approver sees about balance | The Balance line reads "Leaves 4 days after this", then "· 12 days without this request" in grey; a balance below zero is in red (`BalanceAfter`). |
| A request nobody acts on | On the Waiting tab, HR gets a "Waiting too long (n)" button that lists only the requests waiting more than three days (`isWaitingTooLong`, `?long=1`). It counts the requests on the page already loaded. |
| Seeing the attached proof | Open on the document sent with a request shows it inside the request: a picture as a picture, a PDF in a frame, anything else with a download link (`InlineDocument`). |
| "Send back with a question" that returns once answered | "Ask a question" in the Leave requests drawer sends the note as a question; the request stays waiting on the same approver, the person answers in the employee app or on My leave, and whoever asked is told the answer (`sendBackLeave`, `answerLeaveQuestion`). |
| HR deciding anything, marked "Decided by HR" | While it is still the manager's turn, HR for the whole company gets "Approve as HR" (Reject as before); the request's Status says "Decided by HR" and its history and audit line say so. Leave on the approval rule or steps keeps its own steps. |
| A request still waiting when its day passes | Company choices → Approvals: "Leave still waiting when its first day has passed is closed as not approved", **off by default**. When on, the hourly leave job closes it with the reason and the person is told (`closePassedLeave`). The day itself reads as the attendance record has it; nothing marks it absent by hand. |

Picked and already how the app works: who approves is fixed by the reporting line (no choice
for the person asking); approving part of a request is approve all, then edit; a stand-in with
dates while a manager is away (a stand-in has from and to dates; requests go to the
stand-in in that window).

Picked, **not built yet**: longer leave (over 5 days) going on to the department head; claims
over ₹10,000 going to finance after the manager; two approvers at once, either one deciding; HR
asked to choose a new approver when one leaves; cancelling approved leave needing the manager's
OK again; requests after the payroll cut-off allowed with payroll told to rerun. All need server
work.

### Round 48 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| The next holiday on home | The employee app's Today tab shows "Next holiday · Pongal, Wed 14 Jan" under today's card: the first holiday from today that the person gets off (an optional one only once chosen), looking into next year when this year has none left (`NextHoliday`, `nextHoliday`). |
| My shifts on the phone | My schedule opens on the next 14 days as a list, today on top, across a month end when needed; "Whole month" brings back the month picker (`useNextDays`, `nextDays`). |

Picked and already how the app works: a shift's own grace minutes decide when a punch is late; the
real punch time is shown and the day is counted from the shift start; hours called in on call are
paid as overtime; working days are set per shift; Saturdays are working days unless a weekly-off rule
says otherwise; the roster carries no hour totals.

Picked, **not built yet**: one company holiday list with each holiday marked for some branches;
"Publish" for a draft roster, with staff told; asking for a shift as a request approved like leave;
a weekly choice of start time from fixed options; a repeating roster pattern set once; a warning
for two shifts back to back (the roster holds one shift a person a day); a short-notice change the
person must accept; a punch on a day with no shift sent to the manager to confirm as an extra day.
All need server work.

### Round 49 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Moving from another HR tool | Import employees recognises an employee export from Keka, greytHR, Zoho People or Darwinbox by its column names, says "This looks like an export from greytHR; its columns are matched below", and matches those columns (employee number, joining date, reporting manager's number, work email, phone). Our own column names still win, and no two columns go to one field (`sheetFromTool`, `guessImportColumns`). |
| Dates in an uploaded sheet | The mapping step reads dates day first, as the server does, and shows one from the file: "Dates are read day first: 03/04/2025 in DOJ is 3 Apr 2025". A date that cannot be read is named with the format to use (`readSheetDate`, `ImportReadNotes`). |
| A big import running | While rows go in, a moving bar in the app's colour and "Importing 140 rows. Stay on this page until it finishes." (`ImportProgress`). |

Picked and already how the app works: mistakes in a sheet are listed row by row, with the rest
imported and a file of the rows to fix; a "Manager (employee ID)" column brings in who reports to
whom; the template and any sheet with column matching both exist (sample sheet first); Export
writes the list as it is on screen, with the columns chosen. The owner picked "support restores
it" for undoing an import; the existing 24-hour "Undo this import" stays, since it removes only
that import's rows.

Picked, **not built yet**: "Invite everyone" by SMS and email; staff adding their own photo from
the phone app; all of one person's documents as one ZIP in folders; a start date from which leave
and attendance count, with balances carried in; a CLOR person checking the first payroll with
you; a full data takeout through support; a salary sheet with CTC split by the salary structure;
a "Came from import" filter on Employees. All need server work.

### Round 50 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Stronger contrast | "Stronger text" in the name menu darkens the greys and firms up the hairlines (`data-contrast="strong"`, `useStrongText`); kept in this browser, beside Text size and row density. Not in Books. |
| Tap size on phones | On a touch screen every button and form field is at least 48px tall (`pointer: coarse` in picks.css). |
| Statutory due dates | Payroll home ends with "Next dues": the next five of TDS deposit (7th; March's by 30 April), PF return and payment and ESI (15th), the quarterly TDS return (24Q) and Form 16 (15 June), each with its date and "In N days" (`StatutoryDues`). Professional tax is left out because its dates differ by state. |

Picked and already how the app works: the phone or computer's "reduce motion" setting is followed
everywhere (the global reduced-motion rule); a 2px ring in the app's colour marks the focused
control; form mistakes show in red under each field; a payslip opens as a screen with earnings and
deductions, PDF if wanted; every People report chart has a table of its figures under it; a screen
reader re-reads the page after Save (nothing extra announced); labour law notices are not in CLOR.

Picked, **not built yet**: the phone app keeping the last payslip, balances and shifts offline
with "as of 9:40"; a fingerprint or PIN to open the phone app; a home-screen widget with today's
shift and Punch in; CLOR suggesting a statutory rate change for the payroll admin to accept; an
in-app notice before a due date; a late payment marked in red (needs paid dates recorded). All
need the phone app or server work.

### Round 51 (18 Nov 2026)

Expense claims and company assets. **Built** (employee app bill form, `apps/attendance/src/portal/round51.js`):
a bill paid in another currency is typed as the rupee amount from the card statement, said under
the amount; a bill older than 60 days is refused (the day picker stops at 60 days back and the form
refuses it; the server does not check this yet); a bill in the company's GSTIN asks only for the GST
amount on the bill, no supplier GSTIN.

**Already matching**: a repeat bill is flagged to the approver ("Same amount, day and place as another
bill"); no hotel limit, the approver decides; a lost bill is added with a note and the approver decides
each time; people book their own travel and claim it; a shared bill is claimed by each person for their
part with a copy of the bill; a team meal is one amount and a note.

Picked, **not built yet**: an advance with later claims set against it; company card spends claimed
like a bill marked "paid by company"; asset condition as Good / Fair / Damaged only; each person
confirming "I still have this" for their assets; "Report a problem" on an asset; asking for an asset
as a free text request; a director naming a helper who files claims for them; the employee no longer
asked "Is this a different bill?" (the repeat goes to the approver only). All need server work.

### Round 52 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Case waiting time | The Help desk list has a Waiting column: how long each open or reopened case has waited on HR ("1 day", "3 hours"), from the reopen if there was one (`deskWaiting.js`). The employee sees no promise. |
| Did this solve it? | Under HR's answer in Ask HR, "Did this solve it?" Yes / No, reopen. No reopens through the existing seven-day reopen; Yes is remembered on that device (`CaseRating`). |
| Settlement countdown | Each unpaid, not-yet-overdue full and final shows "Due in 2 working days" (or "Due today") under its due date; Sundays are not counted (`settlementClock.js`). |
| Net first | The settlement drawer opens with the net, in words ("To pay …" / "… owes this"), above the one list of lines, and it follows edits as they are made. |

Picked and already how the app works: each Help desk category sends its case to its own queue
(set in Help desk settings); HR's internal note never reaches the employee; questions are named,
never anonymous; the employee sees only "Waiting for HR", not a person; a question about a
settlement is an ordinary Ask HR question; HR decides each early-release request.

Picked, **not built yet**: Withdraw on a resignation with the manager accepting or not; the
manager accepting a resignation before HR confirms the last day; the last salary paid on the normal
pay day with dues settled later; an unreturned asset's value as its own settlement line; work
apps stopping at the end of the last day while payslips stay open six months; a "Garden leave"
status (paid, no work access, not absent). All need server work.

### Round 53 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Duplicate candidate | A new application from someone who applied before, matched on e-mail or the last ten phone digits, shows "Applied before for Sales Executive in Mar 2026" (and how many more times) in the candidate drawer. HR only, since only HR sees e-mail and phone (`AppliedBefore`, `round53.js`). |
| Goal weights | Under the goal form's Weight field: "Their active goals add to 70% with this one; 30% is still to give", in red once over 100% (`WeightTotal`). |
| Copy last year's goals | With one person chosen on Goals, the secondary "Copy last year's goals" copies their finished goals due last year, a year on, with measure and weight, after asking; a title already set again is skipped and a date already past is left empty. Edit after (`CopyLastYear`). |

Picked and already how the app works: a CV is attached and HR types the details; each interview
names its interviewers and they see it in their own Interviews list; HR can send any offer; "Put
on hold" keeps the candidates and turns the apply link off; people type their own goal progress
in a check-in; feedback is asked only inside a review cycle.

Picked, **not built yet**: a shared interview question list for all jobs; an e-mail to the
candidate on every stage change (today only on "Not taken forward" and offers); a saved
description per job title picked when opening a job; screening questions on the apply form; a
reason asked when a job is paused; company goals shown over the Goals list; the review score
following the goal weights; goals open to the team by default with "Only me and my manager" per
goal; team goals on the manager's list only. All need server work.

### Round 54 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Bank cut-off | Approving a payroll run after 3 PM India time adds "Approved after 3 PM; the bank will credit tomorrow." to the confirm and to the note after approval (`afterBankCutoff`, `@ui/picks/round54`). |
| Arrears tax | An adjustment whose reason says arrears or back pay shows that arrears are taxed in the year paid and the person can claim section 89 relief in their own return (Form 10E). |
| Closed months | A closed payroll period has no Reopen button; the Payroll periods page says closed months stay closed and a mistake is fixed in next month's run. |

Picked and already how the app works: an arrear is one line on the payslip (an adjustment);
group reports are run for each company separately.

Picked, **not built yet**: a "Companies" page to pick a company from; a mid-month pay change split by days on the payslip; a small extra
payroll for a late joiner; an EMI skip asked in the app and approved by HR; HR choosing what carries
over on a transfer between group companies; one bill to the head company with a line per company;
and the CA picks (one list of every client's dues, CA invited with payroll-only access and an end
date, a client list with Run and status, "Ask client" for inputs, "Prepared by" the CA firm at the
foot). All need server work.

### Round 55 (18 Nov 2026)

Built:

| Building block | Pick |
| --- | --- |
| Recent searches | The search box (⌘K) opens on the last five searches; choosing one types it back in (`recents.js`, `CommandPalette` `remember`). A search is remembered once it leads somewhere. Kept in this browser and cleared at sign-out. Not in Books. |
| Recently opened | Under the module that holds Employees, "Recently opened" lists the last five people whose record was opened (`RecentPeople`); only the id and name are kept, in this browser, cleared at sign-out. |
| Search finds pages and people | The search box no longer offers jobs as rows ("Ask for leave", "Fix a punch"); the words of those jobs still find the screen they belong to. Placeholder reads "Search people and screens…". |

Picked, **not built yet** (all need server work): search by phone, PAN or UAN (the people
search matches name, code and email today); a notification summary every two hours; "Remind me
tomorrow" bringing an item back at 9 AM; one company-wide digest time; the manager's week-ahead
on their home (who is away, birthdays, open requests); the "Payment failed · Pay now" strip with
days before apps lock; card or UPI autopay with the bill emailed first; a handover note on Ops
home; canned replies in Ops that link a help page; free tags on each customer as list filters;
renewals due in 30 days with amount and last activity; email subject lines that start with the
action ("Approve Selvi's leave · 2 days"); a "Stop these emails" link that turns off just that
kind.

## Brand (frontend redesign, owner, 15 Nov 2026 — current)

`frontend-redesign-2026-11-15.md` (PDF on the owner's desktop) is the source of
truth; the owner approved every decision D1–D9 on 15 Nov 2026, Books included.
It replaces the R&D hand-off of 14 Nov (Sora + Inter, per-portal accents). Where
this file and the redesign disagree, the redesign wins and this file is the one
to fix. Tokens live in `packages/ui/src/rnd.css`, loaded after `index.css` and
`people.css`.

- **Thesis:** a precision instrument, not a dashboard. Graphite chrome, one
  colour set per app, tabular money, no decoration.
- **Each app has its own colours (owner, 15 Nov 2026; supersedes "one accent").**
  The shell sets `data-app` on `<html>` and the app's block in `rnd.css` sets
  `--act` (primary fill, white label ≥ 4.5:1), `--act-hover`, `--act-ink`
  (links, icons, selected text), `--marker` (active bar, focus), `--tint`
  (selection wash) and `--act-2` (second colour: charts, secondary marks).

  | App | Primary `--act` | Selection `--tint` | Second `--act-2` |
  |---|---|---|---|
  | Workspace | graphite `#202329` (marker Blaze `#FF6B00`) | `#F2F2F2` | orange `#C95000` |
  | People | magenta `#A21CAF` | `#F9F1FA` | teal `#0F766E` |
  | Payroll | deeper blue `#006A9E` | `#F0F6F9` | amber-brown `#B45309` |
  | Attendance | amber `#A85A00` | `#FAF5F0` | violet `#5B47C4` |
  | Books | navy `#232A66` | — | orange `#FF6B00` |

  The CLOR logo, gate pages and the platform default stay Blaze (`--act`
  `#C95000`, `--marker` `#FF6B00`). Status colours (green done, red error,
  amber waiting) are shared by every app and always carry a label.
  `test/palette.test.js` checks each app's contrast.
- **App identity hues** (`--app-*`, the switcher tile and app mark) match the
  app's primary: Accounting `#232A66`, Payroll `#006A9E`, Attendance `#A85A00`,
  People `#A21CAF`, Workspace `#202329`.
- **Logo:** the brand pack in `clor-rnd/brand/logos/`, copied verbatim into
  `packages/ui/src/components/brand/logoPaths.js` and `public/icon.svg`. Never
  redraw it; its own orange (`--logo-*`) is the pack's, not the UI accent.

### Books (Accounting) — owner, 15 Nov 2026 (until phase 4)

Books keeps the look below until the redesign's phase 4 (object grammar) moves
it onto the one palette; the owner approved that move on 15 Nov 2026.


Books wears navy and orange (owner, 15 Nov 2026: "no red, make it orange"):
primary buttons, links, headings and brand ink navy `#232A66` (hover `#1B2050`),
second colour orange `#FF6B00` for the chosen segment, the open module mark
and the rail's "you are here"; page ground white, ink `#1F1A1C`, money in
`#107E3E`, overdue / error `#B91C1C`. The override block is
`:root[data-palette='indigo']` in `index.css`, after the shared red block it
repaints. Lists, forms and layout are unchanged; only colour moved. never the chrome. The header row of every list (Invoice #, Customer, Date …),
in Books and in every other app (Workspace, Ops, People, Payroll, Attendance), is the pale
blue-grey `#EAF2F8` of the Books Invoices list (`--list-head`, hover `#DDE9F2`
`--list-head-hover`; owner, 16 Nov 2026). It is the one exception to the white-only grounds: a
column header, not a ground. The page heading band stays white with a hairline (`--page-heading-bg`).
Settings is a rail group like the others: its screens sit in the panel under category headings,
the Books rail stays beside them, and opening Settings lands on Company Profile (as in the Books build). Navigation is the split rail: a 72px
strip of modules, each an icon over its name, and a panel of the open
module's screens with an X to close it. The panel is drawn like every other
app's second panel: a pale tint of Books' clor.in blue, `#EFF1FC` (`--nav-panel`), with its hairline,
a Sora 800 title, uppercase group labels, 36px rows, and the open screen a
white tile with a hairline ring and a 3px Books blue `#3D4FE0` edge; the open
module in the strip sits on the same tint with a `#3D4FE0` icon and `#232A66` words.

## Aesthetic Direction
- **Direction:** Instrument — industrial-utilitarian, refined.
- **Decoration level:** minimal. Typography and spacing carry the page.
- **Mood:** a precision tool. Data is the interface; chrome gets out of the way.
- **Removed:** ambient colour effects (`ui-ambient`) leave product screens. Product chrome stays monochrome.

## Do's and Don'ts

The rules below are stated in full in the sections that follow. This is the
scan-first list — if you read one part of this document before writing a
component, read this one.

### Do

- **Take every colour from a token** in `src/index.css`. A literal colour
  drifts from the palette the next time a token moves.
- **Set every amount in tabular figures** and align it by what it is, not by
  being a number — see *Value alignment*.
- **Use the shared control height**: 40px in People and Attendance (44px on a
  phone), 36px in Accounting and Payroll, or 28px where a table cell genuinely
  cannot hold the full height (UI rules, 8 Nov 2026).
- **Give a status both colour and text.** Colour alone is not a state.
- **Let one screen have one primary action**, top right.
- **Name menus in sentence case, and make each page title equal its menu label.** (People rail, 2026-11-08: Home · Inbox · People · Time · Workplace · Talent · Reports · Settings; the company's shape under Settings; one Inbox; *My leave* and *My attendance* open from My profile.) A test enforces the case in People.
- **Write the brand as CLOR**, in capitals, in every logo, wordmark and app header.
- **Look at the screen while building it** — desktop and phone screenshots, fixed as seen, before it is called done.
- **Measure before you change geometry.** Every number in this document came
  from the rendered app; an audit that quotes an older draft of this file will
  send you the wrong way.

### Don't

- **Don't use a raw palette class** — `bg-gray-*`, `text-stone-*`,
  `border-slate-*` — anywhere in app chrome. The only exception is a printed
  document (`InvoicePreview`, `ExpenseVoucher`, `DocumentPrintView`,
  `TemplatePreview`), which is black on white on purpose and does not follow
  the theme.
- **Don't nest a card in a card.** A list is the page under one hairline; a
  document earns a surface.
- **Don't introduce a third radius.** 8px clickable, 12px content, `999px`
  pills. The keycap is the one written-down exception.
- **Don't add a Tailwind shadow utility.** Three tokens, and they carry meaning
  — a hard-coded `shadow-sm` does not follow a token change.
  **57 of them are still in app chrome** (37 in `App.jsx`, the rest spread over
  twelve files; none in the print surfaces). Legacy, counted 2026-09-18, not
  yet migrated — do not add a fifty-eighth.
- **Don't put a hover lift on something that isn't clickable.** A lift is a
  promise.
- **Don't right-align a lone money input** because money is usually
  right-aligned. One field is not a column.
- **Don't reach below 12px type** in app chrome.
- **Don't size a panel row by the window.** The rail takes 224–240px off it
  first — that arithmetic is what put a five-column table in a 383px panel.
- **Don't let a wide table clip.** It scrolls in its own container, or its last
  columns are unreachable and nothing says so.
- **Don't write an arbitrary z-index.** The layer tokens are the whole scale;
  `z-[9999]` is what a number becomes when nobody knows what it must beat.
- **Don't pick an icon size by eye.** Four roles: 12 / 14 / **16 default** / 18.
- **Don't use the marks that make a screen read as machine-made** (owner, 8 Nov 2026, measured with SlopCop): a time-of-day greeting (*Good morning*) — a home page is titled by its date or name; small wide-tracked capitals over blocks or columns — labels are sentence case; a coloured bar along the top of a figure card — a waiting figure shows it in its number; a highlighted or underlined accent word in a heading; a slogan; a second typeface for numbers.
- **Don't write filler.** No page or drawer descriptions, no step subtitles, no help that restates its label, no "(optional)" tags. Plain names: *First name*, not *Legal first name*; no code keys shown to people.
- **Don't add a card, colour or style without a reason.** A list sits on the page ground, a record is one sheet, a form being filled is one sheet, a side task opens in a drawer. People writes the reason per screen in `docs/people/design-v1/WORKFORCE-LAYOUT.md`.

## Typography

- **Figtree** (variable, self-hosted via `@fontsource-variable/figtree`; owner,
  15 Nov 2026, replaces Instrument Sans) for everything, in every app and Books: prose, labels, titles and money. Page title 28/36, 700,
  −0.025em (`.ui-t-page`, `.ws-title`, `.ops-title`).
- **JetBrains Mono** at 0.94× size, weight 500, for identifiers only: GSTIN,
  PAN, IFSC, account, invoice and voucher numbers, HSN/SAC, device and
  correlation IDs, API keys (`.ui-mono`). Never money, never prose.
- **Money:** Figtree with tabular figures, right-aligned in any column of
  two or more amounts. True minus (U+2212); zero in a table is `—`, in a
  balance `₹0.00`; two decimals always; compact `₹1.2L` only in KPI tiles.
- Scale 12/13/14/16/20/24/28/34 (`--text-xs` … `--text-3xl`); 12px is the floor
  in chrome (11px only in `.ui-kbd`). Two weights per screen, 400 and 600; 700
  for titles and totals. No uppercase labels.
- Figtree everywhere, Books included. Inter, Sora, Plus Jakarta Sans and
  Bricolage Grotesque are retired. Never Google Fonts.

## Color

Colour has one job per role:

| Role | Rule |
|---|---|
| **Accent** (`--act`, `--act-ink`, `--marker`, `--tint`, `--panel`) | Only the primary button, links, the active nav state and focus |
| **App identity** (`--app-*`) | Only inside the app glyph (`.ui-app-switch-mark`, app marks) |
| **Status** | Only for state, always with a text label, never decorative |
| **Neutrals** | Everything else |

Orange is a fill, not a text colour: white on `#FF6B00` is 2.9:1. Text, links
and icons use `--act-ink`.

### Neutrals — white, light only (owner, 15 Nov 2026)

Every ground is pure white `#FFFFFF`: page (`--app-bg`), surface, sunken,
soft panel, rail, module panel, top bar, list header row and page heading
band, in every app and in Books. No grey, cream or tinted ground anywhere.
`#F7F7F7` is hover feedback only · hairline `#E5E5E5` (`--border`) · field
border `#D6D6D6` · strong rule `#C8C8C8` · ink `#1C1B18` (`--fg`) · muted
`#5C5A54` (`--fg-muted`) · subtle `#6E6B64` (`--fg-subtle`). `#8A877F` is
decoration only, never information. Colour on a screen is the one primary
button, links, "you are here", status pills, and the app glyph.

### No dark theme

Light only. `useTheme` pins `data-theme='light'`; `rnd.css` has no dark block
and a test (`test/palette.test.js`) fails if one comes back.

### Gate pages

Every stop between the door and the app (two-factor setup, a company you
cannot open, first company setup, a suspended account, an ended sample link)
uses `packages/shell/GatePage.jsx`: white ground, a 64px bar with the logo and
who is signed in with Sign out, one centred column (34rem, 46rem for a choice
of cards), a 44px icon tile, the title in the brand face, then the content,
and the legal links at the foot. Steps in a gate are `GateStep`: numbered,
done in ink, the current one open. The gate's primary is CLOR orange whatever
app was open last.

### Status — pills 24px high with a 6px dot

| State | Text | Background |
|---|---|---|
| Good / paid / approved | `#166534` | `#E6F1E9` |
| Attention / pending | `#8A5A00` | `#FBF1DC` |
| Problem / overdue | `#B42318` | `#FCEBE9` |
| Neutral | `#5C5A54` | `#EEECE7` |
| Info (banner only) | `#1D4ED8` | `#EBF1FF` |

### Charts and categories

Charts are ink and semantics: series differ by shape, dash and direct labels;
past three series, ink at 100 / 55 / 25% then dashed. The categorical palette
(`--cat-1..8`) and leave-type colours (`--leave-*`) stay only where a colour
names a category that is also written out (leave types, departments in a
legend), never as decoration.

## Spacing
- **Base:** 8px.
- **Density:** comfortable-dense.
- **Rhythm — two values in force, a third only intended:** 12 inside a group
  (`space-y-3`, 62 uses), 24 between groups (`space-y-6`, 129 uses).
  - **Page blocks are 24** (`space-y-6`), enforced on every screen root;
    **12 on People's screens** (2026-10-28, Sky palette only). Before
    2026-09-08 the product used 16 in 43 screens and 20 in 20 more — two values
    on no scale here — so opening one page after another shifted the layout for
    no reason a reader could name.
  - **40 between page sections (`space-y-10`) is written down and never used —
    zero occurrences.** It is an intention, not a rule the code follows. Either
    adopt it deliberately on screens that have distinct sections, or drop it
    from this document; do not cite it as an existing standard.
  - **16 (`space-y-4`) is legacy and still present inside cards and forms**,
    114 uses. It is off the 8-base scale and should migrate to 12 — but that
    tightens every form it touches, so it wants a screen-by-screen visual pass,
    not a codemod. Counted 2026-09-17; do not bulk-replace.

### Row and control height — measured, not assumed

Two table contexts, not one. An audit that quotes a single row height is
reading an older version of this file.

| Context | Row | Control |
| --- | --- | --- |
| List / data table (`.ui-table`), People and Attendance | **48px** with its hairline (5.5px cell padding, a name over an email fits; 8 Nov 2026) | 40px; 44px on a phone |
| List / data table (`.ui-table`), Accounting and Payroll | **55px** (9px cell padding) | 36px |
| Dense line grid (`.ui-grid-dense`) | **40px** (1px cell padding) | **34px** |

Header rows: 37px on a list, 29px on a dense grid. The control tiers those
numbers refer to are defined once under *Controls → Height*.

## Layout
- **Approach:** grid-disciplined.
- **Shell (R&D, 14 Nov 2026; rail names 16 Nov; full-width bar with the CLOR logo and the rail under it, no symbol tile, 17 Nov — see Decisions Log):** an 80px white rail (CLOR symbol tile 36px until 17 Nov,
  each module its 24px icon with its name under it in 11px, two lines at most, the active one on `--tint`
  with a 3px `--marker` bar on its left edge), then a 200px second panel (232px until 16 Nov) on
  `--panel` that scrolls on its own (16/600 title, 12px group
  labels, 36px items with 16px Lucide icons; the active item white with a
  `--panel-border` ring and a 3px `--marker` inset), then a 64px top bar (36px
  search on sunken with ⌘K, company switcher, bell, avatar). Rail and panel run
  the window's full height; the bar sits beside them. Content: 32px padding,
  max width 1280, 32px gap. Ops adds a 32px staff bar above everything in
  `--act` with a white Staff pill; it cannot be hidden. Ops wears the same frame
  (17 Nov 2026): the bar with the CLOR logo and "Ops" full width under the staff
  bar, an 80px rail of five sections (emoji icon, name under it), a 200px white
  panel listing the open section's pages only, the sidebars' blue hover and green
  open item; lists are one bordered sheet with 48px rows and sentence-case column
  names; figure tiles carry no coloured bar or per-tile hue. On a phone the panel
  is a sheet (in Ops it lists every page) and a tab bar sits below.
- **Icons:** Fluent Emoji (flat) for navigation (`@ui/components/ui/navEmoji`);
  Lucide line icons for controls (search, bell, chevrons, close, more, add).
- **Components:** buttons 36px high, 16px sides, 8px radius, 14/600, 16px icon
  with 8px gap; primary on `--act` with white, secondary white with a
  field-border outline. Table header 40px, sunken, 8px radius, 12px/600
  uppercase, 16px sides; rows at least 56px (border-box), 1px top hairline.
  Cards 12px radius, 1px field border, no shadow, 16–24px padding. KPI tile:
  36px tinted icon chip, 12px uppercase label, 28/36 bold tabular number, delta
  pill coloured by meaning, 3px top accent in the identity colour. Seat meter:
  8px sunken track, app-colour fill, value turns amber/red with a "Near limit"
  / "Over limit" pill. Spacing on an 8px grid.
- **Breakpoints are read against the window, the panels are laid out in what
  is left of it.** A row of three panels sized at `xl` (1280) is really sharing
  1040px once the rail is taken off, which is how a five-column table ended up
  in a 383px panel. A three-up row comes at `xl` only when every panel still
  keeps 15rem in what the breakpoint leaves beside the rail (the page padding
  and the overview's own padding taken off too); otherwise it waits for `2xl`.
  `test/overview-breakpoints.test.js` pins the arithmetic. *(Was "three-up rows
  wait for `2xl`"; changed 2026-10-30 to match the running-book Home, pending
  owner approval — see the decisions log.)*
- **Radius — two, not four:** 8px (`rounded-lg`) on anything clickable, 12px
  (`rounded-xl`) on anything holding content. `999px` (`rounded-full`) for
  pills and status labels only.
  - **One documented exception: the keycap, 6px.** A key is 22–28px tall; at
    8px the corner is a third of the height and the cap reads as a lozenge
    rather than a key. It also sets 11px type, below the 12px floor, for the
    same reason — a keycap is a glyph of a physical object, not running text.
    `.ui-kbd` is the canonical one. Two call sites still open-code it with
    `rounded-md` (the shortcut sheet's `<kbd>`, the ⌘K hint in the dashboard
    search); both are annotated in place and should converge on `.ui-kbd`, but
    their heights differ from it so that is a visual change, not a rename.
    Every other `rounded-md` was drift and is gone — a third is drift.
- **No card-in-card.** A list is the page: one hairline, no wrapper. A document is a discrete object: it earns a surface.

### Elevation — three tiers, and they mean different things

Shadow is not decoration here; it says how far a surface is from the page.
Three tokens, never restyled per screen.

| Token | Reads as | Applied to |
| --- | --- | --- |
| `--shadow-card` | Resting on the page | `.ui-card`, `.ui-stat`, `.ui-strip` — a hairline plus barely a shadow |
| `--shadow-pop` | Floating over the page | `.ui-popover`, `[role="menu"]`, the command palette, every open menu |
| `--shadow-lift` | Being picked up | `.ui-lift:hover` only — a card that is itself clickable |

Rules that come out of that:

- **A lift promises interactivity.** `.ui-lift` is opt-in and never goes on a
  plain content card. If it rises on hover, clicking it must do something.
- **The hover lift is gated** behind `@media (hover: hover) and (pointer: fine)` —
  on a touch screen there is no hover, and a sticky lifted state reads as broken.
- **Anything popped over a card takes the raised surface, not just a shadow.**
  `.ui-in-pop` (and `[role="menu"].ui-card`) switch to `--surface-raised`.
  Both resolve to white today; the class keeps the intent if a ground moves.
- **Shadows are token-only.** No `shadow-lg` or any Tailwind shadow utility in
  app chrome — a hard-coded shadow does not follow the tokens.

### Responsive behaviour — three layout classes

The product is desktop-first and stays usable from **911px to 3840px**; that
band is measured, with no page-level horizontal scroll anywhere in it. Browser
zoom is the same thing as a narrower window — 1366 at 125% is 1093 CSS px — so
the zoom levels are covered by the width band rather than tested separately.

| Class | Behaviour |
| --- | --- |
| **Dashboard / overview** | Panel rows collapse by breakpoint. Two-up rows at `xl`; three-up rows at `xl` only when each panel keeps 15rem beside the rail, else `2xl` (see *Layout*; pending owner approval). Below that they stack full width |
| **List / data table** | The page never scrolls sideways; the table scrolls inside its own `.ui-table-scroll`. A wide table scrolling in its container is correct, not a defect |
| **Document form** | The head grid reflows by column count (`sm:grid-cols-2 lg:grid-cols-3`, or a 12-column grid). The line grid does not reflow — it scrolls, because a line item read as stacked fields is not a line item |

Fixed points across the whole band:

- Content caps at **1920px** and centres beyond it. It does not keep growing.
- Page padding is **24px**, dropping to 16px below `sm`.
- Control heights change once: People and Attendance controls are 40px, and 44px
  under 768px where a thumb hits them. Accounting and Payroll stay 36px at every width.
- **A table that scrolls inside its container is not a defect. A page that
  scrolls sideways is.** Those are the two different results, and only the
  second one is a bug.


## Controls

### Height — one baseline, one compact tier, four named exceptions

| Tier | Height | Where |
| --- | --- | --- |
| Baseline, People and Attendance | **40px**; **44px** under 768px | Every button, input, select, search field, icon button and filter chip (`.ui-choice-chip`) in the work area and in dialogs (UI rules, 8 Nov 2026; `people.css`, end of file) |
| Baseline, Accounting and Payroll | **36px** | Every input, select and button in app chrome |
| Compact | **28px** | `.ui-ctl-compact`, `.ui-btn-sm` — column filters and in-table editors, where 36 will not fit |
| Dense grid | **34px** | `.ui-grid-dense .ui-input` / `.ui-select` — the line grid only |

Accounting's baseline is **36**: it was measured before the 8 Nov rules and is
left as it is until its own pass. People and Attendance moved to 40 with the
owner's UI rules; compact (28px) and the dense grid (34px) keep their sizes there.
An override that merely restates the baseline (`!h-9`) is noise and
`src/test/control-geometry.test.js` fails on it.

Four exceptions, each deliberate:

- **`.ui-icon-btn` is 36px, and 28px only inside `.ui-table tbody`.** A second
  rule at higher specificity. So `!h-9` on an icon button *inside* a table is a
  real decision; outside one it says nothing.
- **28px in-field actions.** A mark sitting inside a 36px input: at 36 it fills
  the field edge to edge.
- **44px POS primary** (`!h-11`, the checkout button) — a touch target on a
  counter, used at arm's length.
- **28px POS steppers** (`!h-7 !w-7`) — quantity ± beside a cart line.

### Icons — two roles (owner, 15 Nov 2026)

- **Navigation draws in Fluent Emoji (flat).** Books' screens panel too: one emoji per
  screen key in `apps/accounting/src/navPanelEmoji.js` (owner, 16 Nov 2026). Rails, module panels, Settings
  rows, the command palette and Books' rail modules use full-colour emoji from
  `@ui/components/ui/navEmoji` (Lucide names kept, so a manifest swaps one
  import) or `emoji('name')` from `@ui/components/ui/emoji`. The SVGs are local:
  `node scripts/build-emoji-icons.mjs` writes `fluentEmoji.data.js` from
  `@iconify-json/fluent-emoji-flat` with only the names in use (no runtime
  fetch; Microsoft, MIT). Pick a colourful emoji for a rail: the grey ones
  (page, cart, knobs) read faint on white. Rows in one panel or Settings group
  never share an emoji.
- **Everything else stays Lucide line icons:** small controls (chevrons, close,
  check, sort, filter, more), buttons, in-page actions, and each app's identity
  mark on its colour tile. An emoji set has no such glyphs. Import from
  `lucide-react` or `@ui/components/ui/lineIcons`. The Fluent line set,
  Phosphor two-tone marks and Fluent Color icons stay retired.
- **Stroke 1.75, round caps**, from one rule on `svg.lucide` in `index.css`;
  never filled, never duotone, never two colours. Illustrations and chart
  marks keep their own strokes.
- **Sizes 14 / 16 / 18.** 16 is the default; 14 inline with 13px text or in a
  28px control; 18 in the rail, the phone tab bar and dialog headers; 20 only
  in an empty state. 12 and 15 retire.
- **One concept, one glyph:** invoice `file-text`, bill `receipt`, payment
  `arrow-up-right` (out) / `arrow-down-left` (in), journal `book-open`, pay
  run `banknote`, payslip `scroll-text`, employee `user-round`, punch `clock`,
  leave `calendar-days`, device `fingerprint`, import `upload`, export
  `download`, approval `check-check`, attention `triangle-alert`.
- Icon alone only with a tooltip and an `aria-label`; no icon-only destructive
  action. Never tint an icon with an app hue outside the app mark, and never
  colour an icon for a status the pill already shows.

### Layers

Sixteen z-index values were in use, ending at `z-[9999]`. Measured in the
browser: a row-action menu at 9999 painted **over an open dialog**. It never
needed 9999 — the shell creates no stacking context, so a fixed overlay
competes in the root context and only had to clear a sticky table header at 20.
9999 is what a number becomes when there is no scale to consult.

| Token | Value | Layer |
| --- | --- | --- |
| `--z-below` | −1 | decoration painted behind content |
| `--z-base` | 1 | in-flow lifts — a table head against its rows |
| `--z-sticky` | 20 | sticky table headers and toolbars |
| `--z-header` | 40 | the app header |
| `--z-popover` | 60 | menus, dropdowns, pickers, **row actions** |
| `--z-drawer` | 100 | side drawers, the mobile nav (panel at 101) |
| `--z-modal` | 120 | dialogs |
| `--z-modal-popover` | 130 | a menu opened **inside** a dialog |
| `--z-toast` | 140 | notifications outrank what caused them |
| `--z-palette` | 160 | the command palette reaches over everything |
| `--z-tooltip` | 180 | last word, and never interactive |

The order is the rule; the integers are spaced only so a tier can be inserted
without renumbering.

**The two popover layers are the point.** A popover belonging to an open dialog
must sit above that dialog; an unrelated popover on the page behind it must sit
below. Same component, two answers — so `Modal` publishes its layer through
React context and `Popover` reads it. The DOM cannot answer this, because every
overlay portals to `body` and a popover's ancestors say nothing about what
opened it.

**Never write an arbitrary z-index.** `z-[9999]`, `z-[200]`, `z-[125]` are all
gone. A bracketed z-index at or above the drawer tier fails
`src/test/layers-are-ordered.test.js`. A small local `z-10`/`z-30` inside an
already-layered ancestor is fine — it orders siblings inside that ancestor's
context and cannot escape it.

**A third-party overlay joins the scale explicitly or it is outside it.**
Sonner's `Toaster` takes `style={{ zIndex: 'var(--z-toast)' }}` because Sonner
otherwise injects its own `z-index: 999999999` and would paint over the command
palette — the prop is the wiring, not a redundancy to tidy away.

**Before raising a z-index, check the stacking context.** A number cannot lift
an element out of an ancestor that has `transform`, `filter`, `backdrop-filter`,
`contain: paint`, `isolation` or its own positioned z-index. If an overlay is
trapped, portal it — do not escalate.

### Content width — measured, and smaller than it looked

An audit counted 69 `max-w-*` uses across master-data files and read them as
page-width drift. Measuring the rendered pages says otherwise: **document forms,
master forms, lists, dashboards and reports carry no page-level `max-w` at all.**
They use the full content column, which the shell already caps at 1920px and
centres beyond that.

So there are two page-width behaviours in force, not four roles:

| Behaviour | Applies to | Implementation |
| --- | --- | --- |
| **Full content column** | documents, master forms, lists, dashboards, reports | no page-level `max-w`; the shell's 1920px cap governs |
| **Compact** | settings and configuration pages | a page-level `max-w-2xl` (672px) |

The rest of the `max-w-*` values are **inner measure**, not page width: a
paragraph held to `[46ch]`, a totals block at `w-80`, a sub-panel at `max-w-lg`.
Those are correct and should stay per-component.

**A wide page is not a wide field.** Page width and field width are separate
systems: the form grid's column spans decide how wide an input is, and a date
stays a date on a 1920px screen. See *Controls → Value alignment* and the line
grid rules.


### Select

A select draws its own indicator: `appearance: none`, a chevron as an inline
SVG background, 36px of trailing room reserved for a 16px mark, and
`text-overflow: ellipsis` so a long value truncates rather than running under
it.

**This belongs to `.ui-select` alone, never to the shared `.ui-input` block.**
Putting it there once gave every text input in the product a chevron.

### Value alignment

A figure is aligned by what it *is*, not by being a number. Named once, in
`.ui-val-left` / `.ui-val-center` / `.ui-val-right`, so it is not re-decided at
each call site.

| Kind | Alignment |
| --- | --- |
| Financial table column | **right** — a column is compared down its decimal |
| Financial summary / totals | **right** — it lines up with the column above it |
| Standalone monetary input | **centred** — one field is not a column, and a lone figure pinned right reads as a stray |
| Compact numeric entry | **centred** where the field is narrow enough that right-alignment crowds the edge |
| Text and entity fields | **left** |

A centred amount keeps its currency symbol with the number rather than pinning
it to the left edge — `.ui-money-centred` groups the two so they centre as one
thing.

**Do not reintroduce `text-right` on every money input.** That is the change
this table exists to prevent.

### Text fields suggest what already exists

Every free-text field offers matching values the company already has, on focus
and while typing: cities, relationships, the work-email domain, the branch a
work site sits at, reasons used before, names already on people's records. Use
`SuggestInput` (`packages/ui/src/components/ui/SuggestInput.jsx`), never a
native `<datalist>`. The list sits under the field and the caret stays in it;
↓/↑ move, Enter takes a row only after the arrows were used, Escape closes.
Typing stays free. A suggestion is offered, never forced.

What is never suggested: one person's private details to anyone else (phones,
personal emails, government IDs, home addresses, bank details), and anything
from private cases or help-desk tickets. Free reasons are offered only once a
phrase has been used at least twice. A name that already exists in the list
being added to is said plainly ("already in the list"), not offered.

## Buttons

Two separate ideas, and a review checks both:

- **Priority** is how much a button matters on its screen: *primary* (the one
  thing the screen is for), *secondary* (things you also do here), *tertiary*
  (ways out and small things on a row).
- **Appearance** is how it looks. Priority picks the appearance, but the two are
  not the same word: a secondary action can be outlined or soft, a tertiary one
  is usually ghost.

### Five appearances

| Appearance | Class | Looks | Used for |
| --- | --- | --- | --- |
| Primary | `.ui-btn-primary` (`.ui-btn-brand` is the same on brand surfaces) | Filled, the app's action colour (red) | One per screen, top right. Also the Continue / Next of a stepped form |
| Secondary | `.ui-btn-secondary` | Outlined on the surface | Preview, Export, Download, Print |
| Soft | `.ui-btn-soft` | Tinted, no hard edge | Quiet additive actions: Add row, Add another |
| Ghost | `.ui-btn-ghost` | No fill until hovered | Cancel, Back, View details, row actions |
| Danger | `.ui-btn-danger` | Filled red | Delete, Withdraw |

There is no sixth. **Icon-only is a size of ghost, not a type**
(`.ui-icon-btn`): it always has an accessible name (`aria-label`), and a 44px
tap area on phones even when the glyph is smaller.

Sizes: **40px** baseline in People and Attendance (36px in Accounting and Payroll), **28px** compact (`.ui-btn-sm`, in tables and
toolbars where 36 will not fit), and **44px on phones** as the target for
every button a thumb has to hit. Where it is enforced today: in People (sky
palette, under 768px) every `.ui-btn`, `.ui-btn-sm` and page button in the work
area and in drawers and dialogs (`people.css`, "The base button rule fixes its
height"); in the other apps, inside any screen that opts in with
`.ui-touch-44` (under 768px; Payroll's pay runs, salary slips, final
settlements and the employee app's money screens so far) and the stepped-form
actions (`.ui-wizard-actions`, under 640px). Elsewhere it is a target, not yet
a rule. Radius **8px**. People's brand D draws its buttons as pills
(2026-10-28); that is the one exception and it stays inside the sky palette.

### Icons in buttons

An icon in a button takes the button's text colour. The People marigold
icons (31 Oct 2026) are retired with the per-app palettes.

### States

| State | How it shows |
| --- | --- |
| Default | The appearance above |
| Hover | One step deeper (fill) or a sunken tint (outlined, soft, ghost) |
| Pressed | A slight press (scale or 1px down); released faster than pressed |
| Keyboard focus | The one shared focus ring, never a per-button outline |
| Disabled | Faded, not clickable. When the reason is not obvious, say it nearby (a caption or a `title`), never leave the person guessing |
| Loading | `aria-busy="true"`: a small spinner where the icon was (over the label when there is none), same width, clicks ignored, label still read out. Not the disabled look. Reduced motion: it breathes instead of turning |
| Success | `data-state="done"`: a tick and one word ("Saved", "Added") for about 1.5s, then back. Used sparingly, where no toast fires; **the toast is the main success signal** |
| Error | Not on the button. The field says what is wrong, or a message near the form does; the button goes back to default |

Use the shared helper, `Button` in `Primitives.jsx`: `loading` sets
`aria-busy`, draws the spinner and refuses a second submit; `done` (with
`useDoneFlash()`) draws the success state. Do not swap the label for
"Saving…": the button changes width and the row beside it jumps. A plain
`<button class="ui-btn" aria-busy="true">` gets the same look from the CSS
when the helper cannot be used.

### Ask first

Destructive and hard-to-undo actions open the shared confirm dialog
(`confirmDialog`) before they run, and its button names the action:
**Run payroll / approve a pay run, Mark paid, Delete, Withdraw a leaving,
Cancel a run.** The dialog's confirm button is danger by default (`tone`);
pass `tone: 'primary'` when the action is hard to undo but not destructive,
such as approving a pay run.

### No floating action button

A floating "+" in a corner is a second primary action and breaks "one primary
action, top right". CLOR does not use one. A phone-only "+" that *replaces* the
top-right primary would need the owner's approval first.

## Motion
- **Approach:** minimal-functional.
- **Duration:** 120ms state, 200ms surface.
- **No entrance animation on list rows.** Data should be there when you look.
- Respect `prefers-reduced-motion`.

## Component Contract
Five primitives. A new module picks archetypes; it does not make layout decisions.

| Primitive | Owns | A module may change |
|-----------|------|---------------------|
| `PageShell` | Title, subtitle, one primary action, secondary actions, padding | The words and the action |
| `DataTable` | Header row, filter caret, density, hover, empty, skeleton, bulk bar, export | Columns and extractors |
| `DocumentView` | Sheet, party block, line table, totals rail, print / download / share | Document kind, line shape |
| `EntryForm` | Identity strip, party field, line grid, totals rail, footer actions | Fields and validation |
| `SettingsPanel` | Grouped toggles, descriptions, save behaviour | Which settings exist |

Rules that hold across every module:
1. One primary action per screen, top right.
2. Voucher number and date sit right of the page title on entry forms.
3. Print / Download / Share, in that order, above a document — never inside it.
4. Every amount is set with tabular figures. Where it is *aligned* depends on
   what kind of thing it is — see *Value alignment* below. A column of figures
   is right-aligned; a lone amount field is not a column.
5. Status is a pill; severity is carried by color *and* text, never color alone.
6. A status hue is a **background**, never type. Pills and filter tabs keep grey
   text on a pale tint; the word carries the meaning and the tint places it.
7. Detail panels state a value in grey at normal weight. A view page is read,
   not scanned for exceptions, so nothing in it is emphasised over anything
   else.

## Audit Baseline (2026-08-24)
Measured across `src/`. Migration is done when these reach zero.

| Finding | Count |
|---------|-------|
| `text-xs` / `text-sm` share of type usage | 1,857 / 2,019 |
| Copies of the same `<th>` class string | 346 |
| Hardcoded palette classes in app chrome | 9 → 0 (fixed 2026-08-24) |
| Hardcoded palette classes in print documents | 298 — correct, see note |
| Competing radii (`lg` 323, `xl` 149, `full` 31, `md` 11) | 4 |
| Pages using `PageHeader` vs raw heading | 36 / 59 |

**Note on the 298.** The first audit counted 319 raw palette classes and called
them debt. That was wrong. 298 of them live in `InvoicePreview.jsx`, the invoice
template renderer in `App.jsx`, and `ExpenseVoucher.jsx` — printed documents,
which are black on white in both themes because that is what comes out of a
printer. Only 9 were real, in app chrome, and those are now tokens. Print
surfaces are deliberately exempt from the token rule.

## Screen Contract

What "done" means for a screen, derived from the Sales Invoice rebuild. Every screen
gets checked against this list; a screen that fails any line is not finished.

**Both archetypes**
1. **Shell.** A list or report uses `PageHeader`. A document uses `DocFormActions` —
   title left; Back, secondary, primary and the ⋮ menu right, pinned while scrolling.
2. **A way back.** Any screen reached *from* another screen carries a Back control that
   returns to where it was opened from, not to a fixed home.
3. **One primary action**, top right. Everything else is secondary or lives in ⋮.
4. **Tokens only.** No `bg-*`/`text-*`/`border-*` palette literals in app chrome; print
   surfaces are the documented exception. Contrast is measured with alpha composited,
   never eyeballed.
5. **Fields carry no local sizing.** `.ui-input` / `.ui-select` own their padding and
   height. A `px-3 py-2` beside them is a silent override and reads as a different
   size to the rest of the product.

**Documents additionally**
6. **Head in two columns**, ruled apart: who and where on the left, the paperwork —
   number, dates, references — on the right.
7. **Line grid** at `.ui-grid-dense`: 40px rows, 34px controls (see *Row and
   control height*), column widths sized to what the column holds, figures
   tabular and right-aligned, no spin buttons. Header text, field text and
   plain cell text all start on one inset — the control is pulled out by its
   own padding so the three agree.
8. **Keyboard.** Pickers on the shared `useListboxKeys` contract; the form on
   `useDocumentFormKeys`. Arrows move between fields and down a grid column, Tab commits
   and advances, a date field is left in one press, Alt+C creates a master in place,
   Ctrl+; enters today.
9. **One figure per job** at the foot. The same total printed three times makes a reader
   check whether the three agree.

Keyboard behaviour is covered by tests in `src/**/*.test.jsx` and runs in the CI gate,
because focus, portals and event order cannot be read off the source.

## Migration Order
1. Type ramp + spacing rhythm into `src/index.css`. Six `space-y` values to three, four radii to two.
2. ~~Remove the hardcoded palette classes.~~ Done (verified 2026-09-07) — the 9 in app
   chrome are tokens; the 329 remaining are all print surfaces and stay as they are.
3. Extract `DataTable`; retire the 346 copied header strings.
4. Force `PageShell` on all 59 raw headings.
5. Monospace money everywhere an amount displays.
6. Unwrap list pages from their card — Sales, then Purchase, then the rest.
7. Build Payroll on the primitives with no new layout code. That build proves the system holds.

## Decisions Log

- **2026-11-18 — Customers add seats themselves (owner, 17 Nov: on at once, like Claude Team and
  Microsoft 365; 14 days to pay):** Workspace, Billing & seats, Change plan shows "This plan is paid
  for N users" and **Add users** (or employees) when CLOR has it switched on and the plan is active,
  priced by the head, nothing overdue and no other addition waiting. The drawer takes a number (up to
  the cap, 20 by default), prices it live as rows of label and right-aligned tabular amount (the days
  left of this period, GST, **to pay by** the due date, and what each period costs more from the next
  renewal), and one primary button named by the count, "Add 3 users". Added, the seats work at once
  and the invoice opens to pay. While it is unpaid the panel says so with **Open the invoice**. Unpaid
  after the days to pay, that invoice is cancelled and those seats alone come off. Ops: a switch in
  Invoice settings, **off until a person turns it on**, and "Seats the customer added" on the
  Subscription tab with **Take back** (Finance, with a reason). Removing seats, apps and refunds stay
  with CLOR.

- **2026-11-17 — CLOR's invoices are emailed and reminded (owner: send, resend, remind, and automatic
  reminders):** issuing an invoice in Ops offers "Email it to …", ticked; the invoice page has Send
  again and Send reminder, each naming the recipient before it goes, and lists every email sent; the
  Overdue view shows days late and last reminded. Invoice settings has Reminders, **off until a person
  switches it on**, saying how many invoices would be reminded today first. Rule: **nothing is mailed
  to a customer without a person having asked for it, either on that invoice or by switching the
  schedule on.** Members also shows who signs in with an authenticator and when they last did; the
  rule itself stays owners and administrators only (owner, same day).
- **2026-11-17 — Easy access, batch 2:** *Ops:* Overview opens on "Needs you today", a list of the
  things themselves (trials ending in 7 days, overdue invoices, tickets urgent or not taken, approvals
  waiting, failed payments), five a group, each row opening the thing and "See all" opening its list
  filtered; it sits above the services table. An account's Invoices and payments tab lists its
  invoices, and its header says what is unpaid. A ticket shows the customer beside the reply: plan,
  apps, unpaid invoices, other open tickets. Trials are sorted soonest to end and paged. Approvals has
  a menu count. *Workspace:* a person's panel on Members opens them in Company users to change a role
  or mark them as left. Rule: **on a summary page, what needs a person comes before how the system is
  doing.**
- **2026-11-17 — Easy access, batch 1 (owner: "info should be available right away instead of searching"):**
  from an audit of Workspace and Ops. *Workspace:* search finds members, companies and settings by the
  words people use (`searchRecords`, `searchActions`, `searchLabel` in the manifest); an invitation
  carries a starting role in the open company; a link opens a list already filtered (Home's line about
  administrators opens Members on those people) or one record; an account role change asks first; the
  Security rail opens its overview; "Sessions" is "Sign-in rules"; Permissions has no menu line (it is
  the Roles grid); breadcrumbs name the rail's own sections. *Ops:* menu counts are work waiting
  (tickets, demo requests, alerts), not totals; crumbs and copy use the rail's section names; "Convert"
  on Trials is "Set up paid plan" and opens the account's Subscription tab instead of granting a free
  plan; the account header says when the trial ends or the plan renews; a payment row opens its account.
  Rule from now on: **a count in a menu is something to do; a link from a summary opens the list
  filtered to what the summary said.**
- **2026-11-17 — Workspace Home says each thing once (owner: "rework Home"):** what needs attention
  and the setup steps sit directly under the greeting. One row of four figures (companies, apps,
  members, waiting); the greeting line keeps the account's name and role only, and no card repeats a
  count. The team ring and bars are drawn from three people up. Quick actions are the three jobs the
  rail does not name; Help is the help centre and a person to ask, in the same rows. One icon square
  on the page: 40px, 8px corners, 22px icon in a 56px row. The setup bar is one solid colour.
- **2026-11-17 — Bar menus on base-ui:** the app switcher, the company menu and the help menu were a
  `div role="menu"` that ignored the arrow keys. They are now `@base-ui/react` menus through
  `@ui/components/ui/Menu` (`.ui-menu`: a 12px sheet of 8px rows, the hover blue under the pointer or
  the arrow keys, 44px rows on a phone); the notifications panel is a base-ui popover. New menus use
  this wrapper. `Modal`, `Drawer` and `Popover` stay hand-built for now: a base-ui modal makes the rest
  of the page inert, so they move together or not at all.
- **2026-11-17 — Ops console on the platform frame (ui-ux-pro-max audit; not yet
  seen by the owner):** ops.clor.in still wore the 14 Nov frame: a 64px icon-only
  rail with a CLOR tile, no logo bar, a 232px panel scrolling through all 33
  pages, small capitals over groups, columns and figures, a coloured bar on each
  figure tile, list headers floating as rounded bars, and hovers drawn white on
  white. It now follows the Layout section: staff bar, full-width bar with the
  CLOR logo and "Ops", 80px rail with section names and Fluent Emoji, 200px panel
  with the open section's pages only, one-sheet lists with 48px rows, sentence-case
  labels, neutral figure tiles coloured only by state, 20px page rhythm. The
  "ops.clor.in" chip and the panel's "Internal" tag are gone (the staff bar
  already says both). The stop before the console (authenticator setup, not
  staff) is a `GatePage`. Keyboard: skip link, focus moves to the page on
  navigation, Escape closes the phone menu, `scroll-padding-top` clears the two
  sticky bars; phone menu rows are 44px. **Ops colour (owner, 17 Nov 2026):
  orange stays.** Ops keeps the default accent (`--act` #C95000); the 14 Nov
  forest does not come back.
- **2026-11-16 — Books under the one platform bar (owner: "match Books"):**
  Books drew a second bar (company, search, year, profile) under the platform bar
  and a rail that began under both, so the company name showed twice and the
  bar read unlike every other app. Now Books' search, year and profile menu
  render into the platform bar (Shell slots `#ui-topbar-app-start` /
  `#ui-topbar-app-end`), its own company name is dropped unless a company keeps
  more than one set of books, and its rail runs the full window height at 80px
  with the CLOR tile on top (280px with a module open), as the split rail does
  elsewhere. Rendered on its own, Books still draws its own bar.
- **2026-11-16 — Workspace Overview, decorative and informative (owner):**
  "background glassy white … sidebar add module names, and hero card … welcome
  add user name and some smileys … dashboard more decorative and informative
  with data colours accent, keeping primary graphite". The Overview
  (`apps/admin/src/screens/AdminHome.jsx`, `ws-overview.css`) gets an edge-to-edge hero
  band (top bar to both sides, hairline under it, words aligned with the cards) ("Welcome to CLOR Workspace", a greeting by first name, Fluent Emoji faces
  on glass tiles around a drawn laptop dashboard, motion off under reduced-motion),
  figure tiles washed in the `--cat-*` palette, a Team and access card (members
  ring, people in each app; no app tiles, the Apps module owns those), quick actions
  as a vertical list heading a 320px right column (with activity, security, help), a company card with setup
  progress, and an activity timeline. Cards there are glassy white (white at
  78%, blurred) over a faint wash high on the page; the ground stays white and
  graphite stays the only button colour. The exception is this page only.
  Every split rail now shows module names under the icons (80px rail).
  Same day: the Workspace bar matches every app (app switcher, search, company,
  bell, Help; no date or trial line, the trial is in Needs your attention), and
  orange on the Overview is kept to small marks.
  17 Nov: the figure tiles and Quick actions lost their per-tile `--cat-*` hues
  (six hues that meant nothing, and a red tile with nothing wrong). They take one
  faint graphite wash; a tile is coloured only for a state: amber or red when
  something is urgent, green when setup is done. The emoji carry the colour;
  charts (the members ring, per-app bars) keep theirs.
  Same day, the shell (every app, Books included): the bar runs the full width
  with the CLOR logo (mark and wordmark) at its head, and the rail and screens
  panel start under it; the rail's symbol tile is gone. This replaces the
  14 Nov full-height rail with the bar stepping aside. On the Overview, a
  "Your apps" row (each built app, its state, one action) sits under the
  figures, one compact line per app. The hero's card is "Today": how the
  business stands today in each app the reader can open, from that app's own
  overview (who is in, headcount, this month's payroll); it replaced a "Next for
  you" card that repeated Needs your attention. With no app that reports a day
  the card is not drawn. Beside it, where the page is wide enough, a picture
  drawn from the account itself: the CLOR mark with the apps around it, each in
  its own colour, a solid line when on and a dashed one when off (the laptop
  drawing is gone). Cards are solid white on the white ground and the page has
  no wash outside the hero ("cards colors are not matching with background");
  hover inside a card is a faint orange tint, not the shell's grey. Secondary
  text on this page is a step darker and weight 500, and the sidebar's module
  names, captions and items are darker and firmer in every app ("fonts are very
  light").
  Later the same day: the picture always shows CLOR's six apps round the mark,
  a live app sending moving dashes down its line; the Today card and the bar's
  logo are smaller (wordmark 17px); and graphite leads the page's accents
  (count badge, progress bars, members ring, hovers), with orange kept for the
  CLOR mark and the underline under the reader's name ("as primary graphite,
  many things color accent not adding up with white background").
  Last word that day on colour: all-graphite accents "look dull". Graphite stays
  the primary; beside it the Overview has three accent hues and no more (blue
  `--cat-1`, the brand's orange, green `--cat-3`) as soft chips behind icons, the
  members ring, the count badge and the progress bar, never as a whole card.
  The rail (first sidebar) is a light cool grey `#F6F7F9` in every app and
  the screens panel beside it is white (the grey was on the panel first; owner:
  "instead of second sidebar, add background color to first sidebar"; a tint
  of the app's colour was tried and came out orange: "do not add orange
  background"). The panel ends in one short help row where a short list left
  the column empty. No orange wash anywhere: the hero's wash is faint blue and green.
  The bar's menus stay white (a dark graphite version was tried and withdrawn);
  the app menu shows each app's mark in its own colour and marks the open app.
  The search and company fields carry a colour icon (Fluent Emoji magnifying
  glass and office building). Hover and the open item in the rail, the screens
  panel and the app menu are a soft blue (`--hover-blue` #2A78D6 at 10% and 14%),
  not grey ("when cursor moves with any option it's grey now, I want different
  color").
  On the Overview each card's headline carries a colour icon, and the Help and
  support rows carry the same icon chips as Quick actions. Fluent Emoji icons
  are drawn a step richer everywhere (`saturate(1.35) contrast(1.18)`): the flat
  set's pale greys washed out on white ("increase icons contrast").
  Workspace → Home's pages (Activity, Inbox, Help and support, Companies,
  Branches, Company profile) follow the Overview: no caption under the title,
  the page's own colour icon beside it, Activity's search and filters on one
  row, shorter empty states with a colour icon. The bar's search field is
  340px (it opens the palette; it is not typed into).
  Workspace pages sit in one frame, not two: the shell's 32px content padding
  only (the Workspace's own 32px inside it is gone from tablet width up).
  Workspace list tables: the header row reads `--list-head`, which the
  Workspace sets to a clearer soft blue `217 231 248` (grey was tried: "change
  color accent"); ink captions; 48px rows; cells top-aligned so the first line
  of every cell in a row sits on one line ("proper alignment"). Pages keep
  20px between their parts, no rule under the header, and on Companies and
  Branches the search and count sit on the title's row beside the buttons.
  The open (selected) item in the rail, the screens panel and the app menu is a
  soft green (`--select-green` #1BAF7A at 14–16%), a different hue from the blue
  hover ("add different color for selection color").
  The Branches list is the pattern for every Workspace list ("branch data
  tables are perfect, apply it to other pages"): one bordered white sheet,
  header row edge to edge, cells top-aligned on one text line, counts
  left-aligned under their heading, pills, tags, app marks and row buttons level
  with the text. No Workspace page draws a caption under its title (the
  one-line purpose is kept for screen readers).
  After the 17 Nov release (#288), same day: every Workspace page wears its menu
  item's colour icon beside its title (set once in the manifest); the
  Workspace's "People & access" module is "Users & access" (People is an app's
  name); the bar keeps the columns under it (logo over the 80px rail, app
  switch over the 192px screens panel, search beside the content's edge), with
  a smaller logo (13px) and a 32px app switch; figure cards on list pages are
  one short row with a colour chip (blue, green, violet, orange in turn) and
  filter fields are 32px; Apps is three compact cards across; in Activity the
  kind of change is plain past-tense words ("Edited"), never a pill that reads
  as a button.
  Three design audits of the Workspace the same day (soft-skill, minimalist,
  taste v1), fixed where they agreed with this document: no `backdrop-filter`
  on scrolling content; one easing curve (`--ws-ease`); a press gives
  (`scale(0.98)`); the Workspace's blues, greens and the rail grey are named
  tokens, and the rail grey is neutral `#F7F7F7` beside warm-neutral text;
  figure cards and attention rows draw the colour emoji twin of a line icon
  (`colourIcon`), so no card mixes two icon styles; every Workspace screen
  loads as grey bars (`Loading`), says an empty list with an icon and a next
  step (`Empty`), and says a failed read where the content would be, with a
  retry (`LoadError`). Not taken from the audits: floating pill nav, section
  padding of 96px and more, scroll reveals, double-bezel cards, serif
  headings, no emoji. Violet for attention was weighed against "purple is the
  AI look" and kept.
  Touch: the compact Workspace sizes (32px fields, buttons and menu rows) are
  for a mouse. Under 768px or on any touch screen every control is 44px tall
  and every field is 16px (no iOS zoom on focus); table-row buttons keep their
  height and the row grows.

- **2026-11-15 — Per-app colours, Figtree, Fluent Emoji (owner):** "fluent
  emoji flat, workspace: Graphite, people: Magenta, payroll: deeper blue,
  attendance: amber, books: small change secondary color no red make it
  orange", and "my choice is Figtree font". Each app gets primary, selection,
  marker and second colours; the logo stays Blaze. Books goes navy with orange,
  red removed. Figtree replaces Instrument Sans everywhere. Fluent Emoji (flat)
  becomes the icon set for navigation and feature marks (next step; small
  controls such as chevrons and close stay line icons, which emoji sets lack).
  Supersedes the one-accent rule and Instrument Sans below.

- **2026-11-15 — White and light only; designed gate pages (owner):** "only
  light mode, no grey or any color pure light > white background". Every
  ground is white in every app and in Books (Books' `#FAF6F4` ground and
  `#EAF2F8` header rows go white too); the dark theme is removed. Then "design
  each page..wherever it redirects everything should look good": the
  two-factor setup, no-access, company setup, suspended and ended-link pages
  move onto one `GatePage` frame. Supersedes warm paper `#FBFAF7` below.

- **2026-11-15 — Books palette and split rail (owner):** Books leaves
  Direction D's indigo/lilac for the in-app red palette (oxblood, brand ink
  `#A50D26`, marigold, blush, `#FAF6F4` ground); indigo stays as Books' app
  identity only. List header rows and the page heading band stay pale
  blue-grey `#EAF2F8` on every list. The inline expanding rail and its
  collapse toggle are replaced by the split rail from the Books developer's
  build (module strip plus screens panel with a close X). The top bar is
  three columns (company, centred search with FY, page and avatar) so a long
  company name truncates instead of running under the search. Supersedes
  "Accounting keeps its indigo" (2026-11-03).

- **2026-11-15 — Frontend redesign (owner approved D1–D9, Books included):**
  one orange accent for every app and portal, warm paper `#FBFAF7`,
  Instrument Sans + JetBrains Mono for identifiers, identity hue in the app
  glyph only, Lucide only at stroke 1.75 and sizes 14/16/18, one nav model
  with Accounting moved into the shell, a command palette, design tests in
  CI, a posting motion. Supersedes the 14 Nov R&D brand below, the per-portal
  accents and the 9 Nov icon families. Books moves in phase 4.
- **2026-11-14 — R&D brand (owner):** the `clor-rnd` hand-off replaces the neon
  brand, People coral, Attendance amber and Plus Jakarta Sans. Graphite +
  Blaze, Sora titles + Inter, portal themes (Workspace orange ink, Ops forest,
  People moss, Attendance violet), the 64/232/64 shell. Uppercase table and
  group labels and the KPI tile's 3px top accent, banned before, are now part
  of the spec. Accounting unchanged.
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-13 | clor.in home page in bands | Owner, 13 Nov: "exact this style" after a large cloud vendor's home page. The home page is full-width bands on a pale ground `#F4F7FB`: navy hero with the invoice in three lit outlines, a white bar of in-page links that sticks (the header does not, on desktop), a search band, then each subject under a small capital label and a weight-500 heading, pill tabs, white cards with a soft edge. Display headings on clor.in are weight 500, tracking -0.025em. Colours stay CLOR's (navy header and footer, Blaze Orange primary); radii stay 8 and 12. The strip above the header is gone; its links sit in the bar. Styles in `website/src/styles/bands.css`. Inner pages (`.pg` on `<main>`) follow: a navy head under the capital label, sections alternating pale and white with no rule between, lists as white cards, a navy closing band. Colour: Blaze Orange is on every chip, tab, tint and card edge (grounds `#FFF8F3`, edges `#F8DFD0`); each product carries a bright pair (Books `#3D4FE0`/`#232A66`, Payroll `#12B5E5`/`#0079BF`, People `#FF7A66`/`#D6452C`, Attendance `#FFB627`/`#E07B00`, Projects `#22C3B3`/`#0E8F84`, Timesheet `#8A97B5`/`#4F5B78`) on its mark, cards and screens. Type: page head `--fx-t-page`, section heading `--fx-t-section`, large card title `--fx-t-lead`, card title 19px/600, labels 12px capitals. Every card says what it is (product tag, before/after, step or number); drawn screens are layered scenes (`Windows.jsx`). Art still wanted: `website/ART_BRIEF.md` |
| 2026-11-09 | The neon brand actually reaches Workspace, Payroll and Attendance; no AI art in Workspace | Owner: "color should be blaze orange nor red". PR #131 wrote the neon brand down but only the logo moved: the 3 Nov red block still set the platform defaults, so Workspace, Payroll, the operator console and the sign-in pages showed red `#C8102E` buttons on rose-tinted grounds, and Attendance's `blaze` palette was still red too. The platform default is now Blaze Orange on pure white with `#E5E7EB` hairlines and slate headings; `blaze` is Solar Amber; a new `payroll` palette is Electric Cyan. White on `#FF5400` is 3.2:1, not the 4.5:1 written before, so the button takes `#D44500` (4.5:1) and the neon stays for marks. The red block is kept only under `sky` and `indigo`, so People and Accounting are pixel-for-pixel as they were. Workspace Overview's illustrated office building was AI art, removed; the greeting stands on the white page |
| 2026-11-09 | One icon family in every app but Accounting | Owner: "use same icons which is used in people everywhere except books". Payroll, Attendance, Workspace, the shell's own pages (sign-in, company setup) and the operator console draw the way People does: menus, rails, app tiles and content marks in Phosphor two-tone (`duo()` in `@ui/components/ui/duoIcon`, `iconSet: 'duo'`), buttons and actions in Fluent Regular line icons (`lineIcons: 'fluent'`, via `@ui/components/ui/lineIcons`). The Fluent Color set (Attendance, Workspace) is retired. Each app keeps its own palette; only the icon family changed. On clor.in the People, Payroll and Attendance marks are the same Phosphor two-tone glyphs. Accounting keeps Lucide (no `iconSet` in its manifest), and Books keeps its Lucide book on clor.in |
| 2026-11-08 | People: coral primary, teal second colour, icons coloured by kind, 192px panel | Owner: primary and white background OK, "secondary colour yellow not suiting, each kind of function visually different colour, secondary sidebar reduce width, icons are not at all good". From a three-way preview the owner chose duotone icons coloured by kind and teal over slate and violet. Coral `#C93F28` is the action; teal `#0F766E` takes every marigold job (chosen view, waiting, the open module, tab line, button icons); gold leaves the chart and leave series; a warning is amber-brown, never a yellow fill. Each icon wears its kind's colour (nine kinds). The module panel goes from 216px to 192px, so People's menu calls Attendance requests "Attendance fixes". Supersedes the marigold decisions of 3 Nov and 31 Oct for People; other apps and the employee app unchanged |
| 2026-11-08 | UI rules: 48px rows, 40/44px controls, 18/16px icons, 3 chart colours, white page kept | Owner took the recommendation on the UI-rules paste. People and Attendance only: table rows 48px (was 46–49 in People, 55 in Attendance); buttons, fields, search, icon buttons and filter chips 40px, 44px under 768px (was 36); rail and menu icons 18px, button and table icons 16px; a chart three colours, the rest one grey "Other". The page stays a clean white ground with no card round a list (the paste's grey page with white cards was declined). Accounting, Payroll and printed documents unchanged |
| 2026-11-08 | Marks that read as machine-made are dropped | Owner approved decision 6 of the 8 Nov People plan. The checker (SlopCop, 14 patterns) and GPTZero scored CLOR's surfaces as machine-made. Out: the cream sign-in board with the underlined accent word *daily.* and the *ticked off before tea* line (now a white page with one plain sentence), the halftone, Attendance's *Good morning* with its animated sun (now the date), small wide-tracked capitals on column heads, eyebrows and section labels outside Accounting (now 12px sentence case), the marigold bar along the top of a waiting figure card (now the number in the waiting ink), and JetBrains Mono for numbers (now Plus Jakarta Sans with tabular figures, one face). Accounting and printed documents are unchanged |
| 2026-11-04 | People: marigold off faces, news, events and org colours | Re-review of #123: Home's Waiting for you panel was clay while Announcements and Celebrate were marigold; news and event marks cycled by index (the newest post always marigold); org cards, the org chart and the structure page each picked a department's colour their own way, so Sales was teal, marigold and green on three screens; one face in five was marigold and the record's face a marigold disc. Now Waiting for you is the marigold panel; news, events, Fun Friday and the birthday badge take violet or clay by kind; one `tintOf(name)` over four families colours a department or branch everywhere; faces hash over four washes and the record's face keeps its own. A test scans People's JSX for tints picked by index |
| 2026-11-04 | People: tints by meaning, not by position; accent teal is not lagoon | Code review of #123: figure cards, list strips and quick links took their tint from their place (`nth-child`), so marigold, kept for "look here", landed on Yearly rise and Leavers while To decide was teal, and a figure changed colour when the one beside it was hidden. Each caller now names its tint (`data-tint` / a `tint` field: teal people and structure, green done, present and joining, clay leaving, gaps and rules, violet notice, records and what is coming, marigold only what waits on you), and no People rule picks a colour by position. Department and branch cards cycle four tints, leaving marigold out. Accent teal `#0F6860` is one of those tint families for small marks; it is not the retired lagoon teal `#0E7C7B`, which was People's action and brand colour and stays retired. Faces, which take one of five washes from the name, are written down as the code does it |
| 2026-11-04 | People: a white work area, colour in the accents, a plain right panel | Owner: "except sidebars use complete white background, use more different colours along with red, yellow… make right parts very clean". Tinted figure tiles, grey trays, the neutral head row and the record's oxblood header turn white; colour moves into small marks in five families (teal, green, clay, violet, marigold) beside red; table faces keep their own hues instead of solid oxblood. The right panel drops its dividers and its grid of boxed quick links for a plain list. The module panel goes to 216px: at 200px "Attendance requests" was cut |
| 2026-11-03 | A chosen view is marigold | Owner, on People's "In use / Retired" switch (solid oxblood): "use different color like green or orange, any best in entire app". Marigold with oxblood words (6.9:1) on a warm neutral tray, through `--choice` / `--on-choice` / `--choice-tray`, read by every selected-segment rule (platform, Blaze, People's tray and segmented strips). Orange-family marigold is already the brand's second colour; red is the action and green means done, so neither fits a choice. Accounting's indigo palette unsets the tokens and is unchanged |
| 2026-11-03 | People: no hero card, a white rail, colour beside the red | Owner, after the red brand went live: "remove hero card and sidebar complete red background in people", then "only red is visible where is other colours". Home's greeting leaves its oxblood card for the white page (Add an employee the one red primary); the rail and the phone tab bar turn white with oxblood icons. The red brand had folded every wash into blush, so figures, panel heads and the module panel all read pink: figures get their own tints again (slate, green, clay, blush), panel heads and list strips go white, the module panel a warm neutral, and green returns for done and present. A leave type is never red |
| 2026-11-03 | Accounting keeps its indigo | Owner, after the red brand went live: "do not change color to accounting". Accounting opts into a shared `indigo` palette (its manifest's `palette`), which restates Direction D's tokens exactly as they were (money out red, cotton page, lilac selection); its icon and install manifest go back to their navy tile. Keyed on the palette, not the app id. The CLOR logo is the same in every app, so the palette leaves `--logo-*` alone |
| 2026-11-03 | The red brand and the owner's wordmark, in every app and on clor.in | Owner, 3 Nov: a new CLOR logo ("this latest logo i want exact curves design everything"), its blue banned ("do not use this color"), then "go with red combination" over violet, plum and graphite, and "header keep white only". The wordmark is traced from the owner's image and drawn from outlines (`clorPaths.js`), its letters oxblood (owner: "logo color do not keep red"); the C-tick is retired. Palette: red `#C8102E` acts, oxblood `#5C0A16` is the deep brand (People's rail, blocks), blush `#FBE8EA` is chosen and done, marigold `#F5A623` the dot and "waiting", ink `#1F1A1C` the text. Every top bar is white. Attendance's Blaze orange and graphite become oxblood and red. Because red is now the brand, money out is ink with a minus sign and red means only an error `#B91C1C`, always with its warning mark. Icons, favicons, manifests, the share card and the website's accent follow |
| 2026-11-03 | People: lilac module panel; every app wears the dotted CLOR mark | Owner, 3 Nov: "both sidebars same color, hard to read modules and submodules" — the indigo rail and indigo panel read as one ground. The module panel is lilac `#E9E5F4`, brand D's secondary, with indigo words (10.7:1) and the open screen a white tile with the marigold edge; the bar and rail stay deep indigo; light theme only. Owner, same day: "logo still using old" — Payroll, Attendance, Accounting, sign-in and the static icons still drew the C-tick without its marigold dot. `ClorMark` and `ClorLogo` now draw `ClorTick`, the shell drops its People-only branch, and the favicon, `logo*.svg`, `brand/*.svg` and their PNGs carry the dot (the tile icon is a cotton tick with a marigold dot on indigo, as People's). The static lockups keep their old spacing between mark and name |
| 2026-11-03 | People: one indigo for the frame and its blocks | Owner, 3 Nov: "header … colour mismatch". Home's greeting block was brand indigo `#232A66` directly under the `#1B2152` bar and beside the `#1B2152` rail: two indigos a step apart, which reads as a mistake. The greeting and the employee record's header now use `--frame` (`#1B2152`); their lilac words gain contrast (support text 9.0:1, was 7.8:1). Brand indigo stays for ink (buttons, the open tab, initials, fields on the bar). Light theme, People only |
| 2026-11-02 | People: deep indigo frame (direction A) | Owner, 2 Nov: People looked "too pale, washed out", "generic", and its spacing and hierarchy were off. The designer showed three directions on real screens (A Deep indigo, B Warm editorial, C Dense pro); the owner chose A. On the sky palette, light theme: the bar and rail `#1B2152`, the module panel `#232A66`, lilac words on them; the open screen a lilac tile with a marigold edge; Home's greeting and the record's header on indigo blocks with a marigold primary; figures on lilac, what waits on you on marigold; the head row and the tab tray lilac. **Supersedes** the Cotton rail and module panel (2026-10-29) and the pale lilac panel (2026-10-31); the white work area stands. Also fixed: People's buttons, fields and tabs back to 8px and its cards to 12px (they were 999px pills and 20px, against the two radii); Home's waiting requests above the fold with one primary action (Check in secondary, the setup list below Waiting for you); rail labels at 12px; the logo drawn from `--logo-*` tokens. Payroll, Attendance, Accounting and the employee app unchanged |
| 2026-08-24 | Shell + primitives rebuild over a discipline-only pass | The flat type scale is why it reads as a dense tool rather than premium SaaS; discipline alone would not fix it |
| 2026-09-08 | One vertical rhythm for page blocks | 43 screens at 16px and 20 at 20px meant no two modules agreed, and neither value was on the documented scale |
| 2026-09-08 | Weight marks structure, not content | 121 values carried semibold or bold. Spending weight on content leaves none for hierarchy — everything emphasised is nothing emphasised |
| 2026-09-08 | Money drops to weight 400 | Tabular alignment already marks a figure as money. A weight on top made every amount in every table an emphasis, and a screen that is mostly amounts then had none |
| 2026-09-08 | Status hues move out of type and into the tint | Seven saturated words in the filter strip competed with each other and with the figures beside them. Reverses the 2026-09-01 contrast increase, which raised the wrong thing |
| 2026-10-31 | People: brand colours used where they belong | Owner: "yellow and other colors not utilised properly in frontend"; a designer audit (`docs/people/design-v1/COLOUR-AUDIT-2026-10-31.md`) found five causes — the tab-count rule named `.ui-count`, which nothing renders; status tokens left from the teal era (`--warn` #B25000, `--neg` #D70015, Present and On leave both indigo); brand D's indigo figures overriding "nought is quiet grey"; the figure-card rule matching only buttons, so the People report kept Payroll's blue and green; and colours from outside brand D (red 10px bell count, a department rainbow, blue/crimson gender, Tailwind leave colours, peach "Waiting" in the employee app). Owner: "Yes, all ten". On the sky palette, light theme: marigold on counts, figures, pills and the bell that wait on you (tabs marked `data-tone="warn"`, figures `data-attention`), the bell 12px; `--warn` #7A4F00 for words with `--warn-mark` marigold for marks; red #B91C1C only for what went wrong; a new away mark #8D84C6; clash lines marigold-soft with a marigold edge; one series for charts, teams, gender, faces and uncoloured leave types (`--dept-*`, new `--leave-*`, whose base values are the old hexes so other apps are unchanged); the module panel's open screen on the lilac tile with a line; Settings icons on lilac tiles. The employee app wears brand D's waiting pill and a marigold line over the open tab through `data-brand="d"`, not the sky palette, so Attendance's screens keep Blaze. The bell count is 12px everywhere (the type floor); its colour changes in People only. Payroll, Attendance and Accounting are otherwise unchanged |
| 2026-10-31 | People module panel pale lilac, rail stays Cotton | Owner: "sidebars both same yellowish background, need to differentiate, slightly change second sidebar colour, keep primary same and pages same". Module panel `#F7F5FC` (hover `#EFECF8`), rail Cotton `#FAF6EE`, work area white, all unchanged otherwise. Light theme only; Payroll, Attendance and Accounting unchanged |
| 2026-10-28 | People lists are full page, denser, with plain line icons | Owner: "i don't want card type i want full page", "reduce empty spaces to view more data in table", and the pastel duotone icon tiles did not read as icons. On the Sky palette only (People): no rounded box or shadow round a table or the figures, one hairline above; 6px cell padding; 12px page rhythm; 224px module panel; plain Phosphor line icons, muted, the open screen in the accent; figure, tick-box and menu columns as wide as their content; view tabs in the search row; Onboarding & Exit gets search and kind/owner filters. Detail and form screens the same way: the employee record's tabs and Add employee's steps on the page ground under a hairline, forms 56rem wide with Save under them, drawers and dialogs with the page's round buttons and 12px fields. Later the same day: People's ground white, not grey; columns as wide as their content with the spare width once at the row's end; one job per colour beside Sky #0B72B5 (actions) — Navy #0E2A47 headings, Emerald #0E7C5A approved/active, Amber #A15C07 waiting, Coral red #C53A45 rejected/overdue, Violet #5B4BC4 information, Butter #F2C94C highlight only; initials in five soft washes picked from the name. Then a side panel beside ten People lists (`withSidePanel`, `apps/people/src/panels.jsx`): away this week and team clashes, waiting longest, joiners and birthdays, headcount, late items, expiring documents, and where to go next; every line opens a page or filters the list; drawn only when the table still fits at its natural width beside it (never on phones), and not on the employee record, which has its own activity rail. The row menu is 48px at the right edge; on a wide screen the spare width is shared among the columns in proportion to what they hold (a band of empty space at the row's end was rejected: "gaps in right ... not looks good"). Panel blocks: a heading with its count, status pills, a tinted alert line, a timeline for activity, date tiles, link chips. Finishing states: a loading screen takes the page's shape (title, rows) instead of a boxed card; an empty list hides its header row and its empty-state button steps down to secondary when the page heading already has the primary; a figure at nought is quiet grey. A tab that already names the one status its rows share drops the Status column (leave and attendance requests, help desk, workspace lists; kept on All and while a manager's step needs saying), and on Employees Active is plain grey words, pills only for on notice, joining, suspended, left. Org chart: one row of controls (views, as of, count, expand/collapse, zoom), the chart to the bottom of the window, the department legend floating in its corner. Motion (Apple notes): phone sheets leave downward and can be dragged away (1:1, momentum projection, springs, rubber band); press feedback on rows, tabs, menus, chips and figures; lists that open upward rise and fade out on close; reduced motion fades instead of sliding. Inter stays the one face (a redesign audit suggested a display font; not taken without the owner's say). Payroll, Attendance and Accounting unchanged |
| 2026-10-28 | People colours and icons upgraded; Organisation overview as rows | **Colours and icons superseded 2026-10-29 (brand D, two-tone icons); the Organisation rows stand.** Owner: "colours primary and all the colors need to be upgraded, icons", then "i don't want blue as every software this industry used same colours". On the Sky palette only (People): the accent is lagoon teal #0E7C7B (white on it 5.0:1; #0A6665 as text, 6.6:1), apart from the blues and purples of other HR apps; dark theme #2DD4BF with dark ink on it, near-black ground #0A0A0C and neutral grey surfaces #1C1C1E/#2C2C2E. Ink #1D1D1F for text and headings (navy headings dropped); status at Apple's accessible system values: green #1E7F37, orange #B25000, red #D70015, purple #8944AB (dark: #30D158, #FF9F0A, #FF6961, #BF8CFF). The Mist trial (slate #5D6B6B, blush counts) is removed; counts and date tiles take the teal wash. Icons stay Phosphor line icons; the open module and the open screen fill their icon's soft layer in the accent, as a selected symbol does on iOS. Organisation overview: departments and branches as full-width rows under one hairline instead of a card grid that left the end of each row empty; Other lists on the same ground. Payroll, Attendance and Accounting unchanged |
| 2026-10-26 | Text fields suggest what already exists | Owner rule, for every app: a field offers the company's own matching data so nothing is typed twice or spelled two ways. One shared `SuggestInput`; shared vocabulary only, never another person's private details |
| 2026-10-24 | People wears a rose accent on Accounting's layout | **Rose superseded 2026-10-28, then by brand D 2026-10-29; colour-tokens-only palettes stand.** The owner asked for People to keep the same layout and type as Accounting while having its own face. People's app-scoped CSS (59 selectors, 26 `!important`: 22px titles, 15px sections, 6px controls, a coral palette and a second-pass Blaze layer) is removed and replaced by one shared `[data-palette='rose']` block that sets colour tokens only. Colour icons stay (D-01, docs/people/08) |
| 2026-10-29 | People wears brand D, on a white work area | Owner chose brand D for People ("mark this as new"), replacing lagoon teal. Indigo ink and action, marigold for "waiting on you" (fill only), lilac for chosen and done. The work area is white ("keep it white": Cotton read yellowish) with cool lilac-grey hairlines; Cotton stays on the rail and module panel. Bricolage for headings and large figures. Light theme only; People's dark theme keeps its earlier values. Payroll, Attendance and Accounting unchanged |
| 2026-10-29 | People icons: two-tone Phosphor for places, Fluent line for actions | The pastel duotone tiles did not read as icons, and Fluent Color scored 5/10 on brand D. Owner picked option C of six: Phosphor two-tone, indigo line with a lilac fill, marigold fill on the open module, screen and tab (`iconSet: 'duo'`, `duo()` in the manifest). Buttons and row actions use Fluent Regular line icons (`lineIcons: 'fluent'`, via `@ui/components/ui/lineIcons`, which draws Lucide for the other apps). One icon family per role in People |
| 2026-10-28 | People navigation renamed and regrouped | Owner, as a user, was "not satisfied". Rail: Home · People · Organisation · Time · Talent · Workplace · Reports · Settings. Sentence case for every People label (tested); page titles equal menu labels; one Approvals inbox with Approve on each row; My leave and My attendance under My profile; Reports holds reports only (Data check and Privacy controls moved to Settings) |
| 2026-10-30 | Web tests run on every pull request; drifted code fixed to this file | Nothing ran the web suite and 53 tests had failed since the initial import (00f6a61a). Where the code had drifted from a rule already here, the code was fixed: 36 bold or semibold data values (weight marks structure, money at 400), and the Masters "TDS" entry renamed TDS Rates beside GST Rates and TCS Rates |
| 2026-10-30 | **Pending owner approval:** what shipped differs from what the old tests asked | The updated tests describe the screens as shipped, not a decision taken. Each is the owner's to accept or reverse: a three-up overview row at `xl` when each panel keeps 15rem (was "wait for `2xl`"); document lists' status dropdowns without counts; Price Lists without a figure row or its "pricing nothing" figure; the Settings catalogue leaving out the platform category and Tax Rates (reached from Sales and Masters instead). Also as shipped and unremarkable: the overviews share a running Home's plain header (HeroBand stays for Home's first hour); party masters draw addresses as one table and the customer's Dr / Cr sit inline beside the amount |
| 2026-10-31 | Buttons: five appearances, loading and success states, no FAB; marigold icons in People | Owner reviewed a nine-type button list. CLOR keeps five appearances (primary, secondary, soft, ghost, danger); icon-only is a size of ghost; priority and appearance are separate ideas. Adds a shared loading state (`aria-busy`, spinner in the icon's place, width kept, clicks refused, label still read out, breathing under reduced motion) and a brief success state (`data-state="done"`, tick and "Saved" for 1.5s, only where no toast fires), via `Button` / `useDoneFlash` in `Primitives.jsx`. No floating action button. Owner, same day: "in buttons symbols use yellow": in People (sky palette) icons in buttons are marigold: #F5A623 on the indigo primary (6.5:1), a deeper #C98200 on white secondary, soft and ghost (3.2:1 on white; the bright one was 2.0:1 and read washed out), spinner in ink there; icon-only buttons keep their ink (no 3:1-safe two-tone in Fluent line icons); danger keeps white; disabled follows the label; legacy dark primary keeps its ink (1.1:1 on teal). Payroll, Attendance and Accounting unchanged |
| 2026-10-29 | Direction D "Done, daily" brand shipped | C-tick mark and Bricolage wordmark replace the red mark and PNG wordmark; platform palette moves from graphite to indigo / marigold / lilac / cotton. Money semantics and the per-app palettes (Blaze, Rose) unchanged |
| 2026-10-02 | Contrast floor re-measured against the page ground, not white | Compliance audit: Graphite `--fg-subtle` #71717A was 4.83:1 on white but 4.40:1 on the `--app-bg` it often sits on, under AA; now #6B6B73 (4.81:1). `--warn` #A66A00 measured 4.48:1, now #996200. Orange-theme tokens (primary fill, focus ring, orange text → `--brand-ink`) corrected too, though Graphite overrides them. Field borders (1.48:1, WCAG 1.4.11) left for a design decision — see docs/compliance |
| 2026-10-02 | Inter served from the app, not Google Fonts | Loading it from fonts.googleapis.com sent every visitor's IP to Google before sign-in. Same face (`@fontsource-variable/inter`, OFL); the family is `'Inter Variable'` first in every stack |
| 2026-09-18 | Icon scale, layer scale and content width governed | Ten icon sizes became four roles (15px and 16px were doing the same job one pixel apart); sixteen z-index values became eleven ordered tokens after a row menu at `z-[9999]` was measured painting over an open dialog; and measuring the pages showed the content-width "drift" was mostly inner measure rather than page width, so two behaviours were documented instead of four roles invented |
| 2026-09-18 | Do's and Don'ts, Elevation and Responsive behaviour added | Three sections the document never had, filled from the tokens and the measured band rather than from intent. Writing them down surfaced that 57 Tailwind shadow utilities sit in app chrome against a three-token system — recorded as legacy, like `space-y-4`, not silently migrated |
| 2026-09-17 | This document reconciled against the rendered app | An audit quoted `#F97316`, "36px table rows" and a 188px rail — all from here, all stale. Every geometry and colour value above is now measured from the running product, and the audit inherited the errors because it read the doc instead of the tokens |
| 2026-09-13 | One face: Inter, everywhere | The Graphite type decision, adopted alone while its colors stay parked. Money and codes keep digit alignment through tabular-nums instead of a mono family |
| 2026-08-24 | Monospace money | Superseded 2026-09-13 — the alignment survives via tabular-nums, the second family does not |
| 2026-08-24 | No card-in-card on lists | 2–3 more rows per screen, less framing noise. Departs from the Zoho/Tally convention deliberately |
| 2026-08-24 | Fraunces stays in-product for page titles | Superseded 2026-09-13 by the one-face decision |
| 2026-08-24 | Orange kept as the single accent | Already tokenized, and rare against Tally blue / Zoho red / QuickBooks green |
| 2026-09-07 | Field sizing lives in the token, not at the call site | 390 call sites restated `.ui-input`'s own padding and beat it. Heights were unaffected — `min-height` already governed — but the horizontal metric differed from the rest of the product |
| 2026-09-07 | Selection is the accent's job | Six list screens marked the chosen row with `bg-stone-100`, a light-palette literal, so a selected row in dark mode was a near-white band across a dark table |
| 2026-09-07 | The Screen Contract above is the definition of done | The invoice rebuild produced the same nine findings screen after screen; written down, they are reviewable instead of rediscovered |
| 2026-08-24 | Print surfaces exempt from the token rule | A printed invoice is black on white whatever theme the app is in. The audit's 319-colour finding was 93% print documents and only 9 real violations |
