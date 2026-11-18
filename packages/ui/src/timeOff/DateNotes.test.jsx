import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import DateNotes from './DateNotes';

const label = (d) => d;

it('says the weekend between leave days counts by the rule, apart from dates not counted', () => {
  render(<DateNotes label={label} parts={[{ dates: [
    { date: '2026-11-21', counted: true, why: null },
    { date: '2026-11-22', counted: true, why: 'Weekly off, counted (sandwich rule)' },
    { date: '2026-11-23', counted: true, why: 'Weekly off, counted (sandwich rule)' },
    { date: '2026-11-24', counted: false, why: 'Holiday: Guru Nanak Jayanti' },
  ] }]} />);
  expect(screen.getByText(/2 days off in between count, by your company’s leave rule/)).toBeTruthy();
  const charged = screen.getByRole('list', { name: 'Days off that count' });
  expect(within(charged).getAllByRole('listitem')).toHaveLength(2);
  expect(within(charged).getAllByText('Weekly off', { exact: false })[0].textContent).not.toMatch(/sandwich/);
  expect(within(screen.getByRole('list', { name: 'Dates not counted' })).getByText(/Guru Nanak/)).toBeTruthy();
});

it('shows nothing when every date is a plain working day', () => {
  const { container } = render(<DateNotes label={label} parts={[{ dates: [{ date: '2026-11-21', counted: true, why: null }] }]} />);
  expect(container.textContent).toBe('');
});
