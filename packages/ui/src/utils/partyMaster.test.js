import { describe, expect, it } from 'vitest';

import { activePriceListOptions, mergeGstinFetch, validateParty } from './partyMaster';

describe('a GSTN fetch fills blanks', () => {
  const data = {
    gstin: '29AABCU9603R1ZM',
    pan: 'AABCU9603R',
    legalName: 'Umbrella Chemicals Private Limited',
    state: 'Karnataka',
    address: { line1: '4 MG Road', city: 'Bengaluru', pincode: '560001' },
  };

  it('fills what is empty', () => {
    const { next } = mergeGstinFetch({ prev: { displayName: '', pan: '', billingAddress: {} }, data });
    expect(next.displayName).toBe('Umbrella Chemicals Private Limited');
    expect(next.pan).toBe('AABCU9603R');
    expect(next.billingAddress.line1).toBe('4 MG Road');
    expect(next.billingAddress.state).toBe('Karnataka');
  });

  /*
   * The spec is explicit: do not silently overwrite what somebody typed. A
   * name corrected to what the business actually calls this supplier must
   * survive a button pressed to get the PAN.
   */
  it('keeps what was typed, and says what it kept', () => {
    const { next, kept } = mergeGstinFetch({
      prev: { displayName: 'Umbrella Chem', pan: '', billingAddress: { line1: 'Gate 2, 4 MG Road' } },
      data,
    });
    expect(next.displayName).toBe('Umbrella Chem');
    expect(next.billingAddress.line1).toBe('Gate 2, 4 MG Road');
    expect(kept).toEqual(expect.arrayContaining(['name', 'address']));
  });

  it('does not report a difference that is only case or spacing', () => {
    const { kept } = mergeGstinFetch({
      prev: { displayName: '  umbrella chemicals private limited  ', billingAddress: {} },
      data,
    });
    expect(kept).not.toContain('name');
  });

  it('takes the state from the number, which is where it comes from', () => {
    const { next } = mergeGstinFetch({ prev: { billingAddress: { state: 'Kerala' } }, data });
    expect(next.billingAddress.state).toBe('Karnataka');
  });
});

describe('the price lists a party may point at', () => {
  const db = {
    priceLists: [
      { id: 1, companyId: 1, name: 'Trade', status: 'active' },
      { id: 2, companyId: 1, name: 'Festive', status: 'active', validFrom: '2026-10-01', validTo: '2026-10-31' },
      { id: 3, companyId: 1, name: 'Old', status: 'inactive' },
      { id: 4, companyId: 2, name: 'Another book', status: 'active' },
    ],
  };

  it('offers only lists in force on the day, from this company', () => {
    const opts = activePriceListOptions({ db, companyId: 1, onDate: '2026-09-11' });
    expect(opts.map((o) => o.label)).toEqual(['Trade']);
  });

  it('offers a seasonal list inside its window', () => {
    const opts = activePriceListOptions({ db, companyId: 1, onDate: '2026-10-15' });
    expect(opts.map((o) => o.label)).toEqual(['Festive', 'Trade']);
  });
});

describe('validateParty', () => {
  const ok = { displayName: 'Umbrella Chemicals', groupId: '7' };
  const run = (over = {}, priceListOptions = []) =>
    validateParty({ values: { ...ok, ...over }, noun: 'Vendor', priceListOptions });

  it('passes a party with a name and a group', () => {
    expect(run()).toBeNull();
  });

  it('requires the name and the group', () => {
    expect(run({ displayName: '  ' })).toMatchObject({ field: 'displayName' });
    expect(run({ groupId: '' })).toMatchObject({ field: 'groupId' });
  });

  it('refuses a negative or non-numeric credit limit and points at its tab', () => {
    expect(run({ creditLimit: '-1' })).toMatchObject({ field: 'creditLimit', tab: 'credit' });
    expect(run({ creditLimit: 'lots' })).toMatchObject({ field: 'creditLimit', tab: 'credit' });
    expect(run({ creditLimit: '' })).toBeNull();
    expect(run({ creditLimit: '250000' })).toBeNull();
  });

  it('refuses a price list that is not on offer', () => {
    const lists = [{ value: '1', label: 'Trade' }];
    expect(run({ priceListId: '9' }, lists)).toMatchObject({ field: 'priceListId', tab: 'credit' });
    expect(run({ priceListId: '1' }, lists)).toBeNull();
    expect(run({ priceListId: '' }, lists)).toBeNull();
  });

  it('checks PAN format only when one is entered', () => {
    expect(run({ pan: '' })).toBeNull();
    expect(run({ pan: 'NOPE' })).toMatchObject({ field: 'pan', tab: 'statutory' });
    expect(run({ pan: 'AABCU9603R' })).toBeNull();
  });

  it('refuses an opening balance that is not a number', () => {
    expect(run({ openingBalance: 'ten' })).toMatchObject({ field: 'openingBalance' });
    expect(run({ openingBalance: '0' })).toBeNull();
  });
});
