import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APPS } from '../packages/shell/registry';

/**
 * The Blaze palette is shared, not Attendance's own styling: an app opts in
 * with `palette: 'blaze'` in its manifest and the shell sets data-palette.
 * Attendance wears Blaze; People wears Rose (owner, 24 Oct 2026, docs/people/08 D-01)
 * on Accounting's layout; Accounting and Payroll keep the platform's colours.
 */
const css = readFileSync('packages/ui/src/index.css', 'utf8');

describe('shared palettes', () => {
  it('Attendance wears Blaze, People wears Rose; Accounting and Payroll keep the platform colours', () => {
    const byPalette = {};
    for (const a of APPS.filter((x) => x.palette)) (byPalette[a.palette] ||= []).push(a.id);
    expect(byPalette).toEqual({ blaze: ['attendance'], rose: ['people'] });
  });

  /* Owner, 24 Oct 2026: People keeps Accounting's layout, type scale and radii. A palette
     may set colour tokens and answer the !important graphite controls; it may not
     restate type or geometry, and nothing may be scoped to the People app itself. */
  it('People has no app-scoped styling: its look is the rose palette on the shared layout', () => {
    expect(css).not.toMatch(/\[data-app='people'\]/);
    const start = css.indexOf('The Rose palette');
    expect(start).toBeGreaterThan(-1);
    const rose = css.slice(start);
    const roseRules = rose.match(/\[data-palette='rose'\][^{]*\{[^}]*\}/g) || [];
    for (const rule of roseRules) {
      expect(rule).not.toMatch(/font-size|line-height|border-radius|font-weight/);
    }
  });

  it('every palette an app names exists in the shared stylesheet', () => {
    for (const a of APPS.filter((x) => x.palette)) {
      expect(css, a.id).toContain(`[data-palette='${a.palette}']`);
    }
  });

  it('Blaze colours are keyed on the palette, not on one app', () => {
    const start = css.indexOf('The Blaze palette');
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start)).not.toMatch(/\[data-app='attendance'\]/);
  });

  it('Attendance and People draw in the colour icon set; the others do not', () => {
    expect(APPS.filter((a) => a.iconSet === 'color').map((a) => a.id).sort()).toEqual(['attendance', 'people']);
  });

  it('colour icons keep their own colours: nothing tints them with the palette', () => {
    expect(css).not.toMatch(/\.ui-color-icon[^{]*\{[^}]*fill:/);
    expect(css).not.toMatch(/--duo-fill/);
  });
});
