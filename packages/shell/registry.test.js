import { describe, expect, it } from 'vitest';

import { APPS, availableApps, landingApp, subscribedApps } from './registry';

/*
 * Company admin (ADR-010) is the platform's own workspace: every company has
 * it, nobody buys it, and it is never where an app's own address lands.
 */
describe('the Company admin workspace', () => {
  it('is there for a company whatever it has bought', () => {
    expect(subscribedApps(['payroll']).map((a) => a.id)).toEqual(expect.arrayContaining(['admin', 'payroll']));
    expect(subscribedApps([]).map((a) => a.id)).toEqual(['admin']);
  });

  it('is never offered for sale', () => {
    expect(availableApps([]).map((a) => a.id)).not.toContain('admin');
  });

  it('is never the app somebody lands in by default', () => {
    expect(landingApp(['payroll']).id).toBe('payroll');
    expect(landingApp(['payroll', 'accounting']).id).toBe('accounting');
    expect(landingApp([])).toBeNull();
  });

  it('holds the company administration that used to live in Accounting', () => {
    const admin = APPS.find((a) => a.id === 'admin');
    expect(admin.platform).toBe(true);
    for (const key of ['users', 'roles', 'permissions', 'security', 'sso', 'audit', 'branches', 'account', 'billing', 'export', 'close', 'company']) {
      expect(admin.screens[key]).toBeTruthy();
      /* Every page but the overview is shown only to somebody who holds its permission. */
      expect(admin.nav.find((n) => n.key === key)?.permission).toBeTruthy();
    }
  });
});
