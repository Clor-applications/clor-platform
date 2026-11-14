import { describe, expect, it } from 'vitest';
import { bumpCompanyNextNumber, formatVoucherNumberPreview, getActiveVoucherSeries, getDocSettings, getVoucherSeries, nextFreeVoucherNumber, voucherSeriesFormatKey } from './docSettings';

describe('voucher numbering series', () => {
  const company = {
    id: 'company-1',
    docSettings: {
      numbering: { invoice: { mode: 'auto', prefix: 'INV-', nextNumber: 4 } },
      numberingSeries: { invoice: [{ id: 'export', name: 'Export', mode: 'auto', prefix: 'EXP-', nextNumber: 7 }] },
      activeNumberingSeries: { invoice: 'export' },
    },
  };

  it('uses the selected series and increments only its counter', () => {
    const db = { companies: [company], invoices: [] };
    expect(getVoucherSeries(company, 'invoice').map(({ id }) => id)).toEqual(['default', 'export']);
    expect(getDocSettings(db, company).numbering.invoice.prefix).toBe('EXP-');
    const updated = bumpCompanyNextNumber({ db, companyId: company.id, voucherKey: 'invoice', usedNumber: 'EXP-7' });
    expect(updated[0].docSettings.numberingSeries.invoice[0].nextNumber).toBe(8);
    expect(updated[0].docSettings.numbering.invoice.nextNumber).toBe(4);
  });

  it('keeps existing default series active when no selection is saved', () => {
    const legacy = { ...company, docSettings: { numbering: company.docSettings.numbering } };
    expect(getDocSettings({ companies: [legacy], invoices: [] }, legacy).numbering.invoice.prefix).toBe('INV-');
    const unconfigured = { id: company.id, docSettings: {} };
    expect(getDocSettings({ companies: [unconfigured], invoices: [{ companyId: company.id }] }, unconfigured).numbering.invoice.nextNumber).toBe(2);
  });

  it('does not use an inactive series for new numbers', () => {
    const inactive = { ...company, docSettings: { ...company.docSettings, numberingSeries: { invoice: [{ ...company.docSettings.numberingSeries.invoice[0], isActive: false }] } } };
    expect(getVoucherSeries(inactive, 'invoice')[1].isActive).toBe(false);
    expect(getActiveVoucherSeries(inactive, 'invoice').id).toBe('default');
    expect(getDocSettings({ companies: [inactive], invoices: [] }, inactive).numbering.invoice.prefix).toBe('INV-');
  });

  it('gives an existing conflicting series a distinct number format', () => {
    const conflicting = { ...company, docSettings: { ...company.docSettings, numberingSeries: { invoice: [{ id: 'retail', name: 'Retail sales', mode: 'auto', prefix: 'INV-', nextNumber: 4 }] }, activeNumberingSeries: { invoice: 'retail' } } };
    const [defaultSeries, retailSeries] = getVoucherSeries(conflicting, 'invoice');
    expect(formatVoucherNumberPreview(defaultSeries)).toBe('INV-4');
    expect(formatVoucherNumberPreview(retailSeries)).toBe('RET-4');
    expect(getDocSettings({ companies: [conflicting], invoices: [] }, conflicting).numbering.invoice.prefix).toBe('RET-');
  });

  it('recognizes matching rendered formats even when unused separators differ', () => {
    expect(voucherSeriesFormatKey({ prefix: 'IN', separator: '-' })).toBe(voucherSeriesFormatKey({ prefix: 'IN', separator: '/' }));
  });

  it('skips a bill number already present on the server', () => {
    const billCompany = { id: 'company-1', docSettings: { numbering: { bill: { mode: 'auto', prefix: 'BILL-', nextNumber: 1 } } } };
    expect(nextFreeVoucherNumber({ db: { bills: [], companies: [billCompany] }, company: billCompany, voucherKey: 'bill', takenNumbers: ['BILL-1'] })).toBe('BILL-2');
  });
});
