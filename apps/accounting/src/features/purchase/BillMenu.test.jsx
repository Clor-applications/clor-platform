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
  useFeatures: () => ({ isEnabled: (key) => key === 'warehouses' }),
}));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: vi.fn(async () => ({})),
  updateDocApi: vi.fn(async () => ({})),
  hasApiSession: () => false,
}));

import { BillForm } from './index';

/**
 * The bill's own ⋮.
 *
 * Every other document form carries one: read this document under the first
 * heading, configure every document of this type under the second, and the
 * separation is the point — somebody reaching for Preview should not find
 * themselves editing what every bill looks like. The bill had no menu at all,
 * and so no way to reach the fields its own company had defined.
 */

const COMPANY = { id: 1, name: 'Neev Steels', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };

const withCustomField = {
  ...COMPANY,
  docSettings: {
    customFields: {
      invoice: [
        { key: 'transporter', label: 'Transporter', type: 'Text', formPlacement: 'header', printPlacement: 'none' },
      ],
    },
  },
};

const dbWith = (company) => ({
  companies: [company],
  vendors: [{ id: 9, companyId: 1, name: 'Steel Supply Co', displayName: 'Steel Supply Co' }],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', gstRate: 18, unit: 'Nos', purchasePrice: 100 }],
  bills: [],
  purchaseOrders: [],
  batches: [],
  uoms: [],
  gstRates: [],
  debitNotes: [],
});

const Host = ({ company = COMPANY, onOpenBillSettings = null, onSaved = () => {} }) => {
  const [db, setDb] = useState(() => dbWith(company));
  return (
    <BillForm
      db={db}
      setDb={(next) => {
        const value = typeof next === 'function' ? next(db) : next;
        onSaved(value);
        setDb(value);
      }}
      currentCompany={db.companies[0]}
      branches={[{ id: 'b1', companyId: 1, name: 'Bengaluru' }]}
      warehouses={[{ id: 'w1', companyId: 1, name: 'Main Store', branchId: 'b1' }]}
      onOpenBillSettings={onOpenBillSettings}
      onClose={() => {}}
    />
  );
};

const openMenu = async (user) => {
  await user.click(screen.getByRole('button', { name: 'More options' }));
  return screen.getByRole('menu');
};

describe('the bill form menu', () => {
  beforeEach(() => localStorage.clear());

  it('is there', () => {
    render(<Host />);
    expect(screen.getByRole('button', { name: 'More options' })).toBeInTheDocument();
  });

  it('separates reading this bill from configuring every bill', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const menu = await openMenu(user);

    expect(within(menu).getByText('This bill')).toBeInTheDocument();
    expect(within(menu).getByText('Configure — every bill')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Preview Bill/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Custom fields/ })).toBeInTheDocument();
  });

  /* The bill's own fields, over the bill — not a walk to a settings screen
     that would have shown the invoice's. */
  it('opens the bill’s custom fields from the menu, in place', async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    render(<Host onOpenBillSettings={opened} />);
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Custom fields/ }));

    expect(await screen.findByText('Bill custom fields')).toBeInTheDocument();
    expect(opened).not.toHaveBeenCalled();
  });

  it('previews the bill being typed, not a saved one', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Preview Bill/ }));

    /* A bill nobody has saved still previews — that is the moment it is
       actually worth looking at. */
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Purchase bill BILL-1/)).toBeInTheDocument();
  });

  it('opens the numbering panel from the menu as well as the field', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Bill numbering/ }));

    expect(within(screen.getByRole('dialog')).getByText('Bill numbering')).toBeInTheDocument();
  });
});

describe('the fields a company added to its bills', () => {
  beforeEach(() => localStorage.clear());

  it('are asked for on the bill', () => {
    render(<Host company={withCustomField} />);
    expect(screen.getByLabelText('Transporter')).toBeInTheDocument();
  });

  it('are not invented where none are defined', () => {
    render(<Host />);
    expect(screen.queryByLabelText('Transporter')).toBeNull();
  });

  it('are saved with the bill', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host company={withCustomField} onSaved={(next) => { saved = next; }} />);

    await user.type(screen.getByLabelText('Transporter'), 'VRL Logistics');

    /* A bill needs a vendor, a warehouse and a line before it will save. */
    await user.click(screen.getByRole('combobox', { name: 'Warehouse *' }));
    await user.click(await screen.findByRole('option', { name: 'Main Store' }));
    await user.click(screen.getByPlaceholderText('Type a vendor name'));
    await user.click(await screen.findByRole('option', { name: /Steel Supply Co/ }));
    await user.click(screen.getByPlaceholderText('Type an item name or code'));
    await user.click(await screen.findByRole('option', { name: /MS Angle 50mm/ }));
    await user.click(screen.getByRole('button', { name: 'Create Bill' }));

    const bill = (saved?.bills || []).at(-1);
    expect(bill?.customFields?.transporter).toBe('VRL Logistics');
  });
});
