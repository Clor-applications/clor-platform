import { beforeEach, describe, expect, it } from 'vitest';
import { appIntent, captureAppIntent, clearAppIntent } from './appIntent';

describe('the app a visitor came for', () => {
  beforeEach(() => sessionStorage.clear());

  it('is kept from ?app= for this tab, and only for a real app', () => {
    expect(captureAppIntent('?app=payroll')).toBe('payroll');
    expect(appIntent()).toBe('payroll');
    captureAppIntent('?app=nonsense');
    expect(appIntent()).toBe('payroll');
  });

  it('is not kept from inside a company, where ?app= is only the app open in place', () => {
    expect(captureAppIntent('?app=people', '/o/2754270912/')).toBeNull();
    expect(appIntent()).toBeNull();
    expect(captureAppIntent('?app=people', '/signup')).toBe('people');
    expect(appIntent()).toBe('people');
  });

  it('is forgotten once the company is made', () => {
    captureAppIntent('?app=people');
    clearAppIntent();
    expect(appIntent()).toBeNull();
  });
});
