import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ColumnHeader, useColumnFilters } from './ColumnFilters';

/*
 * The date window used to be two inputs in a band across the page — the one
 * piece of furniture the shared shell does not have. It belongs to the column
 * it narrows, and this is the behaviour that had to survive the move: a row
 * inside the window stays, a row outside it goes, and a row with no date at
 * all is in no window.
 */

const ROWS = [
  { id: 'a', name: 'Rent', next: '2026-09-01' },
  { id: 'b', name: 'AMC', next: '2026-10-15' },
  { id: 'c', name: 'Retainer', next: '2026-12-31' },
  { id: 'd', name: 'Unscheduled', next: '' },
];

const Table = () => {
  const cf = useColumnFilters();
  const rows = cf.apply(ROWS, { name: (r) => r.name, next: (r) => r.next });
  return (
    <table>
      <thead>
        <tr>
          <ColumnHeader label="Name" col="name" state={cf} />
          <ColumnHeader label="Next invoice date" col="next" state={cf} type="date" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}><td>{r.name}</td><td>{r.next}</td></tr>
        ))}
      </tbody>
    </table>
  );
};

const openDatePanel = () => {
  fireEvent.click(screen.getByLabelText('Sort and filter Next invoice date'));
};

const setWindow = (from, to) => {
  openDatePanel();
  if (from !== null) fireEvent.change(screen.getByLabelText('Next invoice date from'), { target: { value: from } });
  if (to !== null) fireEvent.change(screen.getByLabelText('Next invoice date to'), { target: { value: to } });
  fireEvent.click(screen.getByText('Apply Filter'));
};

const names = () => screen.getAllByRole('row').slice(1).map((r) => r.cells[0].textContent);

describe('a date column filters by window', () => {
  it('keeps only the rows inside it', () => {
    render(<Table />);
    setWindow('2026-09-15', '2026-11-01');
    expect(names()).toEqual(['AMC']);
  });

  it('takes one bound on its own', () => {
    render(<Table />);
    setWindow('2026-10-01', null);
    expect(names()).toEqual(['AMC', 'Retainer']);
  });

  it('treats a row with no date as inside no window', () => {
    render(<Table />);
    expect(names()).toContain('Unscheduled');
    setWindow('2026-01-01', '2026-12-31');
    expect(names()).not.toContain('Unscheduled');
  });

  it('gives a text column the conditions, not two dates', () => {
    render(<Table />);
    fireEvent.click(screen.getByLabelText('Sort and filter Name'));
    expect(screen.getByLabelText('Condition value')).toBeTruthy();
    expect(screen.queryByLabelText('Name from')).toBeNull();
  });

  it('clears back to every row', () => {
    render(<Table />);
    setWindow('2026-09-15', '2026-11-01');
    openDatePanel();
    fireEvent.click(screen.getByText('Clear Filter'));
    expect(names()).toHaveLength(4);
  });
});
