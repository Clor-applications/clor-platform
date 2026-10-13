/**
 * @vitest-environment node
 *
 * This file reads source, it does not render it. A jsdom for it costs about
 * twenty-five seconds of wall clock and is never touched.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The two rules from DESIGN.md that a person cannot hold in their head across
 * 91 screens, checked mechanically instead.
 *
 * Both were cleaned up once and had drifted back by the time anyone looked:
 * DESIGN.md's own migration note claimed the palette cleanup was finished when
 * nine violations were still live. A rule nobody can check is a rule that
 * quietly stops being true, so these two are checked here and run in the gate.
 */

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


const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.jsx?$/.test(name) ? [full] : [];
  });

const sources = () =>
  walk(SRC)
    .filter((f) => !/\.test\.jsx?$/.test(f))
    .map((f) => ({ path: relative(SRC, f), text: readFileSync(f, 'utf8') }));

/**
 * A printed invoice is black on white whatever theme the app is in, so these
 * are exempt by design — see the Decisions Log in DESIGN.md.
 */
const PRINT_SURFACES = [
  'features/sales/InvoicePreview.jsx',
  'features/expenses/ExpenseVoucher.jsx',
  // The paper every document other than the invoice is printed on. Same
  // reason, same exemption: a challan handed to a lorry driver does not follow
  // the operator's dark mode.
  'components/DocumentPrintView.jsx',
  // The invoice as a customer sees it, having followed a shared link. It is
  // the printed copy rendered in their browser, and they have no theme here.
  'features/sales/SharedInvoice.jsx',
  // Every literal in App.jsx lives inside TemplatePreview, which previews the
  // printed sheet rather than dressing the app.
  'App.jsx',
  // The accent a company chooses for its own printed template. A brand colour
  // picked by the customer is theirs, not the product's palette, and it must
  // print as chosen rather than follow whatever theme the operator is in.
  'utils/docSettings.js',
];

describe('DESIGN.md rules', () => {
  /*
   * `.ui-input` owns its padding. A `px-3 py-2` beside it is a utility, so it
   * wins, and the field ends up a different size to every other field in the
   * product. 390 call sites did this before it was mechanised.
   */
  it('no field restates the padding the token already sets', () => {
    const offenders = [];
    for (const { path, text } of sources()) {
      for (const m of text.matchAll(/(ui-input|ui-select)([^"`}]*)/g)) {
        const tail = m[2];
        if (/\bpx-3\b|\bpl-3\b/.test(tail) && /\bpy-2\b/.test(tail)) {
          offenders.push(`${path}: ${m[0].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /*
   * Palette literals do not flip with the theme, so anything wearing one shows
   * its light-mode colour on a dark ground. The exception is paper.
   */
  it('app chrome carries no raw palette classes', () => {
    /*
     * Every hue Tailwind ships, not the eleven somebody listed first.
     *
     * The short list let emerald, orange, rose, violet and teal through, and a
     * customer screen arrived carrying twenty of them — text-emerald-800 on
     * bg-emerald-100, a rose figure, three chart bars — none of which follows
     * the theme, all of which stayed light-mode colours on a dark ground. A
     * rule that covers most of a palette teaches people the palette is fine.
     *
     * Bracketed literals too: `text-[#0F172A]` is the same decision with the
     * lookup done by hand.
     */
    const PALETTE =
      /\b(?:bg|text|border|fill|stroke|ring|from|via|to)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|\b(?:bg|text|border)-\[#[0-9A-Fa-f]{3,8}\]/g;
    const offenders = [];
    for (const { path, text } of sources()) {
      if (PRINT_SURFACES.includes(path)) continue;
      const hits = text.match(PALETTE);
      if (hits) offenders.push(`${path}: ${[...new Set(hits)].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
