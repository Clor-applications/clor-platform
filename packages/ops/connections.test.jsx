import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsBrokenConnections: vi.fn() }));
vi.mock('./api', () => api);

import { BrokenConnections } from './Connections';

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

const items = [
  { kind: 'Attendance reader', id: 'r1', name: 'Gate reader', accountId: 'a1', customer: 'Kaveri Foods', state: 'offline', since: '2026-11-10T06:00:00Z', error: null },
  { kind: 'HR connection', id: 'h1', name: 'Keka (keka)', accountId: 'a2', customer: 'Nila Traders', state: 'error', since: '2026-11-18T06:00:00Z', error: 'Token expired' },
  { kind: 'Attendance reader', id: 'r2', name: 'Dock reader', accountId: 'a2', customer: 'Nila Traders', state: 'error', since: null, error: 'Wrong password' },
];

/* 20 Nov 2026: Background jobs counted failing connections; nothing listed whose they were. */
describe('Broken connections', () => {
  it('lists each one with its customer, what it said and when it last worked, and opens the customer’s Connections', async () => {
    api.opsBrokenConnections.mockResolvedValue({ items, kinds: { 'Attendance reader': 2, 'HR connection': 1 }, customers: 2 });
    const openCustomer = vi.fn();
    render(<BrokenConnections openCustomer={openCustomer} />);
    const rows = within(await screen.findByRole('table', { name: /not working/ })).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('Kaveri Foods');
    expect(rows[1]).toHaveTextContent('Silent');
    expect(rows[1]).toHaveTextContent('Has not called in for a day or more');
    expect(rows[2]).toHaveTextContent('Failing');
    expect(rows[2]).toHaveTextContent('Token expired');
    expect(rows[3]).toHaveTextContent('Never');
    const figures = screen.getByLabelText('Broken connection figures');
    expect(figures).toHaveTextContent('3 connections not working');
    expect(figures).toHaveTextContent('2 customers');
    fireEvent.click(within(rows[2]).getByRole('button', { name: 'Nila Traders' }));
    expect(openCustomer).toHaveBeenCalledWith('a2');
  });

  it('shows one kind when its figure is picked, and all again on a second click', async () => {
    api.opsBrokenConnections.mockResolvedValue({ items, kinds: { 'Attendance reader': 2, 'HR connection': 1 }, customers: 2 });
    render(<BrokenConnections openCustomer={() => {}} />);
    await screen.findByRole('table', { name: /not working/ });
    const pick = within(screen.getByLabelText('Broken connection figures')).getByRole('button', { name: /HR connection/ });
    fireEvent.click(pick);
    expect(within(screen.getByRole('table', { name: /not working/ })).getAllByRole('row')).toHaveLength(2);
    fireEvent.click(pick);
    expect(within(screen.getByRole('table', { name: /not working/ })).getAllByRole('row')).toHaveLength(4);
  });

  it('says so when everything works', async () => {
    api.opsBrokenConnections.mockResolvedValue({ items: [], kinds: {}, customers: 0 });
    render(<BrokenConnections openCustomer={() => {}} />);
    expect(await screen.findByText('Every connection that is switched on is working.')).toBeInTheDocument();
  });
});
