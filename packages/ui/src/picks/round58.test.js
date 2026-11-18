import { describe, expect, it } from 'vitest';
import { bundleChoices, bundleTitle, clock12, inSpan, lastSlips, monthWeeks, punchDoneLines, sentWords, shiftMonth, shouldAskInstall, tapDay } from './round58';

describe('round 58: the employee app on a phone', () => {
  it('aftersend: names who has the request and what happens next', () => {
    expect(sentWords('With Priya Menon (your manager)')).toBe('Sent to Priya Menon (your manager). You will get a notice when it is decided.');
    expect(sentWords('Waiting for a decision')).toBe('Sent. You will get a notice when it is decided.');
    expect(sentWords(null)).toMatch(/^Sent\./);
  });

  it('punchdone: the tick screen reads "In at 9:42 AM · Chennai office · Shift 9:30 AM"', () => {
    expect(clock12('09:42')).toBe('9:42 AM');
    expect(clock12('17:05')).toBe('5:05 PM');
    expect(clock12('00:10')).toBe('12:10 AM');
    expect(clock12('12:00')).toBe('12:00 PM');
    expect(punchDoneLines({ kind: 'IN', time: '09:42', site: 'Chennai office' }, '09:30')).toEqual({ first: 'In at 9:42 AM', second: 'Chennai office · Shift 9:30 AM' });
    expect(punchDoneLines({ kind: 'OUT', time: '18:20', site: 'Chennai office' }, '09:30')).toEqual({ first: 'Out at 6:20 PM', second: 'Chennai office' });
    expect(punchDoneLines({ kind: 'IN', time: '10:00', site: null, outside: true }, '')).toEqual({ first: 'In at 10:00 AM', second: 'Outside the work sites' });
  });

  it('installapp: asks from the second visit, never once dismissed or installed', () => {
    expect(shouldAskInstall({ visits: 1, standalone: false, dismissed: false })).toBe(false);
    expect(shouldAskInstall({ visits: 2, standalone: false, dismissed: false })).toBe(true);
    expect(shouldAskInstall({ visits: 5, standalone: true, dismissed: false })).toBe(false);
    expect(shouldAskInstall({ visits: 5, standalone: false, dismissed: true })).toBe(false);
  });

  it('phonedate: a month is laid out Monday first', () => {
    const weeks = monthWeeks('2026-11');
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']); /* 1 Nov 2026 is a Sunday */
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('rangetap: first tap, then the last; earlier day or a third tap starts again', () => {
    let r = tapDay({ from: '', to: '' }, '2026-11-09');
    expect(r).toEqual({ from: '2026-11-09', to: '' });
    r = tapDay(r, '2026-11-12');
    expect(r).toEqual({ from: '2026-11-09', to: '2026-11-12' });
    expect(inSpan('2026-11-10', r.from, r.to)).toBe(true);
    expect(inSpan('2026-11-13', r.from, r.to)).toBe(false);
    expect(tapDay(r, '2026-11-20')).toEqual({ from: '2026-11-20', to: '' });
    expect(tapDay({ from: '2026-11-09', to: '' }, '2026-11-03')).toEqual({ from: '2026-11-03', to: '' });
    expect(tapDay({ from: '2026-11-09', to: '' }, '2026-11-09')).toEqual({ from: '2026-11-09', to: '2026-11-09' });
    expect(tapDay({ from: '2026-11-09', to: '' }, '2026-11-12', true)).toEqual({ from: '2026-11-12', to: '' });
  });

  it('payslipbundle: offers 3, 6, 12 as far as there are payslips, and names the file', () => {
    expect(bundleChoices(1)).toEqual([]);
    expect(bundleChoices(2)).toEqual([2]);
    expect(bundleChoices(4)).toEqual([3, 4]);
    expect(bundleChoices(6)).toEqual([3, 6]);
    expect(bundleChoices(20)).toEqual([3, 6, 12]);
    const slips = [{ period: 'Sep 2026' }, { period: 'Aug 2026' }, { period: 'Jul 2026' }, { period: 'Jun 2026' }];
    expect(lastSlips(slips, 3).map((s) => s.period)).toEqual(['Sep 2026', 'Aug 2026', 'Jul 2026']);
    expect(bundleTitle(lastSlips(slips, 3), 'E12')).toBe('Payslips Jul 2026 to Sep 2026 E12');
  });
});
