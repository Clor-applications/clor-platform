import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APPS } from '../packages/shell/registry';

/**
 * The Blaze palette is shared, not Attendance's own styling: an app opts in
 * with `palette: 'blaze'` in its manifest and the shell sets data-palette.
 * Attendance wears Blaze; People wears Sky (owner, 28 Oct 2026; Rose before that, D-01)
 * on Accounting's layout; Accounting and Payroll keep the platform's colours.
 */
const css = readFileSync('packages/ui/src/index.css', 'utf8') + readFileSync('packages/ui/src/people.css', 'utf8');

describe('shared palettes', () => {
  it('Attendance wears Blaze, People wears Sky; Accounting and Payroll keep the platform colours', () => {
    const byPalette = {};
    for (const a of APPS.filter((x) => x.palette)) (byPalette[a.palette] ||= []).push(a.id);
    expect(byPalette).toEqual({ blaze: ['attendance'], sky: ['people'] });
  });

  /* People has its own visual rhythm while the palette remains the boundary
     that prevents styles leaking into Accounting, Payroll or Attendance. */
  it('People styles stay within the sky palette', () => {
    expect(css).not.toMatch(/\[data-app='people'\]/);
    const start = css.indexOf('The Sky palette');
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start)).not.toMatch(/\[data-app='(?:accounting|payroll|attendance)'\]/);
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

  /* The Workspace joined them in its redesign (W-R2: Fluent colour icons, as Attendance draws). */
  /* Owner, 28 Oct 2026: People moved to Phosphor line icons, so rose stays the only colour in its chrome. */
  /* People drew in the colour set on 28 Oct 2026, then moved to its brand two-tone set (iconSet 'duo') on 29 Oct. */
  it('Attendance and the Workspace draw in the colour icon set; the others do not', () => {
    expect(APPS.filter((a) => a.iconSet === 'color').map((a) => a.id).sort()).toEqual(['admin', 'attendance']);
  });

  it('colour icons keep their own colours: nothing tints them with the palette', () => {
    expect(css).not.toMatch(/\.ui-color-icon[^{]*\{[^}]*fill:/);
    expect(css).not.toMatch(/--duo-fill/);
  });
});
