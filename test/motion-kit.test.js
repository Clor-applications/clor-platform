/*
 * The Motion kit is switched on app by app (DESIGN.md "Migration" step 6). motion.css must only ever reach an app that
 * has moved, so the apps still on the calm register look exactly as before. People moved first (24 Nov 2026).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync('packages/ui/src/motion.css', 'utf8');
const main = readFileSync('main.jsx', 'utf8');
const MOVED = ['people', 'admin'];
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
      const rest = s.slice(PREFIX.length);
      /* One app ([data-app='x']) or the moved set (:is([data-app='x'], …)): every app named must have moved. */
      const scope = rest.match(/^\[data-app='[a-z]+'\]/)?.[0] || rest.match(/^:is\((\[data-app='[a-z]+'\](?:,\s*)?)+\)/)?.[0];
      expect(Boolean(scope), s).toBe(true);
      const apps = [...scope.matchAll(/data-app='([a-z]+)'/g)].map((m) => m[1]);
      expect(apps.every((a) => MOVED.includes(a)), s).toBe(true);
    }
  });

  it('carries the kit: violet primary, square, flat, TASA Orbiter and Geist Mono', () => {
    expect(css).toMatch(/--act: 124 58 237;/);
    expect(css).toMatch(/--radius: 0;/);
    expect(css).toMatch(/--shadow-card: none;/);
    expect(css).toMatch(/@import '@fontsource-variable\/tasa-orbiter';/);
    expect(css).toMatch(/@import '@fontsource-variable\/geist-mono';/);
    expect(css).toMatch(/--app-deep: 248 236 240;/);
  });

  it('keeps radio dots round', () => {
    expect(css).toMatch(/:not\(input\[type='radio'\]\)/);
  });
});
