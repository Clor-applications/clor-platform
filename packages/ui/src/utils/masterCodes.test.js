import { describe, expect, it } from 'vitest';
import { formatPartyCode, isValidCustomerCode, isValidPartyCode, nextCustomerCode, nextPartyCode, nextVendorCode } from './masterCodes';

describe('master code previews', () => {
  it('shows the first available customer code in the 2–5 series', () => {
    expect(nextCustomerCode([])).toBe('200000');
    expect(nextCustomerCode([{ code: '200000' }, { code: '200001' }])).toBe('200002');
  });

  it('rejects legacy and out-of-series customer codes', () => {
    expect(isValidCustomerCode('200000')).toBe(true);
    expect(isValidCustomerCode('599999')).toBe(true);
    expect(isValidCustomerCode('CUST-001')).toBe(false);
    expect(isValidCustomerCode('600000')).toBe(false);
  });

  it('shows the first available vendor code in the 6–9 series', () => {
    expect(nextVendorCode([])).toBe('600000');
    expect(nextVendorCode([{ code: '600000' }])).toBe('600001');
  });
});

describe('custom party codes', () => {
  it('uses a company format and skips numbers already allotted in that company', () => {
    const company = { id: 2, profile: { partyCodeSettings: { customer: { prefix: 'CUS', suffix: 'A', digits: 4, nextNumber: 12 } } } };
    expect(nextPartyCode([{ companyId: 1, code: 'CUS-0012-A' }], company, 'customer')).toBe('CUS-0012-A');
    expect(nextPartyCode([{ companyId: 2, code: 'CUS-0012-A' }], company, 'customer')).toBe('CUS-0013-A');
  });

  it('allows at most ten numeric digits in a manually entered code', () => {
    expect(isValidPartyCode('C-1234567890-X')).toBe(true);
    expect(isValidPartyCode('C-12345678901-X')).toBe(false);
    expect(isValidPartyCode('C 123')).toBe(false);
  });

  it('follows the configured component order and skips optional parts when off', () => {
    const format = { prefix: 'CUST', suffix: 'X', separator: '-', digits: 5, includeBranchCode: true, includeYear: true, componentOrder: ['branch', 'year', 'prefix', 'sequence', 'suffix'] };
    expect(formatPartyCode(format, 7, 'BLR', new Date(2026, 0, 1))).toBe('BLR-26-CUST-00007-X');
    expect(formatPartyCode({ ...format, includeYear: false, suffix: '' }, 7, 'BLR', new Date(2026, 0, 1))).toBe('BLR-CUST-00007');
  });
});
