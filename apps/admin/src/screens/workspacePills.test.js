// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

/* Read as text: the web suite does not load stylesheets, so `?raw` comes back empty. */
const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');

/*
 * Workspace status pills are 12px text, so they need 4.5:1 (WCAG AA). QA found
 * "Not switched on" (.ws-pill--off) at 4.40:1: muted grey on stone. The test reads
 * the colours from workspace.css itself, so a token change is checked too.
 */
const block = (selector) => {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return '';
  return css.slice(at, css.indexOf('}', at));
};
const tokens = (sel) => Object.fromEntries([...block(sel).matchAll(/--(ws-[\w-]+):\s*(\d+) (\d+) (\d+);/g)].map((m) => [m[1], [Number(m[2]), Number(m[3]), Number(m[4])]]));
const prop = (sel, name) => block(sel).match(new RegExp(`\\n\\s*${name}:\\s*rgb\\(var\\(--(ws-[\\w-]+)\\)\\)`))?.[1];
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

for (const scope of [':root', '.ws']) {
  it(`"Not switched on" and the other state pills read at 4.5:1 or better (${scope} tokens)`, () => {
    const t = { ...tokens(':root'), ...tokens(scope) };
    for (const variant of ['.ws-pill--off', '.ws-pill--ok', '.ws-pill--role']) {
      const fg = prop(variant, 'color') || prop('.ws-pill', 'color');
      const bg = prop(variant, 'background') || prop('.ws-pill', 'background');
      expect(t[fg], `${variant} colour token`).toBeTruthy();
      expect(ratio(t[fg], t[bg]), variant).toBeGreaterThanOrEqual(4.5);
    }
  });
}
