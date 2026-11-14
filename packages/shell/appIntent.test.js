import { beforeEach, describe, expect, it } from 'vitest';
import { appIntent, captureAppIntent, clearAppIntent, landingAfterSetup } from './appIntent';

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

describe('the app a new company opens in (B2)', () => {
  beforeEach(() => sessionStorage.clear());

  it('is the one app picked, Attendance alone included', () => {
    expect(landingAfterSetup(['attendance'])).toBe('attendance');
    expect(landingAfterSetup(['payroll'])).toBe('payroll');
  });

  it('is the app they came for when they picked it, else Accounting among several', () => {
    captureAppIntent('?app=payroll');
    expect(landingAfterSetup(['accounting', 'payroll'])).toBe('payroll');
    expect(landingAfterSetup(['accounting', 'people'])).toBe('accounting');
    expect(landingAfterSetup(['people', 'payroll'], null)).toBe('people');
  });

  it('is People for Attendance when People was picked too, since People includes it', () => {
    expect(landingAfterSetup(['attendance', 'people'], 'attendance')).toBe('people');
  });

  it('is nothing for nothing known', () => {
    expect(landingAfterSetup([])).toBeNull();
    expect(landingAfterSetup(['projects'])).toBeNull();
  });
});
