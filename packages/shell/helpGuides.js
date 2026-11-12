/**
 * The Help centre's how-to articles for the first weeks with CLOR: Workspace,
 * People and Attendance, one job each. They sit beside the overview topics in
 * helpContent.js and are shown the same way.
 *
 * Written from the screens themselves: every menu path, button and field named
 * here is the label on screen. When a screen changes, change its article in the
 * same change. `open` (and `alt`) name a screen by its manifest key; the test
 * in helpContent.test.js fails if a key does not exist. `keywords` are the
 * words people search with that the text does not use.
 */
export const GUIDE_GROUPS = [
  { key: 'guide-workspace', label: 'Workspace how-to' },
  { key: 'guide-people', label: 'People how-to' },
  { key: 'guide-time', label: 'Time and attendance how-to' },
];

export const GUIDES = [
  /* ---------------------------------------------------------------- Getting started */
  {
    key: 'first-week',
    group: 'start',
    title: 'Your first week: what to set up',
    summary: 'Each app has a short list of what to set up first. Every step ticks itself when the work is really done.',
    keywords: ['onboarding', 'checklist', 'getting started', 'get started', 'setup', 'first steps', 'new company'],
    sections: [
      {
        heading: 'Where the lists are',
        points: [
          'Workspace: the Setup ring at the foot of the left rail. It covers company details, inviting your team, giving access and protecting admin sign-in.',
          'People: Get started on Home. It covers departments, employees, the working week and holidays, leave types, who approves, the employee app, documents and Payroll.',
          'Attendance: Get started on Today. It covers a shift, the weekly off, holidays, your staff, a reader or phone punch, and the first day recorded.',
        ],
      },
      {
        heading: 'How the lists work',
        points: [
          'A step shows Done only when CLOR finds the records behind it. You cannot tick a step yourself.',
          'Set up opens the screen that does the step. Review opens it again after it is done.',
          'A list goes away when every step is done. In People and Attendance you can also choose Hide this list, which hides it for the whole company.',
          'Only people who can do the steps see the list. The Workspace ring is shown to owners and admins.',
        ],
      },
      {
        heading: 'A good order for a small company',
        steps: [
          'Invite the people who will help you run CLOR.',
          'Add a shift and its weekly off.',
          'Add this year’s holidays.',
          'Add your staff, one by one or from a spreadsheet.',
          'Connect a reader, or switch on phone punch.',
          'Check the next day that attendance was recorded.',
        ],
      },
    ],
    open: { app: 'admin', screen: 'home', label: 'Open the Overview' },
  },

  /* ---------------------------------------------------------------- Workspace */
  {
    key: 'invite',
    group: 'guide-workspace',
    title: 'Invite people and give them access',
    summary: 'Send an invitation by email, then give the person a role so they can open the apps they need.',
    keywords: ['invite', 'add user', 'new user', 'team member', 'login', 'sign in', 'access'],
    sections: [
      {
        heading: 'Send an invitation',
        steps: [
          'Go to Workspace › Access › Invitations.',
          'Choose Invite people.',
          'Type their email address.',
          'Choose an account role. Member is right for most people. Administrator can add companies and invite people. Billing admin can see the plan and billing.',
          'Tick the companies they should join.',
          'Choose Send invitation.',
        ],
      },
      {
        heading: 'What the person does',
        points: [
          'They get an email with a link. The link works once and expires in 7 days.',
          'They open the link, choose their own password, and choose Create my login and join.',
          'If the link has expired, choose Resend on their row in Invitations. The old link stops working.',
          'To cancel an invitation, choose Withdraw on its row.',
        ],
      },
      {
        heading: 'Give them a role',
        steps: [
          'Go to Workspace › Access › Users.',
          'Open the actions on the person’s row and choose Edit.',
          'Choose a Role, then Save changes.',
          'A person with no role can sign in but opens nothing.',
        ],
      },
      {
        heading: 'Adding someone without an email invitation',
        points: ['In Access › Users, choose Add user. Type their name, email and a temporary password, and tell them the password yourself.'],
      },
    ],
    open: { app: 'admin', screen: 'invitations', label: 'Open Invitations' },
  },
  {
    key: 'who-sees-what',
    group: 'guide-workspace',
    title: 'Roles: who can see what',
    summary: 'What a person can open depends on their role in each company, and on the branches they are given.',
    keywords: ['permissions', 'access', 'role', 'manager', 'hr', 'restrict', 'branch access', 'team manager'],
    sections: [
      {
        heading: 'Three things decide it',
        points: [
          'The role in each company. A role is a set of permissions, ticked app by app.',
          'The branches. In Access › Users, the Branches action limits a person to some branches. All branches means every branch.',
          'Some roles see only their own team, such as Team Manager. They see the days and requests of the people who report to them.',
        ],
      },
      {
        heading: 'Change what a role may do',
        steps: [
          'Go to Workspace › Access › Permissions.',
          'Pick the role.',
          'Tick what it may view, create, edit, approve or export in each app.',
          'Choose Save changes.',
        ],
      },
      {
        heading: 'See what one person can do',
        points: [
          'In Access › Users, open the person’s row actions and choose Details. What they can do lists their roles and permissions.',
          'In Access › Members, the account’s owners and administrators see every person across all companies, with their apps.',
        ],
      },
    ],
    open: { app: 'admin', screen: 'permissions', label: 'Open Permissions' },
  },
  {
    key: 'company-branches',
    group: 'guide-workspace',
    title: 'Set up the company and its branches',
    summary: 'The company’s legal details, and each office or site people work from.',
    keywords: ['company details', 'pan', 'tan', 'address', 'branch', 'office', 'location', 'gstin', 'epf', 'esic'],
    sections: [
      {
        heading: 'Company details',
        steps: [
          'Go to Workspace › Company › Company profile. The page title is your company’s name.',
          'Fill in the legal name, company PAN, TAN and the registered address.',
          'Under Statutory registrations, add the EPF establishment code, ESIC employer code, Professional Tax and Labour Welfare Fund registrations you have.',
          'Choose Save changes.',
        ],
      },
      {
        heading: 'Add a branch',
        steps: [
          'Go to Workspace › Company › Branches.',
          'Choose Add branch.',
          'Type a branch code and branch name, the address and the state.',
          'If GST is on for the company, add the branch’s GSTIN. It fills in the state for you.',
          'Choose Add branch.',
        ],
      },
      {
        heading: 'Good to know',
        points: [
          'The branch’s state decides its holidays and statutory rules, so get it right.',
          'In People, Settings › Company has Branches, Departments and Designations too.',
        ],
      },
    ],
    open: { app: 'admin', screen: 'company', label: 'Open Company profile' },
    alt: { app: 'admin', screen: 'branches', label: 'Open Branches' },
  },
  {
    key: 'authenticator',
    group: 'guide-workspace',
    title: 'Set up an authenticator app',
    summary: 'A six-digit code from your phone, asked for each time you sign in. It keeps your account safe if your password leaks.',
    keywords: ['two-factor', '2fa', 'otp', 'google authenticator', 'microsoft authenticator', 'mfa', 'security code', 'recovery codes'],
    sections: [
      {
        heading: 'Before you start',
        points: ['Install an authenticator app on your phone, such as Google Authenticator or Microsoft Authenticator.'],
      },
      {
        heading: 'Turn it on',
        steps: [
          'Open My profile from the top bar. The same card is on Workspace › Security › Sign-in and sessions.',
          'Under Authenticator app, type your password and choose Set up an authenticator app.',
          'Scan the QR code with the app on your phone. If you cannot scan it, type the key shown under it.',
          'Type the six-digit code the app shows, and choose Turn on.',
          'Save the recovery codes somewhere safe. Each works once if you lose your phone, and they are not shown again.',
        ],
      },
      {
        heading: 'Make it required',
        points: [
          'In Workspace › Security › Sign-in and sessions, tick Owners and admins need an authenticator app, then Save rules.',
          'An owner or admin without one is asked to set it up the next time they sign in.',
        ],
      },
      {
        heading: 'Lost your phone?',
        points: ['At the code step, type one of your recovery codes instead.'],
      },
    ],
    open: { app: 'admin', screen: 'security', label: 'Open Sign-in and sessions' },
  },
  {
    key: 'support',
    group: 'guide-workspace',
    title: 'Get help and raise a ticket',
    summary: 'Ask CLOR a question or report a problem. CLOR support answers by email, usually within one working day.',
    keywords: ['ticket', 'support', 'contact', 'problem', 'bug', 'error', 'complaint', 'help desk', 'not working'],
    sections: [
      {
        heading: 'Raise a ticket',
        steps: [
          'Go to Workspace › Overview › Help and support.',
          'Choose New ticket.',
          'Under What is it?, choose the closest kind, such as Something is not working.',
          'Under Which app, choose the app it is about.',
          'Write a short subject, then what you did, what you expected and what you saw instead.',
          'If an error showed a code, add it under Error code.',
          'Tick Urgent: work has stopped only when nobody can work.',
          'Choose Send to CLOR.',
        ],
      },
      {
        heading: 'After you send it',
        points: [
          'The ticket shows With CLOR while support works on it, and Waiting for you when they need your answer.',
          'Reply on the ticket with Send reply.',
          'When it is fixed, choose It is solved. If it comes back, reply and the ticket opens again.',
          'Owners and administrators see every ticket in the account. Everyone else sees their own.',
        ],
      },
    ],
    open: { app: 'admin', screen: 'support', label: 'Open Help and support' },
  },
  {
    key: 'billing-trial',
    group: 'guide-workspace',
    title: 'Your plan, trial and billing',
    summary: 'See when your trial ends, pay invoices, ask for a plan change or stop renewing.',
    keywords: ['trial', 'invoice', 'payment', 'pay', 'upi', 'bank transfer', 'subscription', 'plan', 'cancel', 'renew', 'price'],
    sections: [
      {
        heading: 'Trial',
        points: ['The Workspace Overview shows when your trial ends. Choose a plan before then to keep your apps open.'],
      },
      {
        heading: 'Pay an invoice',
        steps: [
          'Go to Workspace › Plan & billing › Billing.',
          'Open the invoice under Invoices.',
          'Pay by UPI using the QR code, or by bank transfer to the account shown.',
          'Put the invoice number in the transfer’s remarks.',
          'Choose Print or save as PDF to keep a copy.',
        ],
      },
      {
        heading: 'Change the plan',
        steps: [
          'On Billing, under Change the plan, choose Ask for another change.',
          'Say what to change: add or remove an app, or the number of users or employees.',
          'Choose Send to CLOR. CLOR sales replies by email with the price. Nothing changes until you agree.',
        ],
      },
      {
        heading: 'Stop renewing',
        points: [
          'Only the account owner can do this. Choose Stop renewing on Billing (Stop after the trial during a trial).',
          'Everything works until the end date. After that your data stays to read and export.',
        ],
      },
    ],
    open: { app: 'admin', screen: 'billing', label: 'Open Billing' },
  },
  {
    key: 'export-close',
    group: 'guide-workspace',
    title: 'Export your data or close a company',
    summary: 'Download a copy of a company’s data, and close the company when you no longer need it.',
    keywords: ['export', 'backup', 'download data', 'delete company', 'close account', 'leave clor'],
    sections: [
      {
        heading: 'Export',
        steps: [
          'Go to Workspace › Data › Data export.',
          'Download data takes the books and their documents. Download configuration takes the settings: branches, roles, numbering and approval rules.',
          'Keep the file somewhere safe. Passwords and API secrets are left out of the configuration.',
        ],
      },
      {
        heading: 'HR and attendance data',
        points: ['People and Attendance have Settings › Export data too. Pick what to export, the period, and CSV or JSON.'],
      },
      {
        heading: 'Close a company',
        steps: [
          'Go to Workspace › Data › Close company. Only an administrator of the company can do this.',
          'Choose Download full export. The closure needs an export from the last 24 hours.',
          'Give a reason if you like, and type the company’s name to confirm.',
          'Choose Close company after … days. CLOR may ask for your authenticator code.',
          'The company keeps working through the notice period shown on the page. Choose Cancel the closure at any time in it.',
          'After the notice period, every record of the company is deleted for good.',
        ],
      },
    ],
    open: { app: 'admin', screen: 'export', label: 'Open Data export' },
    alt: { app: 'admin', screen: 'close', label: 'Open Close company' },
  },

  /* ---------------------------------------------------------------- People */
  {
    key: 'add-employee',
    group: 'guide-people',
    title: 'Add an employee',
    summary: 'Add one person, step by step: personal details, employment, and where they sit.',
    keywords: ['new employee', 'new joiner', 'hire', 'staff', 'add staff', 'create employee'],
    sections: [
      {
        heading: 'Steps',
        steps: [
          'Go to People › Employees and choose Add employee.',
          'Personal: type the first name, and the work email and phone if you have them.',
          'Employment: type the employee ID and joining date. Choose the employment type.',
          'Organisation: choose the department, designation and manager.',
          'Review: check everything, then choose Create employee.',
        ],
      },
      {
        heading: 'Good to know',
        points: [
          'Fields marked * are needed. You can fill in the rest later on their record.',
          'Save draft keeps what you typed for 30 days, for you only.',
          'If CLOR thinks this person is already here, it says so and asks why this is a different person.',
          'The manager decides their leave and requests when the company is set up that way.',
        ],
      },
    ],
    open: { app: 'people', screen: 'employeeNew', label: 'Add employee' },
  },
  {
    key: 'import-employees',
    group: 'guide-people',
    title: 'Import employees from a spreadsheet',
    summary: 'Bring in many people at once from an Excel or CSV file. Every row is checked before anything is saved.',
    keywords: ['import', 'upload', 'excel', 'csv', 'bulk', 'spreadsheet', 'template', 'migrate'],
    sections: [
      {
        heading: 'Steps',
        steps: [
          'Go to People › Employees and choose Import.',
          'Choose Download the template. It has every heading CLOR reads, one example row, and a note on each column.',
          'Fill in one row per person. Replace the example row. Keep the headings as they are.',
          'Choose a CSV or Excel file, up to 2 MB and 1000 rows.',
          'Map columns: check where each column goes. Your own headings, such as Emp code or DOJ, are usually matched for you.',
          'Choose Check rows. CLOR lists the rows that are ready and the rows with a problem.',
          'Choose Import N rows to add the ready rows.',
        ],
      },
      {
        heading: 'Good to know',
        points: [
          'Dates can be 15/10/2026 or 2026-10-15.',
          'A department or designation that is not in CLOR yet is added for you.',
          'When an employee ID is already here, choose Skip that row, or Update that employee to change them.',
          'Rows with a problem are left out. Choose Download rows to fix, correct them, and import that file.',
          'An import can be undone for 24 hours under Past imports.',
        ],
      },
    ],
    open: { app: 'people', screen: 'employeeImport', label: 'Open Import employees' },
  },
  {
    key: 'leave-types',
    group: 'guide-people',
    title: 'Set up leave types',
    summary: 'Casual, sick and earned leave: how many days, how they are credited, and who may take them.',
    keywords: ['leave policy', 'casual leave', 'sick leave', 'earned leave', 'privilege leave', 'el', 'cl', 'sl', 'leave balance'],
    sections: [
      {
        heading: 'The quick way',
        steps: [
          'In People, go to Settings › Leave policy. In Attendance, it is Settings › Leave policy too.',
          'Choose Start from your state’s rules and pick your state, then Create them.',
          'Open each leave type and change what differs for your company. Choose Save.',
        ],
      },
      {
        heading: 'Add one yourself',
        steps: [
          'Choose New leave type, or one of the usual types such as Casual Leave.',
          'Give it a name, and say if it is paid leave.',
          'Under What it gives, set the days a year and how they are credited.',
          'Under Who approves, choose who decides it.',
          'Choose Save.',
        ],
      },
      {
        heading: 'Moving to CLOR in the middle of the year',
        points: ['Bring each person’s balance in with Settings › Import data › Leave balances, and past leave with Leave already taken.'],
      },
    ],
    open: { app: 'people', screen: 'leaveTypes', label: 'Open Leave policy' },
    alt: { app: 'attendance', screen: 'leaveTypes', label: 'Open Leave policy in Attendance' },
  },
  {
    key: 'apply-leave',
    group: 'guide-people',
    title: 'Apply for leave and approve it',
    summary: 'Staff ask for leave from the employee app or My leave. HR can enter it for them. The approver decides.',
    keywords: ['leave request', 'time off', 'apply leave', 'approve leave', 'reject leave', 'holiday request', 'half day'],
    sections: [
      {
        heading: 'Ask for leave',
        steps: [
          'In the employee app, open Leave. In CLOR, open My leave.',
          'Choose Ask for leave.',
          'Choose the leave type. It shows how many days are left.',
          'Choose the first and last day, and how much of the day.',
          'Give a reason and choose Send.',
        ],
      },
      {
        heading: 'Enter leave for someone',
        points: ['In Time › Leave requests, choose Enter leave. Pick the employee, the leave type and the days, then Save.'],
      },
      {
        heading: 'Approve or reject',
        steps: [
          'Open Inbox, or Time › Leave requests on the Waiting tab.',
          'Open the request. You see their balance and who else is away then.',
          'Choose Approve, or Reject. To reject, write a note: they see it with the decision.',
        ],
      },
      {
        heading: 'Good to know',
        points: ['Who decides is set on each leave type, under Who approves.'],
      },
    ],
    open: { app: 'people', screen: 'leaveRequests', label: 'Open Leave requests' },
    alt: { app: 'attendance', screen: 'leaveRequests', label: 'Open Leave requests in Attendance' },
  },
  {
    key: 'inbox',
    group: 'guide-people',
    title: 'Approve requests in the Inbox',
    summary: 'Everything waiting for your decision in People, in one list: leave, attendance fixes, overtime and more.',
    keywords: ['approvals', 'approve', 'pending', 'waiting', 'requests', 'reject', 'my tasks'],
    sections: [
      {
        heading: 'The tabs',
        points: [
          'To approve: requests waiting for your decision.',
          'My tasks: joining, leaving and other tasks on your name.',
          'Asked by me: what you asked for, and where it stands.',
        ],
      },
      {
        heading: 'Decide a request',
        steps: [
          'Open Inbox from the rail.',
          'Use Every kind to show one kind, such as Leave.',
          'Choose Approve on the row, or open it to read more.',
          'To reject, or to ask for more, write a comment first. They see it.',
        ],
      },
      {
        heading: 'Many at once',
        points: ['Tick the rows, then choose Approve or Reject in the bar. To reject, type a note to them first.'],
      },
    ],
    open: { app: 'people', screen: 'approvals', label: 'Open Inbox' },
  },
  {
    key: 'approvers',
    group: 'guide-people',
    title: 'Choose who approves',
    summary: 'Requests go to a person’s manager, to HR, or through the steps of an approval rule.',
    keywords: ['approver', 'approval rule', 'manager', 'reports to', 'workflow', 'delegate', 'stand-in'],
    sections: [
      {
        heading: 'Give people a manager',
        points: ['On each person’s record, set their Manager. Requests that go to the manager go to this person.'],
      },
      {
        heading: 'The company’s choices',
        points: ['Settings › Who decides & who sees sets who decides attendance requests, and a few other company choices.'],
      },
      {
        heading: 'Approval rules',
        steps: [
          'Go to Settings › Approval rules.',
          'Choose Set up or Edit beside a kind of request, such as Leaving.',
          'For each step, choose who decides and within how many working days.',
          'Choose Save as new version.',
        ],
      },
      {
        heading: 'When an approver is away',
        points: ['Settings › Delegates names who decides for them while they are away.'],
      },
    ],
    open: { app: 'people', screen: 'companyChoices', label: 'Open Who decides & who sees' },
    alt: { app: 'people', screen: 'approvalRules', label: 'Open Approval rules' },
  },
  {
    key: 'documents',
    group: 'guide-people',
    title: 'Keep documents and their expiry dates',
    summary: 'ID proofs, contracts, permits and certificates on each person’s record, with the date each runs out.',
    keywords: ['document', 'upload', 'aadhaar', 'pan card', 'passport', 'visa', 'work permit', 'licence', 'certificate', 'expiry', 'expire'],
    sections: [
      {
        heading: 'Add a document',
        steps: [
          'Go to People › Documents and choose New document.',
          'Choose the employee, then Upload.',
          'Choose the file, its type and a title.',
          'Set Valid until if it runs out. A work permit or licence, and a certificate, need it.',
          'Choose who can see it, then Upload.',
        ],
      },
      {
        heading: 'Watch the expiry dates',
        points: [
          'A document that runs out within 30 days shows Expires in N days.',
          'The Expired tab lists documents past their date.',
          'Emails about documents about to expire are switched on or off in Workspace › Company › Email notifications.',
        ],
      },
      {
        heading: 'A new version',
        points: ['Open the person’s documents and choose Replace with a new version. Earlier versions are kept.'],
      },
    ],
    open: { app: 'people', screen: 'documents', label: 'Open Documents' },
  },
  {
    key: 'offer-joining',
    group: 'guide-people',
    title: 'From offer to joining day',
    summary: 'Send an offer with an accept link, then follow the joining steps until the person has settled in.',
    keywords: ['offer letter', 'onboarding', 'new joiner', 'joining', 'accept offer', 'hire', 'induction'],
    sections: [
      {
        heading: 'Before the offer',
        points: ['Add the person with a joining date in the future. They show under People › Joining until they join.'],
      },
      {
        heading: 'Send the offer',
        steps: [
          'Go to People › Offers and choose Make an offer.',
          'Pick the person and choose Write the offer.',
          'Fill in their email, position, joining date, Open until and annual CTC.',
          'Choose Send offer. They get an email with a link to accept.',
        ],
      },
      {
        heading: 'Joining',
        points: [
          'People › Joining lists everyone joining or just joined, with their steps.',
          'Choose Open plan on a row to see the steps, who owns each one, and when it is due.',
          'Each task owner marks their step done in Tasks or in Inbox › My tasks.',
          'Settings › Joining & leaving steps sets which steps every joiner gets.',
        ],
      },
    ],
    open: { app: 'people', screen: 'offers', label: 'Open Offers' },
    alt: { app: 'people', screen: 'joiners', label: 'Open Joining' },
  },
  {
    key: 'resignation-exit',
    group: 'guide-people',
    title: 'Record a resignation and the exit',
    summary: 'Record when someone is leaving, then follow the leaving steps to their last day and final pay.',
    keywords: ['resignation', 'resign', 'exit', 'offboarding', 'notice period', 'last working day', 'relieving', 'full and final', 'fnf', 'termination'],
    sections: [
      {
        heading: 'Record it',
        steps: [
          'Go to People › Leaving and choose Record a leaving.',
          'Pick the person and choose Continue.',
          'Choose why they are leaving, such as Resigned.',
          'Set the last working day and the day the resignation was received.',
          'Check the notice period. Tick Notice waived if you agreed to that.',
          'Choose Record leaving.',
        ],
      },
      {
        heading: 'Until the last day',
        points: [
          'People › Leaving lists everyone on notice, with their steps, readers, final wages and CLOR sign-in.',
          'The leaving steps go to their owners, like joining steps.',
          'Record exit interview answers on their record, under Exit interview.',
          'Issue the relieving letter with Issue a letter on their documents.',
        ],
      },
      {
        heading: 'Good to know',
        points: ['Final wages are due within two working days of the last day. People Home shows Final pay due until it is done.'],
      },
    ],
    open: { app: 'people', screen: 'leavers', label: 'Open Leaving' },
  },
  {
    key: 'employee-app',
    group: 'guide-people',
    title: 'Give staff the employee app',
    summary: 'Staff see their days and leave, ask for leave and fixes, and punch from their phone where you allow it.',
    keywords: ['employee portal', 'self service', 'ess', 'mobile app', 'activation code', 'staff login', 'portal'],
    sections: [
      {
        heading: 'Give access',
        steps: [
          'In People, go to Settings › Employee app. In Attendance, it is People › Employee portal access.',
          'Tick the people to give access to.',
          'Choose Give activation codes. Tick and e-mail them to send each person their code.',
          'Print the codes, or hand them over, for people without email.',
        ],
      },
      {
        heading: 'What the employee does',
        steps: [
          'Open the portal address shown beside Company code. Copy address copies it.',
          'Choose First time? Activate.',
          'Type the company code, their employee code and the activation code from HR.',
          'Choose a password, and choose Activate and sign in.',
        ],
      },
      {
        heading: 'Good to know',
        points: [
          'Each activation code works once.',
          'A person who forgets their password asks HR for a new activation code.',
          'From People › Employees you can also tick people and choose Send employee app access.',
        ],
      },
    ],
    open: { app: 'people', screen: 'selfService', label: 'Open Employee app' },
    alt: { app: 'attendance', screen: 'portalAccess', label: 'Open Employee portal access' },
  },

  /* ---------------------------------------------------------------- Time and attendance */
  {
    key: 'shifts-weekly-off',
    group: 'guide-time',
    title: 'Set shifts and weekly offs',
    summary: 'A shift is the working hours and the days off of the people on it. Anyone without a shift follows the working week.',
    keywords: ['shift', 'timing', 'roster', 'weekly off', 'sunday off', 'second saturday', 'working hours', 'grace', 'late'],
    sections: [
      {
        heading: 'Add a shift',
        steps: [
          'In Attendance, go to Attendance › Shifts. In People, it is Time › Shifts.',
          'Choose New shift.',
          'Give it a name, and the times it starts and ends.',
          'Set the break and the late grace in minutes.',
          'Under Weekly off, tick the days off. For the 2nd and 4th Saturday off, leave Saturday unticked and tick 2nd and 4th under Saturdays off as well.',
          'Choose Save.',
        ],
      },
      {
        heading: 'Put people on it',
        steps: [
          'Go to Shift assignments (Who is on which shift in People).',
          'Choose the shift and the From date.',
          'Tick the people and choose Assign.',
        ],
      },
      {
        heading: 'Good to know',
        points: [
          'Weekly off policy shows every shift’s days off in one table.',
          'A shift that ends the next morning is a night shift.',
          'Attendance policy sets the shift for anyone with no schedule.',
        ],
      },
    ],
    open: { app: 'attendance', screen: 'shifts', label: 'Open Shifts' },
    alt: { app: 'people', screen: 'shifts', label: 'Open Shifts in People' },
  },
  {
    key: 'holidays',
    group: 'guide-time',
    title: 'Add holidays',
    summary: 'The year’s paid days off, for everyone or for one branch. Nobody is marked absent on a holiday.',
    keywords: ['holiday list', 'festival', 'national holiday', 'restricted holiday', 'optional holiday', 'calendar'],
    sections: [
      {
        heading: 'From a ready calendar',
        steps: [
          'In Attendance, go to Settings › Holidays. In People, it is Settings › Holidays.',
          'Open More and choose Add a national or state calendar.',
          'Choose the year, the calendar and who it is for.',
          'Choose Add.',
        ],
      },
      {
        heading: 'One at a time',
        steps: [
          'Under Add a holiday, choose the date and type the name.',
          'If the company has more than one branch, choose who it is for.',
          'Tick Optional for a holiday people may choose to take.',
          'Choose Add holiday.',
        ],
      },
      {
        heading: 'Good to know',
        points: [
          'A branch in another state keeps its own holidays.',
          'Optional holidays do not change anyone’s attendance.',
          'More › Import from a spreadsheet brings in a whole list.',
        ],
      },
    ],
    open: { app: 'attendance', screen: 'holidays', label: 'Open Holidays' },
    alt: { app: 'people', screen: 'holidays', label: 'Open Holidays in People' },
  },
  {
    key: 'connect-reader',
    group: 'guide-time',
    title: 'Connect a biometric reader',
    summary: 'A fingerprint or face reader at the door sends each punch to CLOR over the internet.',
    keywords: ['biometric', 'reader', 'device', 'machine', 'fingerprint', 'face', 'essl', 'zkteco', 'adms', 'cloud server'],
    sections: [
      {
        heading: 'On the reader',
        steps: [
          'Open Menu › Comm › Cloud Server Setting.',
          'Type the server address shown in Attendance under How to connect a reader. Switch domain name on and proxy off.',
          'Set the reader’s date and time to Indian time.',
          'Note the serial number from Menu › System Info › Device Info.',
        ],
      },
      {
        heading: 'In CLOR',
        steps: [
          'Go to Readers › All readers and choose Add reader.',
          'Under How it connects, choose Push reader (ADMS) for most ZKTeco and eSSL readers.',
          'Type the serial number and a name, then choose Add.',
          'Do this from a computer on the same internet connection as the reader, such as the office Wi-Fi.',
        ],
      },
      {
        heading: 'Check it works',
        points: [
          'The reader shows online once it connects.',
          'Each person’s user ID on the reader should be their employee code. Punches with an ID CLOR does not know wait in Unmatched punches.',
          'Reader health shows whether each reader is reporting.',
        ],
      },
      {
        heading: 'Other readers',
        points: ['Matrix, Hikvision, Dahua, Suprema, Anviz and e-Time Office are in the How it connects list. The Biometric readers guide covers each one.'],
      },
    ],
    open: { app: 'attendance', screen: 'readers', label: 'Open All readers' },
    alt: { app: 'people', screen: 'readers', label: 'Open Readers in People' },
  },
  {
    key: 'phone-punch',
    group: 'guide-time',
    title: 'Let staff punch from their phone',
    summary: 'Staff punch in and out from the employee app when they are inside a punch area you set.',
    keywords: ['mobile punch', 'phone punch', 'gps', 'geofence', 'location', 'selfie', 'field staff', 'remote attendance'],
    sections: [
      {
        heading: 'Set the place',
        steps: [
          'Go to Settings › Punch areas and choose New site.',
          'Type a name, then find the place on the map, or choose Use where I am.',
          'Set how far from it punches count. 100 to 300 metres suits most offices.',
          'Choose Save.',
        ],
      },
      {
        heading: 'Switch it on for people',
        steps: [
          'Go to People › Employee portal access (Settings › Employee app in People).',
          'Tick the people, then choose Allow phone punch.',
          'Use Mode to choose Work sites only, or Field: anywhere for staff who travel.',
        ],
      },
      {
        heading: 'What the employee does',
        points: [
          'In the employee app, on Today, they choose Share my location to punch, then Punch in now.',
          'Each person needs the employee app first.',
        ],
      },
    ],
    open: { app: 'attendance', screen: 'sites', label: 'Open Punch areas' },
    alt: { app: 'attendance', screen: 'portalAccess', label: 'Open Employee portal access' },
  },
  {
    key: 'missed-punch',
    group: 'guide-time',
    title: 'Fix a missed punch',
    summary: 'The employee asks for a fix and their approver decides. HR can also correct a day directly.',
    keywords: ['missed punch', 'forgot to punch', 'regularise', 'regularize', 'correction', 'attendance request', 'wrong time'],
    sections: [
      {
        heading: 'The employee asks',
        steps: [
          'In the employee app, open My days and choose Ask.',
          'Choose Missed punch.',
          'Choose the day, and type the in and out times.',
          'Choose what happened, such as Forgot to punch, and why.',
          'Choose Send.',
        ],
      },
      {
        heading: 'The approver decides',
        steps: [
          'Open Attendance › Attendance fixes, on the Waiting tab. In People it is Time › Attendance fixes, or Inbox.',
          'Open the request and choose Approve, or Reject with a note.',
        ],
      },
      {
        heading: 'HR corrects a day',
        steps: [
          'Go to Attendance › Attendance records.',
          'Open the person’s day.',
          'Change In and Out, add a note, and choose Save.',
        ],
      },
      {
        heading: 'HR asks on someone’s behalf',
        points: ['On Attendance fixes, choose Enter request, then pick the employee and the kind.'],
      },
    ],
    open: { app: 'attendance', screen: 'requests', label: 'Open Attendance fixes' },
    alt: { app: 'people', screen: 'attendanceRequests', label: 'Open Attendance fixes in People' },
  },
  {
    key: 'month-close',
    group: 'guide-time',
    title: 'Close the month',
    summary: 'Check the month, then lock it so Payroll takes final figures. A snapshot is kept.',
    keywords: ['month end', 'lock attendance', 'payroll cut-off', 'close month', 'reopen month', 'freeze'],
    sections: [
      {
        heading: 'Steps',
        steps: [
          'Go to Attendance › Month close (Time › Month close in People).',
          'Pick the month.',
          'Work through the Checklist: days with no check-out, requests waiting, unknown reader IDs and the rest. Open fixes each one.',
          'In the section that closes the month, tick the boxes that apply.',
          'Choose Close the month.',
        ],
      },
      {
        heading: 'What closing does',
        points: [
          'Corrections, leave, manual changes and late reader uploads can no longer change the month’s days.',
          'Payroll takes the figures as they are, and a snapshot is kept.',
        ],
      },
      {
        heading: 'Reopen',
        points: ['Choose Reopen and say why. Payroll already run from the month is not changed. Closing again keeps a new snapshot.'],
      },
      {
        heading: 'Good to know',
        points: ['Someone who sees only their own team cannot close or reopen the month.'],
      },
    ],
    open: { app: 'attendance', screen: 'monthClose', label: 'Open Month close' },
    alt: { app: 'people', screen: 'monthClose', label: 'Open Month close in People' },
  },
  {
    key: 'payroll-export',
    group: 'guide-time',
    title: 'Export attendance for payroll',
    summary: 'Payable days and loss of pay for each person, as a CSV file, or taken by CLOR Payroll on its own.',
    keywords: ['payable days', 'lop', 'loss of pay', 'salary', 'payroll export', 'attendance summary', 'muster'],
    sections: [
      {
        heading: 'With CLOR Payroll',
        points: ['Close the month. Payroll takes the month’s payable days from the snapshot. There is nothing to send.'],
      },
      {
        heading: 'For another payroll',
        steps: [
          'Go to Reports › Monthly attendance summary and pick the month.',
          'Open More and choose Export summary. The file starts with Payable days and Loss of pay for each person.',
        ],
      },
      {
        heading: 'The figures Payroll took',
        points: ['On Month close, under What Payroll took, choose CSV beside a snapshot.'],
      },
      {
        heading: 'Raw days',
        points: ['Settings › Export data gives each day’s in, out and status, as CSV or JSON.'],
      },
    ],
    open: { app: 'attendance', screen: 'summary', label: 'Open Monthly attendance summary' },
    alt: { app: 'people', screen: 'summary', label: 'Open Monthly attendance in People' },
  },
  {
    key: 'import-time',
    group: 'guide-time',
    title: 'Import holidays, shifts, balances and past days',
    summary: 'Bring a spreadsheet in. Each kind of import has a template with the exact headings CLOR reads.',
    keywords: ['import', 'upload', 'excel', 'csv', 'template', 'opening balance', 'leave balance', 'shift assignment', 'migrate'],
    sections: [
      {
        heading: 'What you can import',
        points: ['Attendance days, employees, holidays, shift assignments, leave balances, leave already taken and contractors.'],
      },
      {
        heading: 'Steps',
        steps: [
          'Go to Settings › Import data.',
          'Under What the file holds, choose the kind.',
          'Choose Download the template. It has the headings, one example row, and a note on each column.',
          'Fill it in and save it as Excel (.xlsx) or CSV.',
          'Choose the file, then Check the file. Nothing is saved yet.',
          'Read which rows are ready and which have a problem, then choose Import.',
        ],
      },
      {
        heading: 'Good to know',
        points: [
          'Shifts and leave types are named exactly as they are in CLOR, so add them first.',
          'Rows with a problem are left out. Fix them in the file and import it again.',
          'Punches exported from a reader go in under Readers, as a file import, not here.',
        ],
      },
    ],
    open: { app: 'attendance', screen: 'dataImport', label: 'Open Import data' },
    alt: { app: 'people', screen: 'dataImport', label: 'Open Import data in People' },
  },
];
