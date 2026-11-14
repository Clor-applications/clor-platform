import { describe, expect, it } from 'vitest';
import { gstinError } from './gstinValidation';

describe('GSTIN branch form validation', () => {
  it('accepts a matching check digit and rejects the entered mismatch', () => {
    expect(gstinError('29AABCU9603R1ZJ')).toBe('');
    expect(gstinError('29AABCU9603R1ZV')).toMatch(/checksum/);
    expect(gstinError('29CBFPA6554HZA1')).toMatch(/14th character.*Z/);
  });
});
