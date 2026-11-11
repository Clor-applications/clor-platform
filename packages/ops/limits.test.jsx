import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsCustomerLimits: vi.fn(), opsSetCustomerLimits: vi.fn(), opsSetCustomerFeature: vi.fn() }));
vi.mock('./api', () => Object.fromEntries(Object.keys(api).map((k) => [k, (...a) => api[k](...a)])));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { Limits } from './Limits';

const F = (key, label, state, o = {}) => ({ key, label, app: 'accounting', appName: 'Accounting', state, inPlan: state === 'plan' || state === 'off', offWithParent: false, needs: null, ...o });
const data = (o = {}) => ({
  plan: { key: 'GROWTH', name: 'Growth', limits: { maxCompanies: 3, maxUsers: 10 } },
  set: { maxCompanies: null, maxUsers: 4 },
  limits: { maxCompanies: 3, maxUsers: 4 },
  used: { companies: 1, users: 5 },
  inGoodStanding: true,
  features: [F('inventory', 'Inventory', 'plan'), F('warehouses', 'Warehouses', 'plan', { needs: 'Inventory' }), F('pos', 'Point of sale', 'not-in-plan')],
  ...o,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
});

describe('operator console: customer limits', () => {
  it('shows use against each limit and who set it; Billing changes the user limit with a reason', async () => {
    api.opsCustomerLimits.mockResolvedValue(data());
    api.opsSetCustomerLimits.mockResolvedValue({});
    render(<Limits id="acc" name="Kaveri Traders" role="BILLING" />);
    const rows = within(await screen.findByRole('list', { name: 'Limits' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('1 of 3');
    expect(rows[0]).toHaveTextContent('The Growth plan’s own.');
    expect(rows[1]).toHaveTextContent('5 of 4');
    expect(rows[1]).toHaveTextContent('Set by CLOR. The Growth plan has 10 users.');
    expect(rows[1]).toHaveTextContent('Over: they cannot add more');
    fireEvent.click(screen.getByRole('button', { name: 'Change limits' }));
    fireEvent.change(screen.getByLabelText('Users'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Companies'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Why|Reason/), { target: { value: 'Five companies agreed' } });
    const go = screen.getAllByRole('button', { name: 'Change limits' });
    fireEvent.click(go[go.length - 1]);
    await waitFor(() => expect(api.opsSetCustomerLimits).toHaveBeenCalledWith('acc', { maxCompanies: 5, maxUsers: null, reason: 'Five companies agreed' }));
  });

  it('turning a module off says what goes with it, and sends the reason', async () => {
    api.opsCustomerLimits.mockResolvedValue(data());
    api.opsSetCustomerFeature.mockResolvedValue({});
    render(<Limits id="acc" name="Kaveri Traders" role="BILLING" />);
    expect(await screen.findByText(/Every feature follows the Growth plan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn off: Inventory' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 3 features' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn off: Inventory' }));
    expect(screen.getByText(/and so does Warehouses, which needs it/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Why|Reason/), { target: { value: 'Stock is broken for them' } });
    const go = screen.getAllByRole('button', { name: 'Turn off' });
    fireEvent.click(go[go.length - 1]);
    await waitFor(() => expect(api.opsSetCustomerFeature).toHaveBeenCalledWith('acc', 'inventory', 'off', 'Stock is broken for them'));
    expect(screen.getByRole('button', { name: 'Turn on: Point of sale' })).toBeInTheDocument();
  });

  it('other roles read but cannot change', async () => {
    api.opsCustomerLimits.mockResolvedValue(data());
    render(<Limits id="acc" name="Kaveri Traders" role="SUPPORT" />);
    await screen.findByRole('list', { name: 'Limits' });
    expect(screen.queryByRole('button', { name: 'Change limits' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 3 features' }));
    expect(screen.queryByRole('button', { name: /Turn off/ })).toBeNull();
    expect(screen.getByText(/Billing changes them/)).toBeInTheDocument();
  });
});
