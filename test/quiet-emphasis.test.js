/**
 * @vitest-environment node
 *
 * This file reads source, it does not render it. A jsdom for it costs about
 * twenty-five seconds of wall clock and is never touched.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Emphasis is spent, not sprayed.
 *
 * Two rules added on 2026-09-08, both of which reverse an earlier pass that
 * raised the wrong thing:
 *
 *   - Money is monospace and right-aligned, and that is already enough to mark
 *     a figure as money. Putting a weight on top made every amount in every
 *     table an emphasis, so a screen that is mostly amounts had none.
 *   - A status hue is a background, never type. Seven saturated words in the
 *     filter strip competed with each other and with the figures beside them.
 *
 * Both are one-line CSS changes that a later pass would undo without noticing,
 * which is why they are checked here rather than trusted to memory.
 */

const CSS = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'packages/ui/src/index.css'), 'utf8');

/** The declaration block for a selector, so a rule is read in isolation. */
const block = (selector) => {
  const at = CSS.indexOf(selector);
  expect(at, `${selector} not found in index.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', at);
  return CSS.slice(open + 1, CSS.indexOf('}', open));
};

const weightOf = (selector) => {
  const m = /font-weight:\s*(\d+)/.exec(block(selector));
  return m ? Number(m[1]) : null;
};

describe('money is not emphasis', () => {
  it('the table money cell is normal weight', () => {
    expect(weightOf('.ui-col-amount.ui-col-amount')).toBe(400);
  });

  /*
   * And so is every other figure. A headline number earns its emphasis from
   * size and colour; a weight on top of that made every number on every list
   * read as emphasis, which is a page with none.
   */
  it('the headline figure and the document total are normal weight too', () => {
    expect(weightOf('.ui-money-lg')).toBe(400);
    expect(weightOf('.ui-total-row > :last-child')).toBe(400);
  });

  it('no money role reintroduces a weight', () => {
    const roles = CSS.match(/\.ui-cell-money\[data-role='[a-z]+'\][^}]*}/g) || [];
    expect(roles.length).toBeGreaterThan(3);
    for (const rule of roles) {
      const m = /font-weight:\s*(\d+)/.exec(rule);
      // A role may set a colour; none of them may shout.
      expect(`${rule.slice(0, 42)} -> ${m ? m[1] : '400'}`).toBe(`${rule.slice(0, 42)} -> 400`);
    }
  });

  /* Tabular figures and right alignment are what mark money instead. */
  it('keeps the signals that replaced the weight', () => {
    const money = block('.ui-col-amount.ui-col-amount');
    expect(money).toMatch(/Inter/);
    expect(money).toMatch(/text-align:\s*right/);
    expect(money).toMatch(/tabular-nums/);
  });
});

describe('a status hue is a background, never type', () => {
  /*
   * DESIGN.md rule 6 is the authority here: "Pills and filter tabs keep grey
   * text on a pale tint; the word carries the meaning and the tint places it."
   *
   * This block previously asserted something stricter — no tint at all, and a
   * single brand-filled selection. That was one reading of the rule, and the
   * graphite system took the other, which is the one DESIGN.md actually
   * writes down. What the rule forbids is the hue getting into the *type*, and
   * that is what these now hold.
   */
  it('the filter tab keeps grey text, whatever its status hue', () => {
    const unselected = block('.ui-segment {\n    background-color');
    expect(unselected).toMatch(/color:\s*rgb\(var\(--fg-muted\)\)/);
    /* The hue is the background. It must not become the text colour. */
    expect(unselected).not.toMatch(/color:\s*rgb\(var\(--seg-ink/);
  });

  it('the selected tab is marked by depth, not by coloured type', () => {
    const selected = block(".ui-segment[aria-selected='true'] {");
    expect(selected).toMatch(/background-color:\s*rgb\(var\(--seg-strong/);
    expect(selected).toMatch(/color:\s*rgb\(var\(--fg\)\)/);
    expect(selected).not.toMatch(/color:\s*rgb\(var\(--seg-ink/);
  });

  it('the status pill follows the same rule', () => {
    const pill = block('.ui-pill-status {');
    expect(pill).toMatch(/color:\s*rgb\(var\(--fg-muted\)\)/);
    expect(pill).not.toMatch(/--seg-ink/);
  });
});

describe('detail panels state rather than emphasise', () => {
  it('a value is grey, normal weight and centred', () => {
    const value = block('.ui-detail-value {');
    expect(value).toMatch(/font-weight:\s*400/);
    expect(value).toMatch(/color:\s*rgb\(var\(--fg-muted\)\)/);
    expect(value).toMatch(/text-align:\s*center/);
  });

  it('a money value in a panel keeps the money face', () => {
    expect(block('.ui-detail-value.ui-detail-mono')).toMatch(/Inter/);
  });
});

/**
 * Every amount wears the money face, everywhere.
 *
 * DESIGN.md rule 4 says every displayed amount is monospace. Four classes were
 * doing that job at two different weights — `.ui-money`, `.ui-amount`,
 * `.ui-col-amount` and a bare `.ui-mono` — and a further hundred amounts
 * carried none of them and rendered in the sans face beside figures that did.
 * A rule applied in four ways in some places and not at all in others is what
 * made the product look inconsistent page to page.
 */

import { readdirSync, statSync } from 'node:fs';

/*
 * The source, which is now in two places.
 *
 * This file used to sit in `src/test/`, so two `dirname`s reached `src/` and
 * one grep covered the whole application. The tree is a platform now — screens
 * under `apps/`, shared UI under `packages/` — and the same two `dirname`s
 * reach the repository root, where a grep also walks node_modules and dist and
 * reports matches that are not the product.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/**
 * Where a file that used to be `src/<path>` lives now.
 *
 * The tree became a platform: screens under `apps/accounting/src`, payroll
 * under `apps/payroll/src`, and everything more than one app uses under
 * `packages/ui/src`. A test that reads source has to look in all three, and
 * looking in the wrong one reports a missing file rather than a real result.
 */
const SRC_DIRS = [
  join(ROOT, 'apps/accounting/src'),
  join(ROOT, 'packages/ui/src'),
  join(ROOT, 'apps/payroll/src'),
];
const SRC = SRC_DIRS[0];


/* The printed document is black on white and outside the app's type rules. */
const PRINT_SURFACES = new Set(['InvoicePreview.jsx', 'ExpenseVoucher.jsx', 'DocumentPrintView.jsx', 'SharedInvoice.jsx']);

const jsxFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return jsxFiles(full);
    if (!name.endsWith('.jsx') || name.includes('.test.')) return [];
    if (PRINT_SURFACES.has(name)) return [];
    return [full];
  });

/* `ui-num` is the tabular face a table cell takes (index.css) and was missing
   from this list, so six correctly-marked cells read as offenders. */
const MONEY_MARK = /ui-col-amount|ui-cell-money|ui-detail-mono|ui-money|ui-amount|ui-mono|ui-num|MoneyValue/;

describe('every amount wears the money face', () => {
  it('no element renders formatMoney in the sans face', () => {
    const offenders = [];
    for (const file of jsxFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      /*
       * `[^<}]` on purpose. A looser class spans nested markup, so a container
       * div wrapping a table of amounts matches as though it were the amount —
       * which is exactly the mistake the codemod behind this rule made before
       * the check was written.
       */
      const el = /<(span|div|td)((?:\s+[^<>]*?)?)>\s*\{[^<}]*formatMoney\(/g;
      let m;
      while ((m = el.exec(source)) !== null) {
        if (!MONEY_MARK.test(m[2])) {
          offenders.push(`${relative(SRC, file)}:${source.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /* The two inline money classes must not drift apart on weight again. */
  it('the inline money classes agree on weight 400', () => {
    const shared = block('.ui-money,\n  .ui-amount');
    expect(shared).toMatch(/font-weight:\s*400/);
    expect(shared).toMatch(/Inter/);
  });

  /* A headline figure is emphasised by its size, not by its weight as well. */
  it('the KPI figure is not also bold', () => {
    const weights = [...CSS.matchAll(/\.ui-kpi\s*\{[^}]*font-weight:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(weights.length).toBeGreaterThan(0);
    for (const w of weights) expect(w).toBeLessThanOrEqual(500);
  });
});

/**
 * Weight is not how a value is presented.
 *
 * 121 elements across 45 files put `font-semibold` or `font-bold` on a data
 * expression — a party name, a document number, a narration, a count. Weight is
 * for structure (a page title, a section heading, a column header), and using it
 * for content as well meant a screen had no hierarchy left to spend: everything
 * was emphasised, so nothing was.
 *
 * The bar is 500. A name that leads a row may still be a little heavier than the
 * fields under it; nothing rendered from data goes above that.
 */
describe('weight marks structure, not content', () => {
  it('no data expression is rendered bold or semibold', () => {
    const offenders = [];
    for (const file of jsxFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      /*
       * Heading elements are exempt, and only them.
       *
       * The rule is about weight standing in for hierarchy on content. A
       * heading whose text happens to arrive as a prop — the name of an
       * address card, say — is structure by the tag it is written in, and the
       * document says so to a screen reader as well as to the eye. Anything
       * else rendering a value at 600 is the thing this bans.
       */
      const el = /<(?!h[1-6]\b)\w+[^>]*className="([^"]*\bfont-(?:semibold|bold)\b[^"]*)"[^>]*>\s*\{[^<}]{0,70}/g;
      let m;
      while ((m = el.exec(source)) !== null) {
        offenders.push(`${relative(SRC, file)}:${source.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * One rhythm between the blocks of a page.
 *
 * DESIGN.md names three spacing values and no others — 12 inside a group, 24
 * between groups, 40 between page sections. The screens were using 16 (43
 * times), 20 (20 times) and 12 (3 times) at the top level, so two of the three
 * commonest page gaps were not on the scale at all and no two modules agreed.
 * A page opened after another page shifted its whole layout by four pixels for
 * no reason a reader could name.
 *
 * Only the outermost wrapper of a screen is held here. Groups inside a page
 * are free to use the tighter step.
 */
describe('pages share one vertical rhythm', () => {
  /*
   * Stated as a ban rather than a requirement, because a `return (` also opens
   * a dropdown body, a prompt, or a template thumbnail — those are groups, and
   * the tighter steps are right for them. What none of them may be is 16 or
   * 20px, the two values on no scale in DESIGN.md and the two that between them
   * accounted for every page-level gap in the product.
   */
  it('no wrapper uses the off-scale 16px step', () => {
    const offenders = [];
    for (const file of jsxFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      const root = /return \(\s*\n\s*<div className="(space-y-\d+)[^"]*"/g;
      let m;
      while ((m = root.exec(source)) !== null) {
        if (m[1] === 'space-y-4' || m[1] === 'space-y-5') {
          offenders.push(`${relative(SRC, file)}:${source.slice(0, m.index).split('\n').length} ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /*
   * 20px is on no scale in DESIGN.md and never was — it appeared twice, in the
   * hero and the sign-in form, and put those two screens on a rhythm nothing
   * else in the product used.
   */
  it('nothing uses the 20px step, which is on no scale', () => {
    const offenders = jsxFiles(SRC)
      .filter((file) => /\bspace-y-5\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
