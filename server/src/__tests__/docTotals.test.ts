import { describe, expect, it } from 'vitest';

import { checkDocTotals } from '../services/docTotals.js';
// The form's own arithmetic: what it sends is what this check must accept.
// @ts-expect-error a plain JavaScript module of the web app, with no types
import { computeGstForLines } from '../../../packages/ui/src/utils/gst.js';

/**
 * The server refuses a document whose totals disagree with its lines (owner,
 * 17 Nov 2026). The first half proves it never refuses what the forms really
 * send, across thousands of made-up documents run through the form's own
 * function; the second, that it catches each kind of disagreement.
 */

/* A small repeatable random source, so a failure can be run again. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const RATES = [0, 0.1, 0.25, 3, 5, 12, 18, 28];

const asSent = (c: any, extra: Record<string, unknown> = {}) => ({
  items: c.lines,
  subtotal: c.subtotal,
  cgstTotal: c.cgstTotal,
  sgstTotal: c.sgstTotal,
  igstTotal: c.igstTotal,
  gstTotal: c.gstTotal,
  total: c.total,
  otherCharges: c.otherCharges.length ? c.otherCharges : undefined,
  otherChargesTotal: c.otherChargesTotal,
  invoiceDiscountApplied: c.invoiceDiscount,
  ...extra,
});

describe('what the forms send is accepted', () => {
  it('5,000 documents from the form’s own arithmetic: lines, line discounts, a discount on the whole, other charges, both kinds of supply', () => {
    const r = rng(20261117);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    for (let n = 0; n < 5000; n += 1) {
      const lines = Array.from({ length: 1 + Math.floor(r() * 12) }, () => ({
        description: 'x',
        quantity: pick([1, 2, 3, 7, 12, 0.5, 1.25, 33, 144, 0.333]),
        rate: Math.round(r() * 250_000) / 100,
        gstRate: pick(RATES),
        discountPct: r() < 0.25 ? pick([5, 10, 12.5, 33.33]) : undefined,
        discountAmount: r() < 0.15 ? Math.round(r() * 5000) / 100 : undefined,
      }));
      const computed = computeGstForLines({
        lines,
        isIntra: r() < 0.5,
        invoiceDiscount: r() < 0.3 ? { type: pick(['pct', 'amt']), value: pick([2.5, 5, 10, 100, 250.75]) } : null,
        otherCharges: r() < 0.3 ? Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ label: 'Freight', amount: Math.round(r() * 90_000) / 100, gstRate: pick(RATES) })) : [],
      });
      const refused = checkDocTotals(asSent(computed));
      if (refused) throw new Error(`document ${n} refused: ${refused.message}\n${JSON.stringify({ lines, computed }, null, 1).slice(0, 1500)}`);
    }
  });

  it('the plain shapes the API and the tests send: lines with no worked amounts, and no lines at all', () => {
    expect(checkDocTotals({ items: [{ quantity: 1, rate: 1000, gstRate: 18 }], subtotal: 1000, cgstTotal: 90, sgstTotal: 90, igstTotal: 0, gstTotal: 180, total: 1180 })).toBeNull();
    expect(checkDocTotals({ items: [{ quantity: 2, rate: 500, gstRate: 0 }], subtotal: 1000, gstTotal: 0, total: 1000 })).toBeNull();
    expect(checkDocTotals({ items: [], subtotal: 1000, igstTotal: 180, gstTotal: 180, total: 1180 })).toBeNull();
    expect(checkDocTotals({ subtotal: 0, total: 0 })).toBeNull();
    /* An expense: one row a ledger, the amount its taxable value. */
    expect(checkDocTotals({ items: [{ quantity: 1, rate: 2500, gstRate: 18, taxableAmount: 2500, gstAmount: 450 }], subtotal: 2500, cgstTotal: 225, sgstTotal: 225, gstTotal: 450, total: 2950 })).toBeNull();
    /* A discount on the whole, lines sent bare. */
    expect(checkDocTotals({ items: [{ quantity: 1, rate: 1000, gstRate: 18 }], invoiceDiscountApplied: 100, subtotal: 900, igstTotal: 162, gstTotal: 162, total: 1062 })).toBeNull();
  });
});

