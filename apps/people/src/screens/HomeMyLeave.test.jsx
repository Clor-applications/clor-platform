// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import HomeMyLeave, { balanceWords } from './HomeMyLeave';

const getMyLeave = vi.fn();
let canAct = true;
vi.mock('../../../attendance/src/api/attendance', () => ({ getMyLeave: (...a) => getMyLeave(...a) }));
vi.mock('@ui/timeOff/shared', () => ({ useCanActForSelf: () => canAct }));

afterEach(() => { cleanup(); getMyLeave.mockReset(); canAct = true; });

const TYPES = [
  { id: 'e', name: 'Earned Leave', isPaid: true, available: 12 },
  { id: 'c', name: 'Casual Leave', isPaid: true, available: 4 },
  { id: 'u', name: 'Loss of Pay', isPaid: false, available: null },
  { id: 's', name: 'Sick Leave', isPaid: true, available: 6 },
  { id: 'm', name: 'Maternity Leave', isPaid: true, available: 182 },
];

it('names the paid balances, three at most, and counts the rest', () => {
  expect(balanceWords(TYPES)).toBe('Earned 12 · Casual 4 · Sick 6 and 1 more');
  expect(balanceWords([{ name: 'Loss of Pay', isPaid: false }])).toBe('');
});

it('shows hours for a leave type kept in hours', () => {
  expect(balanceWords([{ name: 'Short Leave', isPaid: true, available: 0.5, unit: 'HOUR', hoursPerDay: 8 }])).toBe('Short 4 hours');
});

it('shows the days left and what waits, and opens My leave with the form open', async () => {
  getMyLeave.mockResolvedValue({ types: TYPES.slice(0, 2), requests: [{ id: 'r1', status: 'PENDING' }, { id: 'r2', status: 'APPROVED' }] });
  const openScreen = vi.fn();
  render(<HomeMyLeave openScreen={openScreen} />);
  expect(await screen.findByText('Days left: Earned 12 · Casual 4 · 1 request waits for approval')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ask for leave' }));
  expect(openScreen).toHaveBeenCalledWith('myLeave', { ask: '1' });
});

it('offers My leave, not the form, to a sign-in that may not ask for itself', async () => {
  canAct = false;
  getMyLeave.mockResolvedValue({ types: TYPES.slice(0, 1), requests: [] });
  const openScreen = vi.fn();
  render(<HomeMyLeave openScreen={openScreen} />);
  fireEvent.click(await screen.findByRole('button', { name: 'My leave' }));
  expect(openScreen).toHaveBeenCalledWith('myLeave', undefined);
});

it('is left out with no employee file or no leave types', async () => {
  getMyLeave.mockRejectedValue(Object.assign(new Error('none'), { status: 404 }));
  const { container, rerender } = render(<HomeMyLeave />);
  await Promise.resolve();
  expect(container.innerHTML).toBe('');
  getMyLeave.mockResolvedValue({ types: [], requests: [] });
  rerender(<HomeMyLeave key="b" />);
  await Promise.resolve();
  expect(container.innerHTML).toBe('');
});
