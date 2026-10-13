import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const api = {
  listCustomers: vi.fn(),
  listVendors: vi.fn(),
  listItems: vi.fn(),
  listDeliveryChallans: vi.fn(),
  listSalesmen: vi.fn(),
  listFixedAssets: vi.fn(),
  listOrgMasters: vi.fn(),
  listSchedules: vi.fn(),
};
const listPayments = vi.fn();
const listDocsApi = vi.fn();
const listInvoicesApi = vi.fn();
const getJournalEntries = vi.fn();
const getLedgerAccounts = vi.fn(async () => ({ accounts: [] }));
const getFiscalYears = vi.fn();
const listPosDayCloses = vi.fn();

vi.mock('../api/masters', () => ({
  COLLECTION_FOR_KIND: { UOM: 'uoms', PRICE_LIST: 'priceLists' },
  listCustomers: (...a) => api.listCustomers(...a),
  listVendors: (...a) => api.listVendors(...a),
  listItems: (...a) => api.listItems(...a),
  listDeliveryChallans: (...a) => api.listDeliveryChallans(...a),
  listSalesmen: (...a) => api.listSalesmen(...a),
  listFixedAssets: (...a) => api.listFixedAssets(...a),
  listOrgMasters: (...a) => api.listOrgMasters(...a),
}));
vi.mock('../api/payments', () => ({ listPayments: (...a) => listPayments(...a) }));
vi.mock('../api/bankBook', () => ({ listBankBook: async () => ({ entries: [] }) }));
vi.mock('../api/posDayClose', () => ({ listPosDayCloses: (...a) => listPosDayCloses(...a) }));
vi.mock('../api/recurring', () => ({ listSchedules: (...a) => api.listSchedules(...a) }));
vi.mock('../api/ledger', () => ({
  getJournalEntries: (...a) => getJournalEntries(...a),
  getFiscalYears: (...a) => getFiscalYears(...a),
  /* The chart of accounts is hydrated too now that the browser keeps no copy
     of the books between visits. Without it here the whole hook fails to load,
     which is the mock reporting a real change rather than a broken test. */
  getLedgerAccounts: (...a) => getLedgerAccounts(...a),
}));
vi.mock('../api/purchaseDocs', () => ({
  hasApiSession: () => true,
  listDocsApi: (...a) => listDocsApi(...a),
}));
vi.mock('../api/invoices', () => ({ listInvoicesApi: (...a) => listInvoicesApi(...a) }));

import { useServerDocSync } from './useServerDocSync';

const Harness = ({ setDb, companyId = 1 }) => {
  useServerDocSync({ enabled: true, currentCompanyId: companyId, setDb });
  return null;
};

/** Runs the hook once and returns the book it produced from `start`. */
const hydrate = async (start = {}) => {
  let book = start;
  const setDb = (fn) => {
    book = typeof fn === 'function' ? fn(book) : fn;
  };
  render(<Harness setDb={setDb} />);
  await waitFor(() => expect(book).not.toBe(start));
  return book;
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({});
  listPayments.mockReset().mockResolvedValue([]);
  listDocsApi.mockReset().mockResolvedValue([]);
  listInvoicesApi.mockReset().mockResolvedValue([]);
  getJournalEntries.mockReset().mockResolvedValue({ entries: [] });
  getFiscalYears.mockReset().mockResolvedValue({ fiscalYears: [] });
  listPosDayCloses.mockReset().mockResolvedValue({ dayCloses: [] });
  api.listOrgMasters.mockResolvedValue({ masters: [] });
  api.listSchedules.mockResolvedValue({ schedules: [] });
});

/*
 * Three collections were given a table so they would stop living in one
 * browser, and then nothing fetched them — which fixes half the problem it was
 * meant to fix. Payments were the worst: created through the API and never read
 * back, so a new machine showed no receipts, no payments, and an empty book
 * side against a full bank statement.
 */
