import { describe, expect, it } from 'vitest';

import { isForeignDocument, isIntraStateSupply, issuingState } from './gst';

describe('the state a document is issued from (audit, 17 Nov 2026)', () => {
  const company = { state: 'Karnataka' };
  it('is the branch’s, where the branch has one, else the company’s', () => {
    expect(issuingState(company, { state: 'Tamil Nadu' })).toBe('Tamil Nadu');
    expect(issuingState(company, { state: '' })).toBe('Karnataka');
    expect(issuingState(company, null)).toBe('Karnataka');
    expect(issuingState(null, null)).toBe('');
  });

  it('so a Tamil Nadu branch billing a Tamil Nadu customer charges CGST + SGST, not IGST', () => {
    const branch = { state: 'Tamil Nadu' };
    expect(isIntraStateSupply({ companyState: issuingState(company, branch), partyState: 'Tamil Nadu' })).toBe(true);
    expect(isIntraStateSupply({ companyState: issuingState(company, branch), partyState: 'Karnataka' })).toBe(false);
    /* The head office still bills Karnataka within the state. */
    expect(isIntraStateSupply({ companyState: issuingState(company, null), partyState: 'Karnataka' })).toBe(true);
  });
});

describe('a document in another currency', () => {
  it('needs a currency other than the books’ and a rate', () => {
    expect(isForeignDocument({ currency: 'usd', exchangeRate: 83.2 }, 'INR')).toBe(true);
    expect(isForeignDocument({ currency: 'INR', exchangeRate: 1 }, 'INR')).toBe(false);
    expect(isForeignDocument({ currency: 'USD', exchangeRate: 0 }, 'INR')).toBe(false);
    expect(isForeignDocument({ currency: 'USD' }, 'INR')).toBe(false);
    expect(isForeignDocument({}, 'INR')).toBe(false);
    expect(isForeignDocument({ currency: 'USD', exchangeRate: 83 }, 'USD')).toBe(false);
  });
});
