import { describe, expect, it } from 'vitest';
import { isValidCustomerCode, nextCustomerCode, nextVendorCode } from './masterCodes';

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
