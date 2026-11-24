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
const peopleCss = readFileSync('packages/ui/src/people.css', 'utf8');
const account = readFileSync('apps/admin/src/screens/AccountOverview.jsx', 'utf8');
const shell = readFileSync('packages/shell/Shell.jsx', 'utf8');
const siteCss = readFileSync('website/src/styles/site.css', 'utf8');
const adminHome = readFileSync('apps/admin/src/screens/AdminHome.jsx', 'utf8');
const wsOverviewCss = readFileSync('apps/admin/src/screens/ws-overview.css', 'utf8');

describe('People Employees, figures after the list', () => {
  it('puts only the one-line count line above the table, the breakdown after it', () => {
    /* Calm register: the count line under the title is allowed; tiles and charts stay in the fold after the list. */
    expect(directory).toMatch(/strip=\{firstRun \|\| tab !== 'directory' \? null : <MetricStrip /);
    expect(directory).toMatch(/return <CountLine label="Workforce counts"/);
    expect(directory).toMatch(/<summary>Show figures<\/summary>/);
    expect(directory.indexOf('<Breakdown')).toBeGreaterThan(directory.indexOf('<DataTable'));
    expect(directory.indexOf('Show figures')).toBeGreaterThan(directory.indexOf('<DataTable'));
  });

  it('does not show a food-preference figure or department tags in Designation', () => {
    expect(directory).not.toMatch(/FOOD_ORDER|label: 'Food'/);
    expect(directory).toMatch(/\{ key: 'designation', label: 'Designation', sortable: true, render: \(r\) => r\.designation \|\| '—' \}/);
  });
});

describe('People Home on a phone', () => {
  it('keeps the primary and folds the three shortcuts behind More', () => {
    expect(home).toMatch(/<div className="people-home-secondary">/);
    expect(home).toMatch(/<MoreButton/);
    expect(peopleCss).toMatch(/\.people-home-more \{ display: none; \}/);
    expect(peopleCss).toMatch(/@media \(max-width: 639px\) \{\s*\.people-home-secondary \{ display: none; \}\s*\.people-home-more \{ display: block; \}/);
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
    expect(shell).toMatch(/<MenuPanel aria-label="Apps" width="19rem"/);
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
