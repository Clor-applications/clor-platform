import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

/* Data check (PEOPLE-26): the score tile, the blocks-payday tile and one ruled row per check with its count and fix. */
const api = vi.hoisted(() => ({
  getDataHealth: vi.fn(),
  getHeadcount: vi.fn(async () => null),
  markFullDaysPaid: vi.fn(),
  unmarkFullDaysPaid: vi.fn(),
  snoozeHealthCheck: vi.fn(),
  unsnoozeHealthCheck: vi.fn(),
}));
vi.mock('../packages/ui/src/personnel/api', () => api);
vi.mock('@ui/components/ui/notify', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

import DataHealth from '../packages/ui/src/personnel/DataHealth';

afterEach(cleanup);

const data = {
  people: 20,
  blocking: 3,
  checks: [
    { id: 'pan', area: 'Payroll', severity: 'BLOCKS_PAYROLL', title: 'Missing PAN', why: 'Needed for TDS.', fix: 'Add it.', screen: 'employees', count: 3,
      people: [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Bala' }, { id: 'c', name: 'Chitra' }] },
    { id: 'mgr', area: 'People', severity: 'TIDY_UP', title: 'No reporting manager', why: 'Leave has nowhere to go.', fix: 'Set one.', screen: 'employees', count: 1,
      people: [{ id: 'a', name: 'Asha' }] },
  ],
  snoozed: [],
};

describe('Data check tiles and rows', () => {
  it('scores the share of people with no gap and counts each check', async () => {
    api.getDataHealth.mockResolvedValue(data);
    render(<DataHealth app="people" openScreen={vi.fn()} localScreens={['employees']} />);
    const bar = await screen.findByRole('progressbar', { name: /health score/i });
    expect(bar).toHaveAttribute('aria-valuenow', '85');
    expect(screen.getByText('4 issues in 2 checks · 3 of 20 people need a fix')).toBeInTheDocument();
    const pan = screen.getByRole('region', { name: 'Missing PAN' });
    expect(within(pan).getByText('3 people')).toBeInTheDocument();
    expect(within(pan).getByText('Blocks payday')).toBeInTheDocument();
    expect(within(pan).getByRole('link', { name: 'Fix in Payroll' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'No reporting manager' })).getByRole('button', { name: 'Fix' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'No reporting manager' })).getByText('1 person')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download list/i })).toBeEnabled();
  });

  it('leaves tidy-ups out of the score', async () => {
    api.getDataHealth.mockResolvedValue({ ...data, blocking: 0, checks: [data.checks[1]] });
    render(<DataHealth app="people" />);
    expect(await screen.findByRole('progressbar', { name: /health score/i })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('1 issue in 1 check, all tidy-ups')).toBeInTheDocument();
  });

  it('says "at least" when a check lists fewer people than it counts', async () => {
    api.getDataHealth.mockResolvedValue({ ...data, checks: [{ ...data.checks[0], count: 8 }] });
    render(<DataHealth app="attendance" />);
    expect(await screen.findByText('8 issues in 1 check · at least 8 of 20 people need a fix')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fix in Payroll' })).toHaveAttribute('href', '?app=payroll&open=employees');
  });
});
