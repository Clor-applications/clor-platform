import { describe, expect, it } from 'vitest';

import { peopleApp } from '../apps/people/manifest.jsx';
import { holdsPermission, writeGuardPermission } from '../packages/shell/Shell.jsx';
import { PERMISSION_CATALOG, expandPreset } from '../server/src/constants/permissionCatalog.ts';
import { AUDIT_GRANT, CASE_SEAT, SALARY_READ } from '../apps/people/src/api/access.js';

/*
 * People audit, 30 Oct 2026, gaps 3 and 5: every People menu entry shows to
 * exactly the people its route lets in. This runs the shell's own check
 * (holdsPermission) over the manifest, with each person's role template
 * (server/src/constants/permissionCatalog.ts) and the access keys the server
 * sends for a live auditor grant or a seat on a case committee.
 */
const keysOf = (preset) => new Set(expandPreset(preset).map((r) => `${r.module}::${r.subModule}::${r.action}`));
const OWNER = new Set(PERMISSION_CATALOG.flatMap((m) => m.resources.flatMap((r) => r.actions.map((a) => `${m.key}::${r.key}::${a}`))));
const menu = (granted, extra = []) => new Set(peopleApp.nav.filter((i) => i.key && holdsPermission(i.permission, granted, new Set(extra))).map((i) => i.key));

const PERSONS = {
  owner: menu(OWNER),
  hr: menu(keysOf('HR_USER')),
  hrManager: menu(keysOf('HR_MANAGER')),
  manager: menu(keysOf('TEAM_MANAGER')),
  employee: menu(keysOf('EMPLOYEE_SELF_SERVICE')),
  auditor: menu(keysOf('EXTERNAL_AUDITOR'), [AUDIT_GRANT]),
  auditorNoGrant: menu(keysOf('EXTERNAL_AUDITOR')),
  committee: menu(keysOf('EMPLOYEE_SELF_SERVICE'), [CASE_SEAT]),
  hrReadsPay: menu(keysOf('HR_MANAGER'), [SALARY_READ]),
  viewer: menu(keysOf('VIEWER')),
  readOnlyAuditor: menu(keysOf('AUDITOR')),
};

