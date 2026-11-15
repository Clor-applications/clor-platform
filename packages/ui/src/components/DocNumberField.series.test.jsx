import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocFormActions } from './DocumentForm';
import DocNumberField from './DocNumberField';

describe('document form series placement', () => {
  it('puts the series selector in the header and updates the number field', () => {
    const company = { id: 'company-1', docSettings: {
      numbering: { estimate: { mode: 'auto', prefix: 'EST-', nextNumber: 1 } },
      numberingSeries: { estimate: [{ id: 'second', name: 'Second', mode: 'auto', prefix: 'Q-', nextNumber: 5 }] },
    } };
    let db = { companies: [company], estimates: [] };
    const onChange = vi.fn();
    render(<form><DocFormActions title="New Quotation" primaryLabel="Create" /><DocNumberField id="quotation-number" label="Quotation No." value="EST-1" onChange={onChange} voucherKey="estimate" db={db} setDb={(update) => { db = update(db); }} currentCompany={company} settings={{ seriesId: 'default' }} /></form>);
    const select = screen.getByRole('combobox', { name: 'Estimate number series' });
    expect(select.closest('[data-doc-series-slot]')).not.toBeNull();
    fireEvent.change(select, { target: { value: 'second' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: { value: 'Q-5' } }));
    expect(db.companies[0].docSettings.activeNumberingSeries.estimate).toBe('second');
  });
});
