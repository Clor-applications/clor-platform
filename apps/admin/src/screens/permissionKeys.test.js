// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { TIME_LEAVE_RESOURCES, catalogKeys, displayModules, moduleKeys, permissionLabel, visibleModules } from './permissionKeys';

/* The shape the server's catalogue sends (server/src/constants/permissionCatalog.ts), cut down. */
const res = (key, actions = ['VIEW', 'EDIT']) => ({ key, label: key, actions });
const CATALOG = [
  { key: 'SETTINGS', label: 'Settings', resources: [res('Roles')] },
  { key: 'SALES', label: 'Sales', resources: [res('Invoices')] },
  { key: 'PEOPLE', label: 'People', resources: [res('Employees')] },
  {
    key: 'ATTENDANCE',
    label: 'Attendance',
    resources: [
      res('Attendance Records'), res('Attendance Requests'), res('Shifts'), res('Holidays'), res('My Attendance', ['VIEW']),
      res('Leave Types'), res('Leave Requests'), res('Attendance Devices'), res('Attendance Integrations'), res('Employee Portal', ['VIEW']),
    ],
  },
  { key: 'PAYROLL', label: 'Payroll', resources: [res('Pay Runs')] },
];
const labels = (mods) => mods.map((m) => m.label);
const resourcesOf = (mods, label) => mods.find((m) => m.label === label)?.resources.map((r) => r.key);

/* TIME-LEAVE-DECISIONS M1: leave rights are offered to a People-only company. */
describe('the Time & Leave section of the role editor', () => {
  it('shows Time & Leave, and no Attendance section, when only People is offered', () => {
    const shown = visibleModules(CATALOG, ['company', 'people'], 'all');
    expect(labels(shown)).toEqual(['Settings', 'People', 'Time & Leave']);
    expect(resourcesOf(shown, 'Time & Leave').sort()).toEqual([...TIME_LEAVE_RESOURCES].sort());
  });

  it('shows both when People and Attendance are offered, with every Attendance right in one of them', () => {
    const shown = visibleModules(CATALOG, ['company', 'people', 'attendance'], 'all');
    expect(labels(shown)).toEqual(['Settings', 'People', 'Time & Leave', 'Attendance']);
    expect(resourcesOf(shown, 'Attendance')).toEqual(['Attendance Records', 'Attendance Requests', 'Shifts', 'Attendance Devices', 'Attendance Integrations']);
  });

  it('shows Time & Leave to an Attendance-only company too', () => {
    expect(labels(visibleModules(CATALOG, ['company', 'attendance'], 'all'))).toEqual(['Settings', 'Time & Leave', 'Attendance']);
  });

  it('puts Time & Leave on the People tab and on the Attendance tab', () => {
    const both = ['company', 'people', 'attendance'];
    expect(labels(visibleModules(CATALOG, both, 'people'))).toEqual(['People', 'Time & Leave']);
    expect(labels(visibleModules(CATALOG, both, 'attendance'))).toEqual(['Time & Leave', 'Attendance']);
    expect(labels(visibleModules(CATALOG, both, 'company'))).toEqual(['Settings']);
    expect(labels(visibleModules(CATALOG, ['company', 'people'], 'payroll'))).toEqual([]);
  });

  it('keeps every wire key as ATTENDANCE::<Resource>::<ACTION>', () => {
    const shown = displayModules(CATALOG);
    const time = shown.find((m) => m.label === 'Time & Leave');
    expect(time.key).toBe('ATTENDANCE');
    expect(moduleKeys(time)).toContain('ATTENDANCE::Leave Types::EDIT');
    expect(moduleKeys(time)).toContain('ATTENDANCE::Employee Portal::VIEW');
    expect(catalogKeys(shown)).toEqual(catalogKeys(CATALOG));
  });

  it('tells the two halves apart on screen, and splitting twice changes nothing', () => {
    const once = displayModules(CATALOG);
    const ids = once.map((m) => m.displayKey);
    expect(new Set(ids).size).toBe(ids.length);
    expect(displayModules(once)).toEqual(once);
  });

  it('names a leave right by its section', () => {
    expect(permissionLabel(CATALOG, 'ATTENDANCE::Leave Types::EDIT')).toBe('Time & Leave › Leave Types: Edit');
    expect(permissionLabel(CATALOG, 'ATTENDANCE::Shifts::VIEW')).toBe('Attendance › Shifts: View');
    expect(permissionLabel(CATALOG, 'SALES::Invoices::VIEW')).toBe('Sales › Invoices: View');
  });
});
