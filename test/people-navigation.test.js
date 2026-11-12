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
    /* The People plan (8 Nov 2026, §2): no Organisation module; the org chart is a People screen and the company's shape is Settings. */
    expect(modules.map((m) => m.label)).toEqual(['Home', 'Inbox', 'People', 'Time', 'Workplace', 'Talent', 'Reports', 'Settings']);
    expect(modules.some((m) => m.key === 'organization')).toBe(false);
    /* Joining & leaving sits under People (JOINING-LEAVING-DECISIONS.md, placed in the 28 Oct menu); the hub screen is off the menu. */
    for (const k of ['joiners', 'offers', 'lifecycleChanges', 'leavers', 'checklists', 'orgChart']) expect(moduleForScreen(modules, k, peopleApp.nav)?.label, k).toBe('People');
    expect(peopleApp.nav.some((i) => i.key === 'lifecycle')).toBe(false);
    expect(modules.find((m) => m.label === 'Settings').single).toBe(true);
  });

  /* The plan's groups, word for word (docs/people/10-PEOPLE-PLAN-2026-11-08.md §2). */
  it('groups People, Time, Talent and Reports as the plan does', () => {
    const groupsOf = (key) => modules.find((m) => m.key === key).groups.map((g) => [g.label, g.items.map((i) => i.label)]);
    expect(groupsOf('employees')).toEqual([
      ['', ['Employees', 'Org chart', 'Documents']],
      ['Joining & leaving', ['Joining', 'Offers', 'Job changes', 'Leaving', 'Tasks']],
      ['Pay & assets', ['Salary revisions', 'Expenses', 'Benefits', 'Assets']],
    ]);
    expect(groupsOf('leave')).toEqual([
      ['Leave', ["Who's away", 'Leave requests', 'Leave calendar', 'Leave balances']],
      ['Attendance', ['Daily attendance', 'All attendance records', 'Days to check', 'Attendance fixes', 'Overtime & comp-off', 'Late marks', 'Absent without leave', 'Night work']],
      /* Shifts, readers and the month's close are People's too (owner, 11 Nov 2026). */
      ['Shifts', ['Shift calendar', 'Shifts', 'Who is on which shift', 'Temporary shifts', 'Shift swaps']],
      ['Readers', ['Readers', 'Reader health', 'Punches', 'Punches with no employee']],
      ['Month end', ['Ready for payroll?', 'Employee confirmations', 'Month close']],
    ]);
    expect(groupsOf('talent').map(([l]) => l)).toEqual(['Hiring', 'Performance']);
    expect(groupsOf('talent')[0][1]).not.toContain('Refer someone');
    expect(groupsOf('reports')).toEqual([
      /* The reports home first (platform audit, 11 Nov 2026): every report in plain groups; one report opens from it, off the menu. */
      ['', ['All reports']],
      ['People', ['Headcount & attrition']],
      ['Time', ['Monthly attendance', 'Daily attendance register', 'All attendance reports', 'Leave register', 'Requests report']],
      ['Statutory registers', ['Statutory registers']],
    ]);
  });

  it('Delegates, the compliance calendar, the auditor’s evidence and the company’s shape are Settings pages; Night work stays in Time', () => {
    const parentOf = Object.fromEntries(peopleApp.nav.filter((i) => i.key).map((i) => [i.key, i.parent]));
    for (const k of ['standIns', 'compliance', 'auditEvidence', 'departments', 'jobPositions', 'branches', 'orgChanges', 'establishments', 'areas', 'teams', 'seats', 'businessUnits', 'grades', 'costCentres', 'jobRoles']) expect(parentOf[k], k).toBe('settings');
    expect(moduleForScreen(modules, 'nightWork', peopleApp.nav)?.label).toBe('Time');
    expect(moduleForScreen(modules, 'standIns', peopleApp.nav)?.label).toBe('Settings');
    /* Leave summary is a tab of Statutory registers, so it is not a second entry; its address still works. */
    expect(inModules.has('leaveSummary')).toBe(false);
    expect(parentOf.leaveSummary).toBe('registers');
    /* Old names still find the screen in search. */
    const keywordsOf = (k) => peopleApp.nav.find((i) => i.key === k).keywords || [];
    expect(keywordsOf('orgChanges')).toContain('change history');
    expect(keywordsOf('absences')).toContain('absences');
    expect(keywordsOf('companyChoices')).toContain('company choices');
    expect(keywordsOf('reports')).toContain('people report');
    expect(inModules.has('hrReport')).toBe(false);
    expect(parentOf.hrReport).toBe('reportsHome');
    expect(moduleForScreen(modules, 'hrReport', peopleApp.nav)?.label).toBe('Reports');
    expect(keywordsOf('orgChart')).toContain('organisation');
  });

  it('Settings is the plan’s seven groups, in order, and every Settings row has its own icon', async () => {
    const { GROUPS } = await import('../apps/people/src/screens/PeopleSettings.jsx');
    expect(GROUPS.map((g) => g.title)).toEqual(['Company', 'More structure', 'People', 'Time', 'Shifts & readers', 'Requests & approvals', 'Data & privacy', 'Access & apps']);
    expect(GROUPS.find((g) => g.title === 'Requests & approvals').items.map(([k]) => k)).toContain('standIns');
    expect(GROUPS.find((g) => g.title === 'Company').items.map(([k]) => k)).toEqual(expect.arrayContaining(['departments', 'jobPositions', 'branches', 'orgChanges', 'compliance']));
    expect(GROUPS.find((g) => g.title === 'Data & privacy').items.map(([k]) => k)).toContain('auditEvidence');
    const rows = GROUPS.flatMap((g) => g.items.map(([k]) => k));
    const icons = rows.map((k) => peopleApp.nav.find((i) => i.key === k)?.icon?.displayName);
    expect(new Set(icons).size, 'icons reused across Settings rows').toBe(icons.length);
  });

  it('reaches every page from the sidebar or from Settings, and every page exists', () => {
    for (const item of peopleApp.nav.filter((i) => i.key)) {
      /* Your own leave and days open from My profile (owner, 28 Oct 2026 audit), not from the admin menu. */
      /* A retired address (the old compliance calendar) names the page that replaced it, which may itself sit under Settings. */
      const parentOf = (k) => peopleApp.nav.find((i) => i.key === k)?.parent;
      const reachable = inModules.has(item.key) || (item.parent && (inModules.has(item.parent) || inModules.has(parentOf(item.parent)))) || peopleApp.profileLinks.includes(item.key);
      expect(reachable, item.key).toBe(true);
      expect(peopleApp.screens[item.key], item.key).toBeTruthy();
    }
  });

  it('shows Settings on the rail while a settings page is open', () => {
    expect(moduleForScreen(modules, 'departments', peopleApp.nav)?.label).toBe('Settings');
    expect(moduleForScreen(modules, 'branches', peopleApp.nav)?.label).toBe('Settings');
    expect(moduleForScreen(modules, 'companyDetails', peopleApp.nav)?.label).toBe('Settings');
    expect(moduleForScreen(modules, 'employees', peopleApp.nav)?.label).toBe('People');
    /* The record, Add employee and Import keep People selected (WF-01). */
    for (const k of ['employee', 'employeeNew', 'employeeImport']) expect(moduleForScreen(modules, k, peopleApp.nav)?.label, k).toBe('People');
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

  /* Sentence case, as Google and Microsoft write menus (owner, 28 Oct 2026 audit): only the first word, names and abbreviations start capital. */
  it('uses sentence case for every menu label', () => {
    const NAMES = new Set(['HR', 'PAN', 'TAN', 'DPDP', 'CLOR']);
    for (const item of peopleApp.nav.filter((i) => i.key)) {
      const [first, ...rest] = item.label.split(' ');
      expect(/^[A-Z]/.test(first), item.label).toBe(true);
      expect(rest.filter((w) => /^[A-Z]/.test(w) && !NAMES.has(w)), item.label).toEqual([]);
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

  /* People audit, 30 Oct 2026, gap 4: simple mode trims organisation detail only; a small business needs the rest. */
  it('hides organisation detail only', () => {
    const hidden = [...keys(full)].filter((k) => !keys(simple).has(k)).sort();
    expect(hidden).toEqual(['legalEntities']);
  });

  it('shows a new company year end, delegates, policies, compliance, privacy and the other screens it needs', () => {
    const kept = keys(simple);
    for (const k of ['leaveYearEnd', 'standIns', 'approvalRules', 'requestRules', 'policies', 'compliance', 'complianceCalendar', 'privacy', 'privateCases', 'employeeTypes', 'customFields', 'orgChanges', 'helpDeskSettings', 'auditEvidence', 'tags', 'recycleBin']) {
      expect(kept.has(k), k).toBe(true);
    }
  });

  it('never hides a person’s own data, the day’s work, or the setup steps on Home', () => {
    const kept = keys(simple);
    for (const k of ['overview', 'approvals', 'employees', 'employee', 'employeeNew', 'employeeImport', 'documents', 'leaveRequests', 'leaveCalendar', 'leaveBalances', 'timeOverview', 'attendance', 'attendanceRequests', 'myLeave', 'myDays', 'helpdesk', 'dataHealth', 'dataRequests', 'dataProtection', 'auditLogs', 'workingWeek', 'holidays', 'leaveTypes', 'selfService', 'modules', 'companyDetails', 'sso', 'dataImport', 'dataExport', 'settings']) {
      expect(kept.has(k), k).toBe(true);
    }
  });

  it('keeps every module that has a screen left, and the leave screens under one naming rule', () => {
    const modules = resolveModules(peopleApp, simple);
    expect(modules.map((m) => m.label)).toEqual(['Home', 'Inbox', 'People', 'Time', 'Workplace', 'Talent', 'Reports', 'Settings']);
    expect(modules.find((m) => m.key === 'leave').items.map((i) => i.label)).toEqual(["Who's away", 'Leave requests', 'Leave calendar', 'Leave balances', 'Daily attendance', 'All attendance records', 'Days to check', 'Attendance fixes', 'Overtime & comp-off', 'Late marks', 'Absent without leave', 'Night work', 'Shift calendar', 'Shifts', 'Who is on which shift', 'Temporary shifts', 'Shift swaps', 'Readers', 'Reader health', 'Punches', 'Punches with no employee', 'Ready for payroll?', 'Employee confirmations', 'Month close']);
  });

  it('shows everything when simple mode is off, or when the company’s switches are not known yet', () => {
    expect(keys(shown({ peopleDetailed: true })).size).toBe(keys(shown({})).size);
    expect(keys(shown({})).has('standIns')).toBe(true);
  });
});

/* One name for one screen, in both apps that show it (PRODUCT-VIEW §1); each app writes it in its own case (People: sentence case). */
describe('Shared Time & Leave screens', () => {
  it('carry the same label in People and Attendance', async () => {
    const { attendanceApp } = await import('../apps/attendance/manifest.jsx');
    const label = (app, k) => app.nav.find((i) => i.key === k)?.label;
    for (const k of ['timeOverview', 'leaveRequests', 'leaveCalendar', 'leaveBalances', 'leaveRegister', 'standIns', 'leaveTypes', 'holidays', 'workingWeek', 'leaveYearEnd', 'requestRules', 'myLeave']) {
      expect(label(peopleApp, k)?.toLowerCase(), k).toBe(label(attendanceApp, k)?.toLowerCase());
    }
    expect(label(peopleApp, 'attendanceRequests').toLowerCase()).toBe(label(attendanceApp, 'requests').toLowerCase());
  });

  it('do not call two different things Work Sites', async () => {
    const { attendanceApp } = await import('../apps/attendance/manifest.jsx');
    expect(peopleApp.nav.find((i) => i.key === 'establishments').label).toBe('Work sites');
    expect(attendanceApp.nav.some((i) => i.label === 'Work Sites')).toBe(false);
    expect(attendanceApp.nav.find((i) => i.key === 'sites').label).toBe('Punch areas');
  });

  it('show in Attendance under simple mode too, as in People', async () => {
    const { attendanceApp } = await import('../apps/attendance/manifest.jsx');
    expect(attendanceApp.nav.filter((i) => i.feature === 'peopleDetailed').map((i) => i.key)).toEqual([]);
  });
});
