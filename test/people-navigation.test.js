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

  /* The R&D hand-off (14 Nov 2026): the rail by section, each section's pages in the panel. */
  it('puts the hand-off’s eight sections on the rail, Settings last', () => {
    expect(modules.map((m) => m.label)).toEqual(['Home', 'Employees', 'Leave & attendance', 'Hiring', 'Performance', 'Engage', 'Insights', 'Settings']);
    expect(modules.some((m) => m.key === 'organization')).toBe(false);
    for (const k of ['joiners', 'offers', 'lifecycleChanges', 'leavers', 'checklists', 'orgChart', 'assets']) expect(moduleForScreen(modules, k, peopleApp.nav)?.label, k).toBe('Employees');
    expect(peopleApp.nav.some((i) => i.key === 'lifecycle')).toBe(false);
    /* The Inbox sits under Home, where the rail's count is. */
    expect(moduleForScreen(modules, 'approvals', peopleApp.nav)?.label).toBe('Home');
    expect(modules.find((m) => m.label === 'Settings').single).toBe(false);
  });

  it('groups each section’s pages in the panel', () => {
    const groupsOf = (key) => modules.find((m) => m.key === key).groups.map((g) => [g.label, g.items.map((i) => i.label)]);
    expect(groupsOf('overview')).toEqual([
      ['', ['Home', 'Inbox']],
      ['Me', ['My leave', 'My attendance', 'My requests']],
    ]);
    expect(groupsOf('employees')).toEqual([
      ['Directory', ['Employees', 'Org chart', 'Documents']],
      ['Joining & leaving', ['Joining', 'Offers', 'Job changes', 'Leaving', 'Tasks', 'Assets']],
      ['Pay & benefits', ['Salary revisions', 'Benefits', 'Expenses']],
    ]);
    expect(groupsOf('leave')).toEqual([
      ['Leave', ['Leave requests', 'Leave calendar', 'Leave balances', 'Leave register', "Who's away"]],
      ['Attendance', ['Daily attendance', 'All attendance records', 'Days to check', 'Attendance fixes', 'Overtime & comp-off', 'Late marks', 'Absent without leave', 'Night work']],
      /* Shifts, readers and the month's close are People's too (owner, 11 Nov 2026). */
      ['Shifts', ['Shift calendar', 'Shifts', 'Who is on which shift', 'Temporary shifts', 'Shift swaps']],
      ['Readers', ['Readers', 'Reader health', 'Punches', 'Punches with no employee']],
      ['Month end', ['Ready for payroll?', 'Employee confirmations', 'Month close']],
      ['Me', ['My leave', 'My attendance']],
    ]);
    expect(groupsOf('hiring')).toEqual([['', ['Job openings', 'Candidates', 'Interviews', 'Referrals']]]);
    expect(groupsOf('performance')).toEqual([['', ['Goals', 'Reviews', 'One-on-ones', 'Improvement plans', 'Training']]]);
    expect(groupsOf('workplace')).toEqual([['', ['Announcements', 'Events', 'Help desk', 'Confidential cases', 'Policies']]]);
    expect(groupsOf('reports')).toEqual([
      /* The reports home first (platform audit, 11 Nov 2026): every report in plain groups; one report opens from it, off the menu. */
      ['', ['All reports', 'Headcount & attrition', 'Data check', 'Compliance calendar']],
      ['Time', ['Monthly attendance', 'Daily attendance register', 'All attendance reports', 'Requests report']],
      ['Statutory', ['Statutory registers']],
    ]);
  });

  it('Delegates, the auditor’s evidence and the company’s shape are Settings pages; the compliance calendar and data check are Insights; Night work stays in Leave & attendance', () => {
    const parentOf = Object.fromEntries(peopleApp.nav.filter((i) => i.key).map((i) => [i.key, i.parent]));
    for (const k of ['standIns', 'auditEvidence', 'departments', 'jobPositions', 'branches', 'orgChanges', 'establishments', 'areas', 'teams', 'seats', 'businessUnits', 'grades', 'costCentres', 'jobRoles']) expect(parentOf[k], k).toBe('settings');
    for (const k of ['compliance', 'dataHealth']) expect(moduleForScreen(modules, k, peopleApp.nav)?.label, k).toBe('Insights');
    expect(moduleForScreen(modules, 'nightWork', peopleApp.nav)?.label).toBe('Leave & attendance');
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
    expect(moduleForScreen(modules, 'hrReport', peopleApp.nav)?.label).toBe('Insights');
    expect(keywordsOf('orgChart')).toContain('organisation');
  });

  it('Settings is one list of groups for the page and the panel, and every Settings row has its own icon', async () => {
    const { GROUPS } = await import('../apps/people/src/screens/PeopleSettings.jsx');
    expect(GROUPS.map((g) => g.title)).toEqual(['Organisation', 'People records', 'Time off', 'Shifts & readers', 'Requests & approvals', 'Access', 'Data']);
    expect(GROUPS.find((g) => g.title === 'Requests & approvals').items.map(([k]) => k)).toContain('standIns');
    expect(GROUPS.find((g) => g.title === 'Organisation').items.map(([k]) => k)).toEqual(expect.arrayContaining(['departments', 'jobPositions', 'branches', 'orgChanges']));
    expect(GROUPS.find((g) => g.title === 'Data').items.map(([k]) => k)).toContain('auditEvidence');
    const settings = modules.find((m) => m.key === 'settings');
    expect(settings.groups.map((g) => g.label)).toEqual(['', ...GROUPS.map((g) => g.title)]);
    for (const k of peopleApp.nav.filter((i) => i.parent === 'settings').map((i) => i.key)) expect(inModules.has(k), k).toBe(true);
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
    expect(moduleForScreen(modules, 'employees', peopleApp.nav)?.label).toBe('Employees');
    /* The record, Add employee and Import keep Employees selected (WF-01). */
    for (const k of ['employee', 'employeeNew', 'employeeImport']) expect(moduleForScreen(modules, k, peopleApp.nav)?.label, k).toBe('Employees');
  });

  it('every Settings card points at a page in the nav', () => {
    const src = readFileSync('apps/people/src/settingsGroups.js', 'utf8');
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
    expect(modules.map((m) => m.label)).toEqual(['Home', 'Employees', 'Leave & attendance', 'Hiring', 'Performance', 'Engage', 'Insights', 'Settings']);
    expect(modules.find((m) => m.key === 'leave').items.map((i) => i.label)).toEqual(['Leave requests', 'Leave calendar', 'Leave balances', 'Leave register', "Who's away", 'Daily attendance', 'All attendance records', 'Days to check', 'Attendance fixes', 'Overtime & comp-off', 'Late marks', 'Absent without leave', 'Night work', 'Shift calendar', 'Shifts', 'Who is on which shift', 'Temporary shifts', 'Shift swaps', 'Readers', 'Reader health', 'Punches', 'Punches with no employee', 'Ready for payroll?', 'Employee confirmations', 'Month close', 'My leave', 'My attendance']);
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
