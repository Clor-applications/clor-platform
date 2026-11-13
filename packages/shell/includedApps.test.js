import { describe, expect, it } from 'vitest';

import { PEOPLE_SCREEN_ALIASES, includedIn, resolveIncludedLink, shownApps } from '@platform/includedApps';
import { emailGroups } from '@ui/notifications/emailApps';
import { appById, availableApps, catalogueFor, landingApp, landingFor, subscribedApps } from './registry';
import { includedForward } from './includedForward';

/*
 * People includes Attendance (owner, 9 Nov 2026): a company on People has
 * Attendance's screens in People's Time menu, so it is not shown a second app.
 * A company with Attendance alone is as it was.
 */
const PEOPLE_CO = ['accounting', 'people', 'attendance'];
const PEOPLE_ONLY = ['accounting', 'people'];
const ATTENDANCE_CO = ['accounting', 'attendance'];
const ids = (apps) => apps.map((a) => a.id);

describe('the apps a company is shown', () => {
  it('leaves Attendance out for a company on People', () => {
    expect(shownApps(PEOPLE_CO)).toEqual(['accounting', 'people']);
    expect(ids(subscribedApps(PEOPLE_CO))).toEqual(['admin', 'accounting', 'people']);
    expect(includedIn('attendance', PEOPLE_CO)).toBe('people');
  });

  it('never offers Attendance as an app to add when the company has People', () => {
    expect(ids(availableApps(PEOPLE_ONLY))).not.toContain('attendance');
    expect(ids(availableApps(PEOPLE_CO))).not.toContain('attendance');
    expect(ids(catalogueFor(PEOPLE_ONLY))).not.toContain('attendance');
  });

  it('keeps Attendance as it was for a company with Attendance alone', () => {
    expect(shownApps(ATTENDANCE_CO)).toEqual(ATTENDANCE_CO);
    expect(ids(subscribedApps(ATTENDANCE_CO))).toEqual(['admin', 'accounting', 'attendance']);
    expect(ids(availableApps(ATTENDANCE_CO))).toContain('people');
    expect(ids(catalogueFor(ATTENDANCE_CO))).toContain('attendance');
    expect(landingApp(['attendance']).id).toBe('attendance');
    expect(includedIn('attendance', ATTENDANCE_CO)).toBeNull();
  });

  it('still offers Attendance to a company with neither', () => {
    expect(ids(availableApps(['accounting']))).toEqual(expect.arrayContaining(['attendance', 'people']));
  });

  it('lands a People company in People, not in an app it is not shown', () => {
    expect(landingApp(['people', 'attendance']).id).toBe('people');
  });

  it('keeps every app apart in the sample company somebody is exploring', () => {
    expect(ids(subscribedApps(PEOPLE_CO, { all: true }))).toContain('attendance');
    expect(landingFor({ app: 'attendance', screen: 'today' }, PEOPLE_CO, { all: true })).toEqual({ app: 'attendance', screen: 'today', moved: false });
  });
});

describe('a link into Attendance, for a company on People', () => {
  const people = appById('people');
  const attendance = appById('attendance');

  it('opens the same screen in People, by People’s name for it', () => {
    expect(landingFor({ app: 'attendance', screen: 'monthClose' }, PEOPLE_CO)).toEqual({ app: 'people', screen: 'monthClose', moved: true });
    expect(landingFor({ app: 'attendance', screen: 'today' }, PEOPLE_CO)).toEqual({ app: 'people', screen: 'attendance', moved: true });
    expect(landingFor({ app: 'attendance', screen: 'reports' }, PEOPLE_CO)).toEqual({ app: 'people', screen: 'attendanceReports', moved: true });
    expect(landingFor({ app: 'attendance', screen: 'portalAccess' }, PEOPLE_CO)).toEqual({ app: 'people', screen: 'selfService', moved: true });
  });

  it('opens People’s home when there is no matching screen, or none was named', () => {
    expect(landingFor({ app: 'attendance', screen: 'noSuchScreen' }, PEOPLE_CO)).toEqual({ app: 'people', screen: '', moved: true });
    expect(landingFor({ app: 'attendance' }, PEOPLE_CO)).toEqual({ app: 'people', screen: '', moved: true });
  });

  it('leaves the link alone for a company with Attendance alone, and for any other app', () => {
    expect(landingFor({ app: 'attendance', screen: 'today' }, ATTENDANCE_CO)).toEqual({ app: 'attendance', screen: 'today', moved: false });
    expect(landingFor({ app: 'payroll', screen: 'runs' }, PEOPLE_CO)).toEqual({ app: 'payroll', screen: 'runs', moved: false });
  });

  it('every renamed key names a real People screen (or home)', () => {
    for (const [from, to] of Object.entries(PEOPLE_SCREEN_ALIASES)) {
      if (to) expect(people.screens[to], `${from} -> ${to}`).toBeTruthy();
    }
  });

  it('Attendance’s screens have a match in People; the few that do not are known and open its home', () => {
    const home = Object.keys(attendance.screens).filter((k) => !resolveIncludedLink({ app: 'attendance', screen: k }, PEOPLE_CO, people.screens).screen);
    /* No counterpart in People today. A new Attendance screen must be given a place in People or added here on purpose. */
    expect(home.sort()).toEqual(['closeCompany']);
  });
});

