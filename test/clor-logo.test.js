import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* The CLOR logo (owner's master, 5 Nov 2026): orange ribbon C with a centre dot, then CLOR with an orange O. */
const read = (f) => readFileSync(f, 'utf8');
const paths = read('packages/ui/src/components/brand/clorPaths.js');
const logo = read('packages/ui/src/components/brand/ClorLogo.jsx');
const mark = read('packages/ui/src/components/brand/ClorMark.jsx');

describe('the CLOR logo', () => {
  it('draws the ribbon, the dot and CLOR from outlines, never type', () => {
    for (const k of ['GLYPH', 'DOT', 'C', 'L', 'O', 'R']) expect(paths).toMatch(new RegExp(`export const ${k} = 'M-?[\\d.]`));
    for (const f of [logo, mark]) expect(f).not.toMatch(/<text|fontFamily/);
    for (const f of ['public/logo.svg', 'public/brand/clor-light.svg', 'public/brand/clor-dark.svg', 'public/logo-stacked.svg']) {
      expect(read(f), f).not.toMatch(/<text|font-family/);
    }
  });

  it('the ribbon, dot and O are Blaze orange; the other letters take the ink', () => {
    expect(logo).toMatch(/<g fill=\{accentColor \|\| ACCENT\}>\s*<path d=\{GLYPH\} \/>\s*<path d=\{DOT\} \/>\s*<path d=\{O\} \/>/);
    expect(logo).toMatch(/<g fill=\{color \|\| INK\}>\s*<path d=\{C\} \/>\s*<path d=\{L\} \/>\s*<path d=\{R\} \/>/);
    for (const f of [logo, mark]) expect(f).toContain('rgb(var(--logo-accent, 255 84 0))');
    expect(logo).toContain('rgb(var(--logo-ink, 15 23 42))');
    const css = read('packages/ui/src/index.css');
    expect(css).toMatch(/--logo-ink: 15 23 42; --logo-accent: 255 84 0;/);
    expect(css).toMatch(/--logo-ink: 255 255 255; --logo-accent: 255 84 0;/);
  });

  it('every static logo, favicon and app icon wears the same orange ribbon', () => {
    const glyph = paths.match(/export const GLYPH = '([^']+)'/)[1];
    const files = ['public/icon.svg', 'public/logo.svg', 'public/logo-stacked.svg', 'public/brand/clor-light.svg', 'public/brand/clor-dark.svg', 'public/brand/clor-mark.svg', 'public/brand/clor-mark-dark.svg', 'public/brand/clor-icon.svg'];
    for (const app of ['people', 'accounting', 'payroll', 'attendance']) files.push(`public/icons/${app}.svg`, `public/icons/${app}-maskable.svg`);
    for (const f of files) {
      const svg = read(f);
      expect(svg, f).toContain(glyph);
      expect(svg, f).toContain('fill="#FF5400"');
      for (const old of ['#C8102E', '#5C0A16', '#F5A623']) expect(svg, f).not.toContain(old);
    }
    expect(read('public/logo.svg')).toContain('fill="#0F172A"');
    expect(read('public/brand/clor-dark.svg')).toContain('fill="#FFFFFF"');
  });

  it('every app shows the same favicon in its browser tab', () => {
    expect(read('index.html')).not.toMatch(/icons\/people\.svg/);
  });
});
