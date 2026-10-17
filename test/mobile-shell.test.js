// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

import { mobileTabsFor, MAX_TABS } from '../packages/shell/mobileTabs';
import { attendanceApp } from '../apps/attendance/manifest.jsx';

/**
 * CLOR on a phone: the tab bar shows what the app names, every app address has
 * its own manifest and icons, and a build pinned to one app opens that app
 * whatever the hostname (the native shell has none worth reading).
 */

describe('the phone tab bar', () => {
  const nav = [
    { key: 'a', label: 'A' },
    { section: 'More' },
    { key: 'b', label: 'B' },
    { key: 'c', label: 'C' },
    { key: 'd', label: 'D' },
    { key: 'e', label: 'E' },
  ];
  it('shows the tabs an app names, in its order, filled from the nav to four', () => {
    expect(mobileTabsFor({ mobileTabs: ['c', 'a'] }, nav).map((t) => t.key)).toEqual(['c', 'a', 'b', 'd']);
    expect(mobileTabsFor({}, nav).map((t) => t.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(mobileTabsFor({ mobileTabs: ['zzz', 'e'] }, nav).map((t) => t.key)).toEqual(['e', 'a', 'b', 'c']);
  });
  it('never shows more than four, and only screens the person may open', () => {
    expect(mobileTabsFor({ mobileTabs: ['a', 'b', 'c', 'd', 'e'] }, nav)).toHaveLength(MAX_TABS);
    /* The shell hands the permission-filtered nav; a named tab the person cannot open is simply absent. */
    expect(mobileTabsFor({ mobileTabs: ['e'] }, nav.filter((i) => i.key !== 'e')).map((t) => t.key)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('Attendance names Today, Records, Leave requests and Corrections', () => {
    expect(mobileTabsFor(attendanceApp, attendanceApp.nav).map((t) => t.key)).toEqual(['today', 'records', 'leaveRequests', 'requests']);
  });
});

describe('each app address installs as its own app', () => {
  for (const app of ['attendance', 'payroll', 'accounting']) {
    it(`${app} has a manifest and the icons it names`, () => {
      const m = JSON.parse(readFileSync(`public/manifest-${app}.webmanifest`, 'utf8'));
      expect(m.name).toBe(`CLOR ${app.charAt(0).toUpperCase()}${app.slice(1)}`);
      expect(m.display).toBe('standalone');
      expect(m.start_url).toBe('/');
      for (const icon of m.icons) expect(existsSync(`public${icon.src}`), icon.src).toBe(true);
      expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    });
  }
  it('index.html picks the manifest by hostname', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain("'/manifest-' + app + '.webmanifest'");
    expect(html).toContain('viewport-fit=cover');
  });
});

describe('a build pinned to one app', () => {
  it('opens that app on any hostname and never redirects to an app address', async () => {
    vi.stubEnv('VITE_MOBILE_APP', 'attendance');
    vi.resetModules();
    const { appFromHost, hostForApp } = await import('../packages/shell/appHosts.js');
    expect(appFromHost('localhost')).toBe('attendance');
    expect(appFromHost('app.clor.in')).toBe('attendance');
    expect(hostForApp('payroll', 'app.clor.in')).toBeNull();
    vi.unstubAllEnvs();
    vi.resetModules();
    const fresh = await import('../packages/shell/appHosts.js');
    expect(fresh.appFromHost('attendance.clor.in')).toBe('attendance');
    expect(fresh.appFromHost('localhost')).toBeNull();
  });
  it('the Capacitor project is pinned to Attendance and reads the pinned build', () => {
    const cfg = JSON.parse(readFileSync('mobile/attendance/capacitor.config.json', 'utf8'));
    expect(cfg.appId).toBe('in.clor.attendance');
    expect(cfg.webDir).toBe('../../dist-mobile/attendance');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts['build:mobile:attendance']).toContain('VITE_MOBILE_APP=attendance');
  });
});
