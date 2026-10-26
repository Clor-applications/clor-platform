import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Workforce record (People design spec v1 §8 workflow tests 4 and the 409 rule):
 * an edit that fails on the network keeps what was typed and saves on retry;
 * an edit someone else beat keeps the edits and shows what changed.
 */
const api = vi.hoisted(() => ({
  getEmployee: vi.fn(),
  employeeAsOf: vi.fn(),
  updateEmployee: vi.fn(),
  structure: vi.fn(() => Promise.resolve([])),
  employeeActivity: vi.fn(() => Promise.resolve({ events: [], nextBefore: null })),
  openTasksFor: vi.fn(() => Promise.resolve({})),
}));
vi.mock('../apps/people/src/workforce/api', () => ({
  ...api,
  addComment: vi.fn(), changeImpact: vi.fn(() => Promise.resolve({ impact: [] })), decideProbation: vi.fn(), deleteEmployee: vi.fn(),
  listEmployees: vi.fn(() => Promise.resolve({ employees: [] })), rehireEmployee: vi.fn(), withdrawScheduled: vi.fn(),
  listTags: vi.fn(() => Promise.resolve({ tags: [] })), listContractors: vi.fn(() => Promise.resolve({ contractors: [] })),
}));
vi.mock('../packages/ui/src/permissions/usePermissions', () => ({ usePermissions: () => ({ isAdmin: true, permissions: new Set() }) }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => ({ isAdmin: true, permissions: new Set() }) }));

const person = { id: 'e1', name: 'Sara Khan', firstName: 'Sara', lastName: 'Khan', preferredName: null, status: 'ACTIVE', version: 3, code: 'EMP-1' };

describe('Workforce record edits', () => {
  beforeEach(() => {
    /* The sections reused from the old drawer (custom fields, statutory) fetch on their own; they get empty answers. */
    localStorage.setItem('activeOrgId', 'org1');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"entries":[],"events":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }))));
    api.getEmployee.mockResolvedValue({ employee: person, scheduledChanges: [], permits: [] });
    api.updateEmployee.mockReset();
  });

  it('a network failure keeps the edit, and Try again saves it once, with the loaded version', async () => {
    const { default: EmployeeRecord } = await import('../apps/people/src/workforce/EmployeeRecord');
    const user = userEvent.setup();
    api.updateEmployee
      .mockRejectedValueOnce(Object.assign(new Error('Could not reach the server.'), { network: true }))
      .mockResolvedValueOnce({ employee: { ...person, preferredName: 'Sari', version: 4 } });
    render(<EmployeeRecord params={{ id: 'e1', tab: 'personal', edit: 'name' }} updateParams={() => {}} openScreen={() => {}} />);
    const field = await screen.findByLabelText('Preferred name');
    await user.type(field, 'Sari');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Your changes have not been saved. They are still in this form.');
    expect(screen.getByLabelText('Preferred name')).toHaveValue('Sari');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.updateEmployee).toHaveBeenCalledTimes(2));
    expect(api.updateEmployee.mock.calls[1][1]).toMatchObject({ preferredName: 'Sari', version: 3 });
  });

  it('409 STALE keeps the edits, says what changed, and saving again sends the newer version', async () => {
    const { default: EmployeeRecord } = await import('../apps/people/src/workforce/EmployeeRecord');
    const user = userEvent.setup();
    api.updateEmployee
      .mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 409, data: { code: 'STALE', employee: { ...person, preferredName: 'Sasha', version: 5 } } }))
      .mockResolvedValueOnce({ employee: { ...person, preferredName: 'Sari', version: 6 } });
    render(<EmployeeRecord params={{ id: 'e1', tab: 'personal', edit: 'name' }} updateParams={() => {}} openScreen={() => {}} />);
    await user.type(await screen.findByLabelText('Preferred name'), 'Sari');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('This record was updated elsewhere');
    expect(screen.getByText(/Preferred name is now "Sasha"/)).toBeInTheDocument();
    expect(screen.getByLabelText('Preferred name')).toHaveValue('Sari');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateEmployee).toHaveBeenCalledTimes(2));
    expect(api.updateEmployee.mock.calls[1][1]).toMatchObject({ version: 5 });
  });

  it('History compares the record on two dates and marks what changed; a day before joining says so', async () => {
    const { default: EmployeeRecord } = await import('../apps/people/src/workforce/EmployeeRecord');
    api.employeeAsOf.mockImplementation((id, date) => (date === '2026-01-05'
      ? Promise.reject(Object.assign(new Error('Not here'), { status: 404 }))
      : Promise.resolve({ employee: { ...person, designation: date < '2026-10-26' ? 'Clerk' : 'Accountant' } })));
    render(<EmployeeRecord params={{ id: 'e1', tab: 'history' }} updateParams={() => {}} openScreen={() => {}} />);
    await screen.findByText('Compare two dates');
    const user = userEvent.setup();
    const from = screen.getByLabelText('As of');
    await user.clear(from);
    await user.type(from, '1 Jun 2026{Enter}');
    const row = (await screen.findByText('Changed')).closest('tr');
    expect(row).toHaveTextContent('Designation');
    expect(row).toHaveTextContent('Clerk');
    expect(row).toHaveTextContent('Accountant');
    await user.clear(from);
    await user.type(from, '5 Jan 2026{Enter}');
    await screen.findByText(/Not with the company yet on this day/);
  });
});
