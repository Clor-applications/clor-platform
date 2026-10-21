import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APPS } from '../packages/shell/registry';

/**
 * The Blaze palette is shared, not Attendance's own styling: an app opts in
 * with `palette: 'blaze'` in its manifest and the shell sets data-palette.
 * Only Attendance has opted in; the others keep the platform's colours until
 * they choose to.
 */
const css = readFileSync('packages/ui/src/index.css', 'utf8');

describe('shared palettes', () => {
  it('only Attendance wears Blaze for now', () => {
    const wearing = APPS.filter((a) => a.palette === 'blaze').map((a) => a.id);
    expect(wearing).toEqual(['attendance']);
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

  it('only Attendance draws in the colour icon set for now', () => {
    expect(APPS.filter((a) => a.iconSet === 'color').map((a) => a.id)).toEqual(['attendance']);
  });

  it('colour icons keep their own colours: nothing tints them with the palette', () => {
    expect(css).not.toMatch(/\.ui-color-icon[^{]*\{[^}]*fill:/);
    expect(css).not.toMatch(/--duo-fill/);
  });
});
