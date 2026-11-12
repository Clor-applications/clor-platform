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
  company: 'CLOR Applications Private Limited',
  url: SITE_URL,
  appUrl: APP_URL,
  apiUrl: API_URL,
  /* The app's own doors: /signin and /signup open those pages directly. */
  signInUrl: `${APP_URL}/signin`,
  signUpUrl: `${APP_URL}/signup`,
  /* A free trial from the pricing page: /start?app=<slug> checks the email, then asks for the company and the apps. No card. */
  startUrl: `${APP_URL}/start`,
  /* Each product's own address (books.clor.in, people.clor.in, ...): the header's product menu opens it in a new tab. */
  appHomeFor: (slug) => APP_URL.replace('//app.', `//${slug}.`),
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

/** status: 'available' | 'soon'. accent: the product's own colour, used only on its own marks. */
export const PRODUCTS = [
  {
    slug: 'books',
    name: 'Books',
    category: 'Finance',
    status: 'available',
    accent: '#232A66',
    line: 'GST invoicing, accounting and inventory, built for Indian businesses.',
  },
  {
    slug: 'payroll',
    name: 'Payroll',
    category: 'HR',
    status: 'available',
    accent: '#0079BF',
    line: 'Salaries with PF, ESI, PT and TDS, payslips, and postings into your books.',
  },
  {
    slug: 'people',
    name: 'People',
    category: 'HR',
    status: 'available',
    accent: '#C93F28',
    line: 'Employee records, documents, onboarding and an app for every employee.',
  },
  {
    slug: 'attendance',
    name: 'Attendance',
    category: 'HR',
    status: 'available',
    accent: '#854D0E',
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
    accent: '#57534E',
    line: 'Time logged against projects and clients, approved and billed.',
  },
];

export const productBySlug = (slug) => PRODUCTS.find((p) => p.slug === slug);
export const AVAILABLE = PRODUCTS.filter((p) => p.status === 'available');

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
    { href: '/company/team', name: 'Team', line: 'The people behind CLOR.' },
    { href: '/contact', name: 'Contact', line: 'Talk to us about your business.' },
  ],
};

/** The app id inside app.clor.in, where it differs from the site's slug. */
const APP_ID = { books: 'accounting' };
/** A demo request for one product: the form reads ?app= and ticks it. */
export const demoFor = (slug) => `${SITE.demoUrl}?app=${slug}`;
export const appIdFor = (slug) => APP_ID[slug] || slug;