describe('People menu by person', () => {
  it('shows Salary revisions to HR without Payroll only when the owner lets HR read them (Company choices)', () => {
    expect(PERSONS.hrManager.has('compensation')).toBe(false);
    expect(PERSONS.hrReadsPay.has('compensation')).toBe(true);
    expect(PERSONS.owner.has('companyChoices')).toBe(true);
  });

  it('gives everyone with their own days My leave and My attendance, and nothing that would refuse them', () => {
    for (const p of ['owner', 'hr', 'hrManager', 'manager', 'employee', 'committee']) {
      expect(PERSONS[p].has('myLeave'), p).toBe(true);
      expect(PERSONS[p].has('myDays'), p).toBe(true);
    }
    /* The action buttons on those screens need CREATE; every template that opens them carries it (gap 3). */
    for (const preset of ['HR_USER', 'HR_MANAGER', 'TEAM_MANAGER', 'EMPLOYEE_SELF_SERVICE']) expect(keysOf(preset).has('ATTENDANCE::My Attendance::CREATE'), preset).toBe(true);
  });

  it('shows Audit evidence only to a live auditor grant, not to the audit trail role or the owner', () => {
    expect(PERSONS.auditor.has('auditEvidence')).toBe(true);
    expect(PERSONS.auditorNoGrant.has('auditEvidence')).toBe(false);
    expect(PERSONS.owner.has('auditEvidence')).toBe(false);
    expect(PERSONS.hrManager.has('auditEvidence')).toBe(false);
    /* The auditor sees nothing else of People's people. */
    for (const k of ['employees', 'documents', 'privateCases', 'recycleBin', 'dataExport', 'myLeave']) expect(PERSONS.auditor.has(k), k).toBe(false);
  });

  it('shows Confidential cases to whoever takes cases in or sits on a case or committee, and to no one else', () => {
    expect(PERSONS.owner.has('privateCases')).toBe(true);
    expect(PERSONS.committee.has('privateCases')).toBe(true);
    /* HR Manager takes cases in (owner, 8 Nov 2026). */
    expect(PERSONS.hrManager.has('privateCases')).toBe(true);
    for (const p of ['hr', 'manager', 'employee', 'auditor', 'viewer', 'readOnlyAuditor']) expect(PERSONS[p].has('privateCases'), p).toBe(false);
  });

  it('gives HR Manager Policies and Privacy controls, and the read-only roles neither privacy nor files they may not open', () => {
    for (const k of ['policies', 'privacy']) expect(PERSONS.hrManager.has(k), k).toBe(true);
    for (const p of ['viewer', 'readOnlyAuditor']) expect(PERSONS[p].has('privacy'), p).toBe(false);
    /* Viewer reads the people and the files the person can see; the Auditor the list, no files, no recycle bin. */
    expect(PERSONS.viewer.has('employees')).toBe(true);
    expect(PERSONS.readOnlyAuditor.has('employees')).toBe(true);
    for (const k of ['documents', 'recycleBin', 'myLeave']) expect(PERSONS.readOnlyAuditor.has(k), k).toBe(false);
  });

  it('shows the recycle bin to those who may delete something in it, export to those who may read a dataset', () => {
    expect(PERSONS.owner.has('recycleBin')).toBe(true);
    expect(PERSONS.hrManager.has('recycleBin')).toBe(true);
    for (const p of ['hr', 'manager', 'employee', 'auditor']) expect(PERSONS[p].has('recycleBin'), p).toBe(false);
    for (const p of ['owner', 'hr', 'hrManager', 'manager']) expect(PERSONS[p].has('dataExport'), p).toBe(true);
    for (const p of ['employee', 'auditor', 'committee']) expect(PERSONS[p].has('dataExport'), p).toBe(false);
  });

  it('gives a team manager the Goals screen for their own team, which the template now reads', () => {
    expect(PERSONS.manager.has('performance')).toBe(true);
    expect(keysOf('TEAM_MANAGER').has('PEOPLE::Performance::EDIT')).toBe(false);
  });

  it('keeps Data protection and Integrations to the grants their routes check', () => {
    expect(PERSONS.owner.has('dataProtection')).toBe(true);
    expect(PERSONS.hrManager.has('dataProtection')).toBe(true);
    expect(PERSONS.hr.has('dataProtection')).toBe(false);
    expect(PERSONS.owner.has('integrations')).toBe(true);
    for (const p of ['hr', 'hrManager', 'manager', 'employee']) expect(PERSONS[p].has('integrations'), p).toBe(false);
    expect(peopleApp.nav.find((i) => i.key === 'integrations').feature).toBe('attendance');
  });

  it('lists only keys the catalog or the access route knows, so no entry is hidden by a typo', () => {
    const known = new Set([...OWNER, AUDIT_GRANT, CASE_SEAT, SALARY_READ]);
    for (const item of peopleApp.nav.filter((i) => i.permission)) {
      for (const k of [].concat(item.permission)) {
        /* Payroll's and Settings' keys live in their own catalogs' modules, all in PERMISSION_CATALOG. */
        expect(known.has(k), `${item.key}: ${k}`).toBe(true);
      }
    }
  });
});

describe('the screen-wide write guard', () => {
  const item = (k) => peopleApp.nav.find((i) => i.key === k);
  it('stays off the Talent screens the server decides per person (writeGuard: false, PR #67)', () => {
    for (const k of ['performance', 'reviews', 'plans']) expect(writeGuardPermission(item(k)), k).toBeUndefined();
  });
  it('stays off screens opened by any one of several rights, and on for a single one', () => {
    expect(writeGuardPermission(item('recycleBin'))).toBeUndefined();
    expect(writeGuardPermission(item('privateCases'))).toBeUndefined();
    expect(writeGuardPermission(item('myDays'))).toBe('ATTENDANCE::My Attendance::VIEW');
    expect(writeGuardPermission(undefined)).toBeUndefined();
  });
});

describe('the shell’s permission check', () => {
  const granted = new Set(['A::x::VIEW']);
  it('takes one key or any one of a list, and the app’s own access keys', () => {
    expect(holdsPermission('A::x::VIEW', granted)).toBe(true);
    expect(holdsPermission('A::y::VIEW', granted)).toBe(false);
    expect(holdsPermission(['A::y::VIEW', 'A::x::VIEW'], granted)).toBe(true);
    expect(holdsPermission(['A::y::VIEW'], granted)).toBe(false);
    expect(holdsPermission(['A::y::VIEW'], granted, new Set(['A::y::VIEW']))).toBe(true);
  });
  it('hides nothing while the grants are unknown, and needs none for an item without a permission', () => {
    expect(holdsPermission(['A::y::VIEW'], null)).toBe(true);
    expect(holdsPermission(undefined, granted)).toBe(true);
  });
});
