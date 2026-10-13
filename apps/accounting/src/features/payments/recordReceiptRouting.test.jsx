import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: vi.fn(async () => ({})),
  deleteDocApi: vi.fn(async () => ({})),
  hasApiSession: () => false,
  saveSettlementApi: vi.fn(async () => ({})),
}));

import { InvoicesList } from '../sales/index';

const COMPANY = { id: 1, name: 'Neev Steels', state: 'Karnataka' };

const INVOICE = {
  id: 3,
  companyId: 1,
  number: 'INV-3',
  date: '2026-09-09',
  customerId: 5,
  customerName: 'Acme Traders',
  items: [],
  subtotal: 1000,
  gstTotal: 180,
  total: 1180,
  paidAmount: 180,
  status: 'Partial',
};

const db = {
  companies: [COMPANY],
  customers: [{ id: 5, companyId: 1, name: 'Acme Traders', displayName: 'Acme Traders' }],
  invoices: [INVOICE],
  items: [],
  payments: [],
  uoms: [],
  gstRates: [],
};

/*
 * A receipt is a document with a number that posts to the ledger, not a detail
 * of the invoice it settles. Opened as a dialog it had no address of its own,
 * the browser's Back button dismissed the list behind it, and there was nowhere
 * to return to once the money was recorded — rows 49 and 52 of the validation
 * sheet.
 */
describe('recording money against an invoice', () => {
  /* Record Receipt lives in the row's actions menu. */
  const openReceiptAction = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Invoice actions' }));
    const action = screen.getByRole('button', { name: 'Record Receipt' });
    fireEvent.click(action);
  };

  it('navigates to the receipts screen instead of opening a dialog', () => {
    const onRecordReceipt = vi.fn();
    const openModal = vi.fn();
    render(
      <InvoicesList
        db={db}
        setDb={() => {}}
        currentCompany={COMPANY}
        openModal={openModal}
        onRecordReceipt={onRecordReceipt}
      />
    );
    openReceiptAction();

    expect(onRecordReceipt).toHaveBeenCalledTimes(1);
    expect(onRecordReceipt.mock.calls[0][0].id).toBe(3);
    // The point of the change: no dialog over the list.
    expect(openModal).not.toHaveBeenCalled();
  });

  /*
   * The dialog stays as the fallback where this list is rendered without a host
   * that can navigate, so no entry point is lost.
   */
  it('still opens the form when there is nowhere to navigate to', () => {
    const openModal = vi.fn();
    render(<InvoicesList db={db} setDb={() => {}} currentCompany={COMPANY} openModal={openModal} />);
    openReceiptAction();
    expect(openModal).toHaveBeenCalled();
  });
});

describe('a receipt started from an invoice row', () => {
  /*
   * The amount and the reference prefilled and the customer did not, so the one
   * field that decides which invoices can be settled had to be found again by
   * hand. An invoice that came back from the server carries the customer's name
   * and no local id — the id belongs to this browser's copy of the master.
   */
  const company = { id: 1, name: 'Neev Steels', state: 'Karnataka' };
  const db = {
    customers: [{ id: 7, companyId: 1, name: 'Acme Traders', displayName: 'Acme Traders', accountId: 301 }],
    invoices: [],
    receipts: [],
    creditNotes: [],
    accountGroups: [{ id: 13, companyId: 1, name: 'Sundry Debtors', parentGroupId: null }],
    chartOfAccounts: [{ id: 301, companyId: 1, name: 'Acme Traders', groupId: 13 }],
  };

  it('finds the customer by name when the invoice carries no local id', async () => {
    const { default: RecordReceiptForm } = await import('./RecordReceiptForm');
    render(
      <RecordReceiptForm
        db={db}
        setDb={() => {}}
        currentCompany={company}
        onClose={() => {}}
        initialData={{ customerName: 'Acme Traders', amount: 11800, reference: 'INV-1' }}
      />
    );

    /* The party is a ledger row now, so the prefill has to land there — on
       the row that stands for the party, named. (The name is also in the
       ledger select's options, so the assertion is scoped to that row.) */
    /* The ledger field is a type-ahead, so the chosen party is its value. */
    const partyRow = (await screen.findByRole('button', { name: /View Bills/i })).closest('tr');
    expect(within(partyRow).getByRole('combobox').value).toBe('Acme Traders');
  });

  it('still prefers the id when the document has one', async () => {
    const { default: RecordReceiptForm } = await import('./RecordReceiptForm');
    render(
      <RecordReceiptForm
        db={db}
        setDb={() => {}}
        currentCompany={company}
        onClose={() => {}}
        initialData={{ customerId: 7, customerName: 'Someone else', amount: 100 }}
      />
    );

    /* The ledger field is a type-ahead, so the chosen party is its value. */
    const partyRow = (await screen.findByRole('button', { name: /View Bills/i })).closest('tr');
    expect(within(partyRow).getByRole('combobox').value).toBe('Acme Traders');
  });

  it('prefills the customer ledger, amount and selected invoice from the routed sales invoice', async () => {
    const { default: RecordReceiptForm } = await import('./RecordReceiptForm');
    const invoice = {
      id: 44,
      companyId: 1,
      number: 'INV-44',
      customerId: 7,
      customerName: 'Acme Traders',
      date: '2026-09-20',
      total: 1180,
      paidAmount: 0,
      status: 'Posted',
    };
    render(
      <RecordReceiptForm
        db={{ ...db, invoices: [invoice] }}
        setDb={() => {}}
        currentCompany={company}
        onClose={() => {}}
        initialData={{
          customerId: 'server-party-7',
          customerName: 'Acme Traders',
          amount: 1180,
          allocateInvoiceId: 44,
          reference: 'INV-44',
        }}
      />
    );

    const partyRow = (await screen.findByRole('button', { name: /View Bills/i })).closest('tr');
    expect(within(partyRow).getByRole('combobox').value).toBe('Acme Traders');
    expect(within(partyRow).getByRole('spinbutton', { name: /Amount/i })).toHaveValue(1180);
    expect(screen.getByDisplayValue('INV-44')).toBeInTheDocument();
    expect(within(partyRow).getByText(/Against 1 invoice/i)).toBeInTheDocument();
  });
});
