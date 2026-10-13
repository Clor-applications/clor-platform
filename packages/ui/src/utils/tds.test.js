import { describe, expect, it } from 'vitest';

import {
  TDS_SECTIONS,
  tdsAmountOn,
  tdsDefaultRate,
  tdsSection,
  tdsThresholdState,
  tdsVariesByDeductee,
} from './tds';

/**
 * TDS rates and thresholds.
 *
 * Three defects this holds shut, all of which put a wrong number on a document
 * with no error shown:
 *
 *   - 194J was one entry reading "professional or technical services @ 10%".
 *     The section has two rates: technical services, call centre and royalty
 *     are 2%, professional services are 10%. Every technical deduction was
 *     five times what was due.
 *   - 194C was 2% for everyone. It is 1% where the payee is an individual or a
 *     HUF, which in practice is most contractors.
 *   - There were no thresholds at all, so the app deducted from the first
 *     rupee where the law deducts nothing until the limit is passed.
 */

describe('rates', () => {
  it('splits 194J, because the two halves are five times apart', () => {
    expect(tdsDefaultRate('194J(a)')).toBe(2);
    expect(tdsDefaultRate('194J(b)')).toBe(10);
    // The old combined entry must be gone, not merely joined by the new ones.
    expect(tdsSection('194J')).toBeNull();
  });

  it('charges an individual contractor 1% and a company 2%', () => {
    expect(tdsDefaultRate('194C', 'INDIVIDUAL')).toBe(1);
    expect(tdsDefaultRate('194C', 'COMPANY')).toBe(2);
    expect(tdsDefaultRate('194C')).toBe(2); // the safe default
    expect(tdsVariesByDeductee('194C')).toBe(true);
  });

  /* Only 194C differs by payee today; the form should not ask elsewhere. */
  it('does not vary by payee where the law does not', () => {
    expect(tdsVariesByDeductee('194J(b)')).toBe(false);
    expect(tdsDefaultRate('194J(b)', 'INDIVIDUAL')).toBe(10);
  });

  it('carries 194T, and the new Act reference every section will be filed under', () => {
    expect(tdsSection('194T')?.rate).toBe(10);
    for (const s of TDS_SECTIONS) {
      expect(`${s.code}:${Boolean(s.newAct)}`).toBe(`${s.code}:true`);
    }
  });
});

describe('thresholds', () => {
  it('deducts nothing below the limit, and says how much headroom is left', () => {
    const state = tdsThresholdState('194J(b)', 5000, 0);
    expect(state.crossed).toBe(false);
    expect(state.base).toBe(0);
    expect(state.reason).toMatch(/45000/);
  });

  /*
   * The rule that is easy to get backwards. Once the annual limit is passed,
   * TDS is due on the WHOLE aggregate including the earlier payments that were
   * below it — not on the excess.
   */
  it('charges the whole aggregate once the annual limit is crossed', () => {
    const state = tdsThresholdState('194J(b)', 30000, 25000);
    expect(state.crossed).toBe(true);
    expect(state.base).toBe(55000);
  });

  it('is crossed by one large bill even when the year is small', () => {
    // 194C: 30,000 single-bill limit, 1,00,000 annual.
    const state = tdsThresholdState('194C', 40000, 0);
    expect(state.crossed).toBe(true);
    expect(state.reason).toMatch(/single bill/i);
  });

  it('is crossed by many small bills that no single limit catches', () => {
    // Five payments of 25,000: none above 30,000, the aggregate above 1,00,000.
    const state = tdsThresholdState('194C', 25000, 100000);
    expect(state.crossed).toBe(true);
    expect(state.base).toBe(125000);
  });

  /* 194Q is the exception: the excess over 50 lakh, never the whole. */
  it('charges only the excess under 194Q', () => {
    const state = tdsThresholdState('194Q', 1000000, 4800000);
    expect(state.crossed).toBe(true);
    expect(state.base).toBe(800000);
    expect(tdsAmountOn(state.base, tdsDefaultRate('194Q'))).toBe(800);
  });

  it('charges nothing under 194Q while the party is still under the limit', () => {
    expect(tdsThresholdState('194Q', 500000, 1000000).crossed).toBe(false);
  });
});
