/**
 * Everything the site says about Clor that could go out of date lives here,
 * so one file is checked before publishing (see CONTENT_CHECKLIST.md).
 *
 * Product status follows the platform's own app catalogue
 * (server/src/constants/appCatalog.ts): accounting, payroll, attendance and
 * people are available; projects is planned; timesheet has no app yet.
 */

/* A staging build points at its own app (VITE_APP_URL=https://app.staging.clor.in); production needs nothing set. */
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const SITE_URL = env.VITE_SITE_URL || 'https://clor.in';
const APP_URL = env.VITE_APP_URL || 'https://app.clor.in';
/* The API beside the app: app.clor.in -> api.clor.in, app.staging.clor.in -> api.staging.clor.in. VITE_API_URL for a local run. */
const API_URL = env.VITE_API_URL || `${APP_URL.replace('//app.', '//api.')}/api`;

export const SITE = {
  name: 'CLOR',
  company: 'Clor Applications Pvt Ltd',
  url: SITE_URL,
  appUrl: APP_URL,
  apiUrl: API_URL,
  /* The app's own doors: /signin and /signup open those pages directly. */
  signInUrl: `${APP_URL}/signin`,
  signUpUrl: `${APP_URL}/signup`,
  /* Staff punch, apply for leave and read payslips here, with no CLOR user of their own. */
  portalUrl: `${APP_URL.replace('//app.', '//attendance.')}/#/portal`,
  /* The Request a demo form (pages/Demo.jsx); the header's button opens it with no app chosen. */
  demoUrl: '/demo',
  /* Short form for the About page and the footer. */
  city: 'Yelahanka, Bengaluru',
  /* Confirmed by the company, 2026-10-24. */
  contactEmail: 'info@clor.in',
  salesEmail: 'sales@clor.in',
  supportEmail: 'support@clor.in',
  address: 'No. 8, Ground Floor, 5th Cross, Veerasagara Main Road, Meneshwara Layout, Attur, Yelahanka, Bengaluru 560064',
  /* Verified from the deployment config (Cloud Run service URL). */
  hosting: 'Google Cloud, Mumbai region',
};

/**
 * status: 'available' | 'soon'. accent: the product's own colour, used only on its own marks.
 * Each available product has figures drawn with sample data in components/Figures.jsx.
 * Order is the owner's: Books first, then People, Attendance, Payroll, Workspace.
 */
export const PRODUCTS = [
  {
    slug: 'books',
    name: 'Books',
    category: 'Accounting',
    status: 'available',
    accent: '#232A66',
    line: 'GST invoices, e-way bills, stock, bank reconciliation and the returns, for Indian businesses.',
    who: 'Any company that raises GST invoices',
  },
  {
    slug: 'people',
    name: 'People',
    category: 'HR',
    status: 'available',
    accent: '#C93F28',
    line: 'The full HR app for growing, medium and big companies: records, documents, leave, attendance, joining and leaving, and an app for every employee.',
    who: 'Growing, medium and big companies',
  },
  {
    slug: 'attendance',
    name: 'Attendance',
    category: 'HR',
    status: 'available',
    accent: '#854D0E',
    line: 'Time, leave and shifts for small companies, from biometric readers at the gate or a phone on site.',
    who: 'Small companies',
  },
  {
    slug: 'payroll',
    name: 'Payroll',
    category: 'HR',
    status: 'available',
    accent: '#0079BF',
    line: 'Salaries with PF, ESI, professional tax and TDS worked out, payslips in the employee app, and the journal posted to Books.',
    who: 'Any company that pays salaries',
  },
  {
    slug: 'workspace',
    name: 'Workspace',
    category: 'Platform',
    status: 'available',
    accent: '#FF5400',
    line: 'The one sign-in behind every CLOR app: your companies and branches, your people and what each may see, and the audit trail.',
    who: 'Included with every product',
  },
  {
    slug: 'projects',
    name: 'Projects',
    category: 'Coming soon',
    status: 'soon',
    accent: '#2E8DA3',
    line: 'Plan work, track tasks and see what each project costs.',
  },
  {
    slug: 'timesheet',
    name: 'Timesheet',
    category: 'Coming soon',
    status: 'soon',
    accent: '#57534E',
    line: 'Time logged against projects and clients, approved and billed.',
  },
];

export const productBySlug = (slug) => PRODUCTS.find((p) => p.slug === slug);
export const AVAILABLE = PRODUCTS.filter((p) => p.status === 'available');
/** The apps a demo can be asked for: the ones the demo form and the platform's app catalogue know. */
export const DEMO_APPS = AVAILABLE.filter((p) => p.slug !== 'workspace');

/**
 * Links between products that work today, each a real path in the platform:
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
    { href: '/solutions/businesses', name: 'For businesses', line: 'GST invoices, staff records and salaries under one login.' },
    { href: '/solutions/accounting-firms', name: 'For accounting firms', line: 'Work in clients’ books with the access they give you.' },
  ],
  resources: [
    { href: '/resources', name: 'Guides', line: 'Setting up readers, connectors, sign-in and more.' },
    { href: '/integrations', name: 'Integrations', line: 'Readers, Tally, HR tools and sign-in that connect today.' },
    { href: '/security', name: 'Security', line: 'How your data is kept apart and safe.' },
  ],
  company: [
    { href: '/company/about', name: 'About', line: 'Who makes CLOR, and where.' },
    { href: '/contact', name: 'Contact', line: 'Talk to us about your business.' },
  ],
};

/** The app id inside app.clor.in, where it differs from the site's slug. */
const APP_ID = { books: 'accounting' };
/** Links in the header bar; everything else is reached from the footer and the pages themselves. */
export const HEADER = [
  { href: '/products', name: 'Products' },
  { href: '/pricing', name: 'Pricing' },
];
/** A demo request for one product: the form reads ?app= and ticks it. */
export const demoFor = (slug) => `${SITE.demoUrl}?app=${slug}`;
export const appIdFor = (slug) => APP_ID[slug] || slug;
