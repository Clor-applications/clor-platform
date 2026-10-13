import { describe, expect, it } from 'vitest';

import { applyTdsSectionLedgerMappings, linkTdsPayableLedger } from './tdsMapping';

const company = { id: 1, profile: { taxCompliances: { tds: { rateOverrides: {} } } } };
const payable = (id, nature = '') => ({ id, companyId: 1, name: `TDS ${id}`, groupId: 10, tdsSide: 'PAYABLE', tdsNatureCode: nature });

describe('TDS section and payable-ledger mapping', () => {
  it('links a newly created payable ledger back to its section', () => {
    const ledger = payable(101, 'CONTRACTOR_SUB_CONTRACTOR');
    const next = linkTdsPayableLedger({ companies: [company], chartOfAccounts: [ledger] }, 1, ledger);
    expect(next.companies[0].profile.taxCompliances.tds.rateOverrides.CONTRACTOR_SUB_CONTRACTOR.linkedLedgerId).toBe('101');
  });

  it('moves a section link when another payable ledger is selected', () => {
    const oldLedger = payable(101, 'CONTRACTOR_SUB_CONTRACTOR');
    const selected = payable(102);
    const next = applyTdsSectionLedgerMappings(
      { companies: [company], chartOfAccounts: [oldLedger, selected] },
      1,
      [{ natureCode: 'CONTRACTOR_SUB_CONTRACTOR', legacyCode: '194C', linkedLedgerId: '102' }]
    );
    expect(next.chartOfAccounts.find((row) => row.id === 102)).toMatchObject({ tdsNatureCode: 'CONTRACTOR_SUB_CONTRACTOR', tdsSection: '194C', tdsSide: 'PAYABLE' });
    expect(next.chartOfAccounts.find((row) => row.id === 101).tdsNatureCode).toBeUndefined();
  });

  it('clears the previous section when a ledger is remapped', () => {
    const previous = payable(101, 'CONTRACTOR_SUB_CONTRACTOR');
    const ledger = payable(101, 'PROFESSIONAL_SERVICES');
    const db = { companies: [{ ...company, profile: { taxCompliances: { tds: { rateOverrides: { CONTRACTOR_SUB_CONTRACTOR: { linkedLedgerId: '101' } } } } } }], chartOfAccounts: [ledger] };
    const next = linkTdsPayableLedger(db, 1, ledger, previous);
    const overrides = next.companies[0].profile.taxCompliances.tds.rateOverrides;
    expect(overrides.CONTRACTOR_SUB_CONTRACTOR.linkedLedgerId).toBe('');
    expect(overrides.PROFESSIONAL_SERVICES.linkedLedgerId).toBe('101');
  });
});
