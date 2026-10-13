/**
 * @vitest-environment node
 *
 * A wide table needs somewhere to scroll, or its last columns are gone.
 *
 * The list cards are `overflow: hidden`, which is what keeps a sticky header
 * and rounded corners honest. The consequence is that a table wider than its
 * card is not merely cut off at the window's edge — it is clipped by the card
 * with no scrollbar anywhere, and the columns past the edge cannot be reached
 * by scrolling, dragging, or keyboard. On the Receipts and Payments lists that
 * silently removed the Amount column at 1093px, which is a 1366 laptop at 125%.
 *
 * `.ui-table-scroll` is the wrapper that gives the table its own scroll. Every
 * wide list in the product has one; the rule is that they all do.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sourceFiles = () =>
  execSync("git ls-files 'apps/**/*.jsx' 'packages/**/*.jsx'", { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

/*
 * Only the tables that `DocumentListShell` puts inside its card are judged.
 *
 * That shell is where `ui-card overflow-hidden` comes from, so that is where a
 * missing scroller silently eats columns. A line grid inside a document form
 * sits in a well with visible overflow and is a different question; this test
 * does not pretend to answer it.
 */
const inListShell = (lines, index) => {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (/<DocumentListShell\b/.test(lines[i])) depth += 1;
    if (/<\/DocumentListShell>/.test(lines[i])) depth -= 1;
  }
  return depth > 0;
};

/*
 * Whether a `<div className="…ui-table-scroll…">` is an ANCESTOR of this line.
 *
 * Looking a fixed number of lines back is not enough: the TDS module opens one
 * scroller and renders eight tables under it, the first of them 56 lines down,
 * and a lookback window reports all eight as unwrapped. So walk backwards
 * keeping a running balance of `</div>` against `<div`. Each time the balance
 * goes below zero we have stepped out through an opening tag that is still
 * open at the table — an actual ancestor — and that is the one to examine.
 */
const insideScroller = (lines, index) => {
  let balance = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i];
    balance += (line.match(/<\/div>/g) || []).length;
    for (const open of line.match(/<div\b[^>]*>?/g) || []) {
      /* A self-closing div cannot be an ancestor of anything. */
      if (/\/>$/.test(open)) continue;
      if (balance > 0) {
        balance -= 1;
        continue;
      }
      if (/ui-table-scroll/.test(open)) return true;
    }
  }
  return false;
};

const wideTables = () => {
  const out = [];
  for (const file of sourceFiles()) {
    const lines = readFileSync(resolve(root, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/<table[^>]*ui-table-wide/.test(line)) return;
      if (!inListShell(lines, i)) return;
      out.push({ at: `${relative(root, file)}:${i + 1}`, wrapped: insideScroller(lines, i) });
    });
  }
  return out;
};

describe('wide list tables', () => {
  it('are each wrapped in a scroller, so no column is unreachable', () => {
    expect(wideTables().filter((t) => !t.wrapped).map((t) => t.at)).toEqual([]);
  });

  /* Guards the assertion above against passing on an empty search. */
  it('exist to be checked', () => {
    expect(wideTables().length).toBeGreaterThan(8);
  });
});
