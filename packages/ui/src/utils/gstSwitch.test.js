import { describe, it, expect } from 'vitest';
import { isCompanyGstEnabled, isCompanyTaxEnabled } from './gst';

/* Books, owner 15 Nov 2026: GST, TDS and TCS are on only when switched on. */
describe('the GST switch', () => {
  it('follows the switch in the tax settings, either way', () => {
    expect(isCompanyGstEnabled({ profile: { taxCompliances: { gstEnabled: true } } })).toBe(true);
    expect(isCompanyGstEnabled({ gstin: '29ABCDE1234F1Z5', profile: { taxCompliances: { gstEnabled: false } } })).toBe(false);
  });

  it('does not turn GST on from a GSTIN alone', () => {
    expect(isCompanyGstEnabled({ gstin: '29ABCDE1234F1Z5' })).toBe(false);
    expect(isCompanyGstEnabled({})).toBe(false);
    expect(isCompanyGstEnabled(null)).toBe(false);
  });

  it('still reads the older top-level switch', () => {
    expect(isCompanyGstEnabled({ gstEnabled: true })).toBe(true);
  });
});

describe('the TDS and TCS switches', () => {
  it('are off until switched on', () => {
    expect(isCompanyTaxEnabled({}, 'tds')).toBe(false);
    expect(isCompanyTaxEnabled({ profile: { taxCompliances: { tds: { enabled: true } } } }, 'tds')).toBe(true);
    expect(isCompanyTaxEnabled({ profile: { taxCompliances: { tds: { enabled: true } } } }, 'tcs')).toBe(false);
  });
});
