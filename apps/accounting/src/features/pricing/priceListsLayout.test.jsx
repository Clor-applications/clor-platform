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

  it('carries five figures across the top', () => {
    view();
    expect(screen.getByRole('region', { name: /Summary/i }).children).toHaveLength(5);
  });

  it('counts a list that prices nothing, which is the one worth finding', () => {
    // Wholesale has no rates: every invoice quietly falls back to the item's
    // own price and says nothing about it.
    view();
    const summary = screen.getByRole('region', { name: /Summary/i });
    const card = [...summary.children].find((c) => c.textContent.includes('Pricing nothing'));
    expect(card.textContent).toMatch(/1/);
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
