import { describe, expect, it } from 'vitest';

import { appFromHost, hostForApp, isFrontDoor } from './appHosts';

describe('app addresses', () => {
  it('reads the app from its subdomain', () => {
    expect(appFromHost('accounting.clor.in')).toBe('accounting');
    expect(appFromHost('payroll.clor.in')).toBe('payroll');
    expect(appFromHost('app.clor.in')).toBeNull();
    expect(appFromHost('attendance.clor.in')).toBeNull();
    expect(appFromHost('localhost')).toBeNull();
    expect(appFromHost('64de3a9f.clor-app.pages.dev')).toBeNull();
  });

  it('knows the front door', () => {
    expect(isFrontDoor('app.clor.in')).toBe(true);
    expect(isFrontDoor('accounting.clor.in')).toBe(false);
    expect(isFrontDoor('127.0.0.1')).toBe(false);
  });

  it('finds the address of another app from here', () => {
    expect(hostForApp('payroll', 'accounting.clor.in')).toBe('payroll.clor.in');
    expect(hostForApp('accounting', 'app.clor.in')).toBe('accounting.clor.in');
  });

  it('switches in place where there are no app addresses', () => {
    expect(hostForApp('payroll', 'localhost')).toBeNull();
    expect(hostForApp('payroll', '127.0.0.1')).toBeNull();
    expect(hostForApp('payroll', '64de3a9f.clor-app.pages.dev')).toBeNull();
    expect(hostForApp('attendance', 'accounting.clor.in')).toBeNull();
  });
});
