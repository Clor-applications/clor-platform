import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: vi.fn(async () => ({})),
  deleteDocApi: vi.fn(async () => ({})),
  hasApiSession: () => false,
  saveSettlementApi: vi.fn(async () => ({})),
}));
vi.mock('@ui/api/ledger', () => ({
  listLedgerAccounts: vi.fn(async () => ({ accounts: [] })),
  createLedgerAccount: vi.fn(async () => ({})),
}));

import { CreditNoteForm, EstimateForm } from './index';
import { BillForm, DebitNoteForm } from '../purchase/index';
import SalesOrders from './SalesOrders';
import DeliveryChallans from './DeliveryChallans';
import RecordReceiptForm from '../payments/RecordReceiptForm';

/**
 * One shape of screen for every document.
 *
 * A quotation becomes a sales order becomes an invoice, and a receipt settles
 * it. They had drifted into four layouts: the number on the left of one and
 * the right of another, "Add line" here and "Add Item" there, a running total
 * on the invoice and nowhere else. Somebody who has raised a hundred invoices
 * should not have to read the quotation screen.
 *
 * These are the parts of the invoice's layout the others must carry. They are
 * asserted per screen rather than as a rendered comparison, because a sales
 * order genuinely has no due date and a receipt genuinely has no line grid —
 * what is shared is where things sit, not which fields exist.
 */

const COMPANY = {
  id: 1,
  name: 'Neev Steels',
  gstin: '29ABCDE1234F1Z5',
  state: 'Karnataka',
  /* TDS on: the chooser tests below exercise the compact control, which is
     offered only where the company tracks TDS. */
  profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F' } } },
};

const baseDb = (over = {}) => ({
  companies: [COMPANY],
  customers: [{ id: 5, companyId: 1, name: 'Acme Traders', displayName: 'Acme Traders' }],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', gstRate: 18, unit: 'Nos', salePrice: 100 }],
  estimates: [],
  salesOrders: [],
  invoices: [],
  creditNotes: [],
  receipts: [],
  chartOfAccounts: [],
  uoms: [],
  gstRates: [],
  salesmen: [],
  ...over,
});

/** The line grid the invoice defines, column for column. */
const LINE_COLUMNS = ['Item', 'Description', 'Qty', 'Unit', 'Rate (₹)', 'Disc %', 'Tax %', 'Amount (₹)'];

const lineHeaders = () => {
  const table = screen.getAllByRole('table').find((t) => within(t).queryByText('Item'));
  return within(table)
    .getAllByRole('columnheader')
    .map((th) => th.textContent.replace(/\s+/g, ' ').replace(' *', '').trim())
    .filter(Boolean);
};

describe('the quotation wears the invoice layout', () => {
  const renderQuote = () =>
    render(<EstimateForm db={baseDb()} setDb={() => {}} currentCompany={COMPANY} onClose={() => {}} />);

  it('carries every line column the invoice has', () => {
    renderQuote();
    expect(lineHeaders()).toEqual(LINE_COLUMNS);
  });

  it('adds lines with the invoice\'s control and hint', () => {
    renderQuote();
    expect(screen.getByRole('button', { name: /Add Item/i })).toBeInTheDocument();
    expect(screen.getByText(/press Tab in the last field of the last row/i)).toBeInTheDocument();
  });

  it('keeps a running total on screen', () => {
    renderQuote();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText(/line\(s\)/)).toBeInTheDocument();
  });

  it('puts the paperwork in the right-hand column', () => {
    renderQuote();
    // Number and both dates, named as the invoice names them.
    expect(screen.getByLabelText(/^Quotation No\./)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Valid Until/)).toBeInTheDocument();
  });
});

