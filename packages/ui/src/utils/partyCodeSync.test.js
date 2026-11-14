import { expect, it } from 'vitest';
import { reconcilePartyCodes } from './partyCodeSync';
import { mirrorServerRows } from '../hooks/useServerMasters';

it('links existing local customers and vendors to their server codes without touching another company', () => {
  const db = {
    customers: [
      { id: 1, companyId: 1, name: 'Old Customer', accountId: 10, code: '' },
      { id: 2, companyId: 2, name: 'Old Customer', accountId: 20, code: '' },
    ],
    vendors: [{ id: 3, companyId: 1, name: 'Old Vendor', backendPartyId: 'vendor-id', accountId: 30, code: '' }],
    chartOfAccounts: [{ id: 10, companyId: 1, code: '' }, { id: 20, companyId: 2, code: '' }, { id: 30, companyId: 1, code: '' }],
  };
  const result = reconcilePartyCodes(db, 1,
    [{ id: 'customer-id', name: 'Old Customer', code: 'CUST-00001' }],
    [{ id: 'vendor-id', name: 'Old Vendor', code: 'VEND-00001' }]);
  expect(result.customers[0]).toMatchObject({ code: 'CUST-00001', backendPartyId: 'customer-id' });
  expect(result.customers[1].code).toBe('');
  expect(result.vendors[0].code).toBe('VEND-00001');
  expect(result.chartOfAccounts.map((row) => row.code)).toEqual(['CUST-00001', '', 'VEND-00001']);
  expect(reconcilePartyCodes(result, 1,
    [{ id: 'customer-id', name: 'Old Customer', code: 'CUST-00001' }],
    [{ id: 'vendor-id', name: 'Old Vendor', code: 'VEND-00001' }])).toBe(result);
});

it('refreshes a linked local row when the server assigns its code', () => {
  let db = { customers: [{ id: 1, companyId: 1, name: 'Old Customer', backendPartyId: 'party-1', code: '' }] };
  mirrorServerRows({
    setDb: (update) => { db = update(db); },
    collection: 'customers', backendKey: 'backendPartyId', companyId: 1,
    serverRows: [{ id: 'party-1', name: 'Old Customer', code: 'CUST-00001' }],
    mapRow: (row) => ({ name: row.name, code: row.code }), syncFields: ['code'],
  });
  expect(db.customers[0].code).toBe('CUST-00001');
});
