import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import Referrals from './Referrals';

/*
 * HR's Referrals (A20): who referred whom and where they are, the bonus with its amount only for
 * someone who may see it, the bonus filters, and the report by employee.
 */
const perms = { current: new Set(['PEOPLE::Recruitment::VIEW', 'PEOPLE::Recruitment::EDIT']) };
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => ({ isAdmin: false, permissions: perms.current }) }));
vi.mock('./CandidateDrawer', () => ({ default: ({ id }) => <div role="dialog">Candidate {id}</div> }));
const rows = [
  { id: 'r1', candidateId: 'c1', candidate: 'Priya Shah', stage: 'HIRED', openingId: 'o1', job: 'Sales executive', referrerId: 'e1', referrer: 'Ravi Kumar', via: 'FORM', relation: 'College friend', referredAt: '2026-09-01T10:00:00Z', bonusStatus: 'DUE', bonusDueOn: '2026-10-28', bonusAmount: 5000, hasBonus: true },
  { id: 'r2', candidateId: 'c2', candidate: 'Anil Rao', stage: 'REJECTED', openingId: 'o1', job: 'Sales executive', referrerId: 'e1', referrer: 'Ravi Kumar', via: 'LINK', relation: null, referredAt: '2026-09-02T10:00:00Z', bonusStatus: 'NONE', bonusDueOn: null, bonusAmount: 5000, hasBonus: true },
];
const api = vi.hoisted(() => ({
  listReferrals: vi.fn(),
  referralReport: vi.fn(),
  listOpenings: vi.fn(),
  sendBonus: vi.fn(),
  bonusPaid: vi.fn(),
  bonusForfeit: vi.fn(),
}));
vi.mock('../api/talent', () => api);

beforeEach(() => {
  perms.current = new Set(['PEOPLE::Recruitment::VIEW', 'PEOPLE::Recruitment::EDIT']);
  api.listOpenings.mockResolvedValue([{ id: 'o1', title: 'Sales executive' }]);
  api.listReferrals.mockImplementation(({ status }) => Promise.resolve({ rows: status === 'bonusDue' ? [rows[0]] : rows, counts: { all: 2, open: 0, joined: 1, bonusDue: 1, bonusWaiting: 0, bonusPaid: 0, notTaken: 1 }, money: true }));
  api.referralReport.mockResolvedValue({ money: true, totals: { referred: 2, inProcess: 0, joined: 1, bonusWaiting: 0, bonusDue: 5000, bonusPaid: 0 }, byEmployee: [{ referrerId: 'e1', referrer: 'Ravi Kumar', referred: 2, inProcess: 0, joined: 1, bonusDue: 5000, bonusPaid: 0 }], hires: [] });
});

it('lists referrals with the referrer, the stage and the bonus amount for HR', async () => {
  render(<Referrals />);
  expect((await screen.findAllByText('Priya Shah')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Ravi Kumar').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Through their link').length).toBeGreaterThan(0);
  expect(screen.getAllByText('₹5,000').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Due').length).toBeGreaterThan(0);
});

it('hides amounts from someone who may not see them', async () => {
  api.listReferrals.mockResolvedValue({ rows: rows.map((r) => ({ ...r, bonusAmount: null })), counts: {}, money: false });
  render(<Referrals />);
  expect((await screen.findAllByText('Priya Shah')).length).toBeGreaterThan(0);
  expect(screen.queryByText('₹5,000')).toBeNull();
  expect(screen.getAllByText('Due').length).toBeGreaterThan(0);
});

it('filters to bonuses due from a notice, and shows the report by employee', async () => {
  render(<Referrals params={{ status: 'bonusDue' }} />);
  await waitFor(() => expect(api.listReferrals).toHaveBeenCalledWith(expect.objectContaining({ status: 'bonusDue' })));
  expect(screen.queryByText('Anil Rao')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'By employee' }));
  const table = await screen.findByRole('table', { name: 'Referrals by employee' });
  expect(table.textContent).toContain('Ravi Kumar');
  expect(screen.getByText('Bonus due', { selector: 'dt' }).nextSibling.textContent).toBe('₹5,000');
});
