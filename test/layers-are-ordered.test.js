/**
 * @vitest-environment node
 *
 * Overlays stack in a decided order, not in the order people reached for a
 * bigger number.
 *
 * Sixteen z-index values were in use, topping out at 9999 — and a row-action
 * menu at 9999 painted over an open dialog, measured in the browser. It never
 * needed 9999: nothing in the shell creates a stacking context, so a fixed
 * overlay only had to clear a sticky table header at 20, and reached for the
 * ceiling because no scale existed to consult.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(root, 'packages/ui/src/index.css'), 'utf8');

const layer = (name) => {
  const m = css.match(new RegExp(`--z-${name}:\\s*(-?\\d+)`));
  if (!m) throw new Error(`--z-${name} is not defined`);
  return Number(m[1]);
};

/* The order the product depends on, coarsest first. */
const ORDER = [
  'base',           // a table head against its own rows
  'sticky',         // sticky headers and toolbars
  'header',         // the app header
  'popover',        // menus, pickers, row actions
  'drawer',         // side drawers, mobile nav
  'drawer-popover', // a menu opened inside a drawer
  'modal',          // dialogs
  'modal-popover',  // a menu opened inside a dialog
  'toast',          // notifications outrank what caused them
  'palette',        // the command palette reaches over everything
  'tooltip',        // last word, never interactive
];

describe('the layer scale', () => {
  it('is strictly ascending, so the order is decidable', () => {
    const values = ORDER.map(layer);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
  });

  it('puts an ordinary popover below a dialog and a dialog-owned one above it', () => {
    /* The whole point of the two popover layers: a row menu on the page must
       not paint over an open dialog, while the dialog's own select must. */
    expect(layer('popover')).toBeLessThan(layer('modal'));
    expect(layer('modal-popover')).toBeGreaterThan(layer('modal'));
  });

  it('keeps decoration behind content', () => {
    expect(layer('below')).toBeLessThan(0);
  });
});

const sources = () =>
  execSync("git ls-files 'apps/**/*.jsx' 'packages/**/*.jsx' 'apps/accounting/src/*.jsx'", { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('.test.'));

describe('no component escalates on its own', () => {
  it('never reaches for an arbitrary z-index', () => {
    /* `z-[9999]` and friends. A bracketed z in Tailwind is a number nobody
       agreed to; the tokens are in index.css and they are the whole scale. */
    const offenders = [];
    for (const file of sources()) {
      const lines = readFileSync(resolve(root, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/z-\[(\d+)\]/g)) {
          /* Below 110 is a local order inside an already-layered ancestor —
             a menu inside the header, which the header's own layer governs. */
          if (Number(m[1]) >= 100) offenders.push(`${relative(root, file)}:${i + 1} z-[${m[1]}]`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('routes every global overlay through a token', () => {
    /* Each of these owns a layer; if one stops naming its token, the scale has
       a hole in it and the next person guesses again. */
    const wired = {
      'packages/ui/src/components/ui/Modal.jsx': '--z-modal',
      'packages/ui/src/components/ui/Drawer.jsx': '--z-drawer',
      'packages/ui/src/components/ui/Toaster.jsx': '--z-toast',
      'packages/ui/src/components/ui/CommandPalette.jsx': '--z-palette',
      'packages/ui/src/components/ui/Popover.jsx': null, // via overlayLayer.js
      'packages/ui/src/components/ui/overlayLayer.js': '--z-modal-popover',
    };
    for (const [file, token] of Object.entries(wired)) {
      const src = readFileSync(resolve(root, file), 'utf8');
      if (token) expect(src, `${file} should name ${token}`).toContain(token);
    }
  });
});
