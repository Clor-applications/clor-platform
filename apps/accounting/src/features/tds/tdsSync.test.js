/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listOrgMasters = vi.fn(async () => ({ masters: [] }));
const createOrgMaster = vi.fn(async () => ({ master: { id: 'srv-1' } }));
const updateOrgMaster = vi.fn(async () => ({}));
vi.mock('@ui/api/masters', () => ({
  listOrgMasters: (...a) => listOrgMasters(...a),
  createOrgMaster: (...a) => createOrgMaster(...a),
  updateOrgMaster: (...a) => updateOrgMaster(...a),
}));
vi.mock('@ui/api/purchaseDocs', () => ({ hasApiSession: () => true }));

import { hydrateTdsStores, pushTdsRow } from './tdsSync';

/**
 * The compliance stores crossing devices: identity is the uid, local ids
 * never travel, and an allocation's joins are rebuilt through the uid maps
 * on arrival.
 */

describe('pushing', () => {
  beforeEach(() => {
    createOrgMaster.mockClear();
    updateOrgMaster.mockClear();
  });

  it('creates by uid, then patches by the server id it was given', async () => {
    const row = { id: 1, companyId: 1, uid: 'tds-abc', tdsAmount: 2000 };
    const first = await pushTdsRow('tdsTransactions', row);
    expect(first).toEqual({ backendMasterId: 'srv-1' });
    expect(createOrgMaster).toHaveBeenCalledWith('TDS_EVENT', 'tds-abc', row);

    await pushTdsRow('tdsTransactions', { ...row, backendMasterId: 'srv-1', tdsAmount: 2500 });
    expect(updateOrgMaster).toHaveBeenCalledWith('srv-1', { data: expect.objectContaining({ tdsAmount: 2500 }) });
  });

  it('refuses a row with no uid — local ids never travel alone', async () => {
    const res = await pushTdsRow('tdsTransactions', { id: 1, companyId: 1 });
    expect(res).toEqual({});
    expect(createOrgMaster).not.toHaveBeenCalled();
  });
});

describe('hydrating', () => {
  it('assigns fresh local ids and rebuilds allocation joins through uids', async () => {
    /* Another device wrote: event uid e-9 (its local id 1), challan c-4
       (its local id 1), and the allocation joining them by ITS ids. This
       browser already holds an unrelated event with local id 7. */
    listOrgMasters.mockResolvedValueOnce({
      masters: [
        { id: 's1', kind: 'TDS_EVENT', data: { id: 1, uid: 'e-9', companyId: 1, tdsAmount: 2000 } },
        { id: 's2', kind: 'TDS_CHALLAN', data: { id: 1, uid: 'c-4', companyId: 1, taxAmount: 2000 } },
        {
          id: 's3',
          kind: 'TDS_CHALLAN_ALLOC',
          data: { id: 1, uid: 'a-1', companyId: 1, amount: 2000, tdsTransactionId: 1, challanId: 1, tdsTransactionUid: 'e-9', challanUid: 'c-4' },
        },
      ],
    });

    const local = {
      tdsTransactions: [{ id: 7, uid: 'mine', companyId: 1, tdsAmount: 500 }],
      tdsChallans: [],
      tdsChallanAllocations: [],
      tdsFilings: [],
    };
    const { patch, changed } = await hydrateTdsStores(local, 1);
    expect(changed).toBe(true);

    /* The arriving event does NOT collide with local id 7 — it takes 8. */
    const arrived = patch.tdsTransactions.find((e) => e.uid === 'e-9');
    expect(arrived.id).toBe(8);
    expect(arrived.backendMasterId).toBe('s1');

    /* And the allocation's joins point at THIS browser's ids, not the
       writer's. */
    const alloc = patch.tdsChallanAllocations[0];
    expect(alloc.tdsTransactionId).toBe(8);
    expect(alloc.challanId).toBe(patch.tdsChallans.find((c) => c.uid === 'c-4').id);
  });

  it('a row this browser already holds is left alone', async () => {
    listOrgMasters.mockResolvedValueOnce({
      masters: [{ id: 's1', kind: 'TDS_EVENT', data: { id: 3, uid: 'mine', companyId: 1, tdsAmount: 999 } }],
    });
    const local = { tdsTransactions: [{ id: 7, uid: 'mine', companyId: 1, tdsAmount: 500 }] };
    const { patch } = await hydrateTdsStores(local, 1);
    expect(patch.tdsTransactions).toBeUndefined();
  });
});
