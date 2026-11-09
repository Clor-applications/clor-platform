import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import PayrollReadiness from './PayrollReadiness';
import { getPayrollReadiness } from '../api/attendance';

/* Payroll readiness is the whole company's; a team-scoped role is told so plainly, not shown an error to retry. */
vi.mock('../api/attendance', () => ({
  getPayrollReadiness: vi.fn(),
  todayIst: () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
}));

it('tells a team-scoped role it covers the whole company, and points to month close', async () => {
  const refused = Object.assign(new Error('Payroll readiness covers the whole company. Month close shows your team’s days.'), { status: 403, data: { code: 'TEAM_SCOPED' } });
  getPayrollReadiness.mockRejectedValue(refused);
  const openScreen = vi.fn();
  render(<PayrollReadiness openScreen={openScreen} />);
  expect(await screen.findByText('Payroll readiness covers the whole company')).toBeTruthy();
  expect(screen.getByText('Your role sees your own team. Month close shows your team’s open days.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /More/ })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open month close' }));
  expect(openScreen).toHaveBeenCalledWith('monthClose', expect.objectContaining({ month: expect.stringMatching(/^\d{4}-\d{2}$/) }));
});

it('still says when the check itself failed', async () => {
  getPayrollReadiness.mockRejectedValue(Object.assign(new Error('The server could not complete that (500). Nothing was saved.'), { status: 500 }));
  render(<PayrollReadiness />);
  expect(await screen.findByText('The server could not complete that (500). Nothing was saved.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});
