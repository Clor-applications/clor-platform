// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { moduleForScreen, railAction, readScreenSearch, resolveModules, screenSearch } from '../packages/shell/splitNav';
import { attendanceApp } from '../apps/attendance/manifest.jsx';
import { payrollApp } from '../apps/payroll/manifest.jsx';

/**
 * The split sidebar: a rail of modules, the open module's screens beside it.
 * These pin the structure Attendance promises, that every screen stays
 * reachable, that opening a panel never moves you, and that the address
 * names the screen so reload and back/forward land in the same place.
 */

const shape = (app) =>
  resolveModules(app, app.nav).map((m) => ({
    module: m.label,
    groups: m.groups.map((g) => [g.label, g.items.map((i) => i.label)]),
  }));

describe('Attendance navigation structure', () => {
  it('has the six rail modules in order', () => {
    expect(resolveModules(attendanceApp, attendanceApp.nav).map((m) => m.label)).toEqual(['Today', 'Personnel', 'Readers', 'Attendance', 'System', 'Me']);
  });
  it('groups each module the way the reference does', () => {
    const s = Object.fromEntries(shape(attendanceApp).map((m) => [m.module, m.groups]));
    expect(s.Personnel).toEqual([
      ['Organization', ['Departments', 'Positions', 'Areas']],
      ['Employees', ['Employees', 'Contractors', 'Resignations', 'Transfer']],
      ['Privacy', ['Data requests']],
    ]);
    expect(s.Readers).toEqual([
      ['Readers', ['Reader health', 'Readers', 'Sync status']],
      ['Data', ['Transactions', 'Phone punches', 'Enrolments', 'Unmatched punches', 'ID mapping', 'Reader logs']],
    ]);
    expect(s.Attendance.map(([g]) => g)).toEqual(['Daily', 'Reports', 'Schedule', 'Rules', 'Leave setup']);
    expect(s.System).toEqual([
      ['Setup', ['Setup']],
      ['Employee portal', ['Portal access', 'Work sites', 'Site check']],
      ['Integrations', ['Integrations']],
      ['Data', ['Import', 'Export']],
    ]);
    expect(s.Me).toEqual([['Mine', ['My attendance', 'My leave']]]);
  });
  it('Today is a single screen with no panel', () => {
    const today = resolveModules(attendanceApp, attendanceApp.nav)[0];
    expect(today.single).toBe(true);
  });
  for (const app of [attendanceApp, payrollApp]) {
    it(`${app.name}: every screen in the nav is reachable from a module, and every module screen exists`, () => {
      const modules = resolveModules(app, app.nav);
      const inModules = new Set(modules.flatMap((m) => m.items.map((i) => i.key)));
      for (const item of app.nav.filter((i) => i.key)) expect(inModules.has(item.key), item.key).toBe(true);
      for (const k of inModules) expect(app.screens[k], k).toBeTruthy();
    });
  }
  it('a person without a screen does not see it, and a module left empty disappears', () => {
    const nav = attendanceApp.nav.filter((i) => !['setup', 'portalAccess', 'sites', 'siteCheck', 'integrations', 'dataImport', 'dataExport'].includes(i.key));
    const labels = resolveModules(attendanceApp, nav).map((m) => m.label);
    expect(labels).not.toContain('System');
  });
  it('the current module follows the screen', () => {
    const modules = resolveModules(attendanceApp, attendanceApp.nav);
    expect(moduleForScreen(modules, 'transactions')?.label).toBe('Readers');
    expect(moduleForScreen(modules, 'holidays')?.label).toBe('Attendance');
  });
});

describe('rail taps', () => {
  it('a single-screen module opens its screen', () => {
    expect(railAction({ single: true, phone: false, panelShown: false })).toBe('go');
  });
  it('on a desktop a module opens its panel without navigating, and a second tap closes it', () => {
    expect(railAction({ single: false, phone: false, panelShown: false })).toBe('browse');
    expect(railAction({ single: false, phone: false, panelShown: true })).toBe('close');
  });
  it('in the phone sheet a tap only switches the panel', () => {
    expect(railAction({ single: false, phone: true, panelShown: true })).toBe('browse');
  });
});

describe('the address names the screen', () => {
  it('adds ?open= and, off an app host, ?app=; keeps other parameters', () => {
    expect(screenSearch('', { app: 'attendance', open: 'holidays', appInHost: false })).toBe('?app=attendance&open=holidays');
    expect(screenSearch('?x=1', { app: 'attendance', open: 'records', appInHost: true })).toBe('?x=1&open=records');
  });
  it('drops ?open= on the app home', () => {
    expect(screenSearch('?open=records', { app: 'payroll', open: null, appInHost: true })).toBe('');
  });
  it('reads back what it wrote', () => {
    expect(readScreenSearch(screenSearch('', { app: 'attendance', open: 'shifts', appInHost: false }))).toEqual({ app: 'attendance', open: 'shifts' });
    expect(readScreenSearch('')).toEqual({ app: null, open: null });
  });
});
