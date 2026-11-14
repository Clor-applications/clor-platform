/**
 * @vitest-environment node
 *
 * Reads source; renders nothing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The owner's UI rules (8 Nov 2026), now Attendance only: rows 48px, controls 40px and 44px on a phone, icons
 * 18px in the rail and menu and 16px in buttons and tables. People moved to the R&D geometry on 14 Nov 2026
 * (rnd.css: 36px controls, 56px rows) and its Home chart to the categorical series, eight colours at most.
 * The page stays white. Accounting keeps its own measured 36px baseline.
 */
const people = readFileSync('packages/ui/src/people.css', 'utf8');
const index = readFileSync('packages/ui/src/index.css', 'utf8');
const home = readFileSync('apps/people/src/screens/PeopleOverview.jsx', 'utf8');
const block = people.slice(people.indexOf('UI rules (owner, 8 Nov 2026)'), people.indexOf(' * The employee app (shared with Attendance'));
const rnd = readFileSync('packages/ui/src/rnd.css', 'utf8');
const SCOPE = "[data-palette='blaze']";

describe('UI rules, 8 Nov 2026', () => {
  it('is written once, for Attendance only', () => {
    expect(block.length).toBeGreaterThan(100);
    expect(block).not.toMatch(/indigo|data-palette='sky'/);
    for (const line of block.split('\n').filter((l) => /\{ [a-z-]+:/.test(l))) {
      expect(line.includes(SCOPE), line).toBe(true);
    }
  });

  it('makes table rows 48px', () => {
    expect(block).toMatch(/\.ui-table\.ui-table tbody tr \{ height: 3rem; \}/);
    expect(block).toMatch(/\.ui-table\.ui-table tbody td \{ padding-block: calc\(0\.375rem - 0\.5px\); \}/);
  });

  it('makes controls 40px, and 44px on a phone', () => {
    expect(block).toMatch(/\.ui-btn\.ui-btn:not\(\.ui-icon-btn, \.ui-btn-sm[^{]*\{ height: 2\.5rem; min-height: 2\.5rem; \}/);
    expect(block).toMatch(/:is\(\.ui-input, \.ui-select\):not\([^{]*\{ min-height: 2\.5rem; \}/);
    expect(block).toMatch(/\.ui-icon-btn\.ui-icon-btn:not\(\.ui-table \*[^{]*\{ width: 2\.5rem; height: 2\.5rem; \}/);
    expect(block).toMatch(/\.ui-choice-chip\.ui-choice-chip \{ height: 2\.5rem;/);
    const phone = block.slice(block.indexOf('@media (max-width: 767px)'));
    expect(phone).toMatch(/min-height: 2\.75rem; min-width: 2\.75rem;/);
    expect(phone).toMatch(/\{ height: 2\.75rem; min-height: 2\.75rem; \}/);
  });

  it('sizes icons 18px in the rail and menu, 16px in buttons and tables', () => {
    expect(block).toMatch(/:is\(\.ui-split-mod, \.ui-split-item, \.ui-nav-item\) > svg:is\(\.ui-glyph, svg\) \{ width: 1\.125rem; height: 1\.125rem;/);
    expect(block).toMatch(/\.ui-table tbody td > svg \{ width: 1rem; height: 1rem;/);
  });

  it('leaves the page ground alone and Accounting on 36px', () => {
    expect(block).not.toMatch(/--page|--bg|--ground|main\.ui-content/);
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