describe('what does not add up is refused, and says which figure', () => {
  const good = { items: [{ quantity: 1, rate: 1000, gstRate: 18, taxableAmount: 1000, gstAmount: 180 }], subtotal: 1000, cgstTotal: 90, sgstTotal: 90, igstTotal: 0, gstTotal: 180, total: 1180 };
  const field = (over: Record<string, unknown>) => checkDocTotals({ ...good, ...over })?.field;

  it('a total that is not taxable value + charges + tax', () => {
    expect(checkDocTotals(good)).toBeNull();
    expect(field({ total: 118 })).toBe('total');
    expect(field({ total: 1180.05 })).toBe('total');
    expect(field({ total: 1180.02 })).toBeUndefined();
    expect(checkDocTotals({ ...good, total: 100 })?.message).toMatch(/add up to ₹1,180\.00, not ₹100\.00/);
  });

  it('a taxable total that is not the lines', () => {
    expect(field({ subtotal: 500, total: 680 })).toBe('subtotal');
    expect(field({ items: [...good.items, { quantity: 1, rate: 50, gstRate: 0 }] })).toBe('subtotal');
  });

  it('tax that is not the rate, on a line or in total', () => {
    expect(field({ items: [{ ...good.items[0], gstAmount: 18 }], cgstTotal: 9, sgstTotal: 9, gstTotal: 18, total: 1018 })).toBe('items.0.gstAmount');
    expect(field({ cgstTotal: 0, sgstTotal: 0, gstTotal: 0, total: 1000 })).toBe('gstTotal');
    expect(field({ items: [{ ...good.items[0], gstRate: 180 }] })).toBe('items.0.gstRate');
  });

  it('a taxable value above quantity × rate', () => {
    expect(field({ items: [{ quantity: 1, rate: 1000, gstRate: 18, taxableAmount: 5000, gstAmount: 900 }], subtotal: 5000, cgstTotal: 450, sgstTotal: 450, gstTotal: 900, total: 5900 })).toBe('items.0.taxableAmount');
  });

  it('a split that is not the tax, or is both kinds, or uneven', () => {
    expect(field({ cgstTotal: 90, sgstTotal: 0, igstTotal: 0 })).toBe('gstTotal');
    expect(field({ cgstTotal: 45, sgstTotal: 45, igstTotal: 90 })).toBe('igstTotal');
    expect(field({ cgstTotal: 100, sgstTotal: 80 })).toBe('sgstTotal');
    expect(field({ cgstTotal: 0, sgstTotal: 0, igstTotal: 180 })).toBeUndefined();
  });

  it('other charges that do not add up, and amounts below zero or not numbers', () => {
    const withCharge = { ...good, otherCharges: [{ label: 'Freight', amount: 100, gstRate: 18, taxableAmount: 100, gstAmount: 18 }], otherChargesTotal: 100, cgstTotal: 99, sgstTotal: 99, gstTotal: 198, total: 1298 };
    expect(checkDocTotals(withCharge)).toBeNull();
    expect(checkDocTotals({ ...withCharge, otherChargesTotal: 10 })?.field).toBe('otherChargesTotal');
    expect(checkDocTotals({ ...withCharge, otherCharges: [{ ...withCharge.otherCharges[0], gstAmount: 0 }] })?.field).toBe('otherCharges.0.gstAmount');
    expect(field({ total: -1180 })).toBe('total');
    expect(field({ subtotal: 'abc' })).toBe('subtotal');
    expect(field({ items: [{ quantity: 'x', rate: 1 }] })).toBe('items.0');
  });
});