describe('the sales order wears the invoice layout', () => {
  const openForm = () => {
    render(<SalesOrders db={baseDb()} setDb={() => {}} currentCompany={COMPANY} />);
    return screen.getByRole('button', { name: /New Sales Order/i });
  };

  it('carries every line column the invoice has, and the same add control', async () => {
    const { click } = await import('@testing-library/user-event').then((m) => ({ click: m.default.setup().click }));
    const trigger = openForm();
    await click(trigger);

    expect(lineHeaders()).toEqual(LINE_COLUMNS);
    expect(screen.getByRole('button', { name: /Add Item/i })).toBeInTheDocument();
    expect(screen.getByText(/press Tab in the last field of the last row/i)).toBeInTheDocument();
  });

  it('names the first total as the invoice does and keeps a running one', async () => {
    const { click } = await import('@testing-library/user-event').then((m) => ({ click: m.default.setup().click }));
    await click(openForm());

    // "Taxable value" is the return's word for it; the invoice says Subtotal.
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText(/line\(s\)/)).toBeInTheDocument();
  });
});

describe('the receipt wears the invoice layout', () => {
  const renderReceipt = () =>
    render(
      <RecordReceiptForm
        db={baseDb()}
        setDb={() => {}}
        currentCompany={COMPANY}
        onClose={() => {}}
        screenTitle="Record Receipt"
        onBack={() => {}}
      />
    );

  it('puts the name, Back and the primary action in one bar', () => {
    renderReceipt();
    expect(screen.getByRole('heading', { name: 'Record Receipt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record Receipt/i })).toBeInTheDocument();
  });

  it('marks its mandatory fields and says what the marker means', () => {
    renderReceipt();
    expect(screen.getByLabelText(/^Receipt Date \*$/)).toBeInTheDocument();
    /* "Amount Received" is gone: the receipt is worth what the allocation
       comes to, so the required figure is the ledger and amount on a row. */
    expect(screen.getByLabelText(/Account, allocation row 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Indicates mandatory fields/i)).toBeInTheDocument();
  });

  it('keeps the figure that must match the bank on screen', () => {
    renderReceipt();
    expect(screen.getAllByText('Net into the account').length).toBeGreaterThan(0);
    expect(screen.getByText(/invoice\(s\) allocated/)).toBeInTheDocument();
  });
});


describe('the sales return wears the invoice layout', () => {
  const renderNote = () =>
    render(<CreditNoteForm db={baseDb()} setDb={() => {}} currentCompany={COMPANY} onClose={() => {}} />);

  it('carries every line column the invoice has', () => {
    renderNote();
    expect(lineHeaders()).toEqual(LINE_COLUMNS);
  });

  it('adds lines with the invoice\'s control and hint, and keeps a running total', () => {
    renderNote();
    expect(screen.getByRole('button', { name: /Add Item/i })).toBeInTheDocument();
    expect(screen.getByText(/press Tab in the last field of the last row/i)).toBeInTheDocument();
    expect(screen.getByText(/line\(s\)/)).toBeInTheDocument();
  });

  /* A credit note reverses an invoice line, and an invoice line can be
     discounted — without the column the note returns more than was charged. */
  it('can discount a line, as the invoice it reverses can', () => {
    renderNote();
    expect(screen.getByLabelText('Discount percent for line 1')).toBeInTheDocument();
  });
});

describe('the delivery challan wears the invoice layout', () => {
  const openChallan = async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<DeliveryChallans db={baseDb()} setDb={() => {}} currentCompany={COMPANY} />);
    await user.click(screen.getByRole('button', { name: /New Challan|New Delivery Challan/i }));
    return user;
  };

  it('names its add control as the invoice does and hints the same', async () => {
    await openChallan();
    expect(screen.getByRole('button', { name: /Add Item/i })).toBeInTheDocument();
    expect(screen.getByText(/press Tab in the last field of the last row/i)).toBeInTheDocument();
  });

  /* A challan states the value of the goods for insurance and the e-way bill,
     so its running figure is goods value, not a tax total. */
  it('keeps the goods value on screen and says what it is not', async () => {
    await openChallan();
    /* The list behind the form carries a Goods value stat too, so this is
       scoped to the running bar the invoice form defines. */
    const bar = document.querySelector('.ui-entry-summary');
    expect(bar).toBeTruthy();
    expect(bar.textContent).toMatch(/Goods value/);
    expect(bar.textContent).toMatch(/not a tax total/i);
  });
});


describe('a document form is a screen, not a panel above the list', () => {
  /*
   * Sales orders, challans and recurring schedules used to open inside the
   * list: cards, status tabs and every row still on screen under a half-typed
   * document, with the list's primary action sitting beside the form's. An
   * invoice and a quotation replace the list; these now do too.
   */
  const opensAlone = async (Component, buttonName, listMarker) => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<Component db={baseDb()} setDb={() => {}} currentCompany={COMPANY} />);
    expect(screen.getAllByText(listMarker).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: buttonName }));
    expect(screen.queryAllByText(listMarker)).toHaveLength(0);
  };

  it('the sales order form replaces the list', async () => {
    await opensAlone(SalesOrders, /New Sales Order/i, 'Still to deliver');
  });

  it('the delivery challan form replaces the list', async () => {
    await opensAlone(DeliveryChallans, /New Challan|New Delivery Challan/i, 'Out, not billed');
  });
});