describe('collections that were written through but never read back', () => {
  it('keeps the fields required to edit a hydrated expense', async () => {
    listDocsApi.mockImplementation(async (kind) => kind === 'expense' ? [{
      id: 'expense-server-1',
      number: 'EXP-1',
      date: '2026-09-19',
      dueDate: '2026-09-19',
      partyId: 'vendor-server-1',
      partyName: 'ABCDEF',
      refNo: 'V-19',
      description: 'Office expense',
      subtotal: 1000,
      gstTotal: 180,
      total: 1180,
      tdsAmount: 20,
      tdsLedgerId: 'tds-ledger-1',
      tdsLedgerName: 'TDS 194C',
      items: [{ description: 'Office Expenses — Stationery', taxableAmount: 1000, gstRate: 18 }],
    }] : []);

    const book = await hydrate();
    expect(book.expenses[0]).toMatchObject({
      backendDocId: 'expense-server-1',
      partyId: 'vendor-server-1',
      vendorName: 'ABCDEF',
      description: 'Office expense',
      tdsAmount: 20,
      tdsLedgerId: 'tds-ledger-1',
    });
    expect(book.expenses[0].items[0].description).toBe('Office Expenses — Stationery');
  });

  it('brings delivery challans back', async () => {
    api.listDeliveryChallans.mockResolvedValue({
      documents: [
        { id: 'dc1', number: 'DC-1', date: '2026-09-01', partyName: 'Acme', purpose: 'JOB_WORK', total: 400, items: [], status: 'Open' },
      ],
    });
    const book = await hydrate();
    expect(book.deliveryChallans).toHaveLength(1);
    expect(book.deliveryChallans[0].number).toBe('DC-1');
    expect(book.deliveryChallans[0].customerName).toBe('Acme');
    // The server's SCREAMING_SNAKE becomes what the form shows.
    expect(book.deliveryChallans[0].purpose).toBe('Job Work');
  });

  it('brings salesmen back with their commission', async () => {
    api.listSalesmen.mockResolvedValue({ salesmen: [{ id: 's1', name: 'Ravi', commissionRate: 2.5, isActive: true }] });
    const book = await hydrate();
    expect(book.salesmen[0].name).toBe('Ravi');
    expect(book.salesmen[0].commissionPct).toBe(2.5);
  });

  it('brings fixed assets back', async () => {
    api.listFixedAssets.mockResolvedValue({
      assets: [{ id: 'a1', name: 'Lathe', cost: 100000, accumulatedDepreciation: 20000, depreciationRate: 15 }],
    });
    const book = await hydrate();
    expect(book.fixedAssets[0].name).toBe('Lathe');
    expect(book.fixedAssets[0].cost).toBe(100000);
  });

  /*
   * Asking once would hydrate the money coming in and quietly leave out the
   * money going out — `listPayments` defaults to receipts.
   */
  it('asks for both directions of payment', async () => {
    listPayments.mockImplementation(({ direction }) =>
      Promise.resolve(
        direction === 'RECEIPT'
          ? [{ id: 'p1', number: 'RCP-1', date: '2026-09-01', direction: 'RECEIPT', amount: 5000, partyType: 'CUSTOMER', partyName: 'Acme' }]
          : [{ id: 'p2', number: 'PAY-1', date: '2026-09-02', direction: 'PAYMENT', amount: 1200, partyType: 'VENDOR', partyName: 'Steel Co' }]
      )
    );
    const book = await hydrate();
    expect(listPayments).toHaveBeenCalledTimes(2);
    expect(book.payments).toHaveLength(2);
    expect(book.payments.find((p) => p.number === 'RCP-1').voucherType).toBe('receipt');
    expect(book.payments.find((p) => p.number === 'PAY-1').voucherType).toBe('payment');
  });

  /*
   * A payment already tied off against a statement must not be offered again on
   * the next machine that opens the book.
   */
  it('carries the reconciled flag across', async () => {
    listPayments.mockImplementation(({ direction }) =>
      Promise.resolve(
        direction === 'RECEIPT'
          ? [{ id: 'p1', number: 'RCP-1', date: '2026-09-01', direction: 'RECEIPT', amount: 5000, reconciled: true, statementRef: 'HDFC · NEFT' }]
          : []
      )
    );
    const book = await hydrate();
    expect(book.payments[0].reconciled).toBe(true);
    expect(book.payments[0].statementRef).toBe('HDFC · NEFT');
  });
});

