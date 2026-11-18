import { describe, expect, it } from 'vitest';
import { CLAIM_CUTOFF_DAYS, RUPEE_HINT, billTooOld, oldestBillDay, tooOldText } from './round51';

describe('round 51 bill picks', () => {
  it('counts the cutoff back 60 days, across months and years', () => {
    expect(CLAIM_CUTOFF_DAYS).toBe(60);
    expect(oldestBillDay('2026-11-18')).toBe('2026-09-19');
    expect(oldestBillDay('2026-01-15')).toBe('2025-11-16');
  });

  it('refuses only bills past the cutoff', () => {
    expect(billTooOld('2026-09-19', '2026-11-18')).toBe(false);
    expect(billTooOld('2026-09-18', '2026-11-18')).toBe(true);
    expect(billTooOld('2026-11-18', '2026-11-18')).toBe(false);
    expect(billTooOld('', '2026-11-18')).toBe(false);
  });

  it('says the rupee amount comes from the card statement', () => {
    expect(RUPEE_HINT).toMatch(/rupee amount from your card statement/);
    expect(tooOldText()).toBe("Bills older than 60 days can't be claimed.");
  });
});