describe('the purchase module wears the invoice layout', () => {
  const purchaseDb = () => ({ ...baseDb(), vendors: [{ id: 9, companyId: 1, name: 'Umbrella Chemicals', displayName: 'Umbrella Chemicals' }], bills: [], debitNotes: [], purchaseOrders: [] });

  it('the bill carries every line column the invoice has', () => {
    render(<BillForm db={purchaseDb()} setDb={() => {}} currentCompany={COMPANY} onClose={() => {}} />);
    expect(lineHeaders()).toEqual(LINE_COLUMNS);
  });

  /* A supplier's discount is on the bill; without a column the rate had to be
     back-worked by hand, which is how a bill stops matching its order. */
  it('the bill can discount a line', () => {
    render(<BillForm db={purchaseDb()} setDb={() => {}} currentCompany={COMPANY} onClose={() => {}} />);
    expect(screen.getByLabelText('Discount percent for line 1')).toBeInTheDocument();
  });

  it('the bill adds lines the way the invoice does and keeps a running total', () => {
    render(<BillForm db={purchaseDb()} setDb={() => {}} currentCompany={COMPANY} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /Add Item/i })).toBeInTheDocument();
    expect(screen.getByText(/press Tab in the last field of the last row/i)).toBeInTheDocument();
    expect(screen.getByText(/line\(s\)/)).toBeInTheDocument();
  });

  it('the purchase return keeps a running total too', () => {
    render(<DebitNoteForm db={purchaseDb()} setDb={() => {}} currentCompany={COMPANY} onClose={() => {}} />);
    expect(screen.getByText(/line\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/press Tab in the last field of the last row/i)).toBeInTheDocument();
  });
});

describe('TDS is chosen once, then out of the way', () => {
  /*
   * Section, rate and payee are how a deduction is chosen; none of them is
   * what a reader of the totals wants afterwards. The chooser folds away and
   * the totals say TDS and a figure — the section is on the document and in
   * the return, which is where it is read.
   */
  it('offers the section only while nothing is chosen', async () => {
    const { InvoiceForm } = await import('./index');
    render(<InvoiceForm db={baseDb()} setDb={() => {}} currentCompany={COMPANY} onClose={() => {}} />);

    // Folded to a single opener until somebody asks for it.
    expect(screen.getByRole('button', { name: /TDS deduction/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('invoice-tds-section')).toBeNull();
  });

  /*
   * One or the other. The chooser was hidden only once a section had been
   * picked, so on a new invoice the opener and the thing it opens were both on
   * screen — two ways to do the same thing, six inches apart.
   */
  it('does not show the chooser and its own opener at once', async () => {
    const { InvoiceForm } = await import('./index');
    render(<InvoiceForm db={baseDb()} setDb={() => {}} currentCompany={COMPANY} onClose={() => {}} />);

    const chooser = document.getElementById('invoice-tds-section');
    expect(chooser?.closest('[hidden]')).toBeTruthy();
  });

  it('opens the chooser when the opener is pressed, and hides the opener', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    const { InvoiceForm } = await import('./index');
    render(<InvoiceForm db={baseDb()} setDb={() => {}} currentCompany={COMPANY} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /TDS deduction/i }));
    expect(document.getElementById('invoice-tds-section')?.closest('[hidden]')).toBeFalsy();
    expect(screen.queryByRole('button', { name: /^\+ TDS deduction/i })).toBeNull();
  });
});
