import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/*
 * People's side of gaps 24 and 25: Settings → Request types (ready-made ones
 * switched on, a new one with its fields), My requests (ask, follow) and
 * Shift swaps (HR's list; cancel an approved one), plus the hourly words.
 */
const api = vi.hoisted(() => ({
  listForms: vi.fn(),
  createForm: vi.fn(async () => ({ id: 'f9' })),
  updateForm: vi.fn(async () => ({})),
  switchOnTemplate: vi.fn(async () => ({ id: 'f2', name: 'ID card' })),
  formsReport: vi.fn(),
  formsReportCsvPath: vi.fn(() => '/x'),
  requestFile: vi.fn(),
  myForms: vi.fn(),
  askForm: vi.fn(async () => ({ id: 'q1' })),
  replyMine: vi.fn(async () => ({})),
  withdrawMine: vi.fn(async () => ({})),
  myFile: vi.fn(),
  listSwaps: vi.fn(),
  cancelSwap: vi.fn(async () => ({})),
}));
const perms = vi.hoisted(() => ({ current: { isAdmin: true, permissions: new Set() } }));
vi.mock('../apps/people/src/api/requests', () => api);
vi.mock('../apps/people/src/workforce/api', () => ({ structure: vi.fn(async () => [{ id: 'd1', name: 'Sales' }]) }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('../packages/ui/src/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../packages/ui/src/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));

import RequestForms from '../apps/people/src/screens/RequestForms';
import MyRequests from '../apps/people/src/screens/MyRequests';
import ShiftSwaps from '../apps/people/src/screens/ShiftSwaps';
import { amountWords, hoursBetween, hoursWords } from '../packages/ui/src/timeOff/partOfDay';
import { missingIn } from '../packages/ui/src/requests/formFiles';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  perms.current = { isAdmin: true, permissions: new Set() };
});

const FORMS = {
  forms: [{ id: 'f1', name: 'Salary certificate', fields: [{ key: 'p', label: 'Purpose', type: 'TEXT' }], audience: 'EVERYONE', departmentIds: [], approver: 'HR', slaDays: null, active: true, open: 2 }],
  templates: [{ key: 'SALARY_CERTIFICATE', name: 'Salary certificate', on: true }, { key: 'ID_CARD', name: 'ID card', description: 'A card', on: false }],
};

describe('Request types', () => {
  it('lists the types and offers the ready-made ones not yet on', async () => {
    api.listForms.mockResolvedValue(FORMS);
    render(<RequestForms />);
    expect((await screen.findAllByText('Salary certificate')).length).toBeGreaterThan(0);
    const ready = screen.getByLabelText('Ready-made request types');
    fireEvent.click(ready.querySelector('button'));
    await waitFor(() => expect(api.switchOnTemplate).toHaveBeenCalledWith('ID_CARD'));
  });

  it('makes a new one with a choice field, approved by the manager then HR', async () => {
    api.listForms.mockResolvedValue({ forms: [], templates: [] });
    render(<RequestForms />);
    fireEvent.click(await screen.findByRole('button', { name: /New request type/ }));
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Travel advance' } });
    fireEvent.change(screen.getByLabelText('Field name *'), { target: { value: 'Amount' } });
    fireEvent.click(screen.getByRole('button', { name: /Add a field/ }));
    fireEvent.change(screen.getAllByLabelText('Field name *')[1], { target: { value: 'Mode' } });
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createForm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Travel advance', approver: 'HR', fields: [expect.objectContaining({ label: 'Amount', type: 'TEXT', required: true }), expect.objectContaining({ label: 'Mode', type: 'TEXT', required: false })] })));
  });

  it('is read only without the right to change approvals', async () => {
    perms.current = { isAdmin: false, permissions: new Set(['PEOPLE::Approvals::VIEW']) };
    api.listForms.mockResolvedValue(FORMS);
    render(<RequestForms />);
    await screen.findAllByText('Salary certificate');
    expect(screen.queryByRole('button', { name: /New request type/ })).toBeNull();
    expect(screen.queryByLabelText('Ready-made request types')).toBeNull();
  });
});

describe('My requests', () => {
  it('says when HR has set none up', async () => {
    api.myForms.mockResolvedValue({ forms: [], requests: [] });
    render(<MyRequests />);
    expect((await screen.findAllByText(/You have not asked for anything yet/)).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('New request')).toBeNull();
  });

  it('shows my requests with their status', async () => {
    api.myForms.mockResolvedValue({ forms: [{ id: 'f1', name: 'Salary certificate', fields: [], slaDays: 2 }], requests: [{ id: 'q1', formName: 'Salary certificate', status: 'MORE_INFO', askedAt: '2026-10-30T10:00:00Z', lines: [{ label: 'Purpose', value: 'Visa' }], files: [], said: 'Which country?', replies: [] }] });
    render(<MyRequests />);
    expect((await screen.findAllByText('Asked for more')).length).toBeGreaterThan(0);
  });
});

describe('Shift swaps', () => {
  const SWAP = { id: 's1', status: 'APPROVED', fromDate: '2099-11-03', toDate: '2099-11-03', reason: 'Exam', createdAt: '2026-10-30T10:00:00Z', requester: { id: 'e1', name: 'Asha Rao' }, colleague: { id: 'e2', name: 'Ravi Kumar' }, days: [{ date: '2099-11-03', requesterShift: { name: 'Morning', startTime: '06:00', endTime: '14:00' }, colleagueShift: { name: 'Evening', startTime: '14:00', endTime: '22:00' } }] };

  it('lists swaps, and HR cancels an approved one that has not started', async () => {
    api.listSwaps.mockResolvedValue({ swaps: [SWAP], rules: { maxDays: 7 }, canCancel: true });
    render(<ShiftSwaps />);
    expect((await screen.findAllByText('Morning ⇄ Evening')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText('Asha Rao')[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel swap' }));
    await waitFor(() => expect(api.cancelSwap).toHaveBeenCalledWith('s1'));
  });

  it('a manager cannot cancel', async () => {
    api.listSwaps.mockResolvedValue({ swaps: [SWAP], rules: { maxDays: 7 }, canCancel: false });
    render(<ShiftSwaps />);
    fireEvent.click((await screen.findAllByText('Asha Rao'))[0]);
    await screen.findByRole('table', { name: 'Days' });
    expect(screen.queryByRole('button', { name: 'Cancel swap' })).toBeNull();
  });
});

describe('words', () => {
  it('hourly leave reads in hours; a form says what is missing', () => {
    expect(amountWords(0.25, { unit: 'HOUR', hoursPerDay: 8 })).toBe('2 hours');
    expect(amountWords(1.5, { unit: 'DAY' })).toBe('1.5 days');
    expect(hoursWords(hoursBetween('10:00', '11:00'))).toBe('1 hour');
    expect(missingIn([{ key: 'a', label: 'Purpose', required: true, type: 'TEXT' }], {}, {})).toBe('Purpose is needed.');
  });
});
