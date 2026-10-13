import { describe, expect, it } from 'vitest';

import { ruleLedgerMapping, tdsEventFrom } from './engine';
import {
  NEW_ACT_FROM,
  TDS_NATURES,
  TDS_RULE_VERSIONS,
  resolveRule,
  ruleById,
  ruleDeducteeRates,
} from './ruleMaster';

/**
 * The Rule Master's CRITICAL contract: history is never overwritten.
 *
 * A change to a rate, a threshold, a section reference or a mapping is a NEW
 * version; the shipped versions keep their ids and figures for ever, because
 * posted records name them. The pins below are the enforcement — an in-place
 * edit fails here; appending a V3 passes untouched.
 */

const CONTRACTOR = 'CONTRACTOR_SUB_CONTRACTOR';

describe('the shipped versions are frozen', () => {
  /* The exact payloads posted data replays under. Changing any figure here
     is declared a violation, not an update — updates append versions. */
  it('194C V1 and V2 carry the figures they shipped with', () => {
    expect(ruleById(`${CONTRACTOR}@V1`)).toMatchObject({
      natureCode: CONTRACTOR,
      historicalSection: '194C',
      statutoryReference: '194C',
      rate: 2,
      rateIndividual: 1,
      single: 30000,
      annual: 100000,
      calculationBase: 'TAXABLE_VALUE',
      deductionTrigger: 'CREDIT_OR_PAYMENT_EARLIER',
      returnCategory: '26Q',
      effectiveTo: '2026-03-31',
    });
    expect(ruleById(`${CONTRACTOR}@V2`)).toMatchObject({
      historicalSection: '194C',
      rate: 2,
      effectiveFrom: NEW_ACT_FROM,
      effectiveTo: null,
    });
    /* The consolidated reference differs; the deduction does not. */
    expect(ruleById(`${CONTRACTOR}@V2`).statutoryReference).not.toBe('194C');
  });

  it('every nature has contiguous windows with no gap at the Act boundary', () => {
    for (const n of TDS_NATURES) {
      const versions = TDS_RULE_VERSIONS.filter((r) => r.natureCode === n.code).sort((a, b) => a.version - b.version);
      expect(versions.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < versions.length; i += 1) {
        const prevTo = new Date(versions[i - 1].effectiveTo);
        const nextFrom = new Date(versions[i].effectiveFrom);
        expect(nextFrom - prevTo).toBe(24 * 60 * 60 * 1000);
      }
      expect(versions[versions.length - 1].effectiveTo).toBeNull();
    }
  });

  it('resolution follows the transaction date across the boundary', () => {
    expect(resolveRule(CONTRACTOR, '2026-03-31').id).toBe(`${CONTRACTOR}@V1`);
    expect(resolveRule(CONTRACTOR, NEW_ACT_FROM).id).toBe(`${CONTRACTOR}@V2`);
  });
});

describe('posted records retain their version', () => {
  it('an event keeps the id it was posted under while resolution moves on', () => {
    const oldRule = resolveRule(CONTRACTOR, '2026-03-01');
    const event = tdsEventFrom(
      {
        natureCode: CONTRACTOR,
        ruleVersionId: oldRule.id,
        statutoryReference: oldRule.statutoryReference,
        sectionCode: oldRule.sectionCode,
        baseAmount: 100000,
        rate: 2,
        tdsAmount: 2000,
        ledgerId: '201',
        side: 'PAYABLE',
      },
      {
        company: { id: 1, name: 'Neev Steels', profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F' } } } },
        party: { id: 2, name: 'Sharp Contractors', pan: 'ABCDE1234F' },
        source: { type: 'bill', id: 7, number: 'BILL-7' },
        date: '2026-03-01',
      }
    );

    expect(event.ruleVersionId).toBe(`${CONTRACTOR}@V1`);
    expect(event.sectionReference).toBe('194C');
    /* Today's resolution has moved to V2 — the event has not. */
    expect(resolveRule(CONTRACTOR, '2026-09-13').id).toBe(`${CONTRACTOR}@V2`);
    /* And the version the event names is still retrievable, figures intact. */
    expect(ruleById(event.ruleVersionId).rate).toBe(2);
  });
});

describe('the remaining specified fields answer', () => {
  it('deductee category rates come from the rule, per category', () => {
    expect(ruleDeducteeRates(ruleById(`${CONTRACTOR}@V1`))).toEqual([
      { category: 'COMPANY', rate: 2 },
      { category: 'INDIVIDUAL', rate: 1 },
    ]);
  });

  it('ledger mapping realizes per company chart, both sides', () => {
    const ledgers = [
      { id: 201, name: 'TDS Payable - Contractor', tdsNatureCode: CONTRACTOR, tdsSide: 'PAYABLE' },
      { id: 202, name: 'TDS Receivable - Contractor', tdsNatureCode: CONTRACTOR, tdsSide: 'RECEIVABLE' },
      { id: 203, name: 'TDS Payable - Professional', tdsNatureCode: 'PROFESSIONAL_SERVICES', tdsSide: 'PAYABLE' },
    ];
    const mapping = ruleLedgerMapping(ruleById(`${CONTRACTOR}@V2`), ledgers);
    expect(mapping.payable.map((l) => l.id)).toEqual([201]);
    expect(mapping.receivable.map((l) => l.id)).toEqual([202]);
  });
});
