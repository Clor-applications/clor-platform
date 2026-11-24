/*
 * The Motion kit is switched on app by app (DESIGN.md "Migration" step 6). motion.css must only ever reach an app that
 * has moved, so the apps still on the calm register look exactly as before. People moved first (24 Nov 2026).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync('packages/ui/src/motion.css', 'utf8');
const main = readFileSync('main.jsx', 'utf8');
const MOVED = ['people'];
const PREFIX = ":root:not(#mo):not(#mo2):not(#mo3):not(#mo4)";

/* Every selector of every style rule, with comments, @import, @keyframes bodies and @media wrappers set aside. */
function selectors(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const out = [];
  const re = /([^{}]+)\{[^{}]*\}/g;
  let m;
  while ((m = re.exec(text))) {
    const sel = m[1].replace(/@media[^{]*\{/g, '').trim();
    if (!sel) continue;
    let depth = 0;
    let part = '';
    for (const ch of sel) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) { out.push(part.trim()); part = ''; } else part += ch;
    }
    if (part.trim()) out.push(part.trim());
  }
  return out;
}

describe('Motion kit layer', () => {
  it('loads after every other stylesheet', () => {
    const imports = [...main.matchAll(/import '\.\/packages\/ui\/src\/([a-z]+\.css)'/g)].map((m) => m[1]);
    expect(imports.at(-1)).toBe('motion.css');
  });

  it('reaches only the apps that have moved', () => {
    const list = selectors(css);
    expect(list.length).toBeGreaterThan(20);
    for (const s of list) {
      expect(s.startsWith(PREFIX), s).toBe(true);
      const app = s.slice(PREFIX.length).match(/^\[data-app='([a-z]+)'\]/);
      expect(app && MOVED.includes(app[1]), s).toBe(true);
    }
  });

  it('carries the kit: ink primary, selection violet, three radii, flat page, TASA Orbiter and Geist Mono', () => {
    expect(css).toMatch(/--act: 124 58 237;/);
    expect(css).toMatch(/--btn: 24 24 27;/);
    expect(css).toMatch(/--radius: 0\.5rem;/);
    expect(css).toMatch(/--radius-lg: 0\.75rem;/);
    expect(css).toMatch(/--shadow-card: none;/);
    expect(css).toMatch(/@import '@fontsource-variable\/tasa-orbiter';/);
    expect(css).toMatch(/@import '@fontsource-variable\/geist-mono';/);
    expect(css).toMatch(/--app-deep: 248 236 240;/);
  });

  it('never fills a button with violet or outlines one in ink (ink primary, 25 Nov 2026)', () => {
    const rule = (sel) => css.slice(css.indexOf(sel)).match(/\{[^}]*\}/)[0];
    expect(rule(":is(.ui-btn-primary, .ui-btn-brand) {")).toMatch(/background-color: rgb\(var\(--btn\)\)/);
    expect(rule('.ui-btn-secondary {')).toMatch(/border: 1px solid rgb\(var\(--edge\)\)/);
  });

  it('keeps documents square', () => {
    expect(css).toMatch(/\.ui-print-area \* \{ border-radius: 0 !important; \}/);
  });
});
