/**
 * The app catalogue as clor.in and the app switcher list it (operator
 * console, Product, App catalogue): each app's name, whether it is offered,
 * and its one line. These are the built-in entries; an operator's change is
 * an AppCatalogueEntry row that wins over them.
 *
 * `code` is clor.in's name for the product page (books, not accounting);
 * `appId` is the app's id inside the product (packages/shell/registry.js).
 * What may be bought is a separate question (constants/appCatalog.ts).
 */
export type ListingStatus = 'AVAILABLE' | 'COMING_SOON' | 'HIDDEN';
export const LISTING_STATUSES: ListingStatus[] = ['AVAILABLE', 'COMING_SOON', 'HIDDEN'];

export type Listing = { code: string; appId: string; name: string; status: ListingStatus; blurb: string };

export const APP_LISTING: Listing[] = [
  { code: 'books', appId: 'accounting', name: 'Books', status: 'AVAILABLE', blurb: 'GST invoicing, accounting and inventory, built for Indian businesses.' },
  { code: 'people', appId: 'people', name: 'People', status: 'AVAILABLE', blurb: 'Employee records, documents, onboarding and an app for every employee.' },
  { code: 'attendance', appId: 'attendance', name: 'Attendance', status: 'AVAILABLE', blurb: 'Biometric readers, phone punches with location, shifts, leave and month close.' },
  { code: 'payroll', appId: 'payroll', name: 'Payroll', status: 'AVAILABLE', blurb: 'Salaries with PF, ESI, PT and TDS, payslips, and postings into your books.' },
  { code: 'workspace', appId: 'admin', name: 'Workspace', status: 'AVAILABLE', blurb: 'Your companies, users, sign-in rules and plan, in one place.' },
  { code: 'projects', appId: 'projects', name: 'Projects', status: 'COMING_SOON', blurb: 'Plan work, track tasks and see what each project costs.' },
  { code: 'timesheet', appId: 'timesheet', name: 'Timesheet', status: 'COMING_SOON', blurb: 'Time logged against projects and clients, approved and billed.' },
];
