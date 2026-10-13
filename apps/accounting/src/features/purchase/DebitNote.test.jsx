import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/*
 * Warehouses on, everything else off.
 *
 * The bill form hides its warehouse field unless the feature is on, so a mock
 * that answers false to everything renders a form these tests then cannot
 * find their way around. BillBranch.test.jsx was given a switchable version
 * when that gate arrived; its five siblings were not, and every one of them
 * has been red since.
 */
vi.mock('@ui/permissions/useFeatures', () => ({
  useFeatures: () => ({ isEnabled: (key) => key === 'warehouses' }),
}));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: vi.fn(async () => ({})),
  hasApiSession: () => false,
}));
const notifyErrors = [];
vi.mock('@ui/components/ui/notify', async (orig) => {
  const real = await orig();
  return {
    ...real,
    notify: { ...real.notify, error: (m) => notifyErrors.push(String(m)), success: () => {}, info: () => {} },
  };
});

import { DebitNoteForm, DebitNotesList } from './index';

const COMPANY = { id: 1, name: 'Neev Steels', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };

const dbWith = (over = {}) => ({
  companies: [COMPANY],
  vendors: [{ id: 9, companyId: 1, name: 'Steel Supply Co', displayName: 'Steel Supply Co', gstin: '29BBBBB0000B1Z5' }],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', gstRate: 18, unit: 'Nos' }],
  bills: [],
  debitNotes: [],
  uoms: [],
  gstRates: [],
  ...over,
});

describe('the debit note line grid', () => {
  const renderForm = (db = dbWith()) =>
    render(<DebitNoteForm db={db} setDb={() => {}} currentCompany={COMPANY} onClose={() => {}} />);

  /* A debit note reverses a bill, line for line, and was entered through a
     five-column table while the bill it corrects had the full grid. */
  it('carries the same columns as the document it corrects', () => {
    renderForm();
    const grid = document.querySelector('table.ui-grid-dense');
    expect(grid).toBeTruthy();
    const heads = within(grid).getAllByRole('columnheader').map((th) => th.textContent.trim());
    expect(heads).toEqual(expect.arrayContaining(['Unit', 'Disc %', 'Tax %']));
  });

  it('keeps the last line when everything else is removed', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Remove line 1' })).toBeDisabled();
  });

  it('renders a field the company defined', () => {
    const company = {
      ...COMPANY,
      docSettings: {
        customFields: { invoice: [{ key: 'rtn', label: 'Return authorisation', type: 'Text', formPlacement: 'header', printPlacement: 'none' }] },
      },
    };
    render(<DebitNoteForm db={dbWith({ companies: [company] })} setDb={() => {}} currentCompany={company} onClose={() => {}} />);
    expect(screen.getByLabelText('Return authorisation')).toBeInTheDocument();
  });
});

describe('printing a debit note', () => {
  const NOTE = {
    id: 1,
    companyId: 1,
    number: 'DN-2',
    date: '2026-09-09',
    vendorId: 9,
    vendorName: 'Steel Supply Co',
    vendorGstin: '29BBBBB0000B1Z5',
    originalBillNumber: 'BILL-11',
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
      <DebitNotesList db={dbWith({ debitNotes: [NOTE] })} setDb={() => {}} openModal={() => {}} currentCompany={COMPANY} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Print debit note DN-2' }));
    return document.querySelector('.printable');
  };

  /* A vendor has to be sent the note; it existed only on screen. */
  it('puts the note on paper against its original bill', () => {
    const paper = openPaper();
    expect(paper).toBeTruthy();
    expect(within(paper).getByText('DEBIT NOTE')).toBeInTheDocument();
    expect(within(paper).getByText(/DN-2/)).toBeInTheDocument();
    expect(within(paper).getByText(/BILL-11/)).toBeInTheDocument();
  });

  /* The document is addressed to a vendor, not a customer. */
  it('addresses the vendor and cites section 34', () => {
    const paper = openPaper();
    expect(within(paper).getByText('Vendor')).toBeInTheDocument();
    expect(within(paper).getByText('Steel Supply Co')).toBeInTheDocument();
    expect(within(paper).getByText(/section 34/)).toBeInTheDocument();
  });

  /* The tax was claimed as input credit and is being given back — it has to
     be on the paper, split the way it was charged. */
  it('shows the tax split', () => {
    const paper = openPaper();
    expect(within(paper).getByText('CGST')).toBeInTheDocument();
    expect(within(paper).getByText('SGST')).toBeInTheDocument();
  });
});

