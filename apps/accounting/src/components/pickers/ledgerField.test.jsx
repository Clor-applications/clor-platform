/**
 * A ledger, typed rather than hunted for.
 *
 * The row used to hold a select listing every ledger in the book. This pins
 * the three things that replaced it: what you type narrows the list, a name
 * that matches nothing says so, and the way out of that is to make it.
 */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import LedgerField from './LedgerField';

const COMPANY = { id: 1, name: 'Neev Steels' };

const LEDGERS = [
  { id: 301, companyId: 1, name: 'ABC Traders', code: '2001', groupName: 'Sundry Debtors' },
  { id: 401, companyId: 1, name: 'Interest Received', code: '4100', groupName: 'Indirect Income' },
  { id: 402, companyId: 1, name: 'Round Off', code: '4200', groupName: 'Indirect Income' },
];

const Host = ({ onChange = () => {}, options = LEDGERS, canCreate = true }) => {
  const [value, setValue] = useState('');
  return (
    <LedgerField
      db={{ chartOfAccounts: LEDGERS, accountGroups: [], accountTypes: [] }}
      setDb={() => {}}
      currentCompany={COMPANY}
      options={options}
      value={value}
      canCreate={canCreate}
      onChange={(id) => { setValue(id); onChange(id); }}
    />
  );
};

const field = () => screen.getByRole('combobox');

describe('typing a ledger', () => {
  it('is a field you type into, not a list you scroll', () => {
    render(<Host />);
    expect(field().tagName).toBe('INPUT');
    expect(field().placeholder).toMatch(/Type a ledger name or code/i);
  });

  it('suggests as you type, on the name', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(field());
    await user.type(field(), 'Inter');
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatch(/Interest Received/);
  });

  it('suggests on the code too, because a code is typed and not read', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(field());
    await user.type(field(), '4200');
    expect(screen.getAllByRole('option')[0].textContent).toMatch(/Round Off/);
  });

  it('puts the chosen name in the field', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    await user.click(field());
    await user.type(field(), 'ABC');
    await user.click(screen.getByRole('option', { name: /ABC Traders/ }));
    expect(onChange).toHaveBeenCalledWith('301');
    expect(field().value).toBe('ABC Traders');
  });
});

describe('when nothing matches', () => {
  it('says so, naming what was typed', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(field());
    await user.type(field(), 'Zephyr');
    expect(screen.getByText(/No ledger matches “Zephyr”/)).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('offers to make it, carrying the name across', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(field());
    await user.type(field(), 'Zephyr');
    /* The whole point of this route: the form opens on the name the search
       just failed to find, rather than asking for it a second time. */
    await user.click(screen.getByRole('button', { name: /Create “Zephyr”/ }));
    expect(await screen.findByText('New Ledger')).toBeInTheDocument();
  });

  it('offers creation before anything is typed, too', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(field());
    expect(screen.getByRole('button', { name: /Create a new ledger/ })).toBeInTheDocument();
  });

  it('says the book is empty rather than showing a blank list', async () => {
    const user = userEvent.setup();
    render(<Host options={[]} />);
    await user.click(field());
    expect(screen.getByText('No ledgers yet.')).toBeInTheDocument();
  });

  it('does not offer creation where the caller forbids it', async () => {
    const user = userEvent.setup();
    render(<Host canCreate={false} />);
    await user.click(field());
    expect(screen.queryByRole('button', { name: /Create/ })).toBeNull();
  });
});