describe('hydration never duplicates what the browser already has', () => {
  it('recognises a challan the browser wrote by its server id', async () => {
    api.listDeliveryChallans.mockResolvedValue({
      documents: [{ id: 'dc1', number: 'DC-1', date: '2026-09-01', partyName: 'Acme', total: 400, items: [] }],
    });
    const book = await hydrate({
      deliveryChallans: [{ id: 1, companyId: 1, backendDocId: 'dc1', number: 'DC-1', date: '2026-09-01' }],
    });
    expect(book.deliveryChallans).toHaveLength(1);
  });

  /* Written on another machine, so the browser has no server id for it — the
     number is what says it is the same document. */
  it('recognises a challan by its number when it has no server id', async () => {
    api.listDeliveryChallans.mockResolvedValue({
      documents: [{ id: 'dc9', number: 'DC-7', date: '2026-09-01', partyName: 'Acme', total: 400, items: [] }],
    });
    const book = await hydrate({
      deliveryChallans: [{ id: 1, companyId: 1, number: 'DC-7', date: '2026-09-01' }],
    });
    expect(book.deliveryChallans).toHaveLength(1);
  });

  /* The same person under two ids means a commission report counts their
     invoices once each. */
  it('recognises a salesman by name', async () => {
    api.listSalesmen.mockResolvedValue({ salesmen: [{ id: 's1', name: 'Ravi', commissionRate: 2 }] });
    const book = await hydrate({ salesmen: [{ id: 1, companyId: 1, name: 'Ravi' }] });
    expect(book.salesmen).toHaveLength(1);
  });

  it('keeps a local row the server has never seen', async () => {
    api.listSalesmen.mockResolvedValue({ salesmen: [{ id: 's1', name: 'Ravi', commissionRate: 2 }] });
    const book = await hydrate({ salesmen: [{ id: 1, companyId: 1, name: 'Only here' }] });
    expect(book.salesmen).toHaveLength(2);
  });
});

/*
 * Schedules used to live in localStorage and run only when somebody signed in.
 * They are the server's now, so a second device has to see them — otherwise
 * pausing a schedule on one machine leaves the other showing it as live.
 */
describe('recurring schedules', () => {
  it('come back from the server', async () => {
    api.listSchedules.mockResolvedValue({
      schedules: [
        {
          id: 'sch1',
          name: 'Monthly retainer',
          partyName: 'Acme',
          frequency: 'MONTHLY',
          interval: 1,
          nextRunDate: '2026-10-01',
          dueDays: 15,
          isActive: true,
          generatedCount: 3,
          template: { items: [{ description: 'Retainer' }], total: 11800 },
        },
      ],
    });
    const book = await hydrate();
    const [t] = book.recurringTemplates;
    expect(t.name).toBe('Monthly retainer');
    expect(t.nextRunDate).toBe('2026-10-01');
    expect(t.total).toBe(11800);
    // The screen has always called it `active`.
    expect(t.active).toBe(true);
    expect(t.generatedCount).toBe(3);
  });

  it('carries a paused schedule across as paused', async () => {
    api.listSchedules.mockResolvedValue({
      schedules: [{ id: 'sch2', name: 'Paused', partyName: 'Acme', nextRunDate: '2026-10-01', isActive: false, template: {} }],
    });
    const book = await hydrate();
    expect(book.recurringTemplates[0].active).toBe(false);
  });
});

describe('journal entries', () => {
  const serverJv = {
    id: 'srv-jv-1',
    entryNo: 'JV/2026/0007',
    date: '2026-09-10T00:00:00.000Z',
    narration: 'September rent',
    sourceDocType: 'MANUAL',
    status: 'POSTED',
    lines: [
      { ledgerAccountId: 'srv-rent', debit: 25000, credit: 0, description: 'rent', ledgerAccount: { code: '5100', name: 'Rent' } },
      { ledgerAccountId: 'srv-bank', debit: 0, credit: 25000, ledgerAccount: { code: '1100', name: 'Bank' } },
    ],
  };

  it('brings a journal raised on another machine into this book', async () => {
    getJournalEntries.mockResolvedValue({ entries: [serverJv] });

    const book = await hydrate();

    expect(book.journalEntries).toHaveLength(1);
    const jv = book.journalEntries[0];
    expect(jv.number).toBe('JV/2026/0007');
    expect(jv.date).toBe('2026-09-10');
    expect(jv.narration).toBe('September rent');
    expect(jv.totalDebit).toBe(25000);
    expect(jv.totalCredit).toBe(25000);
    expect(jv.lines[0]).toMatchObject({ accountName: 'Rent', accountCode: '5100', debit: 25000, credit: 0 });
    expect(jv.lines[1]).toMatchObject({ accountName: 'Bank', serverLedgerAccountId: 'srv-bank', credit: 25000 });
  });

  it('leaves out postings a document already made, so nothing is listed twice', async () => {
    // An invoice posts to the ledger too. That posting arrives with the
    // invoice; listing it on the Journal screen as well would show the same
    // transaction as two entries.
    getJournalEntries.mockResolvedValue({
      entries: [serverJv, { ...serverJv, id: 'srv-jv-2', sourceDocType: 'SALES_INVOICE' }],
    });

    const book = await hydrate();

    expect(book.journalEntries.map((j) => j.backendEntryId)).toEqual(['srv-jv-1']);
  });

  it('does not list the same journal twice once it comes back from the server', async () => {
    getJournalEntries.mockResolvedValue({ entries: [serverJv] });

    const book = await hydrate({
      journalEntries: [{ id: 4, companyId: 1, backendEntryId: 'srv-jv-1', number: 'JV/2026/0007', lines: [] }],
    });

    expect(book.journalEntries).toHaveLength(1);
  });
});

