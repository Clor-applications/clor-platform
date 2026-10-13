/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';

import { datasetChecksum, filingFor, quarterValidation, returnCsv, returnDataset } from './returns';

/**
 * Whether a quarter can be filed, and what it would say.
 *
 * V1 does not file — no portal, no TRACES — but it does know. A quarter is
 * either complete or it is not, and the difference is a handful of checks
 * somebody would otherwise do by eye, in a spreadsheet, in April.
 */

const CONTRACTOR = 'CONTRACTOR_SUB_CONTRACTOR';
const Q = 'FY 2026-27 Q2';

const event = (over) => ({
  companyId: 1,
  side: 'PAYABLE',
  status: 'Posted',
  partyId: 9,
  partyName: 'Steel Supply Co',
  panSnapshot: 'AABCU9603R',
  natureCode: CONTRACTOR,
  ruleVersionId: `${CONTRACTOR}@V2`,
  sectionReference: '393(1) Table 6(i)',
  sectionCode: '194C',
  ledgerId: '101',
  baseAmount: 100000,
  rate: 2,
  tdsAmount: 2000,
  transactionDate: '2026-09-12',
  deductionDate: '2026-09-12',
  returnQuarter: Q,
  sourceType: 'bill',
  sourceId: 1,
  ...over,
});

const COMPANY = {
  id: 1,
  name: 'Neev Steels',
  profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F', deductorName: 'Neev Steels Pvt Ltd', deductorType: 'COMPANY' } } },
};

const dbWith = (events, over = {}) => ({
  companies: [COMPANY],
  chartOfAccounts: [{ id: 101, companyId: 1, name: 'TDS Payable - Contractor' }],
  tdsTransactions: events,
  tdsChallans: [{ id: 1, companyId: 1, number: 'CHL-1', paymentDate: '2026-10-07', taxAmount: 2000 }],
  tdsChallanAllocations: [{ id: 1, companyId: 1, challanId: 1, tdsTransactionId: 1, amount: 2000 }],
  ...over,
});

describe('whether the quarter can be filed', () => {
  it('is ready when every deduction is described and paid', () => {
    const v = quarterValidation(dbWith([{ id: 1, ...event() }]), 1, Q);
    expect(v.ready).toBe(true);
    expect(v.blocking).toEqual([]);
    expect(v.eventCount).toBe(1);
  });

  /* A deduction the department cannot be told about at all. */
  it('blocks a deduction with no section, rule or ledger', () => {
    const db = dbWith([
      { id: 1, ...event({ sectionCode: '' }) },
      { id: 2, ...event({ sourceId: 2, ruleVersionId: '' }) },
      { id: 3, ...event({ sourceId: 3, ledgerId: '' }) },
    ]);
    const codes = quarterValidation(db, 1, Q).blocking.map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['NO_SECTION', 'NO_RULE', 'NO_LEDGER']));
    expect(quarterValidation(db, 1, Q).ready).toBe(false);
  });

  it('blocks a company with no TAN', () => {
    const db = dbWith([{ id: 1, ...event() }], {
      companies: [{ ...COMPANY, profile: { taxCompliances: { tds: { enabled: true } } } }],
    });
    expect(quarterValidation(db, 1, Q).blocking.map((p) => p.code)).toContain('NO_TAN');
  });

  /* Warnings are filed with and explained — they do not stop the quarter. */
  it('warns about a PAN that is missing or malformed, without blocking', () => {
    const missing = quarterValidation(dbWith([{ id: 1, ...event({ panSnapshot: '' }) }]), 1, Q);
    expect(missing.warnings.map((p) => p.code)).toContain('PAN_INVALID');
    expect(missing.blocking).toEqual([]);

    const wrong = quarterValidation(dbWith([{ id: 1, ...event({ panSnapshot: 'NOTAPAN' }) }]), 1, Q);
    expect(wrong.warnings.map((p) => p.code)).toContain('PAN_INVALID');
  });

  it('warns about tax deducted and not yet paid over', () => {
    const db = dbWith([{ id: 1, ...event() }], { tdsChallanAllocations: [] });
    expect(quarterValidation(db, 1, Q).warnings.map((p) => p.code)).toContain('UNPAID');
  });

  it('warns when a challan covers only part of a deduction', () => {
    const db = dbWith([{ id: 1, ...event() }], {
      tdsChallanAllocations: [{ id: 1, companyId: 1, challanId: 1, tdsTransactionId: 1, amount: 500 }],
    });
    expect(quarterValidation(db, 1, Q).warnings.map((p) => p.code)).toContain('PART_PAID');
  });

  it('says an empty quarter is empty rather than ready', () => {
    const v = quarterValidation(dbWith([]), 1, Q);
    expect(v.ready).toBe(false);
    expect(v.problems.map((p) => p.code)).toContain('EMPTY');
  });
});

