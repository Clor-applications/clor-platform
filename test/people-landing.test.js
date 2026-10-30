import { describe, expect, it } from 'vitest';

import { peopleApp } from '../apps/people/manifest.jsx';
import { holdsPermission } from '../packages/shell/Shell.jsx';
import { landingScreen, withoutEmptyHubs } from '../packages/shell/splitNav.js';
import { PERMISSION_CATALOG, expandPreset } from '../server/src/constants/permissionCatalog.ts';
import { AUDIT_GRANT, CASE_SEAT } from '../apps/people/src/api/access.js';

/*
 * People audit, 30 Oct 2026: an employee, an outside auditor or a committee
 * member opened the People web app onto "You can't open Home". The app now
 * opens on Home for whoever may see it, and on the first screen of their rail
 * for everyone else. Same filter as the shell (Shell.jsx).
 */
const keysOf = (preset) => new Set(expandPreset(preset).map((r) => `${r.module}::${r.subModule}::${r.action}`));
const OWNER = new Set(PERMISSION_CATALOG.flatMap((m) => m.resources.flatMap((r) => r.actions.map((a) => `${m.key}::${r.key}::${a}`))));
const navFor = (granted, extra = []) => withoutEmptyHubs(peopleApp.nav.filter((i) => i.section || holdsPermission(i.permission, granted, new Set(extra))));
const landsOn = (granted, extra) => landingScreen(peopleApp, navFor(granted, extra));

describe('where People opens', () => {
  it('opens on Home for the owner, HR and a manager', () => {
    expect(landsOn(OWNER)).toBe('overview');
    expect(landsOn(keysOf('HR_USER'))).toBe('overview');
    expect(landsOn(keysOf('TEAM_MANAGER'))).toBe('overview');
  });

  it('opens an employee, an outside auditor and a committee member on a screen they may open, never a refusal', () => {
    const people = [
      ['employee', keysOf('EMPLOYEE_SELF_SERVICE'), []],
      ['auditor', keysOf('EXTERNAL_AUDITOR'), [AUDIT_GRANT]],
      ['committee', keysOf('EMPLOYEE_SELF_SERVICE'), [CASE_SEAT]],
    ];
    for (const [who, granted, extra] of people) {
      const nav = navFor(granted, extra);
      const key = landingScreen(peopleApp, nav);
      expect(key, who).not.toBe('overview');
      expect(nav.some((i) => i.key === key), who).toBe(true);
      expect(peopleApp.screens[key], who).toBeTruthy();
    }
  });

  it('keeps Home while the permissions are not known yet', () => {
    expect(landingScreen(peopleApp, peopleApp.nav)).toBe('overview');
    expect(landingScreen({ home: 'x', nav: [] }, [])).toBe('x');
  });
});
