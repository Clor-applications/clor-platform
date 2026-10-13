import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/api/invoices', () => ({ createInvoiceApi: vi.fn() }));
vi.mock('@ui/api/posDayClose', () => ({ createPosDayClose: vi.fn() }));
vi.mock('@ui/api/purchaseDocs', () => ({ hasApiSession: () => false }));

import PosScreen from './PosScreen';

const COMPANY = { id: 1, name: 'Neev Kirana', state: 'Karnataka' };

const dbWith = (posDayCloses) => ({
  companies: [COMPANY],
  items: [{ id: 11, companyId: 1, name: 'Sugar 1kg', salePrice: 55, gstRate: 5, unit: 'Nos' }],
  invoices: [],
  posDayCloses,
});

/*
 * The count is a cash control, and a control nobody can read is a number typed
 * into a form. Before this the till stored the day close and no screen ever
 * showed it back — not even to the owner, who is the person it is for.
 */
describe('recent day closes', () => {
  it('shows what was taken, what was counted and the difference', () => {
    render(
      <PosScreen
        db={dbWith([
          { id: 1, companyId: 1, date: '2026-09-08', invoices: 12, total: 6300.5, countedCash: 4250.5, overShort: -50 },
        ])}
        setDb={() => {}}
        currentCompany={COMPANY}
      />
    );

    const row = screen.getByText('2026-09-08').closest('tr');
    expect(row).toBeTruthy();
    expect(row.textContent).toMatch(/12/);
    expect(row.textContent).toMatch(/Short/);
    expect(row.textContent).toMatch(/50/);
  });

  it('says a drawer that agreed with the till agreed', () => {
    render(
      <PosScreen
        db={dbWith([{ id: 1, companyId: 1, date: '2026-09-07', invoices: 4, total: 900, countedCash: 900, overShort: 0 }])}
        setDb={() => {}}
        currentCompany={COMPANY}
      />
    );

    expect(screen.getByText('2026-09-07').closest('tr').textContent).toMatch(/Tallied/);
  });

  it('leaves another company\'s till out of it', () => {
    render(
      <PosScreen
        db={dbWith([{ id: 1, companyId: 2, date: '2026-09-06', invoices: 9, total: 5000, countedCash: 5000, overShort: 0 }])}
        setDb={() => {}}
        currentCompany={COMPANY}
      />
    );

    expect(screen.queryByText('2026-09-06')).toBeNull();
    expect(screen.queryByText(/Recent day closes/i)).toBeNull();
  });
});