describe('what the return would say', () => {
  /* A 26Q is deductee-wise: five bills to one contractor under one section are
     one line, with the challan that paid them named against it. */
  it('is one line per deductee, section and rate', () => {
    const db = dbWith([
      { id: 1, ...event() },
      { id: 2, ...event({ sourceId: 2, tdsAmount: 500, baseAmount: 25000, deductionDate: '2026-08-02' }) },
      { id: 3, ...event({ sourceId: 3, partyId: 4, partyName: 'Acme Works', panSnapshot: 'AAACA1111A', tdsAmount: 5000, baseAmount: 50000 }) },
    ]);
    const data = returnDataset(db, 1, Q);

    expect(data.lines).toHaveLength(2);
    const steel = data.lines.find((l) => l.deductee === 'Steel Supply Co');
    expect(steel).toMatchObject({ baseAmount: 125000, tdsAmount: 2500, paidAmount: 2000, sectionCode: '194C', rate: 2 });
    expect(steel.deductionDates).toEqual(['2026-08-02', '2026-09-12']);
    expect(steel.challans).toEqual(['CHL-1']);
  });

  it('keeps a different rate on its own line, as the return does', () => {
    const db = dbWith([
      { id: 1, ...event() },
      /* No PAN: deducted at 20%, and reported separately. */
      { id: 2, ...event({ sourceId: 2, rate: 20, tdsAmount: 20000 }) },
    ]);
    expect(returnDataset(db, 1, Q).lines.map((l) => l.rate).sort((a, b) => a - b)).toEqual([2, 20]);
  });

  it('carries the deductor the challan and return both need', () => {
    const data = returnDataset(dbWith([{ id: 1, ...event() }]), 1, Q);
    expect(data.deductor).toEqual({ name: 'Neev Steels Pvt Ltd', tan: 'BLRN12345F', type: 'COMPANY' });
  });

  it('totals what was deducted, what was deposited and how many deductees', () => {
    const db = dbWith([
      { id: 1, ...event() },
      { id: 2, ...event({ sourceId: 2, partyId: 4, partyName: 'Acme Works', tdsAmount: 5000, baseAmount: 50000 }) },
    ]);
    expect(returnDataset(db, 1, Q).totals).toEqual({
      baseAmount: 150000,
      tdsAmount: 7000,
      paidAmount: 2000,
      deductees: 2,
    });
  });

  it('exports as CSV, with the reference each deduction carried', () => {
    const csv = returnCsv(returnDataset(dbWith([{ id: 1, ...event() }]), 1, Q));
    const [head, first] = csv.split('\n');
    expect(head).toContain('PAN');
    expect(first).toContain('AABCU9603R');
    expect(first).toContain('393(1) Table 6(i)');
  });

  it('quotes a name that would otherwise break the columns', () => {
    const db = dbWith([{ id: 1, ...event({ partyName: 'Steel, Supply & Co' }) }]);
    expect(returnCsv(returnDataset(db, 1, Q))).toContain('"Steel, Supply & Co"');
  });
});

describe('the freeze pins a signature', () => {
  it('the checksum is stable for the same state and moves with one paisa', () => {
    const base = dbWith([{ id: 1, ...event() }]);
    const a = datasetChecksum(returnDataset(base, 1, Q));
    expect(datasetChecksum(returnDataset(base, 1, Q))).toBe(a);

    const moved = dbWith([{ id: 1, ...event({ tdsAmount: 2000.01 }) }]);
    expect(datasetChecksum(returnDataset(moved, 1, Q))).not.toBe(a);
  });

  it('filingFor finds the quarter record and nothing else', () => {
    const withFiling = dbWith([{ id: 1, ...event() }], {
      tdsFilings: [{ id: 1, companyId: 1, quarter: Q, status: 'Frozen', checksum: 'x', exports: [] }],
    });
    expect(filingFor(withFiling, 1, Q)).toMatchObject({ status: 'Frozen' });
    expect(filingFor(withFiling, 1, 'FY 2026-27 Q1')).toBeNull();
    expect(filingFor(withFiling, 2, Q)).toBeNull();
  });
});
