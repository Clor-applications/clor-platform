import { describe, expect, it } from 'vitest';

import { appFromHost, hostForApp, isFrontDoor } from './appHosts';

describe('app addresses', () => {
  it('reads the app from its subdomain', () => {
    expect(appFromHost('accounting.clor.in')).toBe('accounting');
    expect(appFromHost('payroll.clor.in')).toBe('payroll');
    expect(appFromHost('app.clor.in')).toBeNull();
    expect(appFromHost('attendance.clor.in')).toBe('attendance');
    expect(appFromHost('people.clor.in')).toBe('people');
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
    expect(hostForApp('attendance', 'accounting.clor.in')).toBe('attendance.clor.in');
    expect(hostForApp('people', 'accounting.clor.in')).toBe('people.clor.in');
  });

  it('switches in place where there are no app addresses', () => {
    expect(hostForApp('payroll', 'localhost')).toBeNull();
    expect(hostForApp('payroll', '127.0.0.1')).toBeNull();
    expect(hostForApp('payroll', '64de3a9f.clor-app.pages.dev')).toBeNull();
  });

  /* ADR-010: Company admin is the front door's own workspace. */
  it('opens Company admin on the front door, from any app address', () => {
    expect(hostForApp('admin', 'accounting.clor.in')).toBe('app.clor.in');
    expect(hostForApp('admin', 'payroll.clor.in')).toBe('app.clor.in');
    /* Already there: the shell compares with its own host and does not forward to itself. */
    expect(hostForApp('admin', 'app.clor.in')).toBe('app.clor.in');
    expect(hostForApp('admin', 'localhost')).toBeNull();
  });
});

