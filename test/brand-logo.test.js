import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The CLOR logo and app icons: the brand pack (14 Nov 2026), used verbatim. Kept from the retired red-brand test. */
const read = (f) => readFileSync(f, 'utf8');

describe('the logo is the CL frame and the pack\'s letters (14 Nov 2026)', () => {
  it('every app subdomain wears the same pack icon, and the links carry a version so browsers drop the old one', () => {
    const icon = read('public/icon.svg');
    for (const app of ['accounting', 'attendance', 'payroll', 'people']) {
      expect(read(`public/icons/${app}.svg`), `${app}.svg`).toBe(icon);
      expect(readFileSync(`public/icons/${app}-192.png`).equals(readFileSync('public/clor-icon-192.png')), `${app}-192.png`).toBe(true);
    }
    const html = read('index.html');
    expect(html).toContain('href="/icon.svg?v=b1"');
    expect(html).toContain("'/icons/people.svg?v=b1'");
    expect(read('website/index.html')).toContain('href="/brand/favicon.svg?v=b1"');
  });

  const logo = read('packages/ui/src/components/brand/ClorLogo.jsx');
  const mark = read('packages/ui/src/components/brand/ClorMark.jsx');
  const paths = read('packages/ui/src/components/brand/logoPaths.js');

  it('every shape is an outlined path from the brand pack, so no font is needed', () => {
    expect(() => read('packages/ui/src/components/brand/clorPaths.js')).toThrow();
    expect(paths).toContain('export const SYMBOL_ARC_D');
    expect(paths).toContain('export const SYMBOL_BRACKET_D');
    expect(paths).toContain('export const LETTERS');
    expect(logo).toContain('LETTERS');
    expect(logo).not.toMatch(/fontWeight: 900/);
    /* the dot in the C, and the A badge that followed it, are both gone */
    expect(paths).not.toContain('BADGE_D');
    expect(paths).not.toContain('export const DOT');
    expect(paths).not.toContain('DESC_D');
    /* the icon is the frame alone, not a letter */
    expect(mark).toContain('SYMBOL_ARC_D');
    expect(mark).toContain('SYMBOL_BRACKET_D');
    expect(mark).not.toMatch(/\bC_D\b/);
  });

  it('the ink is graphite and the bracket answers it in blaze orange', () => {
    expect(mark).toContain('var(--logo-mark-orange, 255 84 0)');
    expect(mark).toContain('var(--logo-mark-slate, 32 35 41)');
    expect(mark).toMatch(/ink = color \|\| INK/);
    expect(mark).toMatch(/accent = color \|\| ORANGE/);
    expect(logo).toMatch(/ink = color \|\| INK/);
    expect(logo).toMatch(/accent = color \|\| ORANGE/);
    expect(mark).not.toContain('92 10 22');   /* oxblood gone */
    expect(mark).not.toContain('245 166 35'); /* marigold gone */
    const index = read('packages/ui/src/index.css');
    expect(index).not.toContain('--logo-mark-slate: 15 23 42');
    expect(index).toContain('--logo-mark-slate: 32 35 41');
  });

  it('the orange appears once in the word: the O\'s lower-left quarter', () => {
    const accents = (paths.match(/accent:/g) || []).length;
    expect(accents).toBe(1);
    expect(paths).toContain("accent: 'M0 60V100H48A48 48 0 0 1 0.67 60Z'");
    /* the lockup is the frame then the word, and the stacked one sits the frame over it */
    expect(paths).toContain('export const HORIZONTAL');
    expect(paths).toContain('export const STACKED');
    expect(logo).toMatch(/variant === 'stacked' \? STACKED/);
  });

  it('nothing draws the retired C-tick any more, and the tab icon is the frame on graphite', () => {
    expect(() => read('packages/ui/src/components/brand/ClorTick.jsx')).toThrow();
    const icon = read('public/icon.svg');
    expect(icon).toContain('#FF5400');
    expect(icon).toContain('#202329');
    expect(icon).not.toContain('#C8102E');
    expect(icon).not.toContain('M74.04 25.96');
    /* a full-bleed square cannot also be the "any" icon: the pack ships both */
    const manifest = JSON.parse(read('public/manifest.webmanifest'));
    expect(manifest.icons.some((i) => i.purpose === 'any')).toBe(true);
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(manifest.icons.every((i) => i.purpose !== 'any maskable')).toBe(true);
  });
});
