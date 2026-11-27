/**
 * @vitest-environment node
 *
 * Follow-ups to the 19 Nov design audit that are now in the code.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const directory = readFileSync('apps/people/src/workforce/Directory.jsx', 'utf8');
const attendance = readFileSync('packages/ui/src/timeOff/TeamAttendance.jsx', 'utf8');
const home = readFileSync('apps/people/src/screens/PeopleOverview.jsx', 'utf8');
const peopleCss = readFileSync('apps/people/src/screens/PeopleQuickLaunch.css', 'utf8');
const account = readFileSync('apps/admin/src/screens/AccountOverview.jsx', 'utf8');
const shell = readFileSync('packages/shell/Shell.jsx', 'utf8');
const siteCss = readFileSync('website/src/styles/site.css', 'utf8');
const adminHome = readFileSync('apps/admin/src/screens/AdminHome.jsx', 'utf8');
const wsOverviewCss = readFileSync('apps/admin/src/screens/ws-overview.css', 'utf8');

describe('People Employees, figures after the list', () => {
  it('keeps status selection above the register and workforce figures in a disclosure below it', () => {
    const table = directory.indexOf('<DataTable');
    const filter = directory.indexOf('ariaLabel="Employment status"');
    const disclosure = directory.indexOf('<summary>Workforce figures</summary>');
    expect(filter).toBeGreaterThan(-1);
    expect(table).toBeGreaterThan(filter);
    expect(disclosure).toBeGreaterThan(table);
    expect(directory.indexOf('<MetricStrip')).toBeGreaterThan(disclosure);
    expect(directory.indexOf('<Breakdown')).toBeGreaterThan(disclosure);
  });

  it('does not show a food-preference figure or department tags in Designation', () => {
    expect(directory).not.toMatch(/FOOD_ORDER|label: 'Food'/);
    expect(directory).toMatch(/\{ key: 'designation', label: 'Designation', sortable: true, render: \(r\) => r\.designation \|\| '—' \}/);
  });
});

describe('People Home on a phone', () => {
  it('offers the primary action and two columns of direct destination links on narrow screens', () => {
    expect(home).toMatch(/className="ui-btn ui-btn-primary" onClick=\{go\('employeeNew'\)\}/);
    expect(home).toContain('aria-label="People destinations"');
    expect(home).toContain('href={`?app=people&open=${key}`}');
    expect(peopleCss).toMatch(/\.people-brief-links\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  });
});

describe('Daily attendance, no present days', () => {
  it('writes one line instead of drawing a chart of zeros', () => {
    expect(attendance).toMatch(/weekRows\.some\(\(r\) => r\.value > 0\) \? <Columns/);
    expect(attendance).toMatch(/Nobody marked present this week\./);
  });
});

describe('Workspace settings, the company count', () => {
  it('is in the table head and the plan meter, not repeated as a tile or a fact', () => {
    expect(account).not.toMatch(/<Stat icon=\{ICON\.companies\}/);
    expect(account).toMatch(/<span className="ws-head-meta">\{companies\.length\}<\/span>/);
    expect(account).toMatch(/<LimitMeter label="Companies" used=\{companies\.length\}/);
    expect(account).not.toMatch(/<dt>Companies<\/dt>/);
  });
});

describe('the shell and clor.in', () => {
  it('gives app descriptions room and never blanks a section on a fast scroll', () => {
    expect(shell).toContain('<MenuPanel aria-label="Apps" width="min(19rem, calc(100vw - 1rem))"');
    expect(shell).toMatch(/ui-caption ui-app-blurb/);
    expect(siteCss).toMatch(/\.rv \{\s*opacity: 0\.9;/);
    expect(siteCss).not.toMatch(/transition-delay: calc\(var\(--rv-i, 0\) \* 70ms\)/);
  });
});

describe('Workspace Home', () => {
  it('drops the retired kicker and orange underline', () => {
    expect(adminHome).not.toMatch(/wsh-eyebrow/);
    expect(wsOverviewCss).not.toMatch(/\.wsh-eyebrow|\.wsh-name::after/);
  });

  it('loads in the shape of the attention list it becomes', () => {
    expect(adminHome).toMatch(/<ul className="wsg-acts" aria-hidden="true">/);
    expect(adminHome).toMatch(/wsg-act"[\s\S]*ui-skel ui-skel-text/);
  });
});
