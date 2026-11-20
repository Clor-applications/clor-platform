import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * The neon brand is the platform default (owner, 9 Nov 2026: "color should be
 * blaze orange nor red"). The 3 Nov red block survives only under People's
 * `sky` and Accounting's `indigo`, so Workspace, Payroll, Attendance, the
 * operator console and the sign-in pages never see red.
 */
const css = readFileSync('packages/ui/src/index.css', 'utf8');
const block = (marker) => {
  const at = css.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('\n}\n', at) + 2);
};

describe('the neon default', () => {
  const neon = block('CLOR — the neon brand, platform default');

  it('is Blaze Orange on white, with a button that clears AA', () => {
    expect(neon).toMatch(/--brand: 255 84 0;/);
    expect(neon).toMatch(/--brand-ink: 186 57 0;/);
    expect(neon).toMatch(/--btn-primary-bg: 212 69 0;/);
    expect(neon).toMatch(/--app-bg: 255 255 255;/);
    expect(neon).toMatch(/--border: 229 231 235;/);
    expect(neon).toMatch(/--neg: 185 28 28;/);
    expect(neon).toMatch(/--money-out: var\(--ink\);/);
    expect(neon).not.toMatch(/--red|--oxblood|--blush|200 16 46|165 13 38/);
  });

  it('keeps the red block only under sky and indigo', () => {
    const red = css.slice(css.indexOf('CLOR — the red brand'), css.indexOf("Books (data-palette='indigo') on the red brand"));
    const selectors = red.match(/^:root[^{\n]*\{/gm);
    expect(selectors).toEqual([
      ":root:where([data-palette='sky'], [data-palette='indigo']) {",
    ]);
  });

  /* The blaze and payroll palette blocks were dead (no code sets either palette; each app's
     colour is set per data-app in rnd.css) and were removed in the 21 Nov 2026 audit. */
  it('keeps no dead blaze or payroll palette block', () => {
    expect(css).not.toMatch(/^:root\[data-palette='(blaze|payroll)'\]/m);
  });

  it('the sign-in page reads the platform tokens, not the red brand', () => {
    const auth = css.slice(css.indexOf('.ui-auth {'), css.indexOf('.ui-auth-brand {'));
    expect(auth).not.toMatch(/--red|165 13 38/);
  });

  it('Workspace Overview carries no illustration', () => {
    const home = readFileSync('apps/admin/src/screens/AdminHome.jsx', 'utf8');
    expect(home).not.toMatch(/\.webp|<img/);
    expect(existsSync('apps/admin/src/assets/clor-office.webp')).toBe(false);
  });
});
