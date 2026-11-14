import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DocNumberingPopover from './DocNumberingPopover';

vi.mock('./ui/Drawer', () => ({ default: ({ children, actions }) => <div>{children}{actions}</div> }));

describe('invoice series settings', () => {
  it('saves changes to the selected Master Data series', () => {
    const company = { id: 'company-1', docSettings: {
      numbering: { invoice: { prefix: 'INV-', nextNumber: 9 } },
      numberingSeries: { invoice: [{ id: 'export', name: 'Export', prefix: 'EXP-', nextNumber: 3 }] },
      activeNumberingSeries: { invoice: 'export' },
    } };
    let db = { companies: [company], branches: [] };
    const setDb = vi.fn((update) => { db = typeof update === 'function' ? update(db) : update; });
    const onSaved = vi.fn();
    render(<DocNumberingPopover db={db} setDb={setDb} currentCompany={company} voucherKey="invoice" settings={{ seriesId: 'export', mode: 'auto', prefix: 'EXP-', nextNumber: 3 }} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Prefix'), { target: { value: 'EX/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(db.companies[0].docSettings.numberingSeries.invoice[0].prefix).toBe('EX/');
    expect(db.companies[0].docSettings.numbering.invoice.prefix).toBe('INV-');
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'EX/' }));
  });
});
