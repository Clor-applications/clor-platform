import { describe, expect, it } from 'vitest';
import { fyLabel, returnPath, waitingSaid } from './round34';

describe('round 34 picks', () => {
  it('writes the financial year as FY 2026–27', () => {
    expect(fyLabel('2026-27')).toBe('FY 2026–27');
    expect(fyLabel('2026-2027')).toBe('FY 2026–27');
    expect(fyLabel('2025–26')).toBe('FY 2025–26');
    expect(fyLabel('')).toBe('');
  });

  it('says how long a request has waited', () => {
    const now = Date.parse('2026-11-18T10:00:00Z');
    expect(waitingSaid('2026-11-18T08:00:00Z', now)).toBe('less than a day');
    expect(waitingSaid('2026-11-17T08:00:00Z', now)).toBe('1 day');
    expect(waitingSaid('2026-11-16T08:00:00Z', now)).toBe('2 days');
    expect(waitingSaid('not a date', now)).toBe('');
  });

  it('comes back to the page being opened after a provider sign-in', () => {
    expect(returnPath({ pathname: '/payroll/slips', search: '?id=7&sso_error=x', hash: '#top' })).toBe('/payroll/slips?id=7#top');
    expect(returnPath({ pathname: '/', search: '', hash: '' })).toBe('/');
    expect(returnPath({ pathname: '//evil.example', search: '', hash: '' })).toBe('/');
    expect(returnPath(null)).toBe('/');
  });
});
