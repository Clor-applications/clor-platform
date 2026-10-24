/**
 * Everything the site says about Clor that could go out of date lives here,
 * so one file is checked before publishing (see CONTENT_CHECKLIST.md).
 *
 * Product status follows the platform's own app catalogue
 * (server/src/constants/appCatalog.ts): accounting, payroll, attendance and
 * people are available; projects is planned; timesheet has no app yet.
 */

export const SITE = {
  name: 'Clor',
  company: 'Clor Applications Pvt Ltd',
  url: 'https://clor.in',
  appUrl: 'https://app.clor.in',
  signInUrl: 'https://app.clor.in/',
  /* The app opens sign-up from its front door today; a deep link can replace this once the app has one. */
  signUpUrl: 'https://app.clor.in/',
  /* Confirmed by the company, 2026-10-24. */
  contactEmail: 'info@clor.in',
  salesEmail: 'sales@clor.in',
  supportEmail: 'support@clor.in',
  address: 'No. 8, Ground Floor, 5th Cross, Veerasagara Main Road, Meneshwara Layout, Attur, Yelahanka, Bengaluru 560064',
  /* Verified from the deployment config (Cloud Run service URL). */
  hosting: 'Google Cloud, Mumbai region',
};

/** status: 'available' | 'soon'. accent: the product's own colour, used only on its own marks. */
export const PRODUCTS = [
  {
    slug: 'books',
    name: 'Books',
    category: 'Finance',
    status: 'available',
    accent: '#2F6FDB',
    line: 'GST invoicing, accounting and inventory, built for Indian businesses.',
  },
  {
    slug: 'people',
    name: 'People',
    category: 'HR',
    status: 'available',
    accent: '#7A4FD6',
    line: 'Employee records, documents, onboarding and an app for every employee.',
  },
  {
    slug: 'payroll',
    name: 'Payroll',
    category: 'HR',
    status: 'available',
    accent: '#1E9E6A',
    line: 'Salaries with PF, ESI, PT and TDS, payslips, and postings into your books.',
  },
  {
    slug: 'attendance',
    name: 'Attendance',
    category: 'HR',
    status: 'available',
    accent: '#D07A1F',
    line: 'Biometric readers, phone punches with location, shifts, leave and month close.',
  },
  {
    slug: 'projects',
    name: 'Projects',
    category: 'Operations',
    status: 'soon',
    accent: '#2E8DA3',
    line: 'Plan work, track tasks and see what each project costs.',
  },
  {
    slug: 'timesheet',
    name: 'Timesheet',
    category: 'Operations',
    status: 'soon',
    accent: '#B5487A',
    line: 'Time logged against projects and clients, approved and billed.',
  },
];

export const productBySlug = (slug) => PRODUCTS.find((p) => p.slug === slug);
export const AVAILABLE = PRODUCTS.filter((p) => p.status === 'available');

/**
 * Links between products that work today — each a real path in the platform:
 * People holds the one employee record, Attendance closes a month for payroll,
 * a locked pay run posts its journal to Books.
 */
export const CONNECTIONS = [
  { from: 'people', to: 'attendance', text: 'Attendance reads each person from People: one employee, one ID, on every reader.' },
  { from: 'attendance', to: 'payroll', text: 'Closing the attendance month hands paid days, overtime and leave to the pay run.' },
  { from: 'payroll', to: 'books', text: 'Locking a pay run posts its journal to Books; paying salaries posts the payment.' },
];

export const NAV = {
  solutions: [
    { href: '/solutions/businesses', name: 'For businesses', line: 'Books, people and payroll in one workspace.' },
    { href: '/solutions/accounting-firms', name: 'For accounting firms', line: 'Work in clients’ books with the access they give you.' },
  ],
  resources: [
    { href: '/resources', name: 'Guides', line: 'Setting up readers, connectors, sign-in and more.' },
    { href: '/integrations', name: 'Integrations', line: 'What connects to Clor today.' },
    { href: '/security', name: 'Security', line: 'How your data is kept apart and safe.' },
  ],
  company: [
    { href: '/company/about', name: 'About', line: 'Who builds Clor, and why.' },
    { href: '/contact', name: 'Contact', line: 'Talk to us about your business.' },
  ],
};
