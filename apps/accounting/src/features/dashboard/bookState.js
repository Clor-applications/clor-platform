/**
 * What state the book is in, so Home can answer the question it is actually in
 * a position to answer.
 *
 * Home used to draw one layout whatever it found. On a book with purchases
 * entered and nothing sold, that produced "Every invoice in the book is
 * settled" and "Nothing to chase today" beside a lakh of supplier bills —
 * reassurance, when the true answer was that nobody had been billed yet. The
 * panels were not wrong; they were answering questions the book could not
 * support.
 *
 *   new       nothing has been entered. There is no summary to draw, so Home
 *             is the setup list instead.
 *   setup     something exists — masters, purchases, stock — but nothing has
 *             been billed. Figures are real and shown, and the gap is named
 *             rather than dressed as good news.
 *   running   the book has issued documents. The full dashboard.
 *
 * "Billed" deliberately means a *posted* invoice. A draft is an intention, and
 * a book whose only sales document is a draft is still mid-setup.
 */

const rows = (v) => (Array.isArray(v) ? v : []);
const mine = (v, companyId) => rows(v).filter((r) => String(r?.companyId) === String(companyId));

export const BOOK_NEW = 'new';
export const BOOK_SETUP = 'setup';
export const BOOK_RUNNING = 'running';

/** The six things a book needs before it can raise its first invoice. */
export const setupSteps = (db, company) => {
  const companyId = company?.id;
  const customers = mine(db?.customers, companyId);
  const items = mine(db?.items, companyId);
  const invoices = mine(db?.invoices, companyId);
  const accounts = mine(db?.chartOfAccounts, companyId).filter((a) =>
    /bank|cash/i.test(String(a?.name || '') + String(a?.type || ''))
  );

  const hasGstin = Boolean(String(company?.gstin || '').trim());
  const hasState = Boolean(String(company?.state || '').trim());
  const posted = invoices.filter((i) => String(i?.status || '').toLowerCase() !== 'draft');

  return [
    {
      key: 'company',
      title: 'Company details',
      detail: hasState ? [company?.state, company?.gstin].filter(Boolean).join(' · ') : 'State decides how GST splits',
      done: hasState,
      cta: 'Company profile',
      go: 'settingsCompany',
    },
    {
      key: 'gstin',
      title: 'GSTIN',
      detail: hasGstin ? 'Registered' : 'Skip if you are not registered yet',
      done: hasGstin,
      optional: true,
      cta: 'Add GSTIN',
      go: 'settingsCompany',
    },
    {
      key: 'customer',
      title: 'Add your first customer',
      detail: customers.length ? `${customers.length} on file` : 'Needed before you can invoice',
      done: customers.length > 0,
      cta: 'Add customer',
      go: 'customers',
    },
    {
      key: 'item',
      title: 'Add an item or service',
      detail: items.length ? `${items.length} on file` : 'With its HSN/SAC and GST rate',
      done: items.length > 0,
      cta: 'Add item',
      go: 'items',
    },
    {
      key: 'invoice',
      title: 'Raise your first invoice',
      detail: posted.length ? `${posted.length} raised` : 'The first one is the hard one',
      done: posted.length > 0,
      cta: 'New invoice',
      go: 'newInvoice',
    },
    {
      key: 'bank',
      title: 'Add a bank or cash account',
      detail: accounts.length ? `${accounts.length} on file` : 'So receipts have somewhere to land',
      done: accounts.length > 0,
      cta: 'Add account',
      go: 'cashBank',
    },
  ];
};

/**
 * @returns 'new' | 'setup' | 'running'
 */
export const bookState = (db, company) => {
  const companyId = company?.id;
  const invoices = mine(db?.invoices, companyId);
  const posted = invoices.filter((i) => String(i?.status || '').toLowerCase() !== 'draft');
  if (posted.length) return BOOK_RUNNING;

  const anythingAtAll =
    invoices.length ||
    mine(db?.customers, companyId).length ||
    mine(db?.items, companyId).length ||
    mine(db?.bills, companyId).length ||
    mine(db?.vendors, companyId).length;

  return anythingAtAll ? BOOK_SETUP : BOOK_NEW;
};

export default bookState;
