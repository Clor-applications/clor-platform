import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APPS } from '../packages/shell/registry';

/**
 * Per-app colours (owner, 15 Nov 2026; supersedes the one-accent rule of
 * frontend-redesign-2026-11-15.md §6.3).
 *
 * The CLOR logo and gate pages stay Blaze orange. Inside an app the shell sets
 * data-app and the app's own block paints primary, selection, marker and a
 * second colour: Workspace graphite, People magenta, Payroll deeper blue,
 * Attendance amber. Books keeps its palette attribute (indigo) and wears navy
 * with an orange second colour.
 */
const rnd = readFileSync('packages/ui/src/rnd.css', 'utf8');
const people = readFileSync('packages/ui/src/people.css', 'utf8');


describe('one palette', () => {
  it('no app declares a palette except Accounting, which is phase 4', () => {
    const wearing = APPS.filter((a) => a.palette).map((a) => `${a.id}:${a.palette}`);
    expect(wearing).toEqual(['accounting:indigo']);
  });

  it('every app declares an identity hue in rnd.css', () => {
    for (const a of APPS) expect(rnd, a.id).toContain(`--app-${a.id}:`);
  });

  it('Indigo (Books) wears the red brand, with its own blue header rows and panel, and leaves the CLOR logo alone', () => {
    const books = readFileSync('packages/ui/src/index.css', 'utf8');
    /* Owner, 15 Nov 2026: Books leaves Direction D's indigo/lilac for the
       in-app red palette; the shared red block paints it. Books keeps the
       pale blue list header rows and its clor.in blue for the screens panel. */
    expect(books).toContain(":root:where([data-palette='sky'], [data-palette='indigo']) {");
    const start = books.indexOf("Books (data-palette='indigo') on the red brand");
    expect(start).toBeGreaterThan(-1);
    const block = books.slice(start, books.indexOf('@layer base', start));
    expect(block).toMatch(/--heading-bg: 255 255 255;/);
    expect(block).toMatch(/--nav-panel-mark: 61 79 224;/);
    /* No second brand: the action colour comes from the red block. */
    expect(block).not.toMatch(/--brand:|--lilac|--cotton/);
    expect(block).not.toMatch(/--logo-(mark|dot):/);
    expect(block).not.toMatch(/\[data-app=/);
    /* The light values must not outrank the dark theme's own tokens. */
    expect(block).toMatch(/^:root:where\(\[data-palette='indigo'\]\),$/m);
  });

  /* Owner, 15 Nov 2026: Workspace graphite, People magenta, Payroll deeper blue, Attendance amber, Books navy. */
  it('identity hues are the per-app set chosen 15 Nov', () => {
    for (const hue of ['--app-accounting: 35 42 102', '--app-payroll: 0 106 158', '--app-attendance: 168 90 0', '--app-people: 162 28 175']) {
      expect(rnd, hue).toContain(hue);
    }
  });

  it('identity hues are only read by the app mark, never as a surface', () => {
    const uses = [...rnd.matchAll(/^.*var\(--app-(?!bg\b)[a-z]+.*$/gm)].map((m) => m[0].trim());
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line).toMatch(/\.ui-app-switch-mark|--app-color/);
  });

  it('the old moss and violet primaries are gone; Ops alone takes forest (owner, 21 Nov 2026)', () => {
    expect(rnd).not.toMatch(/--act: 91 71 196|--act: 90 107 31/);
    const ops = rnd.match(/\[data-portal='ops'\]:not\(\[data-palette='indigo'\]\)\s*\{([^}]*)\}/);
    expect(ops).not.toBeNull();
    expect(ops[1]).toMatch(/--act: 1 93 71;/);
    expect(ops[1]).toMatch(/--marker: 1 93 71;/);
    expect(rnd.match(/--act: 1 93 71;/g)).toHaveLength(1);
  });

  /* Owner, 15 Nov 2026: each app has its own primary and a second colour; the CLOR logo stays Blaze. */
  const appBlock = (id) => {
    const m = rnd.match(new RegExp(`\\[data-app='${id}'\\]:not\\(\\[data-palette='indigo'\\]\\)\\s*\\{([^}]*)\\}`));
    return m ? m[1] : null;
  };
  const rgb = (block, name) => {
    const m = block.match(new RegExp(`--${name}:\\s*(\\d+) (\\d+) (\\d+);`));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  for (const [id, act] of [['admin', '32 35 41'], ['people', '162 28 175'], ['payroll', '0 106 158'], ['attendance', '168 90 0']]) {
    it(`${id} declares its own primary, selection wash and second colour`, () => {
      const block = appBlock(id);
      expect(block, id).not.toBeNull();
      expect(block).toContain(`--act: ${act};`);
      for (const t of ['act-hover', 'act-ink', 'marker', 'tint', 'act-2']) expect(rgb(block, t), `${id} --${t}`).not.toBeNull();
    });
  }

  it('Books wears navy with an orange second colour, and no red', () => {
    const books = readFileSync('packages/ui/src/index.css', 'utf8');
    const start = books.indexOf(":root[data-palette='indigo'],");
    expect(start).toBeGreaterThan(-1);
    const block = books.slice(start, books.indexOf('}', start));
    expect(block).toMatch(/--red: 35 42 102;/);
    expect(block).toMatch(/--brand-ink: 35 42 102;/);
    expect(block).toMatch(/--choice: 255 107 0;/);
    expect(block).toMatch(/--nav-panel-mark: 255 107 0;/);
    expect(block).not.toMatch(/165 13 38|138 11 32/);
  });

  it('People is styled by the app it is, not by a palette it wears', () => {
    expect(people).toContain("[data-app='people']");
    expect(people).not.toContain("[data-palette='sky']");
    /* Its rules stay inside People: no sibling app is named in its stylesheet. */
    expect(people).not.toMatch(/\[data-app='(?:accounting|payroll|attendance)'\]/);
  });

  it('the platform accent (gates, Workspace marks) stays Blaze, the logo orange #FF5400 (owner, 21 Nov 2026)', () => {
    expect(rnd).toMatch(/--act: 201 80 0;/);
    expect(rnd).toMatch(/--marker: 255 84 0;/);
    expect(rnd).not.toMatch(/255 107 0/);
    expect(rnd).toMatch(/--on-brand: 255 255 255;/);
  });

  /* Owner, 15 Nov 2026: "only light mode, no grey or any color, pure white background". */
  it('light only: no dark theme block', () => {
    expect(rnd).not.toMatch(/\[data-theme='dark'\]/);
  });

  it('every ground is pure white, in every app and in Books', () => {
    const books = readFileSync('packages/ui/src/index.css', 'utf8');
    const red = books.slice(books.indexOf(":root:where([data-palette='sky'], [data-palette='indigo']) {"));
    for (const token of ['--app-bg', '--surface-sunken', '--soft-panel', '--doc-section', '--heading-bg', '--tint', '--panel']) {
      expect(rnd, token).toMatch(new RegExp(`${token}: 255 255 255;`));
    }
    for (const token of ['--app-bg', '--surface-sunken', '--doc-section', '--heading-bg', '--page-heading-bg', '--rail-active']) {
      expect(red.slice(0, red.indexOf('\n}')), `Books ${token}`).toMatch(new RegExp(`${token}: 255 255 255;`));
    }
  });
});

describe('text clears AA on its own ground (§6.2)', () => {
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

  const light = rnd.slice(0, rnd.indexOf('--blaze: 255 122 51;'));
  const token = (name) => {
    const m = light.match(new RegExp(`--${name}:\\s*(\\d+) (\\d+) (\\d+)`));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };

  const pairs = [
    ['fg', 'app-bg'], ['fg-muted', 'app-bg'], ['fg-subtle', 'app-bg'],
    ['act-ink', 'app-bg'], ['act-ink', 'tint'], ['act-ink', 'surface'],
    ['pos', 'pos-soft'], ['warn-ink', 'warn-soft'], ['neg', 'neg-soft'], ['info', 'info-soft'],
    ['neutral-ink', 'neutral-soft'],
  ];

  for (const [ink, ground] of pairs) {
    it(`${ink} on ${ground} clears 4.5:1`, () => {
      const fg = token(ink); const bg = token(ground);
      expect(fg, ink).not.toBeNull();
      expect(bg, ground).not.toBeNull();
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const id of ['admin', 'people', 'payroll', 'attendance']) {
    it(`${id}: white on its primary, and its ink on its selection wash, clear 4.5:1`, () => {
      const m = rnd.match(new RegExp(`\\[data-app='${id}'\\]:not\\(\\[data-palette='indigo'\\]\\)\\s*\\{([^}]*)\\}`));
      const get = (n) => m[1].match(new RegExp(`--${n}:\\s*(\\d+) (\\d+) (\\d+);`)).slice(1).map(Number);
      expect(ratio(get('act'), [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(get('act-hover'), [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(get('act-ink'), get('tint'))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('the accent as a fill carries a white label', () => {
    expect(ratio(token('act'), token('on-brand'))).toBeGreaterThanOrEqual(4.5);
  });
});
