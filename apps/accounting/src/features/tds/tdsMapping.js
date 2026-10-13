import { natureForSection } from './ruleMaster';

const text = (value) => String(value ?? '').trim();

export const ledgerTdsNatureCode = (ledger) =>
  text(ledger?.tdsNatureCode) || natureForSection(ledger?.tdsSection)?.code || '';

const updateCompanyMappings = (companies, companyId, updater) =>
  (companies || []).map((company) => {
    if (String(company?.id) !== String(companyId)) return company;
    const profile = company.profile || {};
    const taxCompliances = profile.taxCompliances || {};
    const tds = taxCompliances.tds || {};
    return {
      ...company,
      profile: {
        ...profile,
        taxCompliances: {
          ...taxCompliances,
          tds: updater(tds),
        },
      },
    };
  });

/** Keep a TDS Payable ledger and its section-master link as one mapping. */
export const linkTdsPayableLedger = (db, companyId, ledger, previousLedger = null) => {
  const natureCode = ledgerTdsNatureCode(ledger);
  const ledgerId = String(ledger.id);
  const previousNature = ledgerTdsNatureCode(previousLedger);
  const isPayable = String(ledger?.tdsSide || '').toUpperCase() === 'PAYABLE';

  const companies = updateCompanyMappings(db.companies, companyId, (tds) => {
    const rateOverrides = { ...(tds.rateOverrides || {}) };
    if (previousNature && (!isPayable || previousNature !== natureCode) && String(rateOverrides[previousNature]?.linkedLedgerId || '') === ledgerId) {
      rateOverrides[previousNature] = { ...rateOverrides[previousNature], linkedLedgerId: '' };
    }
    if (isPayable && natureCode) rateOverrides[natureCode] = { ...(rateOverrides[natureCode] || {}), linkedLedgerId: ledgerId };
    return { ...tds, rateOverrides };
  });

  if (!isPayable || !natureCode) return { ...db, companies };

  const chartOfAccounts = (db.chartOfAccounts || []).map((account) => {
    if (String(account?.companyId) !== String(companyId)) return account;
    if (String(account.id) === ledgerId) return ledger;
    if (ledgerTdsNatureCode(account) !== natureCode || String(account.tdsSide || '').toUpperCase() !== 'PAYABLE') return account;
    return { ...account, tdsNatureCode: undefined, tdsSection: undefined };
  });
  return { ...db, companies, chartOfAccounts };
};

/** Apply the section drawer's mappings back to the linked Chart of Accounts rows. */
export const applyTdsSectionLedgerMappings = (db, companyId, rows) => {
  const mappedByLedger = new Map();
  const mappedByNature = new Map();
  for (const row of rows || []) {
    const ledgerId = text(row?.linkedLedgerId);
    const natureCode = text(row?.natureCode);
    if (!ledgerId || !natureCode) continue;
    const mapping = { ledgerId, natureCode, sectionCode: text(row?.legacyCode || row?.code) };
    mappedByLedger.set(ledgerId, mapping);
    mappedByNature.set(natureCode, mapping);
  }

  const chartOfAccounts = (db.chartOfAccounts || []).map((account) => {
    if (String(account?.companyId) !== String(companyId)) return account;
    const id = String(account.id);
    const selected = mappedByLedger.get(id);
    if (selected) return { ...account, tdsNatureCode: selected.natureCode, tdsSection: selected.sectionCode, tdsSide: 'PAYABLE' };
    const currentNature = ledgerTdsNatureCode(account);
    if (String(account.tdsSide || '').toUpperCase() === 'PAYABLE' && currentNature && mappedByNature.has(currentNature)) {
      return { ...account, tdsNatureCode: undefined, tdsSection: undefined };
    }
    return account;
  });
  return { ...db, chartOfAccounts };
};
