/**
 * What each product page says. Every feature named here exists in the
 * platform today (checked against the code; list in CONTENT_CHECKLIST.md),
 * except where a product is marked `soon`.
 */

export const PRODUCT_CONTENT = {
  books: {
    title: 'Accounting that already knows GST.',
    intro:
      'Raise GST invoices, e-invoices and e-way bills, keep stock across warehouses, reconcile the bank and close the month. The ledger posts itself as you work.',
    problems: [
      ['Invoices in one tool, books in another', 'Every invoice, bill, receipt and stock movement posts its own journal, so the books are never a month behind the business.'],
      ['GST filing as a monthly scramble', 'GSTR-1 and GSTR-3B are built from the documents you already raised, with e-invoice and e-way bill details kept on each one.'],
      ['Payments chased by phone', 'Send a reminder with a link that opens the invoice, and a UPI payment link that closes with it.'],
    ],
    features: [
      ['Sales', 'Quotations, sales orders, delivery challans, invoices, credit notes and recurring invoices.'],
      ['Purchases', 'Purchase orders, bills, debit notes and expenses, with TDS where it applies.'],
      ['Inventory', 'Items, warehouses, transfers, batches and serial numbers, valued as stock moves.'],
      ['Banking', 'Bank and cash books, receipts and payments, and bank reconciliation.'],
      ['GST', 'e-Invoices, e-way bills, GSTR-1 and GSTR-3B, from the documents themselves.'],
      ['Reports', 'Profit and loss, balance sheet, trial balance and the day book, by branch.'],
    ],
    workflow: {
      title: 'From a sale to the ledger',
      steps: [
        ['Raise the invoice', 'GST is worked out from the place of supply; the e-invoice is generated with it.'],
        ['Send it', 'The customer gets a link to the invoice and, if you use UPI, a link to pay.'],
        ['Record the receipt', 'Allocate it against the invoice; the balance and the ledger update together.'],
        ['File', 'The month’s returns are already made from what was raised.'],
      ],
    },
    roles: 'Owners and accountants see everything; a salesperson can be limited to their own customers and documents, a branch to its own books. Approvals can sit in front of invoices above an amount.',
    faq: [
      ['Can I bring my data from Tally?', 'Yes. Masters and opening balances can be imported, and the Tally connector can keep Tally in step while you move.'],
      ['Does it handle more than one branch or GSTIN?', 'Yes. Each branch keeps its own GSTIN, series and stock, and reports can be read per branch or together.'],
      ['Can my accountant work in it?', 'Yes. Invite them from your Workspace (Access, then Invitations) with their own login; you decide what they can see and change, and can end it at any time.'],
    ],
  },
  people: {
    title: 'The HR app for a company that is growing.',
    intro:
      'Each person’s details, documents and history in one place; attendance, leave and shifts inside it, so you do not need Attendance as well; joining and leaving run from checklists; and every employee gets an app for their own requests.',
    problems: [
      ['The same person in five spreadsheets', 'One employee record that Attendance, Payroll and the employee app all read. Change it once and it is right everywhere.'],
      ['Joining and leaving done from memory', 'Checklists for joining and leaving, with tasks for HR, IT and the manager, ticked as the work is done.'],
      ['HR as the help desk for everything', 'Employees see their payslips, leave, documents and requests in their own app, and raise what they need there.'],
    ],
    features: [
      ['Employee records', 'Personal, job and statutory details with a dated history of every change.'],
      ['Time and leave', 'Everything Attendance does, inside People: readers, phone punches, shifts, leave balances and approvals, and the month close.'],
      ['Documents', 'Offer letters, IDs and certificates, with expiry reminders and who may see each one.'],
      ['Onboarding and exits', 'Joining and leaving checklists, notice periods and final settlement handed to Payroll.'],
      ['Org chart', 'Departments, managers and reporting lines, kept current from the records.'],
      ['Letters', 'Templates for offer, appointment and experience letters, filled from the record.'],
      ['Employee app', 'Payslips, leave, attendance, documents and requests on the employee’s own phone.'],
    ],
    workflow: {
      title: 'A new joiner’s first week',
      steps: [
        ['Add the person', 'HR enters the joining details; the record is the start of everything else.'],
        ['Run the checklist', 'IT, HR and the manager each see their tasks; nothing depends on someone remembering.'],
        ['Invite to the app', 'The employee activates their app and completes their own details.'],
        ['On the reader and payroll', 'Attendance enrols them on the readers; Payroll takes them from the joining date.'],
      ],
    },
    roles: 'HR sees the whole company; managers see their teams; each employee sees only themselves. Sensitive documents and fields, such as bank details and IDs, can be limited to the people who need them.',
    faq: [
      ['Do employees need a login to the workspace?', 'No. They use the employee app with an activation code from HR; it opens only their own data.'],
      ['Can I use People without Payroll?', 'Yes. Each CLOR product works on its own; together they share the employee record.'],
      ['Do I need Attendance as well as People?', 'No. People includes attendance, leave and shifts. Attendance on its own is for a small company that wants only time and leave.'],
      ['Can we import our employee list?', 'Yes, from a spreadsheet, with a preview before anything is saved.'],
    ],
  },
  payroll: {
    title: 'Payroll that ends in your books.',
    intro:
      'Run salaries with PF, ESI, professional tax and TDS worked out, publish payslips to every employee’s app, and post the run and the payment straight into Books.',
    problems: [
      ['Attendance re-typed into payroll', 'Paid days, overtime and leave arrive from the closed attendance month.'],
      ['Statutory files built by hand', 'PF ECR, ESI contributions, PT and Form 16 come out of the payslips themselves.'],
      ['Salary journals entered twice', 'Locking the run posts its journal to Books; paying salaries posts the payment.'],
    ],
    features: [
      ['Salary structures', 'Components, formulas and pay groups, with revisions dated from when they apply.'],
      ['Statutory', 'PF, ESI, professional tax by state, TDS on salary, and Form 16.'],
      ['Pay runs', 'Validate, calculate, review and lock, with every change before locking kept.'],
      ['Payslips', 'Published to the employee app, and kept for as long as the law asks.'],
      ['Settlements', 'Final settlement with leave encashment and gratuity when someone leaves.'],
      ['Accounting', 'Journals and payments posted to Books, to the ledgers you choose.'],
    ],
    workflow: {
      title: 'One month’s payroll',
      steps: [
        ['Attendance closes the month', 'Paid days, overtime and leave are fixed for the run.'],
        ['Calculate and review', 'Every payslip is worked out; differences from last month are shown.'],
        ['Lock and publish', 'Payslips reach the employee app; the journal posts to Books.'],
        ['Pay and file', 'Record the payment, then download the statutory files.'],
      ],
    },
    roles: 'Payroll staff run the payroll; changes to bank details wait for a second person’s approval; sensitive figures can need an authenticator code to open.',
    faq: [
      ['Do I need Books to use Payroll?', 'No. Payroll works on its own; with Books, the postings happen for you.'],
      ['Which states’ professional tax is covered?', 'Professional tax is set per state for each employee’s work location.'],
      ['Can I correct a locked run?', 'Corrections go into the next run as adjustments, so the locked payslips stay as issued.'],
    ],
  },
  attendance: {
    title: 'Time and leave for a small company.',
    intro:
      'Connect your biometric readers or let people punch from their phone within your sites, set shifts and rules, approve leave and corrections, and close the month for payroll. When the company grows and needs records, documents and onboarding too, People takes over and includes all of this.',
    problems: [
      ['Readers that nobody can read', 'Punches arrive from ZKTeco, eSSL, Hikvision and Matrix readers as they happen.'],
      ['Field staff on the honour system', 'Phone punches inside a geofence, with a selfie when you want one, and a manager’s approval outside it.'],
      ['Month end in a spreadsheet', 'Days are worked out from shifts and rules as punches arrive; closing the month hands them to Payroll.'],
    ],
    features: [
      ['Readers', 'Biometric and face readers connected to the cloud, enrolled from the employee record.'],
      ['Phone punch', 'Location and geofences, optional selfie, and approvals for punches away from a site.'],
      ['Shifts and rules', 'Shifts, rosters, late marks, overtime and weekly offs.'],
      ['Leave', 'Leave types, balances, requests and approvals, from the employee app.'],
      ['Corrections', 'Missed punches and on-duty requests, approved by the manager.'],
      ['Month close', 'Review, close and hand paid days to Payroll; reopen if something changes.'],
    ],
    workflow: {
      title: 'A day of attendance',
      steps: [
        ['Punch', 'On a reader at the gate, or on a phone at a client site.'],
        ['Worked out', 'The day is marked from the shift: present, late, half day or overtime.'],
        ['Corrected', 'A missed punch is requested by the employee and approved by the manager.'],
        ['Closed', 'At month end the totals go to Payroll.'],
      ],
    },
    roles: 'Managers approve their teams’ leave and corrections; HR sees every site; selfies are kept only as long as the company’s retention period.',
    faq: [
      ['Which readers work with CLOR?', 'ZKTeco and eSSL readers over their push protocol, Hikvision and Matrix readers, and others through the on-site connector.'],
      ['Do phone punches need GPS?', 'Yes, location is checked against your sites; punches outside them can still be approved by a manager.'],
      ['Can we use Attendance without Payroll?', 'Yes. The month’s totals can also be exported for another payroll.'],
      ['When should we choose People instead?', 'When you need more than time and leave: employee records, documents, joining and leaving checklists, letters and an org chart. People includes everything Attendance does.'],
    ],
  },
  workspace: {
    title: 'One sign-in, and who may see what.',
    intro:
      'Workspace comes with every CLOR product. It holds your companies and branches, the people who sign in and the role each one has, invitations to your accountant, and the audit trail of every change.',
    problems: [
      ['A login for each tool', 'One sign-in opens every CLOR product you use, and every company you run, from one company menu.'],
      ['Nobody sure who can see what', 'Each user has a role per company and sees only the companies, branches and products you gave them.'],
      ['The accountant using your password', 'Invite your accountant with their own login, choose their role, set an end date if you like, and end it any time.'],
    ],
    features: [
      ['Companies and branches', 'All your companies under one sign-in; each branch with its own GSTIN, series and stock.'],
      ['Users and roles', 'Invite people by email and give each a role per company. Change or remove it whenever you need.'],
      ['Outside access', 'Access for an accountant or auditor that ends on a date you choose.'],
      ['Audit trail', 'Every change to records, roles and access, written in plain words with who made it and when.'],
      ['Single sign-on', 'Sign in through Google Workspace, Microsoft Entra ID or another provider over SAML or OpenID Connect; SCIM keeps users in step.'],
      ['Subscriptions', 'Switch a product on for a company when you need it; the data stays if you switch it off.'],
    ],
    workflow: {
      title: 'Setting a company up',
      steps: [
        ['Add the company', 'Name, address and GSTIN; branches if you have them.'],
        ['Switch on the products', 'Books, People, Attendance or Payroll, for the companies that use them.'],
        ['Invite people', 'Your accountant, HR and managers, each with a role. Staff use the employee app instead.'],
        ['Read the trail', 'Everything anyone changes is in the audit trail, in plain words.'],
      ],
    },
    roles: 'The owner sees everything and decides every role. An accountant sees the books they were invited to. A manager sees their team. An employee never signs in here; they use the employee app, which opens only their own data.',
    faq: [
      ['Is Workspace sold separately?', 'No. It comes with any CLOR product. There is nothing to pay for it on its own.'],
      ['Can one person work in several companies?', 'Yes. One sign-in, and the company menu switches between them without signing out.'],
      ['Can I close a company?', 'Yes. Closing a company needs a fresh authenticator code and comes with a notice period before anything is deleted.'],
    ],
  },
  projects: {
    title: 'Projects is on its way.',
    intro: 'Plan work, track tasks and see what each project costs, using the same login, employees and books as the rest of CLOR.',
    planned: ['Projects, tasks and milestones', 'Team assignment from People', 'Costs and billing through Books'],
  },
  timesheet: {
    title: 'Timesheet is on its way.',
    intro: 'Log time against projects and clients, approve it, and bill it. The hours can go on to payroll and to invoices where you want them.',
    planned: ['Daily and weekly time entry', 'Approval by the manager', 'Billable hours to invoices'],
  },
};
