import { describe, expect, it } from 'vitest';
import { afterBankCutoff, indiaHour, mentionsArrears } from './round54';

describe('round 54 helpers', () => {
  it('reads the hour in India time', () => {
    expect(indiaHour(new Date('2026-11-18T09:29:00Z'))).toBe(14);
    expect(indiaHour(new Date('2026-11-18T09:30:00Z'))).toBe(15);
    expect(indiaHour(new Date('2026-11-18T20:00:00Z'))).toBe(1);
  });

  it('warns from 3 PM India time to midnight', () => {
    expect(afterBankCutoff(new Date('2026-11-18T09:29:00Z'))).toBe(false);
    expect(afterBankCutoff(new Date('2026-11-18T09:30:00Z'))).toBe(true);
    expect(afterBankCutoff(new Date('2026-11-18T18:29:00Z'))).toBe(true);
    expect(afterBankCutoff(new Date('2026-11-18T18:30:00Z'))).toBe(false);
  });

  it('spots arrears in the words of a line', () => {
    expect(mentionsArrears('Arrears for March')).toBe(true);
    expect(mentionsArrears('salary arrear')).toBe(true);
    expect(mentionsArrears('back pay, Oct')).toBe(true);
    expect(mentionsArrears('Q4 bonus')).toBe(false);
    expect(mentionsArrears('')).toBe(false);
  });
});