describe('TDS on a return is evaluated, never blindly reversed', () => {
  /*
   * §20: the adjustment applies the ORIGINAL event's snapshotted rate to the
   * returned value, capped at what remains of the deduction — and a bill
   * that never deducted gives nothing back.
   */
  const CONTRACTOR = 'CONTRACTOR_SUB_CONTRACTOR';
  const deductedBill = {
    id: 71, companyId: 1, vendorId: 9, number: 'BILL-71', date: '2026-09-01',
    total: 118000, subtotal: 100000, taxableValue: 100000, paidAmount: 0, status: 'Unpaid',
    tdsAmount: 2000, tdsNatureCode: CONTRACTOR,
    items: [{ itemId: '11', description: 'MS Angle 50mm', quantity: 2, rate: 50000, amount: 100000, gstRate: 18 }],
  };
  const originalEvent = {
    id: 5, companyId: 1, sourceType: 'bill', sourceId: 71, sourceNumber: 'BILL-71',
    partyId: 9, partyName: 'Steel Supply Co', panSnapshot: 'AABCU9603R',
    transactionDate: '2026-09-01', natureCode: CONTRACTOR, ruleVersionId: `${CONTRACTOR}@V2`,
    sectionReference: '393(1) Table 6(i)', sectionCode: '194C',
    baseAmount: 100000, rate: 2, tdsAmount: 2000, ledgerId: '201', side: 'PAYABLE',
    returnQuarter: 'FY 2026-27 Q2', status: 'Posted', reversalOfId: null, correctionOfId: null,
  };

  const raiseNoteAgainst = async (db, saved) => {
    const { useState } = await import('react');
    const Host = () => {
      const [state, setState] = useState(db);
      return (
        <DebitNoteForm
          db={state}
          setDb={(next) => {
            const value = typeof next === 'function' ? next(state) : next;
            saved(value);
            setState(value);
          }}
          currentCompany={COMPANY}
          warehouses={[{ id: 'w1', companyId: 1, name: 'Main Store' }]}
          initialOriginalBillId={71}
          onClose={() => {}}
        />
      );
    };
    render(<Host />);
    const user = (await import('@testing-library/user-event')).default.setup();
    await user.click(screen.getByRole('combobox', { name: /^Warehouse/ }));
    await user.click(await screen.findByRole('option', { name: 'Main Store' }));
    /* The original bill prefilled the grid (2 × ₹50,000). Halving the
       quantity returns ₹50,000 of taxable value. */
    const row = document.querySelector('[data-line-row="0"]');
    const numbers = row.querySelectorAll('input[type="number"]');
    fireEvent.change(numbers[0], { target: { value: '1' } });
    fireEvent.submit(document.querySelector('form'));
  };

  it('gives back the snapshotted rate on the returned value, linked to the original', async () => {
    const saved = vi.fn();
    const db = dbWith({
      bills: [deductedBill],
      warehouses: [],
      tdsTransactions: [originalEvent],
    });
    await raiseNoteAgainst(db, saved);

    await vi.waitFor(() => expect(saved).toHaveBeenCalled());
    const next = saved.mock.calls.at(-1)[0];
    const adjustment = (next.tdsTransactions || []).find((e) => e.correctionOfId === 5);
    expect(adjustment).toBeTruthy();
    /* 2% of the ₹50,000 returned — the ORIGINAL snapshot's rate. */
    expect(adjustment.tdsAmount).toBe(-1000);
    expect(adjustment.baseAmount).toBe(-50000);
    expect(adjustment.sourceType).toBe('debitNote');
    expect(adjustment.ruleVersionId).toBe(`${CONTRACTOR}@V2`);
    expect(adjustment.status).toBe('Posted');
    /* The original is untouched — corrected by lineage, not edited. */
    expect(next.tdsTransactions.find((e) => e.id === 5).tdsAmount).toBe(2000);
  });

  it('a bill that never deducted gives nothing back', async () => {
    const saved = vi.fn();
    const db = dbWith({
      bills: [{ ...deductedBill, tdsAmount: 0, tdsNatureCode: '' }],
      warehouses: [],
      tdsTransactions: [],
    });
    await raiseNoteAgainst(db, saved);

    await vi.waitFor(() => expect(saved).toHaveBeenCalled());
    const next = saved.mock.calls.at(-1)[0];
    expect(next.tdsTransactions || []).toHaveLength(0);
  });
});
