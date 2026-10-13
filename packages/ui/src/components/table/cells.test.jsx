import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { CELL_TYPES, Balance, DueDateCell, InvoiceIdentifier, Money, dueUrgency } from './cells';

const CO = { id: 1 };
const role = (el) => el.querySelector('[data-role]')?.getAttribute('data-role');

describe('semantic cells', () => {
  it('offers every type a column is allowed to declare', () => {
    expect(Object.keys(CELL_TYPES).sort()).toEqual(
      ['balance','creditMoney','date','dueDate','invoiceIdentifier','money','outstandingMoney','overdueMoney','paidMoney','statusBadge'].sort()
    );
  });

  /*
   * The rule the old isOverdue carried, now in one place: a paid invoice whose
   * date has passed is not overdue, and colouring it red teaches people to
   * ignore the colour.
   */
  it('a settled document is never late, whatever its date says', () => {
    expect(dueUrgency('2020-01-01', { balance: 0, todayIso: '2026-09-07' })).toBe('none');
    expect(dueUrgency('2020-01-01', { balance: 100, todayIso: '2026-09-07' })).toBe('overdue');
    expect(dueUrgency('2026-09-07', { balance: 100, todayIso: '2026-09-07' })).toBe('today');
    expect(dueUrgency('2026-12-01', { balance: 100, todayIso: '2026-09-07' })).toBe('future');
  });

  it('a due date carries its urgency without relying on colour', () => {
    const { container } = render(
      <DueDateCell value="2020-01-01" balance={500} todayIso="2026-09-07" />
    );
    const el = container.querySelector('.ui-cell-date');
    expect(el).toHaveAttribute('data-urgency', 'overdue');
    expect(el).toHaveAttribute('title', 'Overdue');
    expect(el.textContent).toContain('Overdue'); // screen-reader copy, not colour
  });

  it('does not colour a date that has nothing at stake', () => {
    const { container } = render(<DueDateCell value="2026-12-01" balance={500} todayIso="2026-09-07" />);
    expect(container.querySelector('.ui-cell-date')).toHaveAttribute('data-urgency', 'future');
  });

  it('a settled balance says so in words rather than showing a zero', () => {
    render(<Balance value={0} company={CO} dueIso="2020-01-01" />);
    expect(screen.getByText('Settled')).toBeInTheDocument();
  });

  it('an open balance is outstanding, and a late one is overdue', () => {
    const open = render(<Balance value={500} company={CO} dueIso="2026-12-01" todayIso="2026-09-07" />);
    expect(role(open.container)).toBe('outstanding');
    const late = render(<Balance value={500} company={CO} dueIso="2020-01-01" todayIso="2026-09-07" />);
    expect(role(late.container)).toBe('overdue');
  });

  it('the document total is the amount role', () => {
    const { container } = render(<Money value={2950} company={CO} />);
    expect(role(container)).toBe('amount');
  });

  it('the reference opens the document and does not also trigger the row', () => {
    const onOpen = vi.fn();
    render(<InvoiceIdentifier value="INV-1" onOpen={onOpen} label="invoice" />);
    return userEvent.click(screen.getByRole('button', { name: /Open invoice INV-1/ })).then(() => {
      expect(onOpen).toHaveBeenCalledTimes(1);
    });
  });
});
