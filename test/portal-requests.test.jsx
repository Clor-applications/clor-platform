import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/*
 * The employee app's requests (TIME-LEAVE-DECISIONS.md, advanced build): the
 * kind picker offers only what the company switched on; a manager's
 * rejection needs a note the person will read.
 */
const api = vi.hoisted(() => ({
  portalToken: vi.fn(() => 'tok'),
  setPortalToken: vi.fn(),
  rememberedIds: vi.fn(() => ({})),
  SignedOut: class SignedOut extends Error {},
  getMe: vi.fn(),
  getAttendance: vi.fn(),
  getCompanyUpdates: vi.fn(() => Promise.resolve({ announcements: [], events: [] })),
  requestRules: vi.fn(),
  listRequests: vi.fn(() => Promise.resolve({ requests: [] })),
  askRequest: vi.fn(),
  changeRequest: vi.fn(),
  cancelRequest: vi.fn(),
  getApprovals: vi.fn(),
  decideApproval: vi.fn(() => Promise.resolve({ request: {} })),
  explainDay: vi.fn(),
  explainLeave: vi.fn(),
  punch: vi.fn(),
  getMonthReview: vi.fn(() => Promise.resolve({ summary: { payableDays: 0, lossOfPayDays: 0, present: 0, leave: 0, absent: 0, approvedOvertimeMinutes: 0 }, unresolved: [], confirmation: null })),
  confirmMonth: vi.fn(),
  disputeMonth: vi.fn(),
  getOvertime: vi.fn(() => Promise.resolve({ days: [] })),
  askOvertime: vi.fn(),
  cancelOvertime: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  activate: vi.fn(),
  todayIst: () => '2026-10-27',
  hm: (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`,
}));
/* Everything else the portal imports answers with an empty object; a Proxy would answer `then` too and vitest would wait on the module forever. */
vi.mock('../apps/attendance/src/portal/portalApi', () => {
  const rest = ['acceptItem', 'getToAccept', 'askLeave', 'cancelLeave', 'editLeave', 'shortenLeave', 'getRestrictedHolidays', 'pickRestrictedHoliday', 'changePassword', 'endOtherSessions', 'endSession', 'getSessions', 'askData', 'getDataRequests', 'getMyData', 'getPrivacyNotice', 'readPrivacyNotice', 'withdrawConsent', 'getDocument', 'getDocuments', 'getLeave', 'previewLeave', 'getHrCases', 'askHr', 'getSchedule', 'getTax', 'saveTax', 'getMyDetails', 'askDetailsChange', 'answerMyRequest', 'withdrawMyRequest', 'getPolicies', 'getPolicy', 'shrinkPhoto', 'locate', 'getUpdates', 'getHolidays', 'getPayslips', 'getPayslip', 'getLeaving', 'resign', 'getDesk', 'raiseDesk', 'getDeskCase', 'replyDesk', 'reopenDesk', 'raisePrivateCase', 'getForms', 'askFormRequest', 'replyFormRequest', 'withdrawFormRequest', 'getFormFile', 'getSwaps', 'swapColleagues', 'askSwap', 'answerSwap', 'withdrawSwap', 'getReferrals', 'referFriend', 'referralLink', 'applyWithin', 'getFixes', 'getMyMarks', 'getNightConsent', 'setNightConsent', 'getTodayPosts', 'getExitInterview', 'sendExitInterview', 'getCelebrations', 'setCelebrations'];
  return { ...Object.fromEntries(rest.map((k) => [k, vi.fn(() => Promise.resolve({}))])), ...api };
});
/* The Me tab's money cards (MyMoney.jsx) call their own transport: nothing spent, no salary advance here. */
vi.mock('../apps/attendance/src/portal/moneyApi', () => {
  const calls = ['addBill', 'removeBill', 'sendClaim', 'reopenClaim', 'askAdvance', 'previewSalaryAdvance', 'askSalaryAdvance', 'withdrawMoney', 'answerMoney', 'billUrl', 'billData'];
  return { ...Object.fromEntries(calls.map((k) => [k, vi.fn(() => Promise.resolve({}))])), getMoney: vi.fn(() => Promise.resolve({ categories: [], merchants: [], draft: null, claims: [], advances: [], salaryAdvance: { available: false, asks: [], loans: [], cap: null } })) };
});
vi.mock('@platform/http', () => ({ apiFetch: vi.fn(), API_BASE: '/api' }));
vi.mock('@platform/context', () => ({ orgId: () => 'org1', currentUser: () => null }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../packages/ui/src/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));

import EmployeePortal from '../apps/attendance/src/portal/EmployeePortal';

const ME = {
  today: '2026-10-27', company: { name: 'Mehta Furniture' }, employee: { name: 'Asha Rao', code: 'MF-007' }, approver: true,
  record: null, shift: { name: 'General', startTime: '09:00', endTime: '18:00' }, phone: { allowed: false, why: '' }, punches: [], privacy: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Employee app requests', () => {
  it('offers only the kinds the company switched on', async () => {
    api.getMe.mockResolvedValue(ME);
    api.getAttendance.mockResolvedValue({ totals: { present: 0, halfDay: 0, absent: 0, leave: 0, late: 0 }, days: [] });
    api.requestRules.mockResolvedValue({ month: '2026-10', rules: {}, kinds: [{ kind: 'MISSED_PUNCH', name: 'Missed punch' }, { kind: 'WFH', name: 'Work from home' }], usage: { WFH: { unit: 'days', used: 1, pending: 0, quota: 4, left: 3 } }, reasons: [] });
    render(<EmployeePortal />);
    fireEvent.click(await screen.findByRole('button', { name: 'My days' }));
    expect(await screen.findByRole('button', { name: 'Work from home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Missed punch' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'On duty' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Work from home' }));
    expect(screen.getByText(/Work-from-home days this month: 1 of 4 used, 3 left/)).toBeInTheDocument();
  });

  it('a manager rejecting a request must say why', async () => {
    api.getMe.mockResolvedValue(ME);
    api.getApprovals.mockResolvedValue({ team: 1, leaves: [], corrections: [], requests: [{ id: 'q1', type: 'request', kind: 'ON_DUTY', kindName: 'On duty', employeeName: 'Ravi Kumar', employeeCode: 'MF-009', date: '2026-11-02', toDate: null, halfDay: null, place: 'Client office', minutes: null, checkIn: null, checkOut: null, reason: 'Site visit', askedAt: '2026-10-27T05:00:00Z' }] });
    render(<EmployeePortal />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approvals' }));
    expect(await screen.findByText(/On duty · 2 Nov · Client office/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const reject = await screen.findByRole('button', { name: 'Reject' });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why not'), { target: { value: 'Nobody else in the office that day' } });
    expect(reject).toBeEnabled();
    fireEvent.click(reject);
    await waitFor(() => expect(api.decideApproval).toHaveBeenCalledWith('request', 'q1', { decision: 'reject', note: 'Nobody else in the office that day' }));
  });
});
