import { useEffect, useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import TdsSettings from './TdsSettings';

/**
 * Configuration → Taxation → TDS: the deductor's profile and the defaults a
 * transaction starts from, with the e-filing details one view away.
 *
 * Rewritten 30 Oct 2026. The old version described a five-section page
 * (Enable TDS, Profile, Natures / Rules, Ledger Mapping, Party Defaults) that
 * this repository never shipped: the screen arrived at the initial import
 * (00f6a61a) as a header with a view picker — Defaults & Mapping, E-Filing
 * Details — and the sections table under Masters (`sectionsOnly`). The
 * guards that still mean something are kept: the profile fields, the two
 * ledger sides kept apart, Save writing onto the company, and no TDS
 * without a real TAN.
 */

const COMPANY = {
  id: 1,
  name: 'Neev Steels',
  profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F' } } },
};

const db0 = {
  companies: [COMPANY],
  accountGroups: [
    { id: 30, companyId: 1, name: 'Statutory Payables', parentGroupId: null },
    { id: 31, companyId: 1, name: 'TDS Payable', parentGroupId: 30 },
    { id: 32, companyId: 1, name: 'Statutory Receivables', parentGroupId: null },
    { id: 33, companyId: 1, name: 'TDS Receivable', parentGroupId: 32 },
  ],
  chartOfAccounts: [
    { id: 201, companyId: 1, name: 'TDS Payable - Contractor', groupId: 31, tdsNatureCode: 'CONTRACTOR_SUB_CONTRACTOR' },
    { id: 202, companyId: 1, name: 'TDS Receivable - Contractor', groupId: 33, tdsNatureCode: 'CONTRACTOR_SUB_CONTRACTOR' },
  ],
  vendors: [
    { id: 9, companyId: 1, name: 'Steel Supply Co', tdsApplicable: true, tdsNatureCode: 'CONTRACTOR_SUB_CONTRACTOR', pan: '' },
  ],
  customers: [],
  tdsTransactions: [],
};

const latest = { db: db0 };
const Host = () => {
  const [db, setDb] = useState(db0);
  useEffect(() => {
    latest.db = db;
  }, [db]);
  const company = db.companies.find((c) => c.id === 1);
  return (
    <TdsSettings
      db={db}
      setDb={(next) => setDb((prev) => (typeof next === 'function' ? next(prev) : next))}
      currentCompany={company}
      onOpenChart={() => {}}
    />
  );
};

describe('the configuration page', () => {
  beforeEach(() => {
    latest.db = db0;
  });

  it('opens on the profile and the defaults', () => {
    render(<Host />);
    expect(screen.getByRole('heading', { name: 'TDS Profile' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Defaults & Mapping' })).toBeInTheDocument();
    expect(screen.getByLabelText('TAN')).toHaveValue('BLRN12345F');
    expect(screen.getByLabelText('Deductor Name')).toHaveValue('Neev Steels');
    expect(screen.getByLabelText('Deductor Type')).toBeInTheDocument();
    expect(screen.getByText('Financial Year')).toBeInTheDocument();
    expect(screen.getByLabelText('Default Nature')).toBeInTheDocument();
  });

  it('offers each default ledger from its own side only', () => {
    render(<Host />);
    const names = (label) => within(screen.getByLabelText(label)).getAllByRole('option').map((o) => o.textContent);
    expect(names('Default Payable Ledger')).toContain('TDS Payable - Contractor');
    expect(names('Default Payable Ledger')).not.toContain('TDS Receivable - Contractor');
    expect(names('Default Receivable Ledger')).toContain('TDS Receivable - Contractor');
    expect(names('Default Receivable Ledger')).not.toContain('TDS Payable - Contractor');
  });

  it('keeps the e-filing details one view away', async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.queryByRole('heading', { name: 'E-Filing Details' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('TDS view'), 'filing');
    expect(screen.getByRole('heading', { name: 'E-Filing Details' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'TDS Profile' })).toBeNull();
  });

  it('saves the profile onto the company, defaults included', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.selectOptions(screen.getByLabelText('Default Payable Ledger'), '201');
    await user.selectOptions(screen.getByLabelText('Default Nature'), 'CONTRACTOR_SUB_CONTRACTOR');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const tds = latest.db.companies[0].profile.taxCompliances.tds;
    expect(tds).toMatchObject({
      enabled: true,
      tan: 'BLRN12345F',
      defaultPayableLedgerId: '201',
      defaultNatureCode: 'CONTRACTOR_SUB_CONTRACTOR',
    });
  });

  it('refuses to enable TDS without a real TAN', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const tan = screen.getByLabelText('TAN');
    await user.clear(tan);
    await user.type(tan, 'NOT-A-TAN');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(latest.db.companies[0].profile.taxCompliances.tds.tan).toBe('BLRN12345F');
  });
});