describe('how far the books are closed', () => {
  it('takes the server\'s answer, since that is what refuses a posting', async () => {
    getFiscalYears.mockResolvedValue({
      fiscalYears: [
        // Newest first, the way the route orders them — so the answer has to
        // be the furthest date, not whichever row happens to come last.
        { name: '2027-28', lockedThrough: null },
        { name: '2026-27', lockedThrough: '2026-09-30' },
        { name: '2025-26', lockedThrough: '2026-03-31' },
      ],
    });

    const book = await hydrate({ fyLocks: [{ companyId: 1, upTo: '2026-03-31' }, { companyId: 2, upTo: '2020-03-31' }] });

    expect(book.fyLocks).toEqual([
      { companyId: 2, upTo: '2020-03-31' },
      { companyId: 1, upTo: '2026-09-30' },
    ]);
  });

  it('leaves the lock alone when the server has none', async () => {
    const book = await hydrate({ fyLocks: [{ companyId: 1, upTo: '2026-03-31' }] });
    expect(book.fyLocks).toEqual([{ companyId: 1, upTo: '2026-03-31' }]);
  });
});

describe('till counts', () => {
  const close = {
    id: 'srv-z-1',
    date: '2026-09-09',
    invoices: 12,
    cash: 4300.5,
    upi: 1200,
    card: 800,
    total: 6300.5,
    countedCash: 4250.5,
    overShort: -50,
    denomCounts: { 500: 8 },
  };

  it('brings a day closed at the counter to the back office', async () => {
    listPosDayCloses.mockResolvedValue({ dayCloses: [close] });

    const book = await hydrate();

    expect(book.posDayCloses).toHaveLength(1);
    expect(book.posDayCloses[0]).toMatchObject({
      backendDayCloseId: 'srv-z-1',
      date: '2026-09-09',
      overShort: -50,
      countedCash: 4250.5,
      denomCounts: { 500: 8 },
    });
    expect(book.posDayCloses[0].id).toBeGreaterThan(0);
  });

  it('does not close the same day twice when the count comes back', async () => {
    // The till that made the close has it already. Arriving again would show
    // the day counted twice and double the takings on any total over them.
    listPosDayCloses.mockResolvedValue({ dayCloses: [close] });

    const book = await hydrate({
      posDayCloses: [{ id: 3, companyId: 1, date: '2026-09-09', cash: 4300.5, overShort: -50 }],
    });

    expect(book.posDayCloses).toHaveLength(1);
  });
});

/*
 * Settlement convergence.
 *
 * Hydration is insert-only by design, which left a browser that already knew
 * an invoice showing whatever it was paid the last time it looked. A receipt
 * recorded on another device, or reversed there, never reached it — the server
 * was right and the screen was not.
 *
 * These pin the narrow exception: how much a document has been paid converges
 * on every sync, in both directions, and nothing else about the local copy is
 * disturbed.
 */
