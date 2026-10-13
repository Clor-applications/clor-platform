import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  useFeatures: () => ({ isEnabled: (key) => key === 'warehouses' || key === 'branches' }),
}));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: vi.fn(async () => ({})),
  hasApiSession: () => false,
}));

import { DebitNoteForm } from './index';

/**
 * A purchase return is a bill in reverse, and is filled in the same way.
 *
 * It asked neither which branch the goods were going back from — reading one
 * out of whichever warehouse was selected — nor offered any way at the series
 * that numbers it. The sales return has asked both for months; the purchase
 * side had not caught up.
 */

const COMPANY = { id: 1, name: 'Neev Steels', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };
const BRANCHES = [
  { id: 'b-blr', companyId: 1, name: 'Bengaluru', code: 'BLR' },
  { id: 'b-hyd', companyId: 1, name: 'Hyderabad', code: 'HYD' },
];
const WAREHOUSES = [
  { id: 'w-blr', companyId: 1, name: 'Bengaluru Store', branchId: 'b-blr' },
  { id: 'w-hyd', companyId: 1, name: 'Hyderabad Store', branchId: 'b-hyd' },
];

const Host = ({ onOpenReturnSettings = null }) => {
  const [db, setDb] = useState({
    companies: [COMPANY],
    vendors: [{ id: 9, companyId: 1, name: 'Steel Supply Co', displayName: 'Steel Supply Co' }],
    items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', gstRate: 18, unit: 'Nos', purchasePrice: 100 }],
    bills: [],
    debitNotes: [],
    batches: [],
    uoms: [],
    gstRates: [],
  });
  return (
    <DebitNoteForm
      db={db}
      setDb={(next) => setDb((prev) => (typeof next === 'function' ? next(prev) : next))}
      currentCompany={db.companies[0]}
      warehouses={WAREHOUSES}
      branches={BRANCHES}
      onOpenReturnSettings={onOpenReturnSettings}
      onClose={() => {}}
    />
  );
};

const field = (name) => screen.getByRole('combobox', { name });

describe('the purchase return asks what the bill asks', () => {
  beforeEach(() => localStorage.clear());

  it('asks which branch', () => {
    render(<Host />);
    expect(field('Branch')).toBeInTheDocument();
  });

  it('narrows the warehouses to that branch', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(field('Branch'));
    await user.click(screen.getByRole('option', { name: 'Bengaluru' }));
    await user.click(field('Warehouse *'));
    /* The bill list on this form is a plain <select>, so scope the check to the
       panel that just opened rather than every option on the screen. */
    const panel = screen.getByRole('listbox');
    expect(within(panel).getAllByRole('option').map((o) => o.textContent.trim())).toEqual(['Bengaluru Store']);
  });

  it('carries the series control on the number field', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Return numbering settings' }));
    expect(within(screen.getByRole('dialog')).getByText('Return numbering')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Next return will be')).toBeInTheDocument();
  });

  it('renumbers this return when its own series changes', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Return numbering settings' }));

    const panel = screen.getByRole('dialog');
    await user.clear(within(panel).getByLabelText('Prefix'));
    await user.type(within(panel).getByLabelText('Prefix'), 'PR-');
    await user.clear(within(panel).getByLabelText('Next number'));
    await user.type(within(panel).getByLabelText('Next number'), '4');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));

    /* The purchase return's own series, not the invoice's. */
    expect(screen.getByLabelText('Debit Note Number')).toHaveValue('PR-4');
  });

  it('carries the ⋮, with the custom fields in it', async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    render(<Host onOpenReturnSettings={opened} />);
    await user.click(screen.getByRole('button', { name: 'More options' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Configure — every return')).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: /Custom fields/ }));
    expect(opened).toHaveBeenCalledWith('settingsCustomFields');
  });
});
