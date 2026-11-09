import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APPS } from '../packages/shell/registry';

/**
 * The Blaze palette is shared, not Attendance's own styling: an app opts in
 * with `palette: 'blaze'` in its manifest and the shell sets data-palette.
 * Attendance wears Blaze; People wears Sky (owner, 28 Oct 2026; Rose before that, D-01)
 * on Accounting's layout; Payroll wears Electric Cyan (`payroll`, neon brand, 5–6 Nov 2026);
 * Accounting keeps Direction D's indigo (owner, 3 Nov 2026: "do not change color to accounting").
 */
const css = readFileSync('packages/ui/src/index.css', 'utf8') + readFileSync('packages/ui/src/people.css', 'utf8');

describe('shared palettes', () => {
  it('Attendance wears Blaze, People wears Sky, Accounting keeps Indigo, Payroll wears its own cyan', () => {
    const byPalette = {};
    for (const a of APPS.filter((x) => x.palette)) (byPalette[a.palette] ||= []).push(a.id);
    expect(byPalette).toEqual({ blaze: ['attendance'], sky: ['people'], indigo: ['accounting'], payroll: ['payroll'] });
  });

  it('Indigo is Direction D as it was, keyed on the palette, and leaves the CLOR logo alone', () => {
    const start = css.indexOf('The Indigo palette');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('@layer base', start));
    expect(block).toMatch(/--indigo: 35 42 102;/);
    expect(block).toMatch(/--brand: var\(--indigo\);/);
    expect(block).toMatch(/--brand-soft: var\(--lilac\);/);
    expect(block).toMatch(/--app-bg: var\(--cotton\);/);
    /* Money out stays red there; the red brand's ink-with-a-minus is for the other apps. */
    expect(block).toMatch(/--money-out: var\(--neg\);/);
    expect(block).not.toMatch(/--logo-(mark|dot):/);
    expect(block).not.toMatch(/\[data-app=/);
    /* The light values must not outrank the dark theme's own tokens. */
    expect(block).toMatch(/^:root:where\(\[data-palette='indigo'\]\),$/m);
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

  /* Owner, 9 Nov 2026: "use same icons which is used in people everywhere except books". The colour set (Attendance,
     Workspace) and Payroll's plain Lucide gave way to People's two-tone marks and Fluent line icons; Accounting keeps Lucide. */
  it('every app but Accounting draws in the People icon family; Accounting keeps the line set', () => {
    const live = APPS.filter((a) => a.available);
    expect(live.filter((a) => a.iconSet === 'duo' && a.lineIcons === 'fluent').map((a) => a.id).sort()).toEqual(['admin', 'attendance', 'payroll', 'people']);
    const books = live.find((a) => a.id === 'accounting');
    expect(books.iconSet).toBeUndefined();
    expect(books.lineIcons).toBeUndefined();
    expect(APPS.filter((a) => a.iconSet === 'color')).toEqual([]);
  });

  it('colour icons keep their own colours: nothing tints them with the palette', () => {
    expect(css).not.toMatch(/\.ui-color-icon[^{]*\{[^}]*fill:/);
    expect(css).not.toMatch(/--duo-fill/);
  });
});
