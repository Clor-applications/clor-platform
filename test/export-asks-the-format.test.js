/**
 * @vitest-environment node
 *
 * This file reads source, it does not render it. A jsdom for it costs about
 * twenty-five seconds of wall clock and is never touched.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Export asks which format, on every list.
 *
 * The invoice list asked; everywhere else the Export entry wrote a CSV and said
 * nothing about it, so the same act meant different things depending on which
 * screen you were standing on. A person who wanted the bills as a PDF had no
 * way to say so — CSV was the answer whether or not it was the question.
 *
 * Checked here rather than trusted to memory because the next list somebody
 * adds will copy whichever neighbour they happen to open.
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


const jsxFiles = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsxFiles(full));
    else if (/\.jsx?$/.test(name) && !/\.test\.jsx?$/.test(name)) out.push(full);
  }
  return out;
};

describe('every list offers PDF, Excel and CSV', () => {
  it('no list menu carries a bare Export entry any more', () => {
    const offenders = [];
    for (const file of jsxFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      /*
       * The shape that used to mean "write a CSV without asking": a menu item
       * whose key is `export`. The shared helper produces `export:pdf` and its
       * siblings instead, so a plain `key: 'export'` is the old way.
       */
      const bare = /\{\s*key:\s*'export'\s*,\s*label:/g;
      let m;
      while ((m = bare.exec(source)) !== null) {
        offenders.push(`${relative(SRC, file)}:${source.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the shared entry offers exactly the three formats', async () => {
    const { EXPORT_FORMATS, exportMenuItem, exportFormatFromKey } = await import('@ui/components/list/exportMenu');
    expect(EXPORT_FORMATS.map((f) => f.key)).toEqual(['pdf', 'xlsx', 'csv']);

    const item = exportMenuItem('Export bills');
    expect(item.label).toBe('Export bills');
    expect(item.children.map((c) => c.label)).toEqual(['PDF', 'Excel', 'CSV']);

    // The parent row opens the list; only a child names a format.
    expect(exportFormatFromKey(item.key)).toBeNull();
    expect(exportFormatFromKey('export:xlsx')).toBe('xlsx');
    expect(exportFormatFromKey('somethingElse')).toBeNull();
  });
});
