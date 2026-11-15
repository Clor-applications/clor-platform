import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VoucherSeriesSelect from './VoucherSeriesSelect';

describe('voucher series selection', () => {
  it.each(['purchaseOrder', 'receipt', 'stockAdjustment'])('uses the chosen active %s series for the next number', (voucherKey) => {
    const company = { id: 'company-1', docSettings: {
      numbering: { [voucherKey]: { mode: 'auto', prefix: 'DEF-', nextNumber: 2 } },
      numberingSeries: { [voucherKey]: [{ id: 'second', name: 'Second', mode: 'auto', prefix: 'TWO-', nextNumber: 7 }, { id: 'disabled', name: 'Disabled', isActive: false, mode: 'auto', prefix: 'OFF-', nextNumber: 1 }] },
    } };
    let db = { companies: [company], purchaseOrders: [], stockAdjustments: [] };
    const setDb = vi.fn((update) => { db = update(db); });
    const onNumberChange = vi.fn();
    const { unmount } = render(<VoucherSeriesSelect db={db} setDb={setDb} currentCompany={company} voucherKey={voucherKey} onNumberChange={onNumberChange} />);
    const select = screen.getByRole('combobox');
    expect(screen.queryByRole('option', { name: 'Disabled' })).toBeNull();
    fireEvent.change(select, { target: { value: 'second' } });
    expect(db.companies[0].docSettings.activeNumberingSeries[voucherKey]).toBe('second');
    expect(onNumberChange).toHaveBeenCalledWith('TWO-7');
    unmount();
  });
});
