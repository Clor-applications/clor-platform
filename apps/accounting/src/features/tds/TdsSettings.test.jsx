import { useEffect, useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import TdsSettings from './TdsSettings';

/**
 * Configuration → Taxation → TDS: everything an administrator decides, in
 * one place — and the Rule Master's figures shown read-only, because a
 * settings page that let somebody retype a rate would be a second answer.
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

  it('carries the five sections', () => {
    render(<Host />);
    for (const title of ['Enable TDS', 'TDS Profile', 'TDS Natures / Rules', 'Ledger Mapping', 'Party Defaults']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('the profile asks the specified fields, and hides the compliance rest under Advanced', async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.getByLabelText('TAN')).toHaveValue('BLRN12345F');
    expect(screen.getByLabelText('Deductor Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Deductor Type')).toBeInTheDocument();
    expect(screen.getByText('Financial Year Context')).toBeInTheDocument();
    expect(screen.getByLabelText('Default Nature')).toBeInTheDocument();
    expect(screen.getByLabelText('Default Payable Ledger')).toBeInTheDocument();
    expect(screen.getByLabelText('Default Receivable Ledger')).toBeInTheDocument();

    /* Advanced holds the rest, folded. */
    expect(screen.queryByLabelText('Deductor State')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(screen.getByLabelText('Deductor State')).toBeInTheDocument();
  });

  it('the rules section states the master, with nothing to type', () => {
    render(<Host />);
    const section = screen.getByRole('heading', { name: 'TDS Natures / Rules' }).closest('section');
    expect(within(section).getByText('Reference in force')).toBeInTheDocument();
    /* Read-only: the section renders no input at all. */
    expect(within(section).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(section).queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('ledger mapping lists both sides; party defaults flag the missing PAN', () => {
    render(<Host />);
    const mapping = screen.getByRole('heading', { name: 'Ledger Mapping' }).closest('section');
    expect(within(mapping).getByText('TDS Payable - Contractor')).toBeInTheDocument();
    expect(within(mapping).getByText('TDS Receivable - Contractor')).toBeInTheDocument();

    const parties = screen.getByRole('heading', { name: 'Party Defaults' }).closest('section');
    expect(within(parties).getByText('Steel Supply Co')).toBeInTheDocument();
    expect(within(parties).getByText(/no PAN/)).toBeInTheDocument();
  });

  it('saves the profile onto the company, defaults included', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.selectOptions(screen.getByLabelText('Default Payable Ledger'), '201');
    await user.selectOptions(screen.getByLabelText('Default Nature'), 'CONTRACTOR_SUB_CONTRACTOR');
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));

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
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    expect(latest.db.companies[0].profile.taxCompliances.tds.tan).toBe('BLRN12345F');
  });
});
