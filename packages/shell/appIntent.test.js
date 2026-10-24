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

  it('is forgotten once the company is made', () => {
    captureAppIntent('?app=people');
    clearAppIntent();
    expect(appIntent()).toBeNull();
  });
});
