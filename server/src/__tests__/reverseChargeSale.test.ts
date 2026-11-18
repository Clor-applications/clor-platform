import { describe, expect, it } from 'vitest';
import { checkDocTotals } from '../services/docTotals.js';
import { invoicePostingLines } from '../services/ledger.js';

/*
 * Audit, 17 Nov 2026: a sale marked reverse charge still billed the GST and posted it as output tax. Under
 * reverse charge the buyer pays the tax to the government: the invoice states it, the total leaves it out, and
 * none of it is the seller's.
 */
const doc = { items: [{ quantity: 1, rate: 1000, gstRate: 18, taxableAmount: 1000, gstAmount: 180 }], subtotal: 1000, cgstTotal: 90, sgstTotal: 90, gstTotal: 180 };

describe('a sale under reverse charge', () => {
  it('has a total without the tax', () => {
    expect(checkDocTotals({ ...doc, total: 1000, reverseCharge: true })).toBeNull();
    expect(checkDocTotals({ ...doc, total: 1180, reverseCharge: true })?.field).toBe('total');
    expect(checkDocTotals({ ...doc, total: 1180 })).toBeNull();
  });

  it('posts no output GST and a receivable of the value alone', () => {
    const lines = invoicePostingLines({ subtotal: 1000, cgstTotal: 90, sgstTotal: 90, igstTotal: 0, total: 1000, reverseCharge: true });
    expect(lines.find((l) => l.controlKind === 'AR')?.debit).toBe(1000);
    expect(lines.some((l) => String(l.controlKind).endsWith('_OUT'))).toBe(false);
    expect(lines.some((l) => l.controlKind === 'ROUNDING')).toBe(false);
  });
});
