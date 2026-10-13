import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/api/payments', () => ({
  listPaymentModes: vi.fn(async () => [
    { id: 'srv-cash', name: 'Cash', code: 'AUTO-CASH', controlKind: 'CASH' },
  ]),
}));

vi.mock('@ui/api/ledger', () => ({
  createLedgerAccount: vi.fn(async ({ name, controlKind, sourceKey }) => ({
    account: { id: `synced-${sourceKey}`, name, code: '', controlKind },
  })),
}));

import usePaymentModes, { modeLabel } from './usePaymentModes';

const db = {
  accountGroups: [
    { id: 1, companyId: 7, name: 'Cash-in-Hand', parentGroupId: null },
    { id: 2, companyId: 7, name: 'Bank Accounts', parentGroupId: null },
  ],
  chartOfAccounts: [
    { id: 10, companyId: 7, name: 'Cash', code: '', groupId: 1, serverLedgerAccountId: 'srv-cash' },
    { id: 11, companyId: 7, name: 'HDFC Current', code: '1010', groupId: 2, serverLedgerAccountId: 'srv-hdfc' },
    { id: 12, companyId: 7, name: 'Sales', code: '4000', groupId: 99 },
    { id: 13, companyId: 7, name: 'Petty Cash', code: '', groupId: 1 },
  ],
};

function Host() {
  const { modes, loading } = usePaymentModes(db, 7);
  if (loading) return <span>Loading</span>;
  return <ul>{modes.map((mode) => <li key={mode.id}>{`${mode.id}|${mode.controlKind}|${modeLabel(mode)}`}</li>)}</ul>;
}

describe('local cash and bank payment modes', () => {
  it('offers every Cash/Bank ledger using the same id the voucher form receives', async () => {
    render(<Host />);
    await waitFor(() => expect(screen.queryByText('Loading')).toBeNull());
    expect(screen.getByText('srv-cash|CASH|Cash')).toBeInTheDocument();
    expect(screen.queryByText(/AUTO-CASH/)).toBeNull();
    expect(screen.getByText('synced-coa-7-11|BANK|1010 · HDFC Current')).toBeInTheDocument();
    expect(screen.getByText('synced-coa-7-13|CASH|Petty Cash')).toBeInTheDocument();
    expect(screen.queryByText(/Sales/)).toBeNull();
  });
});
