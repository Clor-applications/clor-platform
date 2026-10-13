import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: vi.fn(async () => ({})),
  deleteDocApi: vi.fn(async () => ({})),
  hasApiSession: () => false,
  saveSettlementApi: vi.fn(async () => ({})),
}));

import { EstimateForm, EstimatesList, CreditNotesList } from './index';

const COMPANY = { id: 1, name: 'Neev Steels', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };

const dbWith = (over = {}) => ({
  companies: [COMPANY],
  customers: [{ id: 5, companyId: 1, name: 'Acme Traders', displayName: 'Acme Traders' }],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', gstRate: 18, unit: 'Nos' }],
  estimates: [],
  creditNotes: [],
  invoices: [],
  uoms: [],
  gstRates: [],
  ...over,
});

const withField = (label) => ({
  ...COMPANY,
  docSettings: {
    customFields: { invoice: [{ key: 'ref', label, type: 'Text', formPlacement: 'header', printPlacement: 'none' }] },
  },
});

describe('the quotation', () => {
  /*
   * A quotation is the one document a customer sees before deciding, and it
   * could not be printed or sent.
   */
  it('carries the company\'s own fields', () => {
    const company = withField('Enquiry ref');
    render(<EstimateForm db={dbWith({ companies: [company] })} setDb={() => {}} currentCompany={company} onClose={() => {}} />);
    expect(screen.getByLabelText('Enquiry ref')).toBeInTheDocument();
  });
});

describe('printing a quotation', () => {
  const EST = {
    id: 1,
    companyId: 1,
    number: 'QT-2',
    date: '2026-09-09',
    dueDate: '2026-09-30',
    customerId: 5,
    customerName: 'Acme Traders',
    items: [{ itemId: 11, description: 'MS Angle 50mm', quantity: 4, rate: 100, gstRate: 18, taxableAmount: 400 }],
    subtotal: 400,
    cgstTotal: 36,
    sgstTotal: 36,
    gstTotal: 72,
    total: 472,
    status: 'Draft',
  };

  const openPaper = () => {
    render(<EstimatesList db={dbWith({ estimates: [EST] })} setDb={() => {}} openModal={() => {}} currentCompany={COMPANY} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quotation actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Print quotation QT-2' }));
    return document.querySelector('.printable');
  };

  it('puts the quotation on paper with the date its prices hold to', () => {
    const paper = openPaper();
    expect(paper).toBeTruthy();
    expect(within(paper).getByText('QUOTATION')).toBeInTheDocument();
    expect(within(paper).getByText(/QT-2/)).toBeInTheDocument();
    expect(within(paper).getByText(/2026-09-30/)).toBeInTheDocument();
  });

  /* A quotation is not a demand for money and must not read as one. */
  it('says it is not a tax invoice', () => {
    const paper = openPaper();
    expect(within(paper).queryByText('TAX INVOICE')).toBeNull();
    expect(within(paper).getByText(/not a tax invoice/i)).toBeInTheDocument();
  });
});

describe('printing a credit note', () => {
  const NOTE = {
    id: 1,
    companyId: 1,
    number: 'CN-3',
    date: '2026-09-09',
    customerId: 5,
    customerName: 'Acme Traders',
    originalInvoiceNumber: 'INV-9',
    originalInvoiceDate: '2026-08-02',
    reasonLabel: 'Sales Return',
    items: [{ itemId: 11, description: 'MS Angle 50mm', quantity: 2, rate: 100, gstRate: 18, taxableAmount: 200 }],
    subtotal: 200,
    cgstTotal: 18,
    sgstTotal: 18,
    gstTotal: 36,
    total: 236,
    status: 'Open',
  };

  const openPaper = () => {
    render(
      <CreditNotesList db={dbWith({ creditNotes: [NOTE] })} setDb={() => {}} openModal={() => {}} currentCompany={COMPANY} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Print credit note CN-3' }));
    return document.querySelector('.printable');
  };

  /*
   * A credit note has to reach the customer — their books have to agree with
   * it. It could only ever be looked at on screen.
   */
  it('puts the note on paper against its original invoice', () => {
    const paper = openPaper();
    expect(paper).toBeTruthy();
    expect(within(paper).getByText('CREDIT NOTE')).toBeInTheDocument();
    expect(within(paper).getByText(/CN-3/)).toBeInTheDocument();
    expect(within(paper).getByText(/INV-9/)).toBeInTheDocument();
  });

  /* GSTR-1 reports the reason in the CDNR table; the paper states it too. */
  it('states why it was raised and cites section 34', () => {
    const paper = openPaper();
    expect(within(paper).getByText('Sales Return')).toBeInTheDocument();
    expect(within(paper).getByText(/section 34/)).toBeInTheDocument();
  });
});
