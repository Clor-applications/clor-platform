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
    /* Organization follows Workforce (ORGANIZATION-DECISIONS.md): the company's shape moved out of Settings. */
    expect(modules.map((m) => m.label)).toEqual(['Home', 'Workforce', 'Organization', 'Leave & Attendance', 'Hiring', 'Performance', 'Engage', 'Insights', 'Settings']);
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
