import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import PeopleModules from './PeopleModules';

/* Settings → Modules & apps (PEOPLE-44): module tiles with their switches, then the connected CLOR apps with a labelled state. */
const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@platform/http', () => http);
const auth = vi.hoisted(() => ({ billingFor: vi.fn(), setFeature: vi.fn() }));
vi.mock('@platform/auth', () => auth);
vi.mock('@platform/context', () => ({ orgId: () => 'o1', branchId: () => 'b1' }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

const FEATURES = [
  { key: 'peopleHiring', label: 'Hiring', description: 'Jobs and candidates', enabled: true, entitled: true },
  { key: 'peopleBenefits', label: 'Benefits & assets', description: 'Benefits and assets', enabled: false, entitled: true },
  { key: 'payroll', label: 'Payroll', enabled: true, entitled: true },
  { key: 'attendance', label: 'Attendance', enabled: false, entitled: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  http.apiFetch.mockResolvedValue({ features: FEATURES });
  auth.billingFor.mockResolvedValue({ restricted: true, ownedApps: ['people', 'payroll', 'accounting'] });
  auth.setFeature.mockResolvedValue({});
});

it('shows core HR always on, a switch per module, and each app with its state in words', async () => {
  render(<PeopleModules />);
  expect(await screen.findByText('Core HR')).toBeInTheDocument();
  expect(screen.getByText('Always on')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Hiring' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('switch', { name: 'Benefits & assets' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('heading', { name: 'Connected CLOR apps' })).toBeInTheDocument();
  expect(screen.getAllByText('Connected')).toHaveLength(2); // Payroll, and Accounting from the plan
  expect(screen.getByText('Not in plan')).toBeInTheDocument(); // Attendance
  expect(screen.queryByRole('switch', { name: 'Accounting' })).toBeNull();
});

it('switches a module', async () => {
  render(<PeopleModules />);
  fireEvent.click(await screen.findByRole('switch', { name: 'Benefits & assets' }));
  await waitFor(() => expect(auth.setFeature).toHaveBeenCalledWith('o1', 'b1', 'peopleBenefits', true));
});
