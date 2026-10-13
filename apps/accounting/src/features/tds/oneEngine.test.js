import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveTds } from './engine';

/**
 * ONE calculation engine, and the pins that keep it one.
 *
 * Purchase, payment, sales and receipt all ask resolveTds; none of them may
 * grow a calculation of its own. The functional half below walks the
 * specification's input list and resolution order through the single entry
 * point; the static half fails the build if a screen reaches around it.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(join(SRC, f), 'utf8');

describe('every deducting screen asks the one engine', () => {
  it('purchase, payment and sales import resolveTds', () => {
    for (const f of ['features/purchase/index.jsx', 'features/payments/RecordDisbursementForm.jsx', 'features/sales/index.jsx']) {
      expect(read(f)).toMatch(/\bresolveTds\b/);
    }
  });

  /* The rate lookup that bypassed date resolution: nobody outside the tax
     master itself may call it. A screen that wants a rate resolves the rule
     for the document's date. */
  it('no feature calls tdsDefaultRate around the rule master', () => {
    const hits = execSync(
      `grep -rl "tdsDefaultRate" ${JSON.stringify(join(SRC, 'features'))} --include=*.jsx --include=*.js || true`,
      { encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean)
      .filter((f) => !/\.test\./.test(f))
      .filter((f) => !f.includes(`features${join('/', 'tds')}`));
    expect(hits).toEqual([]);
  });
});

describe('the specified input list, through the one entry point', () => {
  const company = {
    id: 1,
    name: 'Neev Steels',
    profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F', defaultNatureCode: 'PROFESSIONAL_SERVICES' } } },
  };
  const LEDGERS = [
    { id: 101, name: 'TDS Payable - Contractor', tdsNatureCode: 'CONTRACTOR_SUB_CONTRACTOR', tdsSide: 'PAYABLE' },
    { id: 102, name: 'TDS Payable - Professional', tdsNatureCode: 'PROFESSIONAL_SERVICES', tdsSide: 'PAYABLE' },
  ];
  const ask = (over = {}) =>
    resolveTds({
      company,
      branchId: 'b-blr',
      party: { id: 9, name: 'Steel Supply Co', pan: 'AABCU9603R', tdsApplicable: true, tdsNatureCode: 'CONTRACTOR_SUB_CONTRACTOR' },
      transactionType: 'bill',
      transactionDate: '2026-09-12',
      taxableBase: 100000,
      ledgers: LEDGERS,
      ...over,
    });

  it('carries branch and transaction type into the result', () => {
    const r = ask();
    expect(r.branchId).toBe('b-blr');
    expect(r.transactionType).toBe('bill');
  });

  it('resolves nature: explicit, then party, then company, then none', () => {
    /* 1 — explicit wins over the party's contractor default. */
    expect(ask({ explicitNatureCode: 'PROFESSIONAL_SERVICES' }).natureCode).toBe('PROFESSIONAL_SERVICES');
    /* 2 — the party's own default. */
    expect(ask().natureCode).toBe('CONTRACTOR_SUB_CONTRACTOR');
    /* 3 — the company default when the party names none. */
    expect(ask({ party: { id: 9, name: 'Plain Co', pan: 'AABCU9603R' } }).natureCode).toBe('PROFESSIONAL_SERVICES');
    /* 4 — no nature anywhere is no TDS, not an error. */
    const bare = { ...company, profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F' } } } };
    const r = ask({ company: bare, party: { id: 9, name: 'Plain Co', pan: 'AABCU9603R' } });
    expect(r.applicable).toBe(false);
    expect(r.tdsAmount).toBe(0);
  });

  it('a valid nature with no mapped ledger BLOCKS the posting', () => {
    const r = ask({ ledgers: [] });
    expect(r.blocked).toBe(true);
    expect(r.warnings.some((w) => w.severity === 'BLOCK' && w.code === 'NO_LEDGER')).toBe(true);
  });
});
