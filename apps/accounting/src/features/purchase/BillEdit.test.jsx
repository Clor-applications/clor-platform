import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  session: false,
  createDocApi: vi.fn(async () => ({ id: 'srv-new', number: 'SRV-NEW' })),
  updateDocApi: vi.fn(async (_kind, id) => ({ id, number: 'PB-0007' })),
}));

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: api.createDocApi,
  updateDocApi: api.updateDocApi,
  deleteDocApi: vi.fn(),
  saveSettlementApi: vi.fn(),
  hasApiSession: () => api.session,
}));

import { BillForm } from './index';

/**
 * Editing a bill changes that bill.
 *
 * The form treated whatever it was opened with as a template: a new number,
 * today's date, an id of `bills.length + 1`, and a create on the server. So
 * "Update Bill" either failed on the bill's own number or put a second bill
 * in the books beside the first.
 */

const COMPANY = { id: 1, name: 'Neev Steels', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };
const BRANCHES = [{ id: 'b-blr', companyId: 1, name: 'Bengaluru', code: 'BLR' }];

const existing = (over = {}) => ({
  id: 3,
  companyId: 1,
  number: 'PB-0007',
  date: '2026-06-01',
  dueDate: '2026-07-01',
  status: 'Unpaid',
  paidAmount: 0,
  vendorId: 9,
  vendorName: 'Steel Supply Co',
  branchId: 'b-blr',
  backendDocId: 'srv-3',
  items: [{ itemId: '11', description: 'MS Angle 50mm', quantity: 2, rate: 100, gstRate: 18 }],
  createdAt: '2026-06-01T10:00:00.000Z',
  ...over,
});

const dbWith = (bill) => ({
  companies: [COMPANY],
  vendors: [{ id: 9, companyId: 1, name: 'Steel Supply Co', displayName: 'Steel Supply Co' }],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', gstRate: 18, unit: 'Nos', purchasePrice: 100 }],
  bills: [{ id: 1, companyId: 1, number: 'PB-0001', date: '2026-05-01', items: [] }, bill],
  purchaseOrders: [],
  batches: [],
  uoms: [],
  gstRates: [],
});

const Host = ({ bill, onSaved }) => {
  const [db, setDb] = useState(() => dbWith(bill));
  return (
    <BillForm
      db={db}
      setDb={(next) => {
        const value = typeof next === 'function' ? next(db) : next;
        onSaved?.(value);
        setDb(value);
      }}
      currentCompany={COMPANY}
      initialData={bill}
      branches={BRANCHES}
      warehouses={[]}
      onClose={() => {}}
    />
  );
};

describe('editing a bill', () => {
  beforeEach(() => {
    localStorage.clear();
    api.session = false;
    api.createDocApi.mockClear();
    api.updateDocApi.mockClear();
  });

  it('keeps its number, date and id, and replaces it rather than adding a second bill', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host bill={existing()} onSaved={(v) => (saved = v)} />);

    expect(screen.getByDisplayValue('PB-0007')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Update Bill' }));

    expect(saved.bills).toHaveLength(2);
    const bill = saved.bills.find((b) => b.id === 3);
    expect(bill.number).toBe('PB-0007');
    expect(bill.date).toBe('2026-06-01');
    expect(bill.createdAt).toBe('2026-06-01T10:00:00.000Z');
  });

  it("updates the server's copy instead of creating another", async () => {
    api.session = true;
    const user = userEvent.setup();
    render(<Host bill={existing()} />);
    await user.click(screen.getByRole('button', { name: 'Update Bill' }));

    expect(api.updateDocApi).toHaveBeenCalledWith('bill', 'srv-3', expect.objectContaining({ number: 'PB-0007' }));
    expect(api.createDocApi).not.toHaveBeenCalled();
  });

  it('sends a paid bill to the server, which refuses only a total below what was paid', async () => {
    /* A paid bill may still be corrected (a reference, a date, a line that
       does not lower the total); the server refuses a reduction below the
       settled amount, so the form does not refuse the edit outright. */
    api.session = true;
    const user = userEvent.setup();
    render(<Host bill={existing({ paidAmount: 500, status: 'Partially Paid' })} onSaved={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Update Bill' }));

    expect(api.updateDocApi).toHaveBeenCalled();
  });
});
