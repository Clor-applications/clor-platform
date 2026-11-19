/**
 * @vitest-environment node
 *
 * The Employees list is for finding a person. Figures sit behind the list, not above it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const directory = readFileSync('apps/people/src/workforce/Directory.jsx', 'utf8');
const attendance = readFileSync('packages/ui/src/timeOff/TeamAttendance.jsx', 'utf8');
const home = readFileSync('apps/people/src/screens/PeopleOverview.jsx', 'utf8');
const peopleCss = readFileSync('packages/ui/src/people.css', 'utf8');

describe('People Employees, figures after the list', () => {
  it('does not put the figure strip above the table', () => {
    expect(directory).not.toMatch(/\bstrip=\{/);
    expect(directory).toMatch(/<summary>Show figures<\/summary>/);
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
