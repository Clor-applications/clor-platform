import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* One neon per app on pure white (owner, 5 Nov 2026). Accounting keeps its indigo. */
const css = readFileSync('packages/ui/src/index.css', 'utf8');
const people = readFileSync('packages/ui/src/people.css', 'utf8');
const blockAt = (src, head) => src.slice(src.indexOf(head), src.indexOf('}', src.indexOf(head)));
const token = (block, name) => (block.match(new RegExp(`--${name}: ([\\d ]+);`)) || [])[1];
const lum = (rgb) => rgb.split(' ').map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

const APPS = {
  workspace: { block: blockAt(css, '/* Hyper Cobalt'), neon: '0 82 255', ink: '0 56 184', tint: '237 243 255', stroke: '204 224 255' },
  attendance: { block: blockAt(css, '/* Cyber Tangerine'), neon: '255 84 0', ink: '186 57 0', tint: '255 243 237', stroke: '255 212 194' },
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

  it('the halo, card and glow rules skip Accounting and the dark theme', () => {
    const shared = css.slice(css.indexOf('Pure white and neon (owner, 5 Nov 2026)'));
    for (const line of shared.split('\n').filter((l) => /^html:root.*\{/.test(l) && /main-content|ui-card|ui-btn-primary/.test(l))) {
      expect(line).toContain(":not([data-theme='dark']):not([data-palette='indigo'])");
    }
    expect(shared).toMatch(/radial-gradient\(36rem circle at 100% 0%, rgb\(var\(--neon\) \/ 0\.14\)/);
    expect(shared).toMatch(/box-shadow: 0 4px 14px rgb\(var\(--neon\) \/ 0\.32\)/);
  });
});
