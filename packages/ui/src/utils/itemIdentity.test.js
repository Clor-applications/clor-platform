/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { renameItemReferences } from './itemIdentity';
import { mirrorServerRows } from '../hooks/useServerMasters';

const C = 1;

describe('renaming an item reference', () => {
  const db = {
    items: [{ id: 5, companyId: C, name: 'Mango' }],
    invoices: [
      { id: 1, companyId: C, items: [{ itemId: '5', quantity: 2 }, { itemId: 'itm-x', quantity: 1 }] },
      { id: 2, companyId: 2, items: [{ itemId: '5', quantity: 9 }] },
    ],
    stockAdjustments: [{ id: 1, companyId: C, itemId: 5, qtyDelta: -1 }],
    stockTransfers: [{ id: 't', companyId: C, lines: [{ itemId: '5', qty: 3 }] }],
    recurringInvoices: [{ id: 1, companyId: C, template: { items: [{ itemId: '5' }] } }],
    discountRules: [{ id: 1, companyId: C, itemIds: [5, 'itm-x'] }],
    priceLists: [{ id: 1, companyId: C, rates: { 5: 80, 'itm-x': 10 } }],
    customers: [{ id: 5, companyId: C, name: 'Not an item' }],
  };

  it('moves every line, adjustment, template, rule and price in this company, and nothing else', () => {
    const patch = renameItemReferences(db, C, 5, 'itm-mango');
    expect(patch.invoices[0].items.map((l) => l.itemId)).toEqual(['itm-mango', 'itm-x']);
    expect(patch.invoices[1]).toBe(db.invoices[1]);
    expect(patch.stockAdjustments[0].itemId).toBe('itm-mango');
    expect(patch.stockTransfers[0].lines[0].itemId).toBe('itm-mango');
    expect(patch.recurringInvoices[0].template.items[0].itemId).toBe('itm-mango');
    expect(patch.discountRules[0].itemIds).toEqual(['itm-mango', 'itm-x']);
    expect(patch.priceLists[0].rates).toEqual({ 'itm-mango': 80, 'itm-x': 10 });
    expect(patch.items).toBeUndefined();
    expect(patch.customers).toBeUndefined();
  });

  it('is a no-op for the same id', () => {
    expect(renameItemReferences(db, C, 5, '5')).toEqual({});
  });
});

describe('items arriving from the server in a picker', () => {
  const run = (prev, serverRows) => {
    let next = prev;
    mirrorServerRows({
      setDb: (fn) => (next = fn(prev)),
      collection: 'items',
      backendKey: 'backendItemId',
      serverRows,
      companyId: C,
      mapRow: (s) => ({ name: s.name }),
    });
    return next;
  };

  it('arrive under their server id', () => {
    const next = run({ items: [] }, [{ id: 'itm-apple', name: 'Apple' }]);
    expect(next.items[0]).toMatchObject({ id: 'itm-apple', backendItemId: 'itm-apple' });
  });

  it('adopt a local-only twin and move its lines to the server id', () => {
    const prev = {
      items: [{ id: 3, companyId: C, name: 'Mango' }],
      invoices: [{ id: 1, companyId: C, items: [{ itemId: '3' }] }],
    };
    const next = run(prev, [{ id: 'itm-mango', name: 'Mango' }]);
    expect(next.items).toEqual([{ id: 'itm-mango', companyId: C, name: 'Mango', backendItemId: 'itm-mango' }]);
    expect(next.invoices[0].items[0].itemId).toBe('itm-mango');
  });
});
