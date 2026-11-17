import { describe, it, expect } from 'vitest';
import { formatPhone } from './phone';

describe('formatPhone', () => {
  it('writes Indian mobiles as +91 98765 43210', () => {
    expect(formatPhone('9876543210')).toBe('+91 98765 43210');
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatPhone('+91 98765-43210')).toBe('+91 98765 43210');
  });
  it('leaves anything else as given', () => {
    expect(formatPhone('080 2345 6789')).toBe('080 2345 6789');
    expect(formatPhone('+1 415 555 0100')).toBe('+1 415 555 0100');
    expect(formatPhone('')).toBe('');
    expect(formatPhone(null)).toBe('');
  });
});
