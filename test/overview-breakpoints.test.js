/**
 * @vitest-environment node
 *
 * A breakpoint is read against the window; a panel is laid out in what is
 * left of it.
 *
 * Tailwind's `xl:` fires at a 1280px *window*. The overview panels live to
 * the right of a 240px rail, so at that moment they are sharing 1040px, not
 * 1280 — and a three-up row sized for 1280 gives its widest panel 383px.
 * Recent Invoices needs 508 for its five columns, so on a 1280, 1366 or 1440
 * laptop the table scrolled sideways inside its own panel to reveal a status
 * pill. 1536 is where the column first reaches the table's natural width,
 * which is `2xl:`.
 *
 * This pins the rule rather than the symptom: a row of three panels waits for
 * 2xl. Two-up rows are deliberately not pinned — they carry a chart and a
 * list, or a donut and its legend, and each one's breakpoint was chosen for
 * what it holds (the sales pair splits 588/436 at xl, both wider than their
 * content). Only the three-up row runs out of room.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

/* Every `<breakpoint>:grid-cols-[…]` in the overview screens, with the number
   of columns the template declares. */
const gridRows = (source) => {
  const rows = [];
  for (const m of source.matchAll(/(\w+):grid-cols-\[([^\]]+)\]/g)) {
    const [, breakpoint, template] = m;
    /* `minmax(0,1.2fr)_minmax(0,0.85fr)_15.5rem` — the underscores separate
       the columns, and there are none inside a minmax(). */
    rows.push({ breakpoint, columns: template.split('_').length });
  }
  return rows;
};

const SCREENS = [
  'apps/accounting/src/features/sales/SalesOverview.jsx',
  'apps/accounting/src/features/purchase/PurchaseOverview.jsx',
  'apps/accounting/src/features/dashboard/DashboardOverview.jsx',
];

describe('overview panel rows', () => {
  it('waits for 2xl before putting three panels in a row', () => {
    for (const file of SCREENS) {
      for (const row of gridRows(read(file))) {
        if (row.columns < 3) continue;
        expect(
          row.breakpoint,
          `${file}: a ${row.columns}-up row at ${row.breakpoint} leaves each panel too narrow — the rail takes 240px off the window first`
        ).toBe('2xl');
      }
    }
  });

  /* Guards the rule above against passing because it found nothing to judge. */
  it('has a three-up row to judge', () => {
    const three = SCREENS.flatMap((f) => gridRows(read(f))).filter((r) => r.columns >= 3);
    expect(three.length).toBeGreaterThan(0);
  });
});
