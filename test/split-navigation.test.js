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
  it('has the six business modules in order, then Me', () => {
    expect(resolveModules(attendanceApp, attendanceApp.nav).map((m) => m.label)).toEqual(['Overview', 'People', 'Readers', 'Attendance', 'Reports', 'Settings', 'Me']);
  });
  it('groups each module the way the navigation brief does', () => {
    const s = Object.fromEntries(shape(attendanceApp).map((m) => [m.module, m.groups]));
    expect(s.People).toEqual([
      ['Directory', ['Employees', 'Contractors']],
      ['Employment Changes', ['Resignations', 'Transfers']],
      ['Organization', ['Departments', 'Designations', 'Locations & Sites']],
      ['Access', ['Employee Portal Access']],
    ]);
    expect(s.Readers).toEqual([
      ['Monitoring', ['Reader Health', 'Sync Monitoring', 'Reader Logs']],
      ['Devices', ['All Readers', 'Device Enrollment']],
      ['Punch Data', ['Punch Transactions', 'Unmatched Punches', 'Employee ID Mapping']],
      ['Other Punch Sources', ['Mobile Punches']],
    ]);
    expect(s.Attendance).toEqual([
      ['Daily Operations', ['Attendance Records', 'Exceptions', 'Corrections']],
      ['Scheduling', ['Schedule Calendar', 'Shifts', 'Shift Assignments', 'Department Schedules', 'Temporary Schedules', 'Shift Rotations']],
      ['Leave', ['Leave Requests', 'Leave Balances']],
      ['Time Management', ['Overtime & Comp-Off']],
      ['Period Closing', ['Employee Confirmations', 'Month Close']],
    ]);
    expect(s.Reports).toEqual([
      ['Attendance', ['Daily Attendance Register', 'Monthly Attendance Summary', 'Attendance Calendar', 'Late Arrivals & Early Exits', 'Absence Report']],
      ['Workforce', ['Department Attendance', 'Employee Attendance History']],
      ['Time & Leave', ['Overtime Report', 'Leave Report']],
      ['Devices', ['Reader Activity']],
      ['All Reports', ['Report Catalogue']],
    ]);
    expect(s.Settings).toEqual([
      ['Organization', ['Attendance Setup', 'Work Sites', 'Work Site Check']],
      ['Work Policy', ['Attendance Policy', 'Weekly Off Policy', 'Overtime Policy', 'Leave Policy', 'Holidays']],
      ['Integrations', ['Integrations']],
      ['Access & Security', ['Single Sign-On']],
      ['Data Management', ['Import Data', 'Export Data', 'Close Company']],
      ['Privacy', ['Data Protection', 'Data Requests']],
    ]);
    expect(s.Me).toEqual([['Self-Service', ['My Attendance', 'My Leave']]]);
  });
  it('labels are Title Case and appear once', () => {
    const labels = attendanceApp.nav.filter((i) => i.key).map((i) => i.label);
    expect(new Set(labels).size).toBe(labels.length);
    const small = new Set(['&', 'of', 'and', 'to', 'a', 'on']);
    for (const l of labels) for (const w of l.split(/[\s-]+/)) if (!small.has(w)) expect(w[0], l).toBe(w[0].toUpperCase());
  });
  it('every screen that existed before the regrouping still has a place in the sidebar', () => {
    const before = ['today', 'employees', 'departments', 'positions', 'areas', 'contractors', 'resignations', 'transfer', 'dataProtection', 'sso', 'dataRequests',
      'readerHealth', 'readers', 'readerSync', 'transactions', 'enrolments', 'unmatched', 'deviceLogs', 'records', 'requests', 'leaveRequests', 'summary',
      'register', 'calendar', 'reports', 'scheduleCalendar', 'shifts', 'shiftAssignments', 'departmentSchedule', 'temporarySchedule', 'rotations', 'holidays',
      'rules', 'leaveTypes', 'leaveBalances', 'portalAccess', 'sites', 'siteCheck', 'integrations', 'dataImport', 'dataExport', 'exceptions', 'monthClose',
      'overtime', 'confirmations', 'phonePunches', 'idMapping', 'setup', 'me', 'myLeave'];
    const inModules = new Set(resolveModules(attendanceApp, attendanceApp.nav).flatMap((m) => m.items.map((i) => i.key)));
    for (const k of before) {
      expect(inModules.has(k), k).toBe(true);
      expect(attendanceApp.screens[k], k).toBeTruthy();
    }
  });
  it('Overview is a single screen with no panel', () => {
    const overview = resolveModules(attendanceApp, attendanceApp.nav)[0];
    expect(overview.single).toBe(true);
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
    const settings = new Set(['setup', 'sites', 'siteCheck', 'holidays', 'rules', 'weeklyOffPolicy', 'overtimePolicy', 'leaveTypes', 'integrations', 'sso', 'dataImport', 'dataExport', 'closeCompany', 'dataProtection', 'dataRequests']);
    const nav = attendanceApp.nav.filter((i) => !settings.has(i.key));
    const labels = resolveModules(attendanceApp, nav).map((m) => m.label);
    expect(labels).not.toContain('Settings');
    expect(labels).toContain('Readers');
  });
  it('the current module follows the screen', () => {
    const modules = resolveModules(attendanceApp, attendanceApp.nav);
    expect(moduleForScreen(modules, 'transactions')?.label).toBe('Readers');
    expect(moduleForScreen(modules, 'holidays')?.label).toBe('Settings');
    expect(moduleForScreen(modules, 'register')?.label).toBe('Reports');
    expect(moduleForScreen(modules, 'transfer')?.label).toBe('People');
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
