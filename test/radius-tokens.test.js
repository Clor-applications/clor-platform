/**
 * @vitest-environment node
 *
 * Reads source; renders nothing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Two radii, in every app (DESIGN.md; owner, 4 Nov 2026, design audit Q12):
 * 8px on anything you can press or type into, 12px on anything that holds
 * content, 999px for pills.
 *
 * Until then the platform tokens said 4px and 6px, so Accounting, Payroll,
 * Attendance and Admin drew 4px cards beside 8px buttons, and People showed
 * four radii on one Home. This pins the token values, the Tailwind mapping,
 * and that app chrome does not open-code a third radius again.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const css = read('packages/ui/src/index.css');
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('--sidebar-w:'));
const token = (name) => rootBlock.match(new RegExp(`\\n\\s*--${name}:\\s*([^;]+);`))?.[1].trim();

describe('the platform radius tokens', () => {
  it('are 8px for what you press or type into', () => {
    for (const name of ['radius-btn', 'radius-input', 'radius-sm', 'radius-lg']) expect([name, token(name)]).toEqual([name, '0.5rem']);
  });

  it('are 12px for what holds content, the overview figures included', () => {
    for (const name of ['radius', 'radius-xl', 'radius-kpi']) expect([name, token(name)]).toEqual([name, '0.75rem']);
  });

  it('feed Tailwind, so rounded-lg and rounded-xl move with them', () => {
    const tw = read('tailwind.config.js');
    expect(tw).toMatch(/lg:\s*'var\(--radius-lg\)'/);
    expect(tw).toMatch(/xl:\s*'var\(--radius-xl\)'/);
  });

  it('leave the focus ring on the element its own radius', () => {
    const rule = css.match(/:where\(a, button, input, select, textarea, \[tabindex\]\):focus-visible \{[^}]*\}/)[0];
    expect(rule).toContain('border-radius: var(--radius-btn);');
  });
});

/* ------------------------------------------------------------ the stylesheet */

/*
 * Every literal radius left in the platform stylesheet, and why. Anything not
 * on this list reads a token, or is 999px / 50% / 0 / inherit.
 */
const CSS_LITERALS = {
  '.ui-kbd {': 'keycap, the 6px exception in DESIGN.md',
  '.ui-global-search kbd {': 'keycap',
  ".ui-nav-item[data-active='true']::before {": 'the active-item edge, a 3px mark',
  ":root[data-palette='blaze'] .ui-split-mod[data-current]::before {": 'the active-item edge, a 3px mark',
  '.ui-tab.is-active::after {': 'the 2px tab underline',
  '.ui-tab-indicator {': 'the 2px tab underline',
  '.ui-hero-bar {': 'a drawn chart bar',
  '.ui-trend-bar {': 'a drawn chart bar',
  '.ui-week-bar {': 'a drawn chart bar',
  '.ui-legend i {': 'a 10px legend swatch',
  '.document-print-template-a4Modern > div {': 'printed document',
};

describe('the platform stylesheet', () => {
  it('writes no radius outside the tokens, apart from the listed marks', () => {
    const offenders = [];
    let selector = '';
    css.split('\n').forEach((line, i) => {
      if (line.includes('{')) selector = line.trim().slice(0, line.trim().indexOf('{') + 1);
      for (const m of line.matchAll(/border(?:-[a-z]+)?-radius:\s*([^;]+);/g)) {
        const v = m[1].replace(/\s*!important/, '').trim();
        if (/^(var\(--radius[a-z-]*\)|999px|9999px|50%|0|inherit)( |$)/.test(v) && v.split(/\s+/).every((p) => /^(var\(--radius[a-z-]*\)|999px|9999px|50%|0|inherit)$/.test(p))) continue;
        if (CSS_LITERALS[selector]) continue;
        offenders.push(`index.css:${i + 1} ${selector} ${v}`);
      }
    });
    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------ the screens */

const PRINTED = /(InvoicePreview|ExpenseVoucher|DocumentPrintView|TemplatePreview)\.jsx$|invoiceTemplates?\//;

/* Tailwind classes that are not one of the two radii or a pill, kept on purpose. */
const CLASS_LITERALS = [
  ['packages/ui/src/components/ui/ShortcutSheet.jsx', 'rounded-md', 'keycap, the 6px exception'],
  ['apps/accounting/src/features/dashboard/DashboardOverview.jsx', 'rounded-sm', 'legend swatches'],
  ['apps/accounting/src/features/dashboard/DashboardOverview.jsx', 'rounded-t-sm', 'chart bars'],
  ['apps/accounting/src/features/dashboard/DashboardOverview.jsx', 'rounded-t', 'chart bars'],
  ['apps/accounting/src/features/crm/CustomerDetailPage.jsx', 'rounded-t', 'chart bars'],
];

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', 'generated'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx|js|tsx|ts)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
};

const OFF_SCALE = /(?<![\w-])rounded(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?(?:-(?:sm|md|2xl|3xl|\[[^\]]*\]))?(?=[\s"'`}])/g;
/* A string is a class list when it also carries a utility with a dash: "rounded down" is prose. */
const CLASSY = /(?<![\w-])(?:p|px|py|m|mx|my|gap|text|flex|grid|inline|items|border|bg|h|w|min-w|ui)-/;

describe('app chrome', () => {
  it('uses rounded-lg, rounded-xl or rounded-full, not a third radius', () => {
    const offenders = [];
    for (const file of ['apps', 'packages'].flatMap((d) => walk(join(ROOT, d)))) {
      const rel = relative(ROOT, file);
      if (PRINTED.test(rel)) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
        for (const lit of line.matchAll(/(["'`])((?:(?!\1).)*)\1/g)) {
          if (!CLASSY.test(lit[2])) continue;
          for (const m of ` ${lit[2]} `.matchAll(OFF_SCALE)) {
            if (CLASS_LITERALS.some(([f, c]) => f === rel && c === m[0])) continue;
            offenders.push(`${rel}:${i + 1} ${m[0]}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('writes no numeric borderRadius in an inline style outside charts and avatars', () => {
    const offenders = [];
    for (const file of ['apps', 'packages'].flatMap((d) => walk(join(ROOT, d)))) {
      const rel = relative(ROOT, file);
      if (PRINTED.test(rel) || /charts\//.test(rel)) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/borderRadius:\s*([^,}\n]+)/g)) {
          const v = m[1].trim();
          if (/var\(--radius|^999$|^'999px'$|^'50%'$/.test(v)) continue;
          if (/HomeBoard\.jsx$/.test(rel) && v === "'4px 4px 0 0'") continue; // chart bars
          offenders.push(`${rel}:${i + 1} ${v}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
