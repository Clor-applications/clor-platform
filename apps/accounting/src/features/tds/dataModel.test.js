/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';

import { TDS_NATURES, TDS_RULE_VERSIONS, resolveRule } from './ruleMaster';
import { filingFor } from './returns';
import {
  challanRegister,
  dueSummary,
  partyWise,
  payableSummary,
  tdsEvents,
  tdsExceptions,
  tdsReconciliation,
} from './reports';

/**
 * The logical data model, stated as invariants.
 *
 * The specification's twelve entities map onto the existing domain rather
 * than twelve new tables — integration over duplication, as it asks:
 *
 *   tds_profile            → company.profile.taxCompliances.tds
 *   tds_nature             → TDS_NATURES        (statutory master, frozen)
 *   tds_rule_version       → TDS_RULE_VERSIONS  (statutory master, frozen)
 *   tds_ledger_mapping     → chartOfAccounts rows (tdsSide / tdsNatureCode)
 *   party_tds_profile      → vendors / customers tds* fields
 *   tds_transaction        → db.tdsTransactions
 *   tds_challan            → db.tdsChallans
 *   tds_challan_allocation → db.tdsChallanAllocations
 *   tds_return             → db.tdsFilings (status, versioned exports, ack)
 *   tds_return_item        → derived returnDataset lines (amounts are never
 *                            maintained, per the reports rule; the filing's
 *                            exports store each version's totals + signature)
 *   tds_exception          → derived tdsExceptions (cannot go stale)
 *   tds_audit_log          → audit fields + lineage ON the rows themselves
 *                            (createdBy/At, modifiedBy/At, reversalOfId,
 *                            correctionOfId, reason) — event-sourced
 *
 * A browser store has no SQL constraints, so the equivalents are enforced
 * here: uniqueness on the masters, company isolation on every reader, and
 * runtime immutability on everything statutory.
 */

const CONTRACTOR = 'CONTRACTOR_SUB_CONTRACTOR';

const event = (companyId, over = {}) => ({
  companyId,
  side: 'PAYABLE',
  status: 'Posted',
  partyId: 9,
  partyName: `Party of ${companyId}`,
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
  returnQuarter: 'FY 2026-27 Q2',
  sourceType: 'bill',
  sourceId: companyId * 10,
  ...over,
});

/* Two companies, everything doubled — nothing of company 2 may ever reach a
   company-1 reader. */
const twoCompanyDb = {
  companies: [
    { id: 1, name: 'Neev Steels', profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F' } } } },
    { id: 2, name: 'Other Co', profile: { taxCompliances: { tds: { enabled: true, tan: 'MUMO54321Z' } } } },
  ],
  chartOfAccounts: [
    { id: 101, companyId: 1, name: 'TDS Payable - Contractor', tdsNatureCode: CONTRACTOR, tdsSide: 'PAYABLE' },
    { id: 201, companyId: 2, name: 'TDS Payable - Contractor (2)', tdsNatureCode: CONTRACTOR, tdsSide: 'PAYABLE' },
  ],
  vendors: [],
  customers: [],
  invoices: [],
  payments: [],
  tdsTransactions: [
    { id: 1, ...event(1) },
    { id: 2, ...event(2, { tdsAmount: 9999, partyName: 'LEAK IF SEEN' }) },
  ],
  tdsChallans: [
    { id: 1, companyId: 1, number: 'CH-1', paymentDate: '2026-10-07', taxAmount: 2000 },
    { id: 2, companyId: 2, number: 'CH-LEAK', paymentDate: '2026-10-07', taxAmount: 9999 },
  ],
  tdsChallanAllocations: [
    { id: 1, companyId: 1, challanId: 1, tdsTransactionId: 1, amount: 2000 },
    { id: 2, companyId: 2, challanId: 2, tdsTransactionId: 2, amount: 9999 },
  ],
  tdsFilings: [
    { id: 1, companyId: 1, quarter: 'FY 2026-27 Q2', status: 'Frozen', checksum: 'x', exports: [] },
    { id: 2, companyId: 2, quarter: 'FY 2026-27 Q2', status: 'Filed', checksum: 'y', exports: [] },
  ],
};

describe('company isolation, on every reader', () => {
  it('no reader lets another company through', () => {
    expect(tdsEvents(twoCompanyDb, 1, {}).every((e) => e.companyId === 1)).toBe(true);
    expect(payableSummary(twoCompanyDb, 1, {}).deducted).toBe(2000);
    expect(partyWise(twoCompanyDb, 1, {}).some((r) => r.partyName === 'LEAK IF SEEN')).toBe(false);
    expect(challanRegister(twoCompanyDb, 1).map((c) => c.number)).toEqual(['CH-1']);
    expect(tdsExceptions(twoCompanyDb, 1, {}).every((x) => !String(x.message).includes('9999'))).toBe(true);
    expect(tdsReconciliation(twoCompanyDb, 1, {}).register).toBe(2000);
    expect(dueSummary(twoCompanyDb, 1, '2026-12-01').due).toBe(0);
    expect(filingFor(twoCompanyDb, 1, 'FY 2026-27 Q2').status).toBe('Frozen');
  });
});

describe('uniqueness, where a database would have a constraint', () => {
  it('nature codes and rule version ids are unique', () => {
    const natureCodes = TDS_NATURES.map((n) => n.code);
    expect(new Set(natureCodes).size).toBe(natureCodes.length);
    const ruleIds = TDS_RULE_VERSIONS.map((r) => r.id);
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
  });
});

describe('statutory immutability is runtime, not convention', () => {
  it('mutating a rule version THROWS — history cannot be restated in place', () => {
    const rule = resolveRule(CONTRACTOR, '2026-09-12');
    expect(() => {
      'use strict';
      rule.rate = 99;
    }).toThrow();
    expect(rule.rate).toBe(2);

    expect(() => {
      'use strict';
      TDS_NATURES[0].name = 'Renamed';
    }).toThrow();
    expect(Object.isFrozen(TDS_RULE_VERSIONS)).toBe(true);
  });
});
