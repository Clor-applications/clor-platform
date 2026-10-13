import { useEffect, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postJournalToLedger = vi.fn(async () => ({}));
vi.mock('@ui/utils/journalSync', () => ({
  postJournalToLedger: (...a) => postJournalToLedger(...a),
}));

import ContraForm from './ContraForm';

/**
 * A contra IS a journal: credit the account the money left, debit the one it
 * reached. The form is a thin front on that fact — the entry it writes must
 * be indistinguishable from one typed on the journal form.
 */

const COMPANY = { id: 1, name: 'Neev Steels' };

const db0 = {
  companies: [COMPANY],
  accountGroups: [
    { id: 21, companyId: 1, name: 'Bank Accounts', parentGroupId: null },
    { id: 22, companyId: 1, name: 'Cash-in-Hand', parentGroupId: null },
  ],
  chartOfAccounts: [
    { id: 501, companyId: 1, name: 'Cash', groupId: 22 },
    { id: 502, companyId: 1, name: 'HDFC Bank', groupId: 21 },
    /* Not cash or bank — must not be offered as a transfer leg. */
    { id: 601, companyId: 1, name: 'Sales', groupId: 99 },
  ],
  journalEntries: [{ id: 3, companyId: 1, number: 'JV-0003', date: '2026-09-01', lines: [] }],
};

const latest = { db: db0 };
let closed = false;
const Host = () => {
  const [db, setDb] = useState(db0);
  useEffect(() => {
    latest.db = db;
  }, [db]);
  return (
    <ContraForm
      db={db}
      setDb={(next) => setDb((prev) => (typeof next === 'function' ? next(prev) : next))}
      currentCompany={COMPANY}
      onClose={() => {
        closed = true;
      }}
    />
  );
};

const pick = async (user, label, name) => {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name }));
};

describe('the transfer', () => {
  beforeEach(() => {
    postJournalToLedger.mockClear();
    latest.db = db0;
    closed = false;
    localStorage.clear();
  });

  it('offers only cash and bank accounts as legs', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('combobox', { name: 'From account' }));
    expect(await screen.findByRole('option', { name: 'Cash' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'HDFC Bank' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Sales' })).toBeNull();
  });

  it('writes one balanced journal: credit the source, debit the target', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pick(user, 'From account', 'Cash');
    await pick(user, 'To account', 'HDFC Bank');
    await user.type(screen.getByLabelText('Amount'), '25000');
    await user.click(screen.getByRole('button', { name: 'Record transfer' }));

    const jv = latest.db.journalEntries.find((j) => j.voucherKind === 'contra');
    expect(jv).toBeTruthy();
    expect(jv.totalDebit).toBe(25000);
    expect(jv.lines).toEqual([
      expect.objectContaining({ accountId: '502', debit: 25000, credit: 0 }),
      expect.objectContaining({ accountId: '501', debit: 0, credit: 25000 }),
    ]);
    /* Same engine as a hand-typed entry. */
    expect(postJournalToLedger).toHaveBeenCalledTimes(1);
    expect(jv.narration).toBe('Transfer from Cash to HDFC Bank');
    expect(closed).toBe(true);
  });

  it('refuses a transfer from an account to itself, and a zero amount', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pick(user, 'From account', 'Cash');
    await pick(user, 'To account', 'Cash');
    await user.type(screen.getByLabelText('Amount'), '100');
    expect(screen.getByRole('button', { name: 'Record transfer' })).toBeDisabled();
    expect(screen.getByText('A transfer needs two different accounts.')).toBeInTheDocument();
  });

  it('will not reuse a journal number that already exists', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pick(user, 'From account', 'Cash');
    await pick(user, 'To account', 'HDFC Bank');
    await user.type(screen.getByLabelText('Amount'), '100');
    const number = screen.getByLabelText('Voucher No.');
    await user.clear(number);
    await user.type(number, 'JV-0003');
    await user.click(screen.getByRole('button', { name: 'Record transfer' }));

    expect(latest.db.journalEntries.filter((j) => j.number === 'JV-0003')).toHaveLength(1);
    expect(closed).toBe(false);
  });
});