describe('settlement convergence', () => {
  const localInvoice = (over = {}) => ({
    id: 7,
    companyId: 1,
    backendInvoiceId: 'srv-inv-1',
    number: 'INV-001',
    total: 118000,
    paidAmount: 0,
    status: 'Unpaid',
    customerName: 'Bengaluru Industrial Supplies',
    notes: 'deliver to gate 3',
    ...over,
  });

  const serverInvoice = (over = {}) => ({
    id: 'srv-inv-1',
    number: 'INV-001',
    date: '2026-06-10',
    total: 118000,
    paidAmount: 0,
    status: 'Unpaid',
    partyName: 'Bengaluru Industrial Supplies',
    items: [],
    ...over,
  });

  it('raises a known invoice when another device recorded a receipt', async () => {
    listInvoicesApi.mockResolvedValue([serverInvoice({ paidAmount: 50000, status: 'Partially Paid' })]);
    const book = await hydrate({ invoices: [localInvoice()] });

    expect(book.invoices).toHaveLength(1);
    const row = book.invoices[0];
    expect(row.paidAmount).toBe(50000);
    expect(row.status).toBe('Partially Paid');
    expect(Number(row.total) - Number(row.paidAmount)).toBe(68000);
  });

  it('lowers it again when that receipt is reversed — never a max()', async () => {
    listInvoicesApi.mockResolvedValue([serverInvoice({ paidAmount: 0, status: 'Unpaid' })]);
    const book = await hydrate({ invoices: [localInvoice({ paidAmount: 50000, status: 'Partially Paid' })] });

    const row = book.invoices[0];
    expect(row.paidAmount).toBe(0);
    expect(row.status).toBe('Unpaid');
    expect(Number(row.total) - Number(row.paidAmount)).toBe(118000);
  });

  it('converges a bill through settledAmount', async () => {
    listDocsApi.mockImplementation(async (kind) =>
      kind === 'bill'
        ? [{ id: 'srv-bill-1', number: 'BILL-001', date: '2026-06-10', total: 118000, settledAmount: 50000, status: 'Partially Paid', partyName: 'KIS', items: [] }]
        : []
    );
    const book = await hydrate({
      bills: [{ id: 3, companyId: 1, backendDocId: 'srv-bill-1', number: 'BILL-001', total: 118000, paidAmount: 0, status: 'Unpaid' }],
    });

    const row = book.bills.find((b) => b.backendDocId === 'srv-bill-1');
    expect(row.paidAmount).toBe(50000);
    expect(row.status).toBe('Partially Paid');
    expect(Number(row.total) - Number(row.paidAmount)).toBe(68000);
  });

  it('leaves a document that was never sent to the server completely alone', async () => {
    listInvoicesApi.mockResolvedValue([serverInvoice({ paidAmount: 50000, status: 'Partially Paid' })]);
    const draft = { id: 99, companyId: 1, number: 'LOCAL-DRAFT', total: 5000, paidAmount: 0, status: 'Draft', notes: 'not sent yet' };
    const book = await hydrate({ invoices: [localInvoice(), draft] });

    const stillThere = book.invoices.find((i) => i.number === 'LOCAL-DRAFT');
    expect(stillThere).toEqual(draft);
  });

  it('touches only the settlement fields, never the rest of the local row', async () => {
    listInvoicesApi.mockResolvedValue([
      serverInvoice({ paidAmount: 50000, status: 'Partially Paid', number: 'RENAMED-ON-SERVER', total: 999999 }),
    ]);
    const book = await hydrate({ invoices: [localInvoice({ notes: 'local edit nobody has pushed' })] });

    const row = book.invoices[0];
    expect(row.paidAmount).toBe(50000);
    expect(row.notes).toBe('local edit nobody has pushed');
    expect(row.number).toBe('INV-001');
    expect(row.total).toBe(118000);
    expect(row.id).toBe(7);
  });

  it('does not reopen a locally cancelled document', async () => {
    listInvoicesApi.mockResolvedValue([serverInvoice({ paidAmount: 0, status: 'Unpaid' })]);
    const book = await hydrate({ invoices: [localInvoice({ status: 'Cancelled' })] });
    expect(book.invoices[0].status).toBe('Cancelled');
  });

  it('is idempotent — a second sync of the same state changes nothing', async () => {
    listInvoicesApi.mockResolvedValue([serverInvoice({ paidAmount: 50000, status: 'Partially Paid' })]);
    const first = await hydrate({ invoices: [localInvoice()] });
    const second = await hydrate(first);
    expect(second.invoices).toEqual(first.invoices);
  });

  it('hydrates a brand-new invoice with what it has actually been paid', async () => {
    listInvoicesApi.mockResolvedValue([serverInvoice({ paidAmount: 50000, status: 'Partially Paid' })]);
    const book = await hydrate({ invoices: [] });
    expect(book.invoices[0].paidAmount).toBe(50000);
  });
});

describe('hydration requests', () => {
  it('starts every request before any of them has answered', async () => {
    // Hold the first document list open: if the requests were still awaited
    // one after another, nothing after it could start until it resolved.
    let release;
    listDocsApi.mockImplementationOnce(() => new Promise((r) => { release = () => r([]); }));

    let applied = 0;
    render(<Harness setDb={() => { applied += 1; }} />);

    await waitFor(() => {
      expect(listInvoicesApi).toHaveBeenCalled();
      expect(listPosDayCloses).toHaveBeenCalled();
      expect(getFiscalYears).toHaveBeenCalled();
      expect(api.listOrgMasters).toHaveBeenCalled();
      expect(listPayments).toHaveBeenCalledTimes(2);
    });
    expect(applied).toBe(0); // nothing applied yet: results still go in order

    release();
    await waitFor(() => expect(applied).toBeGreaterThan(0));
  });
});
