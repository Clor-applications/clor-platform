/**
 * @vitest-environment node
 *
 * Reads source; renders nothing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The owner's UI rules of 8 Nov 2026 (48px rows, 40px controls) are retired. Attendance and People moved to the R&D geometry on 14 Nov 2026
 * (rnd.css: 36px controls, 56px rows), and People Home's chart moved to the categorical series, eight colours at most.
 * The page stays white. Accounting keeps its own measured 36px baseline.
 */
const people = readFileSync('packages/ui/src/people.css', 'utf8');
const index = readFileSync('packages/ui/src/index.css', 'utf8');
const home = readFileSync('apps/people/src/screens/PeopleOverview.jsx', 'utf8');
const rnd = readFileSync('packages/ui/src/rnd.css', 'utf8');

describe('UI rules, 8 Nov 2026', () => {
  it('is gone: Attendance takes the R&D geometry like People (14 Nov 2026)', () => {
    expect(people).not.toMatch(/UI rules \(owner, 8 Nov 2026\)/);
    expect(people).not.toMatch(/data-palette='blaze'\][^{]*\.ui-btn\.ui-btn[^{]*\{ height: 2\.5rem/);
    expect(index).toMatch(/\.ui-btn \{[^}]*min-height: 2\.25rem;/);
  });

  it('leaves People on the R&D geometry: 36px controls and 56px rows from rnd.css', () => {
    expect(rnd).toMatch(/\.ui-btn \{\s*min-height: 2\.25rem;/);
    expect(rnd).toMatch(/\.ui-table tbody td \{[^}]*height: 3\.5rem;/);
  });

  it('gives a chart on People Home the categorical series, eight colours at most, the rest one grey "Other"', () => {
    expect(home).toMatch(/const CHART_COLOURS = 8;/);
    expect(home).not.toMatch(/DEPT_COLOURS/);
    expect(home).toMatch(/'Other'/);
    expect(home).not.toMatch(/\?\? 8\}/);
  });

  it('gives a People report chart three colours too, picked on the server and held by the component', () => {
    const chart = readFileSync('apps/people/src/components/ReportChart.jsx', 'utf8');
    const server = readFileSync('server/src/services/people/reports.ts', 'utf8');
    expect(chart).toMatch(/export const CHART_COLOURS = 3;/);
    expect(chart).toMatch(/s\.other \|\| i >= CHART_COLOURS \? 0 : i \+ 1/);
    expect(server).toMatch(/const CHART_COLOURS = 3;/);
    expect(server).toMatch(/'Other'/);
    /* Drawn with the series tokens, and no chart library. */
    expect(chart).not.toMatch(/echarts|recharts|#[0-9a-fA-F]{6}/);
  });
});
