import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* src/test/ → src/ */
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

const APP = readFileSync(src('App.jsx'), 'utf8');

/**
 * A master is a longer job than an invoice, not a shorter one.
 *
 * Master Data was a set of dialogs: a form in a box over a greyed-out list,
 * with Save at the foot of whatever scrolled inside it. Documents in Sales and
 * Purchases have never worked that way — a new invoice takes the screen, names
 * itself top left, and keeps every way out of it top right.
 *
 * Stated against the source, because what was wrong is the call site: a master
 * form handed to the modal is the bug, wherever it is written.
 */

const MASTER_TITLES = [
  'New Item',
  'Edit Item',
  'New Customer',
  'New Vendor',
];

describe('master forms are screens', () => {
  it('none of them is handed to the modal with a title', () => {
    const offenders = MASTER_TITLES.filter((t) => APP.includes(`title: '${t}'`));
    expect(offenders).toEqual([]);
  });

  it('the item master renders full page from its own list', () => {
    expect(APP).toMatch(/const \[itemForm, setItemForm\] = useState\(null\)/);
    expect(APP).toMatch(/<ItemForm\s*\n\s*fullPage/);
  });

  /*
   * The exception, and it is one rule not a list of names: creating a master in
   * the middle of a document stays a dialog. Sending the document off screen to
   * name a customer is how you lose the document.
   */
  it('keeps the quick create inside a document a dialog', () => {
    expect(APP).toMatch(/title: 'New Ledger'/);
  });

  it('keeps master routes inside the Master Data workspace before considering report routes', () => {
    const masterBranch = APP.indexOf('{dedicatedMasterDataMode ? (');
    const reportBranch = APP.indexOf(': reportPageKeys.has(String(active))', masterBranch);
    expect(masterBranch).toBeGreaterThan(-1);
    expect(reportBranch).toBeGreaterThan(masterBranch);
  });
});
