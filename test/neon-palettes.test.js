import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* One neon per app on pure white (owner, 5–6 Nov 2026): Workspace orange, People coral, Attendance amber, Payroll cyan. Accounting keeps its indigo. */
const css = readFileSync('packages/ui/src/index.css', 'utf8');
const people = readFileSync('packages/ui/src/people.css', 'utf8');
const blockAt = (src, head) => src.slice(src.indexOf(head), src.indexOf('}', src.indexOf(head)));
const token = (block, name) => (block.match(new RegExp(`--${name}: ([\\d ]+);`)) || [])[1];
const lum = (rgb) => rgb.split(' ').map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

const APPS = {
  workspace: { block: blockAt(css, '/* Blaze Orange'), neon: '255 84 0', hover: '224 72 0', ink: '186 57 0', tint: '255 243 237', stroke: '255 212 194' },
  attendance: { block: blockAt(css, '/* Solar Amber'), neon: '234 179 8', hover: '202 138 4', ink: '133 77 14', tint: '254 252 232', stroke: '254 240 138', onBrand: '15 23 42' },
  payroll: { block: blockAt(css, '/* Electric Cyan'), neon: '0 163 255', button: '0 121 191', ink: '0 109 178', tint: '237 248 255', stroke: '186 230 255' },
  people: { block: blockAt(people, "html:root[data-palette='sky']:not([data-theme='dark']),\nhtml:root:not([data-theme='dark']) [data-palette='sky'] {\n  --neon"), neon: '255 19 86', ink: '184 0 54', tint: '255 240 244', stroke: '255 199 213' },
};

describe('pure white and neon', () => {
  for (const [app, p] of Object.entries(APPS)) {
    it(`${app}: neon action, deep ink, 5% tint, stroke, on white with slate text`, () => {
      expect(token(p.block, 'neon')).toBe(p.neon);
      expect(token(p.block, 'btn-primary-bg')).toBe(p.button || p.neon);
      /* White words on the primary button: AA for Payroll's deeper cyan and cobalt; coral and tangerine are the owner's large-text neons. */
      if (p.button) expect(contrast('255 255 255', p.button)).toBeGreaterThan(4.5);
      if (p.hover) expect(token(p.block, 'btn-primary-hover')).toBe(p.hover);
      /* Amber takes slate words: white on #EAB308 is 2.1:1. */
      expect(token(p.block, 'on-brand') || '255 255 255').toBe(p.onBrand || '255 255 255');
      if (p.onBrand) expect(contrast(p.onBrand, p.neon)).toBeGreaterThan(4.5);
      expect(token(p.block, 'brand-ink')).toBe(p.ink);
      expect(token(p.block, 'brand-soft')).toBe(p.tint);
      expect(token(p.block, 'brand-border')).toBe(p.stroke);
      expect(token(p.block, 'choice')).toBe(p.tint);
      expect(token(p.block, 'on-choice')).toBe(p.ink);
      expect(token(p.block, 'app-bg')).toBe('255 255 255');
      expect(token(p.block, 'fg-heading')).toBe('15 23 42');
      expect(token(p.block, 'border')).toBe('226 232 240');
      /* The ink on its own tint is the selected and badge pair: it must read (AA). */
      expect(contrast(p.ink, p.tint)).toBeGreaterThan(4.5);
    });
  }

  it('attendance: amber is a fill, never words — every token that colours text is the ink #854D0E or slate', () => {
    const a = APPS.attendance;
    /* Amber on white is 1.9:1: no word may take it. */
    expect(contrast(a.neon, '255 255 255')).toBeLessThan(3);
    for (const name of ['brand-ink', 'brand-panel', 'link', 'hero-hi', 'doc-link', 'on-choice', 'st-all-ink', 'ws-nav-selected-ink', 'oxblood', 'rail-blaze-ink']) {
      const v = token(a.block, name);
      expect(v, name).not.toBe(a.neon);
      expect(contrast(v, '255 255 255'), name).toBeGreaterThan(4.5);
    }
    /* The dashboard's small mark for today takes the ink; a 5px amber dot on white does not read. */
    expect(css).toMatch(/html:root\[data-palette='blaze'\]:not\(\[data-theme='dark'\]\) \.ui-week li\[data-today\] \.ui-week-day::after \{ background: rgb\(var\(--brand-ink\)\); \}/);
  });

  it('the halo, card and glow rules skip Accounting and the dark theme', () => {
    const shared = css.slice(css.indexOf('Pure white and neon (owner, 5 Nov 2026)'));
    for (const line of shared.split('\n').filter((l) => /^html:root.*\{/.test(l) && /#main-content \{|\.ui-card[,)]|ui-btn-primary/.test(l))) {
      expect(line).toContain(":not([data-theme='dark']):not([data-palette='indigo'])");
    }
    expect(shared).toMatch(/radial-gradient\(36rem circle at 100% 0%, rgb\(var\(--neon\) \/ 0\.14\)/);
    expect(shared).toMatch(/box-shadow: 0 4px 14px rgb\(var\(--neon\) \/ 0\.32\)/);
  });
});

/* Two faces, one type scale and the two-tier sidebar outside Accounting (owner, 6 Nov 2026). */
describe('type and sidebar', () => {
  const tail = css.slice(css.indexOf('Two faces and one type scale'));
  it('Plus Jakarta Sans for words, JetBrains Mono for figures, Accounting left on Inter', () => {
    expect(css).toContain("@import '@fontsource-variable/jetbrains-mono';");
    expect(tail).toMatch(/--font-ui: 'Plus Jakarta Sans Variable'/);
    expect(tail).toMatch(/--font-num: 'JetBrains Mono Variable'/);
    for (const cls of ['.tabular-nums', '.ui-amount', '.ui-col-amount', '.ui-metric-value', '.ui-kpi', '.soft-band-stat-value']) expect(tail).toContain(cls);
    for (const line of tail.split('\n').filter((l) => /^html:root/.test(l))) expect(line).toContain(":not([data-palette='indigo'])");
  });
  it('the type scale: title 20/26 800, card header 14/20 700, metric 22/26 800, badge 10px caps', () => {
    expect(tail).toMatch(/font-size: 1\.25rem !important; line-height: 1\.625rem !important; font-weight: 800 !important; letter-spacing: -0\.5px/);
    expect(tail).toMatch(/font-size: 0\.875rem !important; line-height: 1\.25rem !important; font-weight: 700/);
    expect(tail).toMatch(/font-size: 1\.375rem !important; line-height: 1\.625rem !important; font-weight: 800/);
    expect(tail).toMatch(/font-size: 0\.625rem !important;[^}]*text-transform: uppercase/);
  });
  it('rail 64px with a 3px neon bar on a 5% wash; screens 180px, the open one bold on the tint', () => {
    expect(tail).toMatch(/\.ui-split-rail:not\(\.ui-nav-sheet-split \*\) \{ width: 4rem !important/);
    expect(tail).toMatch(/background: rgb\(var\(--neon\) \/ 0\.05\) !important/);
    expect(tail).toMatch(/width: 3px !important;[^}]*background: rgb\(var\(--neon\)\) !important/);
    expect(tail).toMatch(/\.ui-split-panel:not\(\.ui-nav-sheet-split \*\) \{ width: 11\.25rem !important/);
    expect(tail).toMatch(/\.ui-split-item\[aria-current='page'\] \{\n  background: rgb\(var\(--blush\)\) !important;\n  color: rgb\(var\(--oxblood\)\) !important;\n  font-weight: 700/);
  });
});
