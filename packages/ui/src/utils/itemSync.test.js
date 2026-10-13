/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const created = vi.fn();
const errors = vi.fn();
let signedIn = true;

vi.mock('../api/masters', () => ({ createItem: (...a) => created(...a) }));
vi.mock('../api/purchaseDocs', () => ({ hasApiSession: () => signedIn }));
vi.mock('../components/ui/notify', () => ({ notify: { error: (...a) => errors(...a), success: vi.fn() } }));

import { saveItemToServer } from './itemSync';

beforeEach(() => {
  created.mockReset().mockResolvedValue({ item: { id: 'srv-item-1' } });
  errors.mockReset();
  signedIn = true;
});

/*
 * An item created from the Items screen was written to the browser and nowhere
 * else, while the same item created from a picker on an invoice line was
 * written through — so whether a catalogue survived a change of machine
 * depended on which screen it was typed into. Hydration matches on
 * `backendItemId`, so a browser-only item is invisible to it.
 */
describe('writing an item through to the server', () => {
  it('sends what the server stores, and links the local row to its twin', async () => {
    const patch = await saveItemToServer({
      code: 'ANG50',
      name: 'MS Angle 50mm',
      type: 'Goods',
      unit: 'Nos',
      hsnSac: '7216',
      gstRate: 18,
      salePrice: 1200,
      purchasePrice: 850,
    });

    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0][0]).toMatchObject({
      code: 'ANG50',
      name: 'MS Angle 50mm',
      itemType: 'STOCK',
      hsnSac: '7216',
      gstRate: 18,
      salePrice: 1200,
    });
    expect(patch).toEqual({ backendItemId: 'srv-item-1' });
  });

  it('tells the server a service is a service', async () => {
    // A service has no stock. Sent as STOCK it would be refused on the first
    // invoice for having none.
    await saveItemToServer({ name: 'Freight', type: 'Service' });
    expect(created.mock.calls[0][0].itemType).toBe('SERVICE');
  });

  it('keeps the row here and says so when the server refuses it', async () => {
    created.mockRejectedValue(new Error('duplicate code'));

    expect(await saveItemToServer({ name: 'MS Angle' })).toEqual({});
    expect(String(errors.mock.calls[0][0])).toMatch(/duplicate code/);
  });

  it('does not call the server when nobody is signed in', async () => {
    signedIn = false;
    expect(await saveItemToServer({ name: 'MS Angle' })).toEqual({});
    expect(created).not.toHaveBeenCalled();
  });
});
