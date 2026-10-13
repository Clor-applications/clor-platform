/**
 * @vitest-environment node
 *
 * This file reads source, it does not render it. A jsdom for it costs about
 * twenty-five seconds of wall clock and is never touched.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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


const jsxFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return jsxFiles(full);
    if (!name.endsWith('.jsx') || name.includes('.test.')) return [];
    return [full];
  });

/*
 * Four lists had their toolbar's period filter and export configuration spliced
 * into an unrelated element — a row's actions button, a Knock off button, a
 * table row. React put them on the DOM node as stray attributes and warned, and
 * the toolbar above the list quietly lost its date filter and its export
 * columns. Purchase orders, debit notes, quotations and credit notes were all
 * affected, and the lists looked fine.
 *
 * The signature is unmistakable: a run of ListToolbar props sitting at the
 * toolbar's own indentation inside something that is not a ListToolbar.
 */
const TOOLBAR_PROPS = ['period=', 'onPeriodChange=', 'exportColumns=', 'exportRows=', 'exportSheetName='];

/* FiltersButton takes the period props in its own right — it is the control
   the toolbar delegates them to. */
const LEGITIMATE_HOSTS = new Set(['ListToolbar', 'FiltersButton']);

describe('list toolbars keep their own props', () => {
  it('has no toolbar props stranded outside a ListToolbar', () => {
    const strays = [];
    for (const file of jsxFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (!TOOLBAR_PROPS.some((p) => line.trim().startsWith(p))) return;
        // Walk back to the element this prop is an attribute of.
        for (let k = idx - 1; k >= 0 && idx - k < 60; k -= 1) {
          const open = lines[k].match(/<([A-Za-z][\w.]*)/);
          if (!open) continue;
          if (lines[k].trim().startsWith('</')) continue;
          if (!LEGITIMATE_HOSTS.has(open[1])) strays.push(`${relative(SRC, file)}:${idx + 1} on <${open[1]}>`);
          return;
        }
      });
    }
    expect(strays).toEqual([]);
  });
});
