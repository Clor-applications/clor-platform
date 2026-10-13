/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The module IS three screens: where the money is, what happened to it, and
 * what the bank says. The specification allows exactly these sidebar
 * entries, so exactly these are pinned — a fourth entry appearing under the
 * group, or one going missing behind a feature flag, fails the build.
 */

const APP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../App.jsx'), 'utf8');

describe('the Cash & Bank sidebar', () => {
  it('has exactly: Bank & Cash Accounts, Transactions, Reconciliation', () => {
    const start = APP.indexOf("key: 'bankCashAccounts'");
    expect(start).toBeGreaterThan(-1);
    const group = APP.slice(start, APP.indexOf('],', start));

    const entries = [...group.matchAll(/key: '([^']+)', label: '([^']+)'/g)].map((m) => [m[1], m[2]]);
    expect(entries).toEqual([
      ['bankCashAccounts', 'Bank & Cash Accounts'],
      ['cashBank', 'Transactions'],
      ['bankReco', 'Reconciliation'],
    ]);

    /* And none of the three hides behind a feature flag — the permission is
       the only gate. */
    expect(group).not.toMatch(/feature:/);
  });
});
