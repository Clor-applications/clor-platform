import { describe, expect, it } from 'vitest';

import { partyWise, tdsEvents } from './reports';
import { resolveRule } from './ruleMaster';
import { tdsEventFrom, tdsReversalEventFrom } from './engine';

/**
 * The normalized TDS transaction: a COMPLIANCE EVENT beside the accounting
 * source document, snapshotted at posting and never rewritten. The invoice,
 * payment or receipt stays the accounting truth; this row is what the
 * register, the challan and the return read — which is why every figure it
 * needs is frozen onto it, and a later edit to the vendor, the customer or
 * the rule must change nothing here.
 */

const COMPANY = {
  id: 1,
  name: 'Neev Steels',
  profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F' } } },
};

const CONTRACTOR = 'CONTRACTOR_SUB_CONTRACTOR';

const makeEvent = () => {
  const rule = resolveRule(CONTRACTOR, '2026-09-12');
  return tdsEventFrom(
    {
      natureCode: CONTRACTOR,
      ruleVersionId: rule.id,
      statutoryReference: rule.statutoryReference,
      sectionCode: rule.sectionCode,
      baseAmount: 100000,
      rate: 2,
      tdsAmount: 2000,
      ledgerId: '201',
      side: 'PAYABLE',
    },
    {
      company: COMPANY,
      party: { id: 9, name: 'Steel Supply Co', pan: 'AABCU9603R' },
      source: { type: 'bill', id: 7, number: 'BILL-7' },
      branchId: 'b-blr',
      date: '2026-09-12',
      by: 'suresh@neev.one',
    }
  );
};

describe('the entity carries every specified field', () => {
  it('company, branch, source, party, snapshots, audit and correction metadata', () => {
    const e = makeEvent();
    expect(e).toMatchObject({
      companyId: 1,
      branchId: 'b-blr',
      sourceType: 'bill',
      sourceId: 7,
      partyId: 9,
      panSnapshot: 'AABCU9603R',
      transactionDate: '2026-09-12',
      deductionDate: '2026-09-12',
      natureCode: CONTRACTOR,
      ruleVersionId: `${CONTRACTOR}@V2`,
      sectionCode: '194C',
      baseAmount: 100000,
      rate: 2,
      tdsAmount: 2000,
      ledgerId: '201',
      returnQuarter: expect.stringMatching(/Q2/),
      status: 'Posted',
      createdBy: 'suresh@neev.one',
      modifiedBy: null,
      modifiedAt: null,
      reversalOfId: null,
      correctionOfId: null,
    });
    expect(e.sectionReference).toBeTruthy();
    expect(e.createdAt).toBeTruthy();
  });
});

describe('snapshots survive every later change', () => {
  it('editing the party master rewrites nothing on a posted event', () => {
    const party = { id: 9, name: 'Steel Supply Co', pan: 'AABCU9603R' };
    const e = tdsEventFrom(
      { natureCode: CONTRACTOR, ruleVersionId: 'x@V1', statutoryReference: '194C', sectionCode: '194C', baseAmount: 1, rate: 2, tdsAmount: 2, ledgerId: '1', side: 'PAYABLE' },
      { company: COMPANY, party, source: { type: 'bill', id: 1, number: 'B1' }, date: '2026-09-01' }
    );
    /* The master changes; the snapshot does not. */
    party.pan = 'ZZZZZ9999Z';
    party.name = 'Renamed Co';
    expect(e.panSnapshot).toBe('AABCU9603R');
    expect(e.partyName).toBe('Steel Supply Co');

    /* And the reports read the snapshot, never the master. */
    const db = { tdsTransactions: [{ id: 1, ...e }], vendors: [party] };
    const rows = partyWise(db, 1, {});
    expect(rows[0].pan).toBe('AABCU9603R');
  });
});

describe('corrections are new events, never edits', () => {
  it('the reversal negates the amounts, keeps the snapshots and names its original', () => {
    const original = { id: 41, ...makeEvent() };
    const rev = tdsReversalEventFrom(original, { by: 'auditor@neev.one', reason: 'Bill deleted', date: '2026-10-02' });

    expect(rev.tdsAmount).toBe(-2000);
    expect(rev.baseAmount).toBe(-100000);
    expect(rev.reversalOfId).toBe(41);
    expect(rev.reversalReason).toBe('Bill deleted');
    expect(rev.createdBy).toBe('auditor@neev.one');
    /* Same frozen facts — PAN, rule, section, ledger. */
    expect(rev.panSnapshot).toBe(original.panSnapshot);
    expect(rev.ruleVersionId).toBe(original.ruleVersionId);
    expect(rev.ledgerId).toBe(original.ledgerId);
    /* It reports in ITS OWN quarter — the undo is this quarter's fact. */
    expect(rev.returnQuarter).toMatch(/Q3/);
    expect(rev.id).toBeUndefined();
  });

  it('a reversed pair leaves the live figures and stays as lineage', () => {
    const original = { id: 41, ...makeEvent() };
    const rev = { ...tdsReversalEventFrom(original, { date: '2026-09-20' }), id: 42 };
    const db = { tdsTransactions: [{ ...original, status: 'Reversed' }, rev] };
    const rows = tdsEvents(db, 1, { side: 'PAYABLE' });
    /* Both rows are out of the live set: the deduction is undone once, not
       counted and negated at the same time. */
    const liveTotal = rows
      .filter((e) => String(e.status).toLowerCase() === 'posted')
      .reduce((t, e) => t + Number(e.tdsAmount || 0), 0);
    expect(liveTotal).toBe(0);
    /* The lineage survives for the auditor: what was undone, by what. */
    expect(rows.find((e) => e.id === 41).status).toBe('Reversed');
    expect(rows.find((e) => e.id === 42)).toMatchObject({ status: 'Reversal', reversalOfId: 41 });
  });
});
