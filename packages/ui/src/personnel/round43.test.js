import { describe, expect, it } from 'vitest';
import { maritalNextStep, maskedAadhaar } from './round43';

describe('round 43: Aadhaar shown masked', () => {
  it('writes the last four as a masked number', () => {
    expect(maskedAadhaar('1234')).toBe('XXXX XXXX 1234');
    expect(maskedAadhaar(5678)).toBe('XXXX XXXX 5678');
  });
  it('shows nothing for a missing or wrong value', () => {
    expect(maskedAadhaar('')).toBe('');
    expect(maskedAadhaar(null)).toBe('');
    expect(maskedAadhaar('123')).toBe('');
    expect(maskedAadhaar('123456789012')).toBe('');
  });
});

describe('round 43: what to update after a marital status change', () => {
  it('asks for the nominee and cover after marrying', () => {
    expect(maritalNextStep('SINGLE', 'MARRIED')).toMatch(/nominee.*health cover/);
    expect(maritalNextStep('', 'MARRIED')).toMatch(/husband or wife/);
  });
  it('asks to check them after a divorce or a death', () => {
    expect(maritalNextStep('MARRIED', 'DIVORCED')).toMatch(/check your nominee/);
    expect(maritalNextStep('MARRIED', 'WIDOWED')).toMatch(/check your nominee/);
  });
  it('says nothing when it did not change or became single', () => {
    expect(maritalNextStep('MARRIED', 'MARRIED')).toBeNull();
    expect(maritalNextStep('MARRIED', '')).toBeNull();
    expect(maritalNextStep('', 'SINGLE')).toBeNull();
  });
});
