import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import OutstandingBillsModal from './OutstandingBillsModal';

/**
 * The bills are asked for, not always on show.
 *
 * What this pins is the contract the receipt screen depends on: nothing is
 * committed until Apply, ticking a bill fills it in, and the figure handed
 * back is capped at what is actually owed.
 */

const BILLS = [
  { id: 1, number: 'INV-1', date: '2026-09-01', total: 118000, tdsExpected: 2000, outstanding: 118000 },
  { id: 2, number: 'INV-2', date: '2026-09-04', total: 50000, tdsExpected: 0, outstanding: 20000 },
  { id: 3, number: 'INV-3', date: '2026-09-07', total: 9000, tdsExpected: 0, outstanding: 9000 },
];

const money = (v) => `₹${Number(v || 0).toFixed(2)}`;

const open = (props = {}) => {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <OutstandingBillsModal
      partyName="ABC Industries"
      bills={BILLS}
      value={{}}
      available={1000000}
      money={money}
      onApply={onApply}
      onClose={onClose}
      {...props}
    />
  );
  return { onApply, onClose };
};

const rowFor = (number) => screen.getByText(number).closest('tr');
const tick = (user, number) => user.click(within(rowFor(number)).getByRole('checkbox'));

describe('the dialog itself', () => {
  it('names the party it is allocating against', () => {
    open();
    expect(screen.getByText('ABC Industries')).toBeTruthy();
    expect(screen.getByText('Allocate Outstanding Bills')).toBeTruthy();
  });

  it('shows the seven columns the allocation is decided from', () => {
    open();
    const heads = screen.getAllByRole('columnheader').map((th) => th.textContent.trim());
    /* The first cell is the select-all box rather than the word "Select". */
    expect(heads.slice(1)).toEqual(['Inv No.', 'Inv Date', 'Inv Amount', 'TDS', 'Outstanding', 'Allocation']);
    expect(within(screen.getAllByRole('columnheader')[0]).getByRole('checkbox')).toBeTruthy();
  });

  it('says so, rather than showing an empty table, when nothing is owed', () => {
    open({ bills: [] });
    expect(screen.getByText(/recorded as an advance/i)).toBeTruthy();
  });
});

describe('ticking a bill', () => {
  it('fills the allocation with what is outstanding, not what the bill was', async () => {
    const user = userEvent.setup();
    open();
    /* INV-2 is a 50,000 invoice with 20,000 left on it. Filling in 50,000
       would over-allocate by the part already paid. */
    await tick(user, 'INV-2');
    expect(within(rowFor('INV-2')).getByRole('spinbutton').value).toBe('20000');
  });

  it('never fills past what is left of the receipt', async () => {
    const user = userEvent.setup();
    open({ available: 25000 });
    await tick(user, 'INV-1');
    /* 118,000 is owed but only 25,000 arrived. */
    expect(within(rowFor('INV-1')).getByRole('spinbutton').value).toBe('25000');
  });

  it('counts what is already placed when filling the next one', async () => {
    const user = userEvent.setup();
    open({ available: 25000 });
    await tick(user, 'INV-2');   // takes 20,000 of the 25,000
    await tick(user, 'INV-3');   // 5,000 left, though 9,000 is owed
    expect(within(rowFor('INV-3')).getByRole('spinbutton').value).toBe('5000');
  });

  it('clears the figure when the bill is unticked', async () => {
    const user = userEvent.setup();
    open();
    await tick(user, 'INV-3');
    await tick(user, 'INV-3');
    expect(within(rowFor('INV-3')).getByRole('spinbutton').value).toBe('');
  });
});

describe('the running total at the foot', () => {
  it('counts the selected bills and what they come to', async () => {
    const user = userEvent.setup();
    open();
    await tick(user, 'INV-2');
    await tick(user, 'INV-3');
    expect(screen.getByText(/2 invoices/)).toBeTruthy();
    expect(screen.getByText(money(29000))).toBeTruthy();
  });
});

describe('select all', () => {
  it('fills top-down until the receipt runs out, rather than over-allocating', async () => {
    const user = userEvent.setup();
    open({ available: 130000 });
    await user.click(within(screen.getAllByRole('columnheader')[0]).getByRole('checkbox'));
    /* 118,000 + 20,000 would be 138,000 against a 130,000 receipt, so the
       second bill takes what is left and the third takes nothing. */
    expect(within(rowFor('INV-1')).getByRole('spinbutton').value).toBe('118000');
    expect(within(rowFor('INV-2')).getByRole('spinbutton').value).toBe('12000');
    expect(within(rowFor('INV-3')).getByRole('spinbutton').value).toBe('');
  });

  it('clears every row when unticked', async () => {
    const user = userEvent.setup();
    open();
    const all = () => within(screen.getAllByRole('columnheader')[0]).getByRole('checkbox');
    await user.click(all());
    await user.click(all());
    expect(within(rowFor('INV-1')).getByRole('spinbutton').value).toBe('');
  });
});

describe('committing', () => {
  it('hands back only the ticked bills, and only on Apply', async () => {
    const user = userEvent.setup();
    const { onApply } = open();
    await tick(user, 'INV-2');
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Apply Allocation/i }));
    const [allocation, total] = onApply.mock.calls[0];
    expect(Object.keys(allocation)).toEqual(['2']);
    expect(allocation['2']).toMatchObject({ selected: true, amount: 20000 });
    expect(total).toBe(20000);
  });

  it('caps a hand-typed figure at what the bill is owed', async () => {
    const user = userEvent.setup();
    const { onApply } = open();
    const field = within(rowFor('INV-2')).getByRole('spinbutton');
    await user.clear(field);
    await user.type(field, '99999');
    await user.click(screen.getByRole('button', { name: /Apply Allocation/i }));
    expect(onApply.mock.calls[0][0]['2'].amount).toBe(20000);
  });

  it('warns on the over-allocation before it is silently capped', async () => {
    const user = userEvent.setup();
    open();
    const field = within(rowFor('INV-2')).getByRole('spinbutton');
    await user.clear(field);
    await user.type(field, '99999');
    expect(screen.getByRole('alert').textContent).toMatch(/INV-2 is allocated more than it is owed/i);
  });

  it('cancels without applying anything', async () => {
    const user = userEvent.setup();
    const { onApply, onClose } = open();
    await tick(user, 'INV-1');
    await user.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('opens with what the caller already had allocated', () => {
    open({ value: { 3: { selected: true, amount: 4000 } } });
    expect(within(rowFor('INV-3')).getByRole('spinbutton').value).toBe('4000');
    expect(within(rowFor('INV-3')).getByRole('checkbox').checked).toBe(true);
  });
});
