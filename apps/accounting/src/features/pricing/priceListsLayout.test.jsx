import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/utils/masterSync', () => ({
  pushMaster: vi.fn(async () => ({})),
  removeMaster: vi.fn(async () => ({})),
  saveMaster: vi.fn(async () => ({})),
}));

import PriceLists from './PriceLists';

const COMPANY = { id: 1, name: 'Neev Steels', state: 'Karnataka' };

const db = {
  companies: [COMPANY],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', salePrice: 1200 }],
  priceLists: [
    { id: 1, companyId: 1, name: 'Retail', applyTo: 'all', validFrom: '2026-04-01', validTo: '', createdAt: '2026-04-01', description: 'Default retail prices', isActive: true, rates: { 11: 1250 } },
    { id: 2, companyId: 1, name: 'Wholesale', applyTo: 'selected', validFrom: '2026-01-01', validTo: '2026-03-31', createdAt: '2026-01-01', isActive: true, rates: {} },
  ],
  customers: [], invoices: [], uoms: [], gstRates: [],
};

const noop = () => {};
const view = () => render(<PriceLists db={db} setDb={noop} currentCompany={COMPANY} />);

/*
 * Price Lists, on the shared layout.
 *
 * It had the tabs and the search already but no figures, and its export was a
 * lone download icon parked beside the tabs where no other list keeps one.
 */
describe('Price Lists, laid out like every other list', () => {
  it('names itself and puts search in the header', () => {
    view();
    expect(screen.getByRole('heading', { name: /Price Lists/i })).toBeTruthy();
    expect(screen.getByLabelText(/Search price lists/i)).toBeTruthy();
  });

  /*
   * The two figure-row tests are retired (30 Oct 2026): Price Lists sits on
   * the masters layout — status in the header, no figure row — like Customers
   * and the other masters lists, and has since the import (00f6a61a). The
   * "Pricing nothing" figure they read never shipped in this repository. The
   * counts live in the status dropdown instead.
   */
  it('counts each status in the dropdown, over what search left standing', () => {
    view();
    const options = [...screen.getByRole('combobox', { name: 'Price list status' }).querySelectorAll('option')].map((o) => o.textContent);
    /* Wholesale ran to 31 March, so it is expired whatever today is after that. */
    expect(options).toEqual(['All (2)', 'Active (1)', 'Inactive (0)', 'Expired (1)']);
  });

  it('keeps the status filter in the header and export behind More', () => {
    view();
    expect(screen.getByRole('button', { name: /^More$/i })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Price list status' })).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('puts the rows in one card, not a card inside a card', () => {
    const { container } = view();
    const card = container.querySelector('table.ui-table').closest('.ui-card');
    expect(card).toBeTruthy();
    expect(card.parentElement.closest('.ui-card')).toBeNull();
  });
});
