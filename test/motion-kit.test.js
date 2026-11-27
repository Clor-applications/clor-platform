/*
 * The Motion kit is switched on per surface (DESIGN.md "Migration" step 6).
 * Ops uses the portal attribute because it owns a separate shell.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync('packages/ui/src/motion.css', 'utf8');
const main = readFileSync('main.jsx', 'utf8');
const MOVED = ["[data-app='people']", "[data-app='admin']", "[data-app='payroll']", "[data-app='attendance']", "[data-portal='ops']", "[data-app='accounting']", "[data-app='projects']"];
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
    const seen = new Set();
    for (const s of list) {
      expect(s.startsWith(PREFIX), s).toBe(true);
      const rest = s.slice(PREFIX.length);
      const scope = rest.match(/^:is\(([^)]*)\)/) || rest.match(/^(\[data-(?:app|portal)='[a-z]+'\])/);
      const surfaces = scope?.[1].split(',').map((value) => value.trim()) || [];
      expect(surfaces.length > 0 && surfaces.every((surface) => MOVED.includes(surface)), s).toBe(true);
      surfaces.forEach((surface) => seen.add(surface));
    }
    expect(seen).toEqual(new Set(MOVED));
  });

  it('carries the kit: blue actions, pale selection, flat surfaces and interface fonts', () => {
    expect(css).toMatch(/--act: 21 81 150;/);
    expect(css).toContain('--btn: var(--act);');
    expect(css).toContain('--tint: 239 246 255;');
    expect(css).toMatch(/--radius: 0\.5rem;/);
    expect(css).toMatch(/--radius-lg: 0\.75rem;/);
    expect(css).toMatch(/--shadow-card: none;/);
    expect(css).toMatch(/@import '@fontsource-variable\/inter';/);
    expect(css).toMatch(/@import '@fontsource-variable\/jetbrains-mono';/);
    expect(css).toMatch(/--app-deep: 248 236 240;/);
  });

  it('uses the action color on primary buttons and a light edge on secondary buttons', () => {
    const rule = (sel) => css.slice(css.indexOf(sel)).match(/\{[^}]*\}/)[0];
    expect(rule(":is(.ui-btn-primary, .ui-btn-brand) {")).toMatch(/background-color: rgb\(var\(--btn\)\)/);
    expect(rule('.ui-btn-secondary {')).toMatch(/border: 1px solid rgb\(var\(--edge\)\)/);
  });

  it('keeps documents square', () => {
    expect(css).toMatch(/\.ui-print-area \* \{ border-radius: 0 !important; \}/);
  });
});
