// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

import { mobileTabsFor, MAX_TABS } from '../packages/shell/mobileTabs';
import { moduleForScreen, resolveModules } from '../packages/shell/splitNav';
import { attendanceApp } from '../apps/attendance/manifest.jsx';
import { payrollApp } from '../apps/payroll/manifest.jsx';

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
  it('Payroll names Overview, Pay runs, Salary slips and Payments', () => {
    expect(mobileTabsFor(payrollApp, payrollApp.nav).map((t) => t.key)).toEqual(['overview', 'runs', 'slips', 'payments']);
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
  for (const app of ['attendance', 'payroll', 'accounting']) {
    it(`the ${app} Capacitor project is pinned to its app, reads its own build and has a workflow`, () => {
      const cfg = JSON.parse(readFileSync(`mobile/${app}/capacitor.config.json`, 'utf8'));
      expect(cfg.appId).toBe(`in.clor.${app}`);
      expect(cfg.webDir).toBe(`../../dist-mobile/${app}`);
      const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
      expect(pkg.scripts[`build:mobile:${app}`]).toContain(`VITE_MOBILE_APP=${app}`);
      const wf = readFileSync(`.github/workflows/android-${app}.yml`, 'utf8');
      expect(wf).toContain(`'${app}-v*'`);
      expect(wf).toContain(`mobile/${app}/android`);
      expect(readFileSync(`mobile/${app}/android/app/build.gradle`, 'utf8')).toContain(`applicationId "in.clor.${app}"`);
    });
  }
});

describe('the split sidebar', () => {
  for (const app of [attendanceApp, payrollApp]) {
    it(`${app.name}: every module screen is a nav screen, every nav screen has a module`, () => {
      const navKeys = app.nav.filter((i) => i.key).map((i) => i.key);
      const moduleKeys = app.modules.flatMap((m) => (m.groups ? m.groups.flatMap((g) => g.items) : m.items));
      for (const k of moduleKeys) expect(navKeys, k).toContain(k);
      for (const k of navKeys) expect(moduleKeys, k).toContain(k);
      expect(new Set(moduleKeys).size).toBe(moduleKeys.length);
      expect(app.screens[app.home]).toBeTruthy();
    });
  }
  it('drops what the person may not open, and a module left empty', () => {
    const nav = attendanceApp.nav.filter((i) => i.key && !String(i.key).startsWith('reader') && !['transactions', 'enrolments', 'unmatched', 'deviceLogs'].includes(i.key));
    const modules = resolveModules(attendanceApp, nav);
    expect(modules.map((m) => m.key)).not.toContain('device');
    expect(moduleForScreen(modules, 'records').key).toBe('attendance');
    expect(moduleForScreen(modules, 'today').single).toBe(true);
    expect(moduleForScreen(modules, 'nope')).toBeNull();
  });
});
