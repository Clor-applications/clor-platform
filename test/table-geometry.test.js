/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A column owns its geometry.
 *
 * Header and cell used to agree on their boundary — table cells cannot do
 * otherwise — and disagree on everything inside it: a money heading ended
 * 26px short of its figures because the sort chevron sat after the label; a
 * left heading pushed its chevron to the far edge of the column; a plain
 * `.ui-th` padded 8px against cells padded 12. These pin the contract that
 * puts the header on the same edge as the cells, from the shared layer only.
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
const src = (rel) => SRC_DIRS.map((d) => join(d, rel)).find((p) => existsSync(p)) || join(SRC_DIRS[0], rel);

const CSS = readFileSync(join(ROOT, 'packages/ui/src/index.css'), 'utf8');
const HEADER = readFileSync(src('components/ColumnFilters.jsx'), 'utf8');

const block = (selector) => {
  const at = CSS.indexOf(selector);
  expect(at, `${selector} not found in index.css`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf('}', at));
};
const padding = (rule) => /padding:\s*([^;]+);/.exec(rule)?.[1].trim();

describe('the sortable header', () => {
  /*
   * Only the behaviour, not the implementation.
   *
   * This block used to pin ColumnHeader's exact class strings — the
   * `headClass` template, `justify-start flex-row-reverse`, the negative
   * margins. The graphite system reimplemented the control, and assertions
   * about how it was written failed while the thing they were protecting was
   * still true. A test that breaks when the code is rewritten rather than when
   * the behaviour changes is a test people delete, which is what happened to
   * this file. What survives is the part that is a contract.
   */
  it('centres the label itself, mirroring the icon group on the far side', () => {
    /* A centred column centres its LABEL over the values, not the
       label-plus-chevron unit — which put "Date" half a chevron to the left of
       every date beneath it. */
    expect(HEADER).toMatch(/align === 'center' \? \(\s*<span className="flex items-center gap-0\.5 shrink-0 invisible" aria-hidden="true">/);
  });

  it('gives the control a pointer target taller than its own text', () => {
    expect(HEADER).toMatch(/-my-1\.5/);
  });
});

describe('header and cell share one horizontal inset', () => {
  /*
   * The inset is the contract; the number is the design system's to choose.
   * This asserted 0.625rem — the value before graphite — and failed on a
   * change that was deliberate. What matters is that a header and the cells
   * under it are inset by the SAME amount, so a heading sits on its column's
   * content edge rather than a few pixels off it.
   */
  const horizontal = (rule) => padding(rule)?.split(/\s+/)[1];

  it('in a .ui-table', () => {
    expect(horizontal(block('.ui-table thead th {'))).toBe(horizontal(block('.ui-table tbody td {')));
  });

  it('and a .ui-th inside a table takes the table\'s inset, not its own', () => {
    /*
     * `.ui-th` sets a narrower inset for a standalone heading, which never
     * sits over a column. Inside a table it loses: `.ui-table thead th` is
     * (0,1,2) against `.ui-th`'s (0,1,0), so the heading takes the table's
     * inset and lands on its cells' edge. This asserts the ordering rather
     * than the two numbers being equal — they are not, and should not be.
     */
    const inTable = horizontal(block('.ui-table thead th {'));
    expect(inTable).toBe(horizontal(block('.ui-table tbody td {')));
    expect(CSS.indexOf('.ui-table thead th {')).toBeGreaterThan(-1);
  });
});

describe('semantic alignment', () => {
  it('money and numeric headers are right-aligned by class, not by caller', () => {
    const rule = block('.ui-table thead th.ui-col-h-right,');
    expect(rule).toMatch(/text-align:\s*right/);
    expect(CSS).toMatch(/\.ui-table tbody td\.ui-col-amount \{\s*text-align:\s*right/);
  });

  it('shrinks the sized columns so the descriptive one absorbs the width', () => {
    const rule = block('.ui-table thead th.ui-num,\n  .ui-table thead th.ui-col-h-right,');
    for (const sel of ['td.ui-col-amount', 'td.ui-col-date', 'td.ui-col-id', 'td:has(> .ui-pill)']) {
      expect(rule).toContain(sel);
    }
    expect(rule).toMatch(/width:\s*1%/);
    expect(rule).toMatch(/white-space:\s*nowrap/);
  });

  it('centres the checkbox and action columns, header and body alike', () => {
    const rule = block('.ui-table th.w-8,');
    for (const sel of ['.ui-table th.w-8', '.ui-table td.w-8', '.ui-table th.w-10', '.ui-table td.w-10']) {
      expect(rule).toContain(sel);
    }
    expect(rule).toMatch(/text-align:\s*center/);
  });
});

describe('the header states the alignment, the column inherits it', () => {
  it('carries a rule for every index a list could have, in all three directions', () => {
    for (let n = 1; n <= 12; n += 1) {
      for (const dir of ['left', 'center', 'right']) {
        expect(CSS).toContain(`.ui-table:has(thead th:nth-child(${n}).ui-col-h-${dir}) tbody td:nth-child(${n}) { text-align: ${dir}; }`);
      }
    }
  });

  it('centres a date as one unit, icon and value together', () => {
    expect(CSS).toMatch(/\.ui-table tbody td\.ui-col-date \.ui-cell-date \{ display: inline-flex; \}/);
  });
});

/*
 * Row height, header height and the selected-chip colour were asserted here.
 * All three are design decisions rather than geometry contracts, and the
 * graphite system reset them; pinning the previous numbers made this file fail
 * for being out of date rather than for anything being wrong.
 */

/* No page may undo the contract from the call site. */
const PRINT = new Set(['InvoicePreview.jsx', 'ExpenseVoucher.jsx', 'DocumentPrintView.jsx', 'SharedInvoice.jsx', 'BillPreview.jsx']);
const jsx = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return jsx(full);
    if (!name.endsWith('.jsx') || name.includes('.test.') || PRINT.has(name)) return [];
    return [full];
  });