describe('the Attendance address, for a company on People', () => {
  const at = (hostname, search = '', pathname = '/o/4831920657/', hash = '') => ({ protocol: 'https:', hostname, pathname, search, hash });

  it('goes on to the matching screen at People’s address, keeping the company', () => {
    expect(includedForward(at('attendance.clor.in', '?open=monthClose&s.month=2026-10'), PEOPLE_CO)).toBe('https://people.clor.in/o/4831920657/?open=monthClose&s.month=2026-10');
    expect(includedForward(at('attendance.clor.in', '?open=today'), PEOPLE_CO)).toBe('https://people.clor.in/o/4831920657/?open=attendance');
  });

  it('goes to People’s home when the screen has no match or none is named', () => {
    expect(includedForward(at('attendance.clor.in', '?open=closeCompany'), PEOPLE_CO)).toBe('https://people.clor.in/o/4831920657/');
    expect(includedForward(at('attendance.clor.in', '', '/'), PEOPLE_CO, { code: '4831920657' })).toBe('https://people.clor.in/o/4831920657/');
  });

  it('sends a front-door link that names Attendance to People too', () => {
    expect(includedForward(at('app.clor.in', '?app=attendance&open=today&from=weekly', '/'), PEOPLE_CO, { code: '4831920657' })).toBe('https://people.clor.in/o/4831920657/?open=attendance&from=weekly');
  });

  it('stays put for a company with Attendance alone', () => {
    expect(includedForward(at('attendance.clor.in', '?open=today'), ATTENDANCE_CO)).toBeNull();
  });

  it('stays put on People’s own address, on other apps’ addresses, and where apps have no addresses', () => {
    expect(includedForward(at('people.clor.in', '?open=monthClose'), PEOPLE_CO)).toBeNull();
    expect(includedForward(at('payroll.clor.in', '?open=runs'), PEOPLE_CO)).toBeNull();
    /* localhost: the shell opens People in place instead. */
    expect(includedForward(at('localhost', '?app=attendance&open=today', '/'), PEOPLE_CO)).toBeNull();
  });

  it('stays put in the sample company somebody is exploring', () => {
    expect(includedForward(at('attendance.clor.in', '?open=today'), PEOPLE_CO, { all: true })).toBeNull();
  });
});

describe('email switches, for a company on People', () => {
  const events = [
    { key: 'attendance.leave_decided', enabled: true },
    { key: 'people.joined', enabled: true },
  ];

  it('lists Attendance’s emails under People, with no Attendance group', () => {
    const groups = emailGroups(events, PEOPLE_CO);
    expect(groups.map((g) => g.id)).toEqual(['accounting', 'people']);
    expect(groups.find((g) => g.id === 'people').events.map((e) => e.key).sort()).toEqual(['attendance.leave_decided', 'people.joined']);
  });

  it('keeps the Attendance group for a company with Attendance alone', () => {
    const groups = emailGroups(events, ATTENDANCE_CO);
    expect(groups.find((g) => g.id === 'attendance').events.map((e) => e.key)).toEqual(['attendance.leave_decided']);
  });
});
