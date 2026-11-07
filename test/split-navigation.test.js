// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { readFileSync } from 'node:fs';

import { moduleForScreen, railAction, readScreenSearch, resolveModules, screenSearch, withoutEmptyHubs } from '../packages/shell/splitNav';
import { attendanceApp } from '../apps/attendance/manifest.jsx';
import { payrollApp } from '../apps/payroll/manifest.jsx';
import { peopleApp } from '../apps/people/manifest.jsx';

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
    expect(resolveModules(attendanceApp, attendanceApp.nav).map((m) => m.label)).toEqual(['Today', 'People', 'Readers', 'Attendance', 'Reports', 'Settings', 'Me']);
  });
  it('groups each module the way the navigation brief does', () => {
    const s = Object.fromEntries(shape(attendanceApp).map((m) => [m.module, m.groups]));
    expect(s.People).toEqual([
      ['Directory', ['Employees', 'Contractors']],
      ['Employment changes', ['Joining & leaving tasks', 'Resignations', 'Transfers']],
      ['Organization', ['Departments', 'Designations', 'Locations & sites']],
      ['Access', ['Employee portal access']],
    ]);
    expect(s.Readers).toEqual([
      ['Monitoring', ['Reader health', 'Sync monitoring', 'Reader logs']],
      ['Devices', ['All readers', 'Device enrollment']],
      ['Punch data', ['Punch transactions', 'Unmatched punches', 'Employee ID mapping']],
      ['Other punch sources', ['Mobile punches']],
    ]);
    expect(s.Attendance).toEqual([
      ['Daily operations', ['Attendance records', 'Punches', 'Exceptions', 'Attendance requests']],
      ['Scheduling', ['Schedule calendar', 'Shifts', 'Shift assignments', 'Department schedules', 'Temporary schedules', 'Shift rotations']],
      /* Time & Leave: the screens People shows, shared (TIME-LEAVE-DECISIONS.md). */
      ['Leave', ["Who's away", 'Leave requests', 'Leave calendar', 'Leave balances', 'Leave register', 'Delegates']],
      ['Time management', ['Overtime & comp-off']],
      ['Period closing', ['Payroll readiness', 'Employee confirmations', 'Month close']],
    ]);
    expect(s.Reports).toEqual([
      ['Overview', ['Attendance insights']],
      ['Attendance', ['Daily attendance register', 'Monthly attendance summary', 'Attendance calendar', 'Late arrivals & early exits', 'Absence report']],
      ['Workforce', ['Department attendance', 'Employee attendance history']],
      ['Time & leave', ['Overtime report', 'Leave report']],
      ['Devices', ['Reader activity']],
      ['All reports', ['Report catalogue']],
    ]);
    expect(s.Settings).toEqual([
      ['Organization', ['Attendance setup', 'Punch areas', 'Punch area check', 'Joining & leaving steps']],
      ['Work policy', ['Attendance policy', 'Weekly off policy', 'Overtime policy', 'Leave policy', 'Working week', 'Holidays', 'Leave year end', 'Attendance request types']],
      ['Integrations', ['Integrations']],
      ['Access & security', ['Users & security', 'Roles & access']],
      ['Data management', ['Data health', 'Import data', 'Export data', 'Close company']],
      ['Compliance', ['Compliance']],
      ['Privacy', ['Data protection', 'Data requests']],
      ['Audit & recovery', ['Audit logs', 'Recycle bin']],
    ]);
    expect(s.Me).toEqual([['Self-Service', ['My attendance', 'My leave']]]);
  });
  it('labels are sentence case and appear once (People plan, 8 Nov 2026: one wording rule in both apps)', () => {
    const labels = attendanceApp.nav.filter((i) => i.key).map((i) => i.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) for (const w of l.split(/\s+/).slice(1)) if (!/^[A-Z0-9&-]{2,}$/.test(w)) expect(w[0], l).toBe(w[0].toLowerCase());
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
    const settings = new Set(['setup', 'sites', 'siteCheck', 'holidays', 'rules', 'weeklyOffPolicy', 'overtimePolicy', 'leaveTypes', 'workingWeek', 'leaveYearEnd', 'requestRules', 'integrations', 'sso', 'rolesAccess', 'dataImport', 'dataExport', 'closeCompany', 'dataProtection', 'dataRequests', 'auditLogs', 'recycleBin', 'dataHealth', 'complianceCalendar', 'journeySteps']);
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

describe('settings pages', () => {
  it('People: every page under Settings has a card, and every card opens a page', () => {
    const cards = new Set([...readFileSync('apps/people/src/screens/PeopleSettings.jsx', 'utf8').matchAll(/\['([a-zA-Z]+)', '/g)].map((m) => m[1]).filter((k) => !['payroll', 'attendance'].includes(k)));
    const under = peopleApp.nav.filter((i) => i.parent === 'settings').map((i) => i.key);
    expect(under.filter((k) => !cards.has(k)), 'no card').toEqual([]);
    expect([...cards].filter((k) => !peopleApp.screens[k]), 'no page').toEqual([]);
  });
  it('Settings is there while one page under it is, and goes with the last', () => {
    const nav = [{ key: 'settings', hub: true }, { key: 'holidays', parent: 'settings' }, { key: 'records' }];
    expect(withoutEmptyHubs(nav).map((i) => i.key)).toEqual(['settings', 'holidays', 'records']);
    expect(withoutEmptyHubs(nav.filter((i) => i.key !== 'holidays')).map((i) => i.key)).toEqual(['records']);
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
  /* The Workspace asks that the content follow the rail: Company opens Companies, never the Overview left behind. */
  it('in an app that asks for it, a module opens its landing page with its panel', () => {
    expect(railAction({ single: false, phone: false, panelShown: false, opensHome: true })).toBe('goOpen');
    expect(railAction({ single: false, phone: false, panelShown: true, opensHome: true, current: false })).toBe('goOpen');
    expect(railAction({ single: false, phone: false, panelShown: true, opensHome: true, current: true })).toBe('close');
    expect(railAction({ single: false, phone: true, panelShown: false, opensHome: true })).toBe('browse');
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
    expect(readScreenSearch(screenSearch('', { app: 'attendance', open: 'shifts', appInHost: false }))).toEqual({ app: 'attendance', open: 'shifts', params: null });
    expect(readScreenSearch('')).toEqual({ app: null, open: null, params: null });
  });
});

describe('screen state in the address (People design v1, D-V7)', () => {
  it('carries a record and its tab as s.* params, and reads them back', () => {
    const url = screenSearch('', { app: 'people', open: 'employee', appInHost: false, params: { id: 'e1', tab: 'history' } });
    expect(url).toBe('?app=people&open=employee&s.id=e1&s.tab=history');
    expect(readScreenSearch(url)).toEqual({ app: 'people', open: 'employee', params: { id: 'e1', tab: 'history' } });
  });
  it('a new screen without params clears the last one\'s, and keeps unrelated query keys', () => {
    expect(screenSearch('?x=1&open=employee&s.id=e1', { app: 'people', open: 'employees', appInHost: true, params: null })).toBe('?x=1&open=employees');
  });
  it('leaves params alone when none are given, and drops blank and nested values', () => {
    expect(screenSearch('?open=a&s.q=ravi', { open: 'a', appInHost: true })).toBe('?open=a&s.q=ravi');
    expect(screenSearch('', { open: 'a', appInHost: true, params: { q: '', f: { a: 1 }, page: 2 } })).toBe('?open=a&s.page=2');
  });
  it('merges a patch, removing keys set to null', async () => {
    const { mergeParams } = await import('../packages/shell/splitNav');
    expect(mergeParams({ id: 'e1', tab: 'overview' }, { tab: 'history' })).toEqual({ id: 'e1', tab: 'history' });
    expect(mergeParams({ id: 'e1' }, { id: null })).toBeNull();
  });
});
