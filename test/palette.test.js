import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APPS } from '../packages/shell/registry';

/**
 * One accent, one palette (frontend-redesign-2026-11-15.md §6.3).
 *
 * An app does not choose colours any more. Every app draws in the platform's
 * palette — graphite chrome, one orange accent — and identifies itself only by
 * the hue inside its glyph. Accounting keeps its indigo until the object
 * grammar lands (phase 4); it is the one hold-out, named here so it cannot
 * quietly become two.
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

  it('identity hues are the redesign set, not the old per-app brands', () => {
    for (const hue of ['--app-accounting: 15 82 87', '--app-payroll: 74 58 107', '--app-attendance: 138 75 42', '--app-people: 107 90 22']) {
      expect(rnd, hue).toContain(hue);
    }
  });

  it('identity hues are only read by the app mark, never as a surface', () => {
    const uses = [...rnd.matchAll(/^.*var\(--app-(?!bg\b)[a-z]+.*$/gm)].map((m) => m[0].trim());
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line).toMatch(/\.ui-app-switch-mark|--app-color/);
  });

  it('the old per-portal accents are gone: no forest, moss or violet primary', () => {
    expect(rnd).not.toMatch(/data-portal='ops'/);
    expect(rnd).not.toMatch(/\[data-app='attendance'\]\s*\{[^}]*--act:/);
    expect(rnd).not.toMatch(/--act: 91 71 196|--act: 90 107 31|--act: 1 93 71/);
  });

  it('People is styled by the app it is, not by a palette it wears', () => {
    expect(people).toContain("[data-app='people']");
    expect(people).not.toContain("[data-palette='sky']");
    /* Its rules stay inside People: no sibling app is named in its stylesheet. */
    expect(people).not.toMatch(/\[data-app='(?:accounting|payroll|attendance)'\]/);
  });

  it('the accent is the fill that carries a label, and the mark that does not', () => {
    expect(rnd).toMatch(/--act: 201 80 0;/);
    expect(rnd).toMatch(/--marker: 255 107 0;/);
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

  it('the accent as a fill carries a white label', () => {
    expect(ratio(token('act'), token('on-brand'))).toBeGreaterThanOrEqual(4.5);
  });
});
