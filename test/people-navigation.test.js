import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { peopleApp } from '../apps/people/manifest.jsx';
import { moduleForScreen, resolveModules } from '../packages/shell/splitNav.js';

/**
 * People (founder, 22 Oct 2026): the sidebar holds the day's work; what is
 * set up once lives on one Settings page. Every page is reachable from one or
 * the other, and the rail shows Settings while one of its pages is open.
 */
describe('People navigation', () => {
  const modules = resolveModules(peopleApp, peopleApp.nav);
  const inModules = new Set(modules.flatMap((m) => m.items.map((i) => i.key)));

  it('keeps the sidebar to the day’s work, Settings last', () => {
    /* Workforce package (owner, 26 Oct 2026): the visible module is Workforce; its key stays `employees`. */
    /* Organization follows Workforce (ORGANIZATION-DECISIONS.md): the company's shape moved out of Settings. Joining & Leaving is its own module after Workforce (JOINING-LEAVING-DECISIONS.md). */
    expect(modules.map((m) => m.label)).toEqual(['Home', 'Workforce', 'Joining & Leaving', 'Organization', 'Time & Leave', 'Hiring', 'Performance', 'Engage', 'Insights', 'Settings']);
    for (const k of ['lifecycle', 'joiners', 'lifecycleChanges', 'leavers', 'checklists']) expect(moduleForScreen(modules, k, peopleApp.nav)?.label, k).toBe('Joining & Leaving');
    expect(modules.find((m) => m.label === 'Settings').single).toBe(true);
  });

  it('reaches every page from the sidebar or from Settings, and every page exists', () => {
    for (const item of peopleApp.nav.filter((i) => i.key)) {
      const reachable = inModules.has(item.key) || (item.parent && inModules.has(item.parent));
      expect(reachable, item.key).toBe(true);
      expect(peopleApp.screens[item.key], item.key).toBeTruthy();
    }
  });

  it('shows Settings on the rail while a settings page is open', () => {
    expect(moduleForScreen(modules, 'departments', peopleApp.nav)?.label).toBe('Organization');
    expect(moduleForScreen(modules, 'branches', peopleApp.nav)?.label).toBe('Organization');
    expect(moduleForScreen(modules, 'companyDetails', peopleApp.nav)?.label).toBe('Settings');
    expect(moduleForScreen(modules, 'employees', peopleApp.nav)?.label).toBe('Workforce');
    /* The record, Add employee and Import keep Workforce selected (WF-01). */
    for (const k of ['employee', 'employeeNew', 'employeeImport']) expect(moduleForScreen(modules, k, peopleApp.nav)?.label, k).toBe('Workforce');
  });

  it('every Settings card points at a page in the nav', () => {
    const src = readFileSync('apps/people/src/screens/PeopleSettings.jsx', 'utf8');
    const keys = [...src.matchAll(/\['([a-zA-Z]+)', '/g)].map((m) => m[1]).filter((k) => !['payroll', 'attendance'].includes(k));
    const nav = new Set(peopleApp.nav.map((i) => i.key));
    for (const k of keys) expect(nav.has(k), k).toBe(true);
  });

  /* Founder, 22 Oct 2026: modules switch on and off within the subscription; the shell hides an item whose `feature` is off. */
  it('ties each switchable page to its module switch, and leaves the core without one', () => {
    const featureOf = Object.fromEntries(peopleApp.nav.filter((i) => i.key).map((i) => [i.key, i.feature]));
    expect(featureOf).toMatchObject({ recruitment: 'peopleHiring', candidates: 'peopleHiring', performance: 'peoplePerformance', learning: 'peoplePerformance', announcements: 'peopleEngage', assets: 'peopleBenefits', benefits: 'peopleBenefits' });
    /* The help desk is P0 core (docs/people/02-PRD.md, People Desk, DESK-01..06), no longer the Engage register it replaced (D-10). */
    for (const core of ['overview', 'employees', 'documents', 'checklists', 'leaveRequests', 'leaveBalances', 'attendance', 'settings', 'modules', 'helpdesk']) expect(featureOf[core], core).toBeUndefined();
  });

  it('uses Title Case for every menu label', () => {
    for (const item of peopleApp.nav.filter((i) => i.key)) {
      const small = item.label.split(' ').filter((w) => /^[a-z]/.test(w) && !['and', 'of', 'to', 'in'].includes(w));
      expect(small, item.label).toEqual([]);
    }
  });
});

/*
 * Simple mode (PRODUCT-VIEW §6): the server reads `peopleSimpleMode` and the
 * menus see `peopleDetailed: false` (server/src/services/features.ts). The
 * shell hides an item whose `feature` is off (packages/shell/Shell.jsx), so
 * this is the same filter, run over the manifest.
 */
describe('People navigation in simple mode', () => {
  const shown = (features) => peopleApp.nav.filter((i) => i.section || !i.feature || features[i.feature] !== false);
  const simple = shown({ peopleDetailed: false, peopleOrgDetail: false });
  const full = shown({ peopleDetailed: true, peopleOrgDetail: false });
  const keys = (nav) => new Set(nav.filter((i) => i.key).map((i) => i.key));

  it('hides the detailed screens a larger HR team needs', () => {
    const hidden = [...keys(full)].filter((k) => !keys(simple).has(k)).sort();
    expect(hidden).toEqual(['approvalRules', 'auditEvidence', 'compliance', 'complianceCalendar', 'customFields', 'employeeTypes', 'helpDeskSettings', 'integrations', 'leaveYearEnd', 'legalEntities', 'orgChanges', 'policies', 'privacy', 'privateCases', 'recycleBin', 'requestRules', 'rolesAccess', 'selfServiceChanges', 'standIns', 'tags', 'workTypes']);
  });

  it('never hides a person’s own data, the day’s work, or the setup steps on Home', () => {
    const kept = keys(simple);
    for (const k of ['overview', 'approvals', 'employees', 'employee', 'employeeNew', 'employeeImport', 'documents', 'leaveRequests', 'leaveCalendar', 'leaveBalances', 'timeOverview', 'attendance', 'attendanceRequests', 'myLeave', 'myDays', 'helpdesk', 'dataHealth', 'dataRequests', 'dataProtection', 'auditLogs', 'workingWeek', 'holidays', 'leaveTypes', 'selfService', 'modules', 'companyDetails', 'sso', 'dataImport', 'dataExport', 'settings']) {
      expect(kept.has(k), k).toBe(true);
    }
  });

  it('keeps every module that has a screen left, and the leave screens under one naming rule', () => {
    const modules = resolveModules(peopleApp, simple);
    expect(modules.map((m) => m.label)).toEqual(['Home', 'Workforce', 'Joining & Leaving', 'Organization', 'Time & Leave', 'Hiring', 'Performance', 'Engage', 'Insights', 'Settings']);
    expect(modules.find((m) => m.key === 'leave').items.map((i) => i.label)).toEqual(['Leave Overview', 'Leave Requests', 'Leave Calendar', 'Leave Balances', 'Leave Register', 'Attendance Requests', 'Attendance', 'My Leave', 'My Attendance']);
  });

  it('shows everything when simple mode is off, or when the company’s switches are not known yet', () => {
    expect(keys(shown({ peopleDetailed: true })).size).toBe(keys(shown({})).size);
    expect(keys(shown({})).has('standIns')).toBe(true);
  });
});

/* One name for one screen, in both apps that show it (PRODUCT-VIEW §1). */
describe('Shared Time & Leave screens', () => {
  it('carry the same label in People and Attendance', async () => {
    const { attendanceApp } = await import('../apps/attendance/manifest.jsx');
    const label = (app, k) => app.nav.find((i) => i.key === k)?.label;
    for (const k of ['timeOverview', 'leaveRequests', 'leaveCalendar', 'leaveBalances', 'leaveRegister', 'standIns', 'leaveTypes', 'holidays', 'workingWeek', 'leaveYearEnd', 'requestRules', 'myLeave']) {
      expect(label(peopleApp, k), k).toBe(label(attendanceApp, k));
    }
    expect(label(peopleApp, 'attendanceRequests')).toBe(label(attendanceApp, 'requests'));
  });

  it('do not call two different things Work Sites', async () => {
    const { attendanceApp } = await import('../apps/attendance/manifest.jsx');
    expect(peopleApp.nav.find((i) => i.key === 'establishments').label).toBe('Work Sites');
    expect(attendanceApp.nav.some((i) => i.label === 'Work Sites')).toBe(false);
    expect(attendanceApp.nav.find((i) => i.key === 'sites').label).toBe('Punch Areas');
  });

  it('hide the same detailed Time & Leave screens in Attendance under simple mode', async () => {
    const { attendanceApp } = await import('../apps/attendance/manifest.jsx');
    const tagged = attendanceApp.nav.filter((i) => i.feature === 'peopleDetailed').map((i) => i.key).sort();
    expect(tagged).toEqual(['leaveYearEnd', 'requestRules', 'standIns']);
  });
});
