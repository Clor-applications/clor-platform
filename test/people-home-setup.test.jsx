import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@ui/components/ui/notify', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/timeOff/MyDays', () => ({ HomeCheckIn: () => null }));
vi.mock('@ui/personnel/Employees', () => ({ Avatar: () => null }));
vi.mock('@platform/context', () => ({ orgId: () => 'org1', branchId: () => 'br1', platformContext: () => ({ user: null }) }));
vi.mock('@platform/auth', () => ({ setFeature: vi.fn(async () => ({})) }));
vi.mock('@ui/personnel/api', () => ({
  listEmployees: vi.fn(async () => ({ employees: [], total: 0 })),
  getOverview: vi.fn(async () => ({ headcount: 0, byStatus: {}, joinedThisMonth: [], leftThisMonth: 0, byDepartment: [], upcomingBirthdays: [] })),
  getPeopleHome: vi.fn(async () => []),
  listMyTasks: vi.fn(async () => []),
  updateChecklistTask: vi.fn(),
  getPeopleSetup: vi.fn(),
  changePeopleSetup: vi.fn(),
  summaryOpened: vi.fn(async () => ({ ok: true })),
}));

import * as api from '@ui/personnel/api';
import { setFeature } from '@platform/auth';
import PeopleOverview from '../apps/people/src/screens/PeopleOverview';

const step = (key, title, over = {}) => ({ key, title, blurb: `${title} blurb`, detail: 'Nothing yet', done: false, skipped: false, optional: false, screen: key === 'people' ? 'employeeNew' : key, ...over });
const setup = (over = {}) => ({
  setup: {
    steps: [
      step('people', 'Add your people', { alt: { label: 'Import', screen: 'employeeImport' } }),
      step('week', 'Set the working week and holidays', { screen: 'workingWeek' }),
      step('leave', 'Pick your leave types', { screen: 'leaveTypes', done: true, detail: '3 leave types' }),
      step('app', 'Give your staff the employee app', { screen: 'selfService' }),
      step('payroll', 'Connect Payroll (optional)', { screen: 'modules', optional: true, app: 'payroll' }),
    ],
    done: 1,
    total: 4,
    show: true,
  },
  simpleMode: { on: true, suggest: false, reasons: [] },
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* PRODUCT-VIEW §2: a new company's Home is a setup list, not "All caught up". */
describe('People Home setup list', () => {
  it('replaces "All caught up" with the steps while setting up', async () => {
    api.getPeopleSetup.mockResolvedValue(setup());
    render(<PeopleOverview openScreen={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Get People ready' })).toBeInTheDocument();
    expect(screen.getByText('1 of 4 done. Each step ticks itself once it is in place.')).toBeInTheDocument();
    expect(screen.queryByText('All caught up')).toBeNull();
    expect(screen.getByText('Nothing waits for you yet. Start with the steps above.')).toBeInTheDocument();
    /* The done step says so, and is reviewed rather than set up. */
    expect(screen.getByRole('button', { name: 'Review: Pick your leave types' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip: Pick your leave types' })).toBeNull();
    expect(screen.getByText('Optional')).toBeInTheDocument();
  });

  it('opens each step’s screen, and Import beside Add', async () => {
    api.getPeopleSetup.mockResolvedValue(setup());
    const openScreen = vi.fn();
    render(<PeopleOverview openScreen={openScreen} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up: Add your people' }));
    expect(openScreen).toHaveBeenCalledWith('employeeNew');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(openScreen).toHaveBeenCalledWith('employeeImport');
    fireEvent.click(screen.getByRole('button', { name: 'Set up: Set the working week and holidays' }));
    expect(openScreen).toHaveBeenCalledWith('workingWeek');
  });

  it('skips a step and hides the list through the server', async () => {
    api.getPeopleSetup.mockResolvedValue(setup());
    api.changePeopleSetup.mockResolvedValue(setup({ setup: { ...setup().setup, show: false } }));
    render(<PeopleOverview openScreen={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip: Give your staff the employee app' }));
    await waitFor(() => expect(api.changePeopleSetup).toHaveBeenCalledWith({ action: 'skip', step: 'app' }));
    /* Settled: the list goes and "All caught up" is back. */
    expect(await screen.findByText('All caught up')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Get People ready' })).toBeNull();
  });

  it('shows "All caught up" once set up, and to someone who cannot set the company up', async () => {
    api.getPeopleSetup.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    render(<PeopleOverview openScreen={vi.fn()} />);
    expect(await screen.findByText('All caught up')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Get People ready' })).toBeNull();
  });

  it('suggests switching simple mode off once, and switches only when asked', async () => {
    api.getPeopleSetup.mockResolvedValue(setup({ setup: { ...setup().setup, show: false }, simpleMode: { on: true, suggest: true, reasons: ['12 people work here'] } }));
    api.changePeopleSetup.mockResolvedValue(setup({ setup: { ...setup().setup, show: false }, simpleMode: { on: false, suggest: false, reasons: [] } }));
    render(<PeopleOverview openScreen={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Your company has grown' })).toBeInTheDocument();
    expect(screen.getByText(/^12 people work here\./)).toBeInTheDocument();
    expect(setFeature).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show every screen' }));
    await waitFor(() => expect(setFeature).toHaveBeenCalledWith('org1', 'br1', 'peopleSimpleMode', false, { trigger: 'outgrown' }));
    await waitFor(() => expect(api.changePeopleSetup).toHaveBeenCalledWith({ action: 'simpleAdviceSeen' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Your company has grown' })).toBeNull());
  });

  it('keeps simple mode when the owner says so', async () => {
    api.getPeopleSetup.mockResolvedValue(setup({ simpleMode: { on: true, suggest: true, reasons: ['3 people sign in to CLOR'] } }));
    api.changePeopleSetup.mockResolvedValue(setup());
    render(<PeopleOverview openScreen={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep it simple' }));
    await waitFor(() => expect(api.changePeopleSetup).toHaveBeenCalledWith({ action: 'simpleAdviceSeen' }));
    expect(setFeature).not.toHaveBeenCalled();
  });
});
