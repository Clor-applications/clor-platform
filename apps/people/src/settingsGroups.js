/*
 * People → Settings, in groups (R&D hand-off, 14 Nov 2026: Organisation, Time off, Access, Data, plus the groups the
 * hand-off has no screen for yet). One list for both places that show it: the Settings page (PeopleSettings) and the
 * Settings panel beside it (manifest `modules`), so a row is never on one and missing from the other.
 *
 * items: [navKey, the one line that says what the page is for]
 * tone: the group's identity colour on the Settings page (--cat-N, PEOPLE-28: Organisation blue, Time off yellow,
 *   Access violet, Data orange), behind each tile's icon chip.
 */
export const SETTINGS_GROUPS = [
  {
    title: 'Organisation',
    tone: 1,
    note: 'Who the employer is and how it is organised.',
    items: [
      ['companyDetails', 'Legal name, PAN, TAN, GSTIN, addresses'],
      ['legalEntities', 'Only when one group runs more than one registered company: which one each work site belongs to'],
      ['businessUnits', 'Divisions you report on separately'],
      ['branches', 'Offices and other places people work from'],
      ['areas', 'Where people are based, for holidays and reports'],
      ['establishments', 'Registered work sites, each with its own registrations and registers'],
      ['departments', 'Departments and their heads'],
      ['teams', 'Teams inside departments'],
      ['jobPositions', 'Job titles used on letters'],
      ['jobRoles', 'Job roles across designations'],
      ['seats', 'Positions people fill, open or taken'],
      ['grades', 'Pay bands and eligibility'],
      ['employeeTypes', 'Full-time, contract, intern: probation and notice'],
      ['workTypes', 'Office, remote, hybrid, field'],
      ['costCentres', 'Where salary cost is booked'],
      ['tags', 'Free labels for filtering'],
      ['orgChanges', 'Every change to the structure: what, who, when'],
    ],
  },
  {
    title: 'People records',
    tone: 3,
    note: 'What is kept about people, and what happens when they join or leave.',
    items: [
      ['customFields', 'Your own fields on every person: who sees them, who edits them'],
      ['letterTemplates', 'Offer, appointment, relieving and other letters the company issues'],
      ['journeySteps', 'The steps when someone joins or leaves: whose, when, for whom, and which need a note'],
      ['exitQuestions', 'The questions a leaver answers in the employee app, and how long answers are kept'],
      ['selfServiceChanges', 'Which of their own details employees may change without waiting for HR'],
    ],
  },
  {
    title: 'Time off',
    tone: 4,
    note: 'Leave rules and the company calendar.',
    items: [
      ['leaveTypes', 'Leave types, credits, carry forward and rules'],
      ['holidays', 'Holiday lists by location'],
      ['leaveBlocks', 'Days nobody may ask for leave, such as the year-end close; for some departments or leave types'],
      ['workingWeek', 'Which days of the week are off, for everyone not on a shift'],
      ['leaveYearEnd', 'What carries, lapses or is paid out when the leave period ends'],
      ['attendanceRules', 'Late marks that cost part of a day, missing-punch reminders, unexplained absence and night work for women'],
      ['requestRules', 'Work from home, on duty, missed punch and permission hours: what is on, monthly limits, who approves'],
    ],
  },
  {
    title: 'Shifts & readers',
    tone: 5,
    note: 'How shifts repeat, where people may punch from, and how readers know each person.',
    items: [
      ['shiftPolicy', 'The shift for anyone with no schedule, and what a late arrival costs'],
      ['weeklyOffPolicy', 'Which days each shift has off'],
      ['overtimePolicy', 'When extra hours count as overtime, and how they are paid or given back as time off'],
      ['departmentSchedule', 'One shift for a whole department'],
      ['rotations', 'Shifts that change by the week, such as morning then night'],
      ['sites', 'The places people may punch from on their phone'],
      ['siteCheck', 'Test a punch area on the map before staff use it'],
      ['phonePunches', 'Punches made from the employee app, with their place and photo'],
      ['enrolments', 'Whose fingerprint or face is on which reader'],
      ['idMapping', 'The number each reader knows a person by'],
      ['readerSync', 'When each reader last sent its punches'],
      ['deviceLogs', 'What each reader reported, for finding a fault'],
      ['contractors', 'Contract labour agencies whose workers punch here'],
    ],
  },
  {
    title: 'Requests & approvals',
    tone: 6,
    note: 'What people may ask for, who decides, and who stands in when the approver is away.',
    items: [
      ['approvalRules', 'Who decides job changes, resignations, probation, policies: steps, due days, overdue'],
      ['requestForms', 'Requests people can make, such as an ID card or a salary certificate: the form, who may ask, who approves'],
      ['standIns', 'Who decides for a manager while they are away: leave and other approvals'],
      ['automations', 'Reminders CLOR sends on its own: probation ending, final pay due, birthdays, leave waiting'],
      ['helpDeskSettings', 'Help desk categories, reply and resolve times, and answer templates'],
      ['companyChoices', 'Who decides attendance requests, withdrawn notices, who sees salary revisions and why someone leaves'],
      ['emailNotifications', 'Which emails go out, such as a document about to expire or the Monday summary, in Workspace'],
    ],
  },
  {
    title: 'Access',
    tone: 7,
    note: 'Who signs in, what they may do, and which features are on.',
    items: [
      ['selfService', 'Who can sign in to the employee app'],
      ['sso', 'Users, sign-in and single sign-on, in Workspace'],
      ['rolesAccess', 'What each role may do in People, in Workspace'],
      ['modules', 'Turn People features on or off'],
    ],
    apps: [
      ['payroll', 'Payroll', 'Salaries, statutory deductions and payslips for these people'],
      ['attendance', 'Attendance', 'The same readers, shifts and days, as an app of its own'],
    ],
  },
  {
    title: 'Data',
    tone: 2,
    note: 'Bring data in, take it out, and keep it right.',
    items: [
      ['dataImport', 'Bring employees and balances in from Excel'],
      ['dataExport', 'Download your HR data'],
      ['integrations', 'Webhooks, API keys and HR tool sync'],
      ['dataProtection', 'DPDP Act notice and consent'],
      ['dataRequests', 'Requests to see, correct or erase data'],
      ['privacy', 'Who opened sensitive details, how long records are kept, and auditor access'],
      ['recycleBin', 'Restore what was deleted in 30 days'],
      ['auditLogs', 'Who changed what, and when'],
      ['auditEvidence', 'What the company has shared with an outside auditor, and until when'],
    ],
  },
];
