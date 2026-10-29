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
 *
 * Updated 30 Oct 2026: the rule is now the width, not the breakpoint's name.
 * The running-book Home (in DashboardOverview since the import, 00f6a61a)
 * puts two three-up rows at xl — a chart, a donut and a bank list; two due
 * lists and recent transactions — and gives its narrow panels floors in rem
 * (`minmax(17rem,…)`). No table sits in them. So a three-up row may come
 * before 2xl when, in the room its breakpoint leaves beside the rail, every
 * panel still gets at least 15rem; a row that waits for 2xl passes as before.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

/* The window width each breakpoint fires at. */
const BREAKPOINT_PX = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };
const RAIL_PX = 240;
/* The page's own side padding, both sides. */
const PAGE_PADDING_PX = 24;
const MIN_PANEL_PX = 240;
const REM = 16;

/* One column of a template: its floor in px and its share in fr. */
const parseColumn = (col) => {
  const minmax = col.match(/^minmax\(([^,]+),([^)]+)\)$/);
  const toPx = (v) => (v.endsWith('rem') ? parseFloat(v) * REM : v.endsWith('px') ? parseFloat(v) : 0);
  if (minmax) {
    const [, min, max] = minmax;
    return max.endsWith('fr') ? { floor: toPx(min), fr: parseFloat(max) } : { floor: toPx(max), fr: 0 };
  }
  return col.endsWith('fr') ? { floor: 0, fr: parseFloat(col) } : { floor: toPx(col), fr: 0 };
};

/* The width each column gets in `room` px: fr shares, with any column whose
   share falls under its floor held at the floor and the rest re-shared. */
const resolveWidths = (columns, room) => {
  const widths = columns.map((c) => (c.fr ? null : c.floor));
  for (;;) {
    const open = columns.map((c, i) => i).filter((i) => widths[i] === null);
    const left = room - widths.reduce((sum, w) => sum + (w ?? 0), 0);
    const frTotal = open.reduce((sum, i) => sum + columns[i].fr, 0);
    const pinned = open.filter((i) => (left * columns[i].fr) / frTotal < columns[i].floor);
    if (!pinned.length) {
      for (const i of open) widths[i] = (left * columns[i].fr) / frTotal;
      return widths;
    }
    for (const i of pinned) widths[i] = columns[i].floor;
  }
};

/* Every `<breakpoint>:grid-cols-[…]` in the overview screens, with its columns
   and the gap its row declares. */
const gridRows = (source) => {
  const rows = [];
  for (const m of source.matchAll(/className="([^"]*?)(\w+):grid-cols-\[([^\]]+)\]([^"]*)"/g)) {
    const [, before, breakpoint, template, after] = m;
    const gap = (`${before} ${after}`.match(/\bgap-(\d+)\b/) || [0, 4])[1] * 4;
    /* `minmax(0,1.2fr)_minmax(0,0.85fr)_15.5rem` — the underscores separate
       the columns, and there are none inside a minmax(). */
    const columns = template.split('_').map(parseColumn);
    rows.push({ breakpoint, gap, columns, template });
  }
  return rows;
};

/* The narrowest panel in a row at the moment its breakpoint first applies. */
const narrowestAt = (row) => {
  const room = BREAKPOINT_PX[row.breakpoint] - RAIL_PX - PAGE_PADDING_PX - row.gap * (row.columns.length - 1);
  return Math.min(...resolveWidths(row.columns, room));
};

const SCREENS = [
  'apps/accounting/src/features/sales/SalesOverview.jsx',
  'apps/accounting/src/features/purchase/PurchaseOverview.jsx',
  'apps/accounting/src/features/dashboard/DashboardOverview.jsx',
];

describe('overview panel rows', () => {
  it('waits for 2xl, or for room, before putting three panels in a row', () => {
    for (const file of SCREENS) {
      for (const row of gridRows(read(file))) {
        if (row.columns.length < 3 || row.breakpoint === '2xl') continue;
        expect(
          narrowestAt(row),
          `${file}: [${row.template}] at ${row.breakpoint} leaves a panel too narrow — the rail takes 240px off the window first`
        ).toBeGreaterThanOrEqual(MIN_PANEL_PX);
      }
    }
  });

  it('would catch the row that scrolled', () => {
    /* A wide chart and two unfloored panels at xl: the two side panels get
       ~197px each of a 1280 window, too narrow for a list of names and
       amounts. The check has to fail on it, or it judges nothing. */
    const [row] = gridRows('<div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)]">');
    expect(narrowestAt(row)).toBeLessThan(MIN_PANEL_PX);
  });

  /* Guards the rule above against passing because it found nothing to judge. */
  it('has a three-up row to judge', () => {
    const three = SCREENS.flatMap((f) => gridRows(read(f))).filter((r) => r.columns.length >= 3);
    expect(three.length).toBeGreaterThan(0);
  });
});
