/**
 * @vitest-environment node
 *
 * Reads source; renders nothing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The owner's UI rules (8 Nov 2026), People and Attendance only: rows 48px, controls 40px and 44px on a
 * phone, icons 18px in the rail and menu and 16px in buttons and tables, a chart three colours at most.
 * The page stays white. Accounting keeps its own measured 36px baseline.
 */
const people = readFileSync('packages/ui/src/people.css', 'utf8');
const index = readFileSync('packages/ui/src/index.css', 'utf8');
const home = readFileSync('apps/people/src/screens/PeopleOverview.jsx', 'utf8');
const block = people.slice(people.indexOf('UI rules (owner, 8 Nov 2026)'), people.indexOf(' * The employee app (shared with Attendance'));
const SCOPE = ":is([data-palette='sky'], [data-palette='blaze'])";

describe('UI rules, 8 Nov 2026', () => {
  it('is written once, for People and Attendance only', () => {
    expect(block.length).toBeGreaterThan(100);
    expect(block).not.toMatch(/indigo/);
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

  it('gives a chart on People Home three colours, the rest one grey "Other"', () => {
    expect(home).toMatch(/const CHART_COLOURS = 3;/);
    expect(home).not.toMatch(/DEPT_COLOURS/);
    expect(home).toMatch(/'Other'/);
    expect(home).not.toMatch(/\?\? 8\}/);
  });
});
