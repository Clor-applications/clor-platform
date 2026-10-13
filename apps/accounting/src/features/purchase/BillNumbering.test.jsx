import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: vi.fn(async () => ({})),
  updateDocApi: vi.fn(async () => ({})),
  hasApiSession: () => false,
}));

import { BillForm } from './index';

/**
 * The purchase series, changed on the bill that is using it.
 *
 * An invoice has carried this since numbering moved onto the document: the
 * gear on the number field, the prefix, the next number, and what the next
 * document will be called. A bill had the same series underneath and no way
 * to touch it — the number that came up was the number you got, and the only
 * remedy was Settings, from a screen with half a bill typed into it.
 */

const COMPANY = { id: 1, name: 'Neev Steels', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };
const BRANCHES = [{ id: 'b-blr', companyId: 1, name: 'Bengaluru', code: 'BLR' }];

const dbWith = (company = COMPANY) => ({
  companies: [company],
  vendors: [{ id: 9, companyId: 1, name: 'Steel Supply Co', displayName: 'Steel Supply Co' }],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', gstRate: 18, unit: 'Nos', purchasePrice: 100 }],
  bills: [],
  purchaseOrders: [],
  batches: [],
  uoms: [],
  gstRates: [],
});

/** The form with a live db, so a saved series is visible in the next number. */
const Host = ({ company = COMPANY, onOpenBillSettings = null }) => {
  const [db, setDb] = useState(() => dbWith(company));
  return (
    <BillForm
      db={db}
      setDb={(next) => setDb((prev) => (typeof next === 'function' ? next(prev) : next))}
      currentCompany={db.companies[0]}
      branches={BRANCHES}
      warehouses={[]}
      onOpenBillSettings={onOpenBillSettings}
      onClose={() => {}}
    />
  );
};

const gear = () => screen.getByRole('button', { name: 'Bill numbering settings' });
const panel = () => screen.getByRole('dialog');

describe('the bill number carries its series', () => {
  beforeEach(() => localStorage.clear());

  it('puts the control on the number field', () => {
    render(<Host />);
    expect(gear()).toBeInTheDocument();
  });

  it('opens onto the purchase series, not the sales one', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(gear());
    expect(within(panel()).getByText('Bill numbering')).toBeInTheDocument();
    expect(within(panel()).getByText('Next bill will be')).toBeInTheDocument();
  });

  it('shows what the next bill will be called as the series is typed', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(gear());

    await user.clear(within(panel()).getByLabelText('Prefix'));
    await user.type(within(panel()).getByLabelText('Prefix'), 'PB/25-26/');
    await user.clear(within(panel()).getByLabelText('Next number'));
    await user.type(within(panel()).getByLabelText('Next number'), '41');

    expect(within(panel()).getByText('PB/25-26/41')).toBeInTheDocument();
  });

  /* The point of the panel: the number on the bill in front of you changes. */
  it('renumbers the bill being typed once the series is saved', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(gear());

    await user.clear(within(panel()).getByLabelText('Prefix'));
    await user.type(within(panel()).getByLabelText('Prefix'), 'PB-');
    await user.clear(within(panel()).getByLabelText('Next number'));
    await user.type(within(panel()).getByLabelText('Next number'), '7');
    await user.click(within(panel()).getByRole('button', { name: 'Save' }));

    expect(screen.getByLabelText('Bill Number')).toHaveValue('PB-7');
  });

  it('writes the purchase series without touching the invoice one', async () => {
    const user = userEvent.setup();
    const company = {
      ...COMPANY,
      docSettings: { numbering: { invoice: { mode: 'auto', prefix: 'INV-', nextNumber: 12 } } },
    };
    render(<Host company={company} />);
    await user.click(gear());
    await user.clear(within(panel()).getByLabelText('Prefix'));
    await user.type(within(panel()).getByLabelText('Prefix'), 'PB-');
    await user.click(within(panel()).getByRole('button', { name: 'Save' }));

    /* The invoice series is untouched, so a sales document still numbers the
       way it did — the bug this shape of write exists to avoid. */
    expect(screen.getByLabelText('Bill Number')).toHaveValue('PB-1');
  });

  it('asks before walking off a half-typed bill to the settings screen', async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    render(<Host onOpenBillSettings={opened} />);
    await user.click(gear());
    await user.click(within(panel()).getByRole('button', { name: 'All numbering' }));

    /* Nothing typed yet, so it goes straight there. */
    expect(opened).toHaveBeenCalledWith('docNumbering');
  });
});
