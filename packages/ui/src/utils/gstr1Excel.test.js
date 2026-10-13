import { describe, expect, it } from 'vitest';
import { buildGstr1ExcelModel } from '@ui/utils/gstr1Excel';

describe('buildGstr1ExcelModel', () => {
  it('creates a filing summary source and every GSTR-1 particulars sheet', () => {
    const model = buildGstr1ExcelModel({
      company: { name: 'CLOR Test', gstin: '29ABCDE1234F1Z5', address: 'Bengaluru' },
      gstin: '29ABCDE1234F1Z5',
      periodLabel: 'April 2026',
      db: {
        invoices: [{ id: '1', status: 'Paid', number: 'INV-1', date: '2026-04-10', customerName: 'Registered Buyer', customerGstin: '29AAAAA0000A1Z5', subtotal: 1000, cgstTotal: 90, sgstTotal: 90, gstTotal: 180, total: 1180, items: [{ itemId: 'i1', quantity: 2, rate: 500, amount: 1000, gstRate: 18 }] }],
        creditNotes: [], payments: [], journalEntries: [], items: [{ id: 'i1', name: 'Item', hsnSac: '1001', unit: 'PCS' }],
      },
    });

    expect(model.company.gstin).toBe('29ABCDE1234F1Z5');
    expect(model.company.period).toBe('April 2026');
    expect(model.sections).toHaveLength(13);
    expect(model.sections.find((section) => section.key === 'b2b')?.rows).toHaveLength(1);
    expect(model.sections.find((section) => section.key === 'hsn')?.rows[0]).toMatchObject({ hsn: '1001', quantity: 2, taxable: 1000 });
    expect(model.sections.find((section) => section.key === 'documents')?.rows[0]).toMatchObject({ total: 1, net: 1 });
  });
});

