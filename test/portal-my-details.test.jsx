import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../packages/ui/src/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../apps/attendance/src/portal/portalApi', () => ({
  SignedOut: class SignedOut extends Error {},
  getMyDetails: vi.fn(),
  askDetailsChange: vi.fn(),
  answerMyRequest: vi.fn(async () => ({ status: 'WAITING' })),
  withdrawMyRequest: vi.fn(async () => ({ status: 'WITHDRAWN' })),
  getPolicies: vi.fn(),
  getPolicy: vi.fn(),
  acceptItem: vi.fn(async () => ({})),
  shrinkPhoto: vi.fn(),
  getLeaving: vi.fn(async () => ({ status: 'ACTIVE', lastDay: null, waiting: null })),
}));

import * as api from '../apps/attendance/src/portal/portalApi';
import { MyDetails, Policies } from '../apps/attendance/src/portal/MyDetails';

/**
 * The employee app's People self-service (workforce audit E1, E3, E5, E13):
 * my job in words, my details, my requests with HR's comment and a way to
 * answer or withdraw, and Accept on a policy HR asked me to read.
 */
const guard = (p) => p;
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DETAILS = {
  fields: { firstName: 'Imran', lastName: 'Patil', phone: '9000000001', city: 'Pune', gender: 'MALE' },
  labels: { firstName: 'First name', lastName: 'Last name', phone: 'Phone', city: 'City', gender: 'Gender' },
  hasPhoto: false,
  savesAtOnce: ['phone', 'personalEmail', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation'],
  hrDecidesWithinDays: 3,
  terms: { designation: 'Store keeper', department: 'Stores', employmentType: 'Permanent', hours: 'Part-time', workMode: 'Office', manager: 'Ravi Kumar', joinedOn: '2026-01-05', probationEndsOn: '2026-07-05', confirmedOn: null, contractEndsOn: null, lastDay: null },
  requests: [
    { id: 'r1', kind: 'PROFILE_CHANGE', title: 'Imran Patil: city change', status: 'MORE_INFO', statusLabel: 'More information asked for', asked: [{ field: 'city', label: 'City', value: 'Mumbai' }], comment: { text: 'Send a utility bill.', by: 'Asha HR', at: '2026-10-20T10:00:00Z' }, replies: [], createdAt: '2026-10-19T10:00:00Z', canReply: true, canWithdraw: true },
  ],
  waiting: [],
};

describe('My details in the employee app', () => {
  it('shows the job in words, the details, and the request with HR’s comment; an answer goes to the server', async () => {
    api.getMyDetails.mockResolvedValue(DETAILS);
    render(<MyDetails guard={guard} />);
    expect(await screen.findByText('My job')).toBeTruthy();
    expect(screen.getByText('Permanent · Part-time')).toBeTruthy();
    expect(screen.getByText('Ravi Kumar')).toBeTruthy();
    expect(screen.getByText('5 Jul 2026')).toBeTruthy();
    expect(screen.getByText('Pune')).toBeTruthy();
    expect(screen.getByText(/Other changes, and a new photo, go to HR, who decide within 3 working days/)).toBeTruthy();
    expect(screen.getByText('More information asked for')).toBeTruthy();
    expect(screen.getByText('Asha HR: Send a utility bill.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Bill sent by email.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() => expect(api.answerMyRequest).toHaveBeenCalledWith('r1', 'Bill sent by email.'));
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(api.withdrawMyRequest).toHaveBeenCalledWith('r1'));
  });

  it('sends only what changed', async () => {
    api.getMyDetails.mockResolvedValue({ ...DETAILS, requests: [] });
    api.askDetailsChange.mockResolvedValue({ saved: [], requested: ['city'] });
    render(<MyDetails guard={guard} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change details' }));
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Mumbai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.askDetailsChange).toHaveBeenCalledWith({ city: 'Mumbai' }));
    expect(await screen.findByText(/Sent to HR: city/)).toBeTruthy();
  });
});

describe('Company policies in the employee app', () => {
  it('offers Accept only where HR asked for it', async () => {
    api.getPolicies.mockResolvedValue({ policies: [
      { versionId: 'v1', title: 'Leave policy', categoryLabel: 'Leave', effectiveFrom: '2026-04-01', acknowledgementId: 'a1', acceptedAt: null },
      { versionId: 'v2', title: 'Dress code', categoryLabel: 'Conduct', effectiveFrom: '2026-04-01', acknowledgementId: null, acceptedAt: null },
    ] });
    render(<Policies guard={guard} />);
    expect(await screen.findByText('Leave policy')).toBeTruthy();
    const accepts = screen.getAllByRole('button', { name: 'Accept' });
    expect(accepts).toHaveLength(1);
    fireEvent.click(accepts[0]);
    await waitFor(() => expect(api.acceptItem).toHaveBeenCalledWith('a1'));
  });
});
