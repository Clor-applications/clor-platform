/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';

import { COLLECTION_FOR_KIND, MASTER_KIND } from './masters';

/**
 * The real map, unmocked.
 *
 * Every other test of the reference lists mocks this module and supplies its
 * own map, so a collection missing here passes all of them while the screen
 * silently keeps its rows in the browser: `saveMaster` returns early when the
 * collection has no kind, and it returns early quietly.
 */
describe('the reference lists the server knows', () => {
  it('covers every collection that writes through', () => {
    expect(MASTER_KIND).toEqual({
      uoms: 'UOM',
      itemCategories: 'ITEM_CATEGORY',
      priceLists: 'PRICE_LIST',
      discountRules: 'DISCOUNT_RULE',
      costCenters: 'COST_CENTER',
      accountGroups: 'ACCOUNT_GROUP',
      gstRates: 'GST_RATE',
    });
  });

  it('maps each kind back to exactly one collection, so hydration lands', () => {
    for (const [collection, kind] of Object.entries(MASTER_KIND)) {
      expect(COLLECTION_FOR_KIND[kind]).toBe(collection);
    }
  });
});
