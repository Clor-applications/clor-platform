/**
 * The Help centre's articles. Each says what a part of CLOR is for, where it
 * is, and the few steps people actually take there. Places are named exactly
 * as the menus name them; `open` is a screen the article can open directly
 * ({ app, screen }). Integration guides that need more room stay as pages
 * under /docs (`doc`).
 *
 * Keep this true to the product: when a menu is renamed or a screen moves,
 * change the article in the same change. The step-by-step guides for
 * Workspace, People and Attendance are in helpGuides.js.
 */
import { GUIDES, GUIDE_GROUPS } from './helpGuides';

export const HELP_GROUPS = [
  { key: 'start', label: 'Getting started' },
  { key: 'workspace', label: 'Workspace' },
  ...GUIDE_GROUPS,
  { key: 'apps', label: 'Apps' },
  { key: 'integrations', label: 'Integrations' },
];

const OVERVIEWS = [
  {
    key: 'welcome',
    group: 'start',
    title: 'Welcome to CLOR',
    summary: 'One sign-in for your books, people, payroll and attendance. The Workspace runs the account; each app does its own work.',
    sections: [
      {
        heading: 'How CLOR is laid out',
        points: [
          'The Workspace is where the account is run: companies, who has access, sign-in rules, the plan and your data.',
          'Accounting, Payroll, People and Attendance are the apps. Each company switches on the apps it uses.',
          'The rail on the left lists the sections of the app you are in; each opens its own page.',
        ],
      },
      {
        heading: 'Finding your way',
        points: [
          'Search (Ctrl K, or ⌘K on a Mac) finds any screen or app by name.',
          'Breadcrumbs above a page title open that section; the ← button goes back to where you were.',
          'Your Overview lists your apps; open one from its card.',
        ],
      },
    ],
    open: { app: 'admin', screen: 'home', label: 'Open the Overview' },
  },
  {
    key: 'setup',
    group: 'start',
    title: 'Set up your workspace',
    summary: 'Four things make a new company ready to use. The Setup ring at the foot of the Workspace rail shows how far you are.',
    sections: [
      {
        heading: 'The four steps',
        steps: [
          'Add company details — GSTIN, PAN and the registered address, under Company › Company profile.',
          'Invite your team — Access › Invitations. People choose their own password from the link.',
          'Give everyone access — Access › Users. Each person needs a role that opens at least one app.',
          'Protect admin sign-in — Security › Sign-in and sessions: require an authenticator app for owners and admins.',
        ],
      },
    ],
    open: { app: 'admin', screen: 'company', label: 'Open Company profile' },
  },
  {
    key: 'search',
    group: 'start',
    title: 'Search and shortcuts',
    summary: 'Get to any screen without the menus.',
    sections: [
      {
        heading: 'Search',
        points: [
          'Click the search field at the top, or press Ctrl K (⌘K on a Mac).',
          'Type part of a screen or app name — “users”, “pay runs”, “invoices” — and press Enter.',
        ],
      },
    ],
  },
  {
    key: 'companies',
    group: 'workspace',
    title: 'Companies',
    summary: 'Each company is a legal entity with its own books, people and payroll. One account can hold several.',
    sections: [
      {
        heading: 'Where',
        points: ['Workspace › Company › Companies.'],
      },
      {
        heading: 'Common tasks',
        steps: [
          'Add a company: Add company, then its name, state and (if registered) GSTIN.',
          'See a company at a glance: click its name — figures, who administers it, its people and its apps.',
          'Work in another company: Switch to on its row, or Switch to this company in its panel.',
          'Fill in legal details: Company › Company profile; branches under Company › Branches.',
        ],
      },
    ],
    open: { app: 'admin', screen: 'companies', label: 'Open Companies' },
  },
  {
    key: 'people',
    group: 'workspace',
    title: 'People and access',
    summary: 'Who is in the account, which companies they can open, and what they can do there.',
    sections: [
      {
        heading: 'The pages',
        points: [
          'Members — everyone in the account, their account role, companies and apps.',
          'Users — the logins of the company you are in, with their role here.',
          'Invitations — invite by email; links work once and expire in 7 days.',
          'Outside access — people from other accounts, such as your accountant, and until when.',
        ],
      },
      {
        heading: 'Account roles',
        points: [
          'Account Owner — runs the account, its plan and its owners.',
          'Account Admin — adds companies and invites people.',
          'Billing Admin — sees the account, its plan and billing.',
          'Member — what they can do in a company comes from their company roles.',
        ],
      },
    ],
    open: { app: 'admin', screen: 'members', label: 'Open Members' },
  },
  {
    key: 'roles',
    group: 'workspace',
    title: 'Roles and permissions',
    summary: 'A role is a set of permissions. People get roles under Users; permissions are ticked under Permissions.',
    sections: [
      {
        heading: 'Common tasks',
        steps: [
          'Create a role: Access › Roles › Create role, named for the work it covers.',
          'Choose what it may do: Access › Permissions — pick the role, tick by app and module, then Save changes.',
          'Start from a template to fill the ticks, then adjust.',
          'Give it to someone: Access › Users, open the person, Edit, choose the role.',
        ],
      },
      {
        heading: 'Good to know',
        points: ['Which records a person sees (branches, warehouses) is set on the person under Users, not on the role.'],
      },
    ],
    open: { app: 'admin', screen: 'roles', label: 'Open Roles' },
  },
  {
    key: 'security',
    group: 'workspace',
    title: 'Sign-in and security',
    summary: 'How people sign in, how long they stay signed in, and the record of what changed.',
    sections: [
      {
        heading: 'The pages',
        points: [
          'Sign-in and sessions — lockout, session length, password rules, who may sign in; your own sessions.',
          'Single sign-on — sign in through Google Workspace, Microsoft Entra, Okta or another provider.',
          'Credentials — API keys and tokens other systems use; pause, rotate or revoke them.',
          'Audit trail — every change in the company, who made it and when.',
          'Account activity — changes to the account itself, and refused attempts.',
        ],
      },
    ],
    open: { app: 'admin', screen: 'securityHome', label: 'Open Security' },
  },
  {
    key: 'plan',
    group: 'workspace',
    title: 'Plan and billing',
    summary: 'Your plan, what it allows, and how much of it you use.',
    sections: [
      {
        heading: 'Where',
        points: ['Workspace › Plan › Subscription for the plan and usage.', 'Plan › Billing holds invoices and payment details once billing starts; nothing is charged before then.'],
      },
    ],
    open: { app: 'admin', screen: 'account', label: 'Open Subscription' },
  },
  {
    key: 'data',
    group: 'workspace',
    title: 'Your data',
    summary: 'Take a copy of a company’s data, or close a company.',
    sections: [
      {
        heading: 'Export',
        points: ['Data › Data export downloads the books and documents, or the configuration, as a file you keep.'],
      },
      {
        heading: 'Closing a company',
        steps: [
          'Download a full export first.',
          'Data › Close company, give a reason and type the company’s name.',
          'The company keeps working through the notice period; you can cancel at any time in it.',
          'After the notice period every record of the company is deleted for good.',
        ],
      },
    ],
    open: { app: 'admin', screen: 'dataHome', label: 'Open Data' },
  },
  {
    key: 'accounting',
    group: 'apps',
    title: 'Books',
    summary: 'Invoices, bills, GST and the books behind them.',
    sections: [
      {
        heading: 'Where things are',
        points: [
          'Sales — invoices, quotations, sales orders, receipts, returns, delivery challans.',
          'Purchases — bills, purchase orders, payments, returns, expenses.',
          'Cash & Bank — bank and cash accounts, reconciliation.',
          'Inventory — items, stock adjustments, transfers, batches.',
          'Reports — P&L, balance sheet, trial balance, general ledger, GST.',
          'Settings — numbering, invoice templates, GST rates, features.',
        ],
      },
    ],
    open: { app: 'accounting', screen: '', label: 'Open Accounting' },
  },
  {
    key: 'payroll',
    group: 'apps',
    title: 'Payroll',
    summary: 'Salaries, statutory deductions, payslips and the journal they post.',
    sections: [
      {
        heading: 'A month’s pay',
        steps: [
          'Before the run: check adjustments, loans and advances, and tax declarations.',
          'Pay runs: start the month’s run, review, approve.',
          'Salary slips and payments follow from the approved run.',
          'Books: post the run to Accounting, or export it for Tally.',
        ],
      },
      {
        heading: 'Setup',
        points: ['Pay calendar, pay groups, salary components and structures, statutory compliance and ledger mapping, under Setup.'],
      },
    ],
    open: { app: 'payroll', screen: '', label: 'Open Payroll' },
  },
  {
    key: 'people-app',
    group: 'apps',
    title: 'People',
    summary: 'Every HR job in one place: employees, time off, hiring, growth and the workplace.',
    sections: [
      {
        heading: 'Where things are',
        points: [
          'Employees — directory, org chart, documents, onboarding and exit, letters.',
          'Time & Leave — leave requests, balances, calendar, attendance requests, holidays.',
          'Hiring — jobs and candidates. Performance — goals, feedback, training.',
          'Settings — company details, departments, designations, approval rules, modules.',
        ],
      },
    ],
    open: { app: 'people', screen: '', label: 'Open People' },
  },
  {
    key: 'attendance',
    group: 'apps',
    title: 'Attendance',
    summary: 'Biometric readers, shifts, leave, corrections and payable days.',
    sections: [
      {
        heading: 'Where things are',
        points: [
          'Readers — reader health, logs, enrolment; punch data and unmatched punches.',
          'Attendance — daily records, exceptions, corrections; scheduling and shifts.',
          'Period closing — lock the month and hand payable days to Payroll.',
          'Settings — work policy, integrations, data and privacy.',
        ],
      },
    ],
    open: { app: 'attendance', screen: '', label: 'Open Attendance' },
  },
  {
    key: 'readers',
    group: 'integrations',
    title: 'Biometric readers',
    summary: 'ZKTeco/eSSL, Matrix COSEC, Hikvision, Dahua, Suprema, Anviz, e-Time Office, or a CSV import.',
    doc: '/docs/readers.html',
  },
  {
    key: 'connector',
    group: 'integrations',
    title: 'On-site connector',
    summary: 'For readers on the office network, Tally on your LAN, and Active Directory.',
    doc: '/docs/connector.html',
  },
  {
    key: 'hr-tools',
    group: 'integrations',
    title: 'HR tools',
    summary: 'greytHR, Keka, Zoho People: punches out, people in.',
    doc: '/docs/hr-tools.html',
  },
  {
    key: 'tally',
    group: 'integrations',
    title: 'Tally',
    summary: 'Payroll entries as import XML, or posted straight into Tally.',
    doc: '/docs/tally.html',
  },
  {
    key: 'sso',
    group: 'integrations',
    title: 'Single sign-on',
    summary: 'Google Workspace, Microsoft Entra, Okta, ADFS — OpenID Connect and SAML 2.0.',
    doc: '/docs/sso.html',
  },
  {
    key: 'scim',
    group: 'integrations',
    title: 'Directory sync (SCIM)',
    summary: 'Your identity provider adds and removes people in CLOR.',
    doc: '/docs/scim.html',
  },
];

/* The overviews, then the guides; "Your first week" opens the Getting started group. */
export const HELP_TOPICS = [
  OVERVIEWS[0],
  ...GUIDES.filter((g) => g.group === 'start'),
  ...OVERVIEWS.slice(1),
  ...GUIDES.filter((g) => g.group !== 'start'),
];

/** Topics whose title, summary, keywords or text mention every word typed. */
export function searchHelp(query, topics = HELP_TOPICS) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return topics;
  return topics.filter((t) => {
    const text = [t.title, t.summary, ...(t.keywords || []), ...(t.sections || []).flatMap((s) => [s.heading, ...(s.points || []), ...(s.steps || [])])].join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
