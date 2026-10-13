/**
 * @vitest-environment node
 *
 * This file reads source, it does not render it. A jsdom for it costs about
 * twenty-five seconds of wall clock and is never touched.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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


/**
 * A series is corrected on the document that is using it.
 *
 * The invoice and the bill each grew the gear separately and every other
 * document had none, so changing a purchase order's prefix meant abandoning a
 * half-typed order for Settings. A series is nearly always realised to be
 * wrong WHILE a document is being typed — the year turned over, or the prefix
 * is last company's — and that is the moment it has to be reachable.
 */

/** Every file that allots a number from a local series. */
const filesAllotting = (voucherKey) =>
  execSync(`grep -rl "voucherKey: '${voucherKey}'" ${SRC_DIRS.map((d) => JSON.stringify(d)).join(' ')} --include=*.jsx || true`, {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !/\.test\.jsx?$/.test(f));

/** Whether that file also offers the series control. */
const carriesTheGear = (file) => {
  const src = readFileSync(file, 'utf8');
  return /DocNumberField|DocNumberingPopover|numbering=\{\{/.test(src);
};

describe('the numbering control', () => {
  /*
   * Receipts are here too now. Their number used to be whatever the server
   * minted, which made them the one document whose numbering nobody could see
   * or change — so the receipt reads the company's series like every other
   * form and sends it, and the server allocates one only when it is given
   * none. One series, either way.
   */
  const LOCAL_SERIES = [
    'receipt',
    'invoice',
    'bill',
    'estimate',
    'creditNote',
    'debitNote',
    'purchaseOrder',
    'salesOrder',
    'deliveryChallan',
    'expense',
    'journalEntry',
    /* The last three to catch up: the payment voucher, the POS counter and
       the stock adjustment batch. POS and adjustments have no number a person
       types — the gear rides the header / a series preview instead. */
    'payment',
    'pos',
    'stockAdjustment',
  ];

  for (const key of LOCAL_SERIES) {
    it(`is on the form that allots a ${key} number`, () => {
      const files = filesAllotting(key);
      expect(files.length).toBeGreaterThan(0);
      expect(files.filter((f) => !carriesTheGear(f))).toEqual([]);
    });
  }
});
