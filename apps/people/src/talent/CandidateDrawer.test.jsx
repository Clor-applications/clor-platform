import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import CandidateDrawer from './CandidateDrawer';

/*
 * One hire path (People plan 8 Nov 2026, step 4): Hire is the primary only on
 * an accepted offer; otherwise the card offers "Hire without offer…", which
 * asks why before it hires and sends the reason with the flag.
 */
const api = vi.hoisted(() => ({
  getCandidate: vi.fn(), hireCandidate: vi.fn(), moveCandidate: vi.fn(), noteCandidate: vi.fn(), saveResume: vi.fn(), resumeFile: vi.fn(),
  addCandidate: vi.fn(), updateCandidate: vi.fn(), cancelInterview: vi.fn(), giveFeedback: vi.fn(), interviewers: vi.fn().mockResolvedValue([]), listInterviews: vi.fn().mockResolvedValue({ interviews: [] }), moveInterview: vi.fn(), scheduleInterview: vi.fn(), readFile: vi.fn(),
}));
vi.mock('../api/talent', () => api);
vi.mock('../workforce/api', () => ({ nextEmployeeCode: vi.fn().mockResolvedValue('E-42') }));
vi.mock('../workforce/OfferDrawer', () => ({ default: () => <div>Offer drawer</div> }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => ({ isAdmin: true, permissions: new Set() }) }));

const card = (offers) => ({
  candidate: { id: 'c1', name: 'Meera K', email: 'meera@example.com', phone: null, source: 'REFERRAL', stage: 'OFFER', stageAt: '2026-11-01T05:00:00Z', openingId: 'o1', openingTitle: 'Accountant', resume: null, resumeUrl: null, offerAcceptedOn: offers.some((o) => o.status === 'ACCEPTED') ? '2026-11-05' : null },
  timeline: [], interviews: [], offers, referral: null,
});
const mount = () => render(<CandidateDrawer id="c1" hr canEdit canHire canOffer onClose={() => {}} />);
beforeEach(() => vi.clearAllMocks());

it('Hire is the one primary once the offer is accepted, and "Hire without offer" is not offered', async () => {
  api.getCandidate.mockResolvedValue(card([{ id: 'of1', status: 'ACCEPTED', designation: 'Accountant', joiningDate: '2026-11-20', acceptBy: '2026-11-10' }]));
  mount();
  await screen.findByText(/Offer accepted on/);
  const hire = screen.getByRole('button', { name: 'Hire' });
  expect(hire.className).toContain('ui-btn-primary');
  expect(screen.queryByRole('button', { name: 'Hire without offer…' })).toBeNull();
  fireEvent.click(hire);
  expect(await screen.findByRole('heading', { name: 'Hire Meera K' })).toBeTruthy();
  expect(screen.queryByText('Why without an offer *')).toBeNull();
});

it('while the offer waits for an answer there is no Hire; "Hire without offer…" asks why and sends the flag and reason', async () => {
  api.getCandidate.mockResolvedValue(card([{ id: 'of1', status: 'SENT', designation: 'Accountant', joiningDate: '2026-11-20', acceptBy: '2026-11-10' }]));
  api.hireCandidate.mockResolvedValue({ employee: { id: 'e1', name: 'Meera K', code: 'E-42' }, handoffs: { offerFiled: false, checklist: 8, joiningForm: 'SENT', appAccess: 'SENT', salary: null } });
  mount();
  await screen.findByText('Waiting for them to accept the offer. Hire opens when they do.');
  expect(screen.queryByRole('button', { name: 'Hire' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Hire without offer…' }));
  await screen.findByRole('heading', { name: 'Hire Meera K without an offer' });
  /* No reason, no hire. */
  fireEvent.click(screen.getByRole('button', { name: 'Hire' }));
  expect(await screen.findByText(/Say why they are hired without an accepted offer/)).toBeTruthy();
  expect(api.hireCandidate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Why without an offer *'), { target: { value: 'Terms agreed in person' } });
  fireEvent.click(screen.getByRole('button', { name: 'Hire' }));
  await waitFor(() => expect(api.hireCandidate).toHaveBeenCalledWith('c1', expect.objectContaining({ withoutOffer: true, reason: 'Terms agreed in person', code: 'E-42' })));
});