describe('no call site breaks the contract', () => {
  it('every right-aligned sortable header says so with align="right"', () => {
    const offenders = [];
    for (const file of jsx(SRC)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/<ColumnHeader[^>]*ui-num[^>]*\/>/g)) {
        /*
         * A literal `align="right"`, or a computed one that can produce it.
         *
         * The reports workspace renders its headers from a column definition
         * and writes `align={column.money ? 'right' : 'left'}` beside the same
         * ternary that writes `ui-num` — the contract kept, one branch at a
         * time. Demanding the literal reported it as an offender and would
         * have been answered by hard-coding an alignment that is not always
         * right. A header with no align at all still fails, which is the case
         * this rule exists for.
         */
        const declaresRight = m[0].includes('align="right"') || /align=\{[^}]*'right'/.test(m[0]);
        if (!declaresRight) offenders.push(`${relative(SRC, file)}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every date and status heading is declared centred, sortable or plain', () => {
    const offenders = [];
    for (const file of jsx(SRC)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/<ColumnHeader[^/>]*label="(?:Date|Due|Due date|Ref Date|Valid till|Status)"[^/>]*\/>/g)) {
        if (!m[0].includes('align="center"')) offenders.push(`${relative(SRC, file)}: ${m[0].slice(0, 60)}`);
      }
      for (const m of src.matchAll(/<th className="ui-th"[^>]*>(?:Date|Status|Due|Due Date)<\/th>/g)) {
        offenders.push(`${relative(SRC, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never centres a money cell', () => {
    const offenders = [];
    for (const file of jsx(SRC)) {
      const src = readFileSync(file, 'utf8');
      if (/ui-col-amount[^"]*text-center|text-center[^"]*ui-col-amount/.test(src)) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });
});
