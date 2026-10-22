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
    expect(modules.map((m) => m.label)).toEqual(['Home', 'Employees', 'Leave & Attendance', 'Hiring', 'Performance', 'Engage', 'Insights', 'Settings']);
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
    expect(moduleForScreen(modules, 'departments', peopleApp.nav)?.label).toBe('Settings');
    expect(moduleForScreen(modules, 'companyDetails', peopleApp.nav)?.label).toBe('Settings');
    expect(moduleForScreen(modules, 'employees', peopleApp.nav)?.label).toBe('Employees');
  });

  it('every Settings card points at a page in the nav', () => {
    const src = readFileSync('apps/people/src/screens/PeopleSettings.jsx', 'utf8');
    const keys = [...src.matchAll(/\['([a-zA-Z]+)', '/g)].map((m) => m[1]).filter((k) => !['payroll', 'attendance'].includes(k));
    const nav = new Set(peopleApp.nav.map((i) => i.key));
    for (const k of keys) expect(nav.has(k), k).toBe(true);
  });

  it('uses Title Case for every menu label', () => {
    for (const item of peopleApp.nav.filter((i) => i.key)) {
      const small = item.label.split(' ').filter((w) => /^[a-z]/.test(w) && !['and', 'of', 'to', 'in'].includes(w));
      expect(small, item.label).toEqual([]);
    }
  });
});
