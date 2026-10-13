/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const created = vi.fn();
const deleted = vi.fn();
const patched = vi.fn();
let signedIn = true;

vi.mock('../api/masters', () => ({
  MASTER_KIND: {
    uoms: 'UOM',
    itemCategories: 'ITEM_CATEGORY',
    priceLists: 'PRICE_LIST',
    discountRules: 'DISCOUNT_RULE',
    costCenters: 'COST_CENTER',
    accountGroups: 'ACCOUNT_GROUP',
    gstRates: 'GST_RATE',
  },
  createOrgMaster: (...a) => created(...a),
  deleteOrgMaster: (...a) => deleted(...a),
  updateOrgMaster: (...a) => patched(...a),
}));
vi.mock('../api/purchaseDocs', () => ({ hasApiSession: () => signedIn }));
vi.mock('../components/ui/notify', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

import { masterDataOf, pushMaster, removeMaster, saveMaster } from './masterSync';

beforeEach(() => {
  created.mockReset().mockResolvedValue({ master: { id: 'srv-1' } });
  deleted.mockReset().mockResolvedValue({});
  patched.mockReset().mockResolvedValue({});
  signedIn = true;
});

/*
 * Six reference lists lived only in the browser: clear it and the units, the
 * categories and — worst — the price lists that decide what an invoice charges
 * were gone, and a second person never saw them at all.
 */
describe('write-through for the reference lists', () => {
  it('sends the right kind for the collection', async () => {
    await saveMaster('priceLists', 'Wholesale', { rates: { 11: 90 } });
    expect(created).toHaveBeenCalledWith('PRICE_LIST', 'Wholesale', { rates: { 11: 90 } });
  });

  it('hands back the server id to keep on the local row', async () => {
    expect(await saveMaster('costCenters', 'Chennai')).toEqual({ backendMasterId: 'srv-1' });
  });

  /*
   * A refusal must never cost somebody their typing. The row stays local and
   * the message says the server did not take it — the rule the salesman
   * master set.
   */
  it('keeps nothing back when the server refuses', async () => {
    created.mockRejectedValue(new Error('nope'));
    expect(await saveMaster('uoms', 'Nos')).toEqual({});
  });

  it('does not call the server when nobody is signed in', async () => {
    signedIn = false;
    expect(await saveMaster('uoms', 'Nos')).toEqual({});
    expect(created).not.toHaveBeenCalled();
  });

  it('refuses a collection that is not one of the six', async () => {
    expect(await saveMaster('invoices', 'INV-1')).toEqual({});
    expect(created).not.toHaveBeenCalled();
  });
});

describe('what gets stored as the payload', () => {
  /*
   * Identity lives in the server's own columns. A stored id would come back on
   * hydration and fight the local numbering.
   */
  it('strips identity from the payload', () => {
    expect(
      masterDataOf({ id: 4, companyId: 1, backendMasterId: 'srv-1', name: 'Retail', hydratedFromServer: true, rates: { 11: 5 }, status: 'active' })
    ).toEqual({ rates: { 11: 5 }, status: 'active' });
  });

  it('pushes an edited row whole, name and payload together', async () => {
    await pushMaster({ id: 4, backendMasterId: 'srv-9', name: 'Retail', rates: { 11: 5 } });
    expect(patched).toHaveBeenCalledWith('srv-9', { name: 'Retail', data: { rates: { 11: 5 } } });
  });

  /* A row the server never took has nothing to patch — and must not throw. */
  it('says nothing about a row that was never sent', async () => {
    await pushMaster({ id: 4, name: 'Local only', rates: {} });
    expect(patched).not.toHaveBeenCalled();
  });
});

describe('removal', () => {
  it('deletes on the server by its server id', async () => {
    await removeMaster({ id: 2, backendMasterId: 'srv-3', name: 'Scrap' });
    expect(deleted).toHaveBeenCalledWith('srv-3');
  });

  it('is silent for a row that only ever existed here', async () => {
    await removeMaster({ id: 2, name: 'Scrap' });
    expect(deleted).not.toHaveBeenCalled();
  });
});

describe('GST rates are a reference list like the rest', () => {
  it('writes a new rate through, carrying the rate in the payload', async () => {
    // A rate added on one machine used to be unknown everywhere else, so an
    // invoice raised elsewhere could not charge it.
    const patch = await saveMaster('gstRates', 'GST 18%', { rate: 18 });

    expect(created).toHaveBeenCalledWith('GST_RATE', 'GST 18%', { rate: 18 });
    expect(patch).toEqual({ backendMasterId: 'srv-1' });
  });
});
