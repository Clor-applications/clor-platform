import { describe, expect, it } from 'vitest';

import { isGstRegistered, outstandingByParty, standingOf } from './partyStanding';

const docs = [
  { companyId: 1, customerId: 5, total: 10000, paidAmount: 0, dueDate: '2026-08-01', status: 'Unpaid' },
  { companyId: 1, customerId: 5, total: 5000, paidAmount: 2000, dueDate: '2026-12-31', status: 'Partial' },
  { companyId: 1, customerId: 5, total: 9000, paidAmount: 9000, dueDate: '2026-01-01', status: 'Paid' },
  { companyId: 1, customerId: 7, total: 4000, paidAmount: 0, dueDate: '2026-01-01', status: 'Cancelled' },
  { companyId: 1, customerId: 7, total: 3000, paidAmount: 0, dueDate: '2026-01-01', status: 'Draft' },
  { companyId: 2, customerId: 5, total: 99999, paidAmount: 0, dueDate: '2026-01-01', status: 'Unpaid' },
];

describe('what a party owes', () => {
  const byId = outstandingByParty({ docs, idKey: 'customerId', companyId: 1, todayIso: '2026-09-10' });

  it('counts what is unpaid, not what was billed', () => {
    // 10,000 in full + 3,000 of the part-paid one. The settled invoice is done.
    expect(standingOf(byId, 5).outstanding).toBe(13000);
    expect(standingOf(byId, 5).documents).toBe(2);
  });

  it('separates the part that is late, which is the part somebody chases', () => {
    expect(standingOf(byId, 5).overdue).toBe(10000);
  });

  it('leaves out cancelled and draft documents', () => {
    // A draft is an intention and a cancelled invoice is not owed. Counting
    // either would send somebody chasing money nobody owes.
    expect(standingOf(byId, 7).outstanding).toBe(0);
  });

  it('never counts another company’s documents', () => {
    expect(standingOf(byId, 5).outstanding).toBe(13000);
  });

  it('answers zero for a party with nothing against them', () => {
    expect(standingOf(byId, 999)).toEqual({ outstanding: 0, overdue: 0, documents: 0 });
  });
});

describe('whether a party is registered', () => {
  it('takes a GSTIN as the evidence it is', () => {
    // The dropdown is what somebody chose; the number is the fact. A party with
    // a GSTIN typed in is registered whatever the dropdown was left on.
    expect(isGstRegistered({ gstin: '29ABCDE1234F1Z5', gstRegistration: 'Unregistered' })).toBe(true);
  });

  it('accepts the registration type when there is no number yet', () => {
    expect(isGstRegistered({ gstRegistration: 'Regular' })).toBe(true);
    expect(isGstRegistered({ gstRegistration: 'Composition' })).toBe(true);
  });

  it('says no for an unregistered party', () => {
    expect(isGstRegistered({ gstRegistration: 'Unregistered' })).toBe(false);
    expect(isGstRegistered({})).toBe(false);
  });
});
