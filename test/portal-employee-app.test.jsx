import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/*
 * The web employee app's gaps from the employee-view audit (EMPLOYEE-VIEW.md):
 * payslips, the "What's new" feed, resigning, Ask HR as a conversation, the
 * private complaint, the salary-account card, cards that say when they did
 * not load, a confirm before cancelling leave, and the year's holidays.
 */
const api = vi.hoisted(() => ({
  portalToken: vi.fn(() => 'tok'),
  setPortalToken: vi.fn(),
  rememberedIds: vi.fn(() => ({})),
  SignedOut: class SignedOut extends Error {},
  todayIst: () => '2026-10-27',
  hm: (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`,
  getMe: vi.fn(),
  getPayslips: vi.fn(),
  getPayslip: vi.fn(),
  getUpdates: vi.fn(),
  getHolidays: vi.fn(),
  pickRestrictedHoliday: vi.fn(async () => ({ ok: true })),
  getLeaving: vi.fn(),
  /* Joining & Leaving: nothing of the person's own to do, so the card stays away. */
  getJourney: vi.fn(async () => ({ joining: [], leaving: [], handBack: [] })),
  getGrowth: vi.fn(async () => ({ on: false, goals: [], reviews: [], plans: [], oneOnOnes: [], trainings: [] })),
  /* Jobs and referrals: the company has Hiring off, so the block stays away. */
  getReferrals: vi.fn(async () => ({ on: false, jobs: [], referrals: [], applications: [] })),
  referFriend: vi.fn(),
  referralLink: vi.fn(),
  applyWithin: vi.fn(),
  doneJourneyTask: vi.fn(async () => ({ done: true })),
  resign: vi.fn(async () => ({ request: { id: 'l1', status: 'WAITING' } })),
  getMyDetails: vi.fn(),
  getDesk: vi.fn(),
  raiseDesk: vi.fn(async () => ({ request: { id: 'd9' } })),
  getDeskCase: vi.fn(),
  replyDesk: vi.fn(async () => ({ message: { id: 'm9' } })),
  reopenDesk: vi.fn(async () => ({ request: { id: 'd2' } })),
  raisePrivateCase: vi.fn(),
  getDocuments: vi.fn(),
  getToAccept: vi.fn(async () => ({ pending: [] })),
  getLeave: vi.fn(),
  cancelLeave: vi.fn(async () => ({ request: {} })),
  getTax: vi.fn(async () => ({ available: false })),
  getPolicies: vi.fn(async () => ({ policies: [] })),
  getCompanyUpdates: vi.fn(async () => ({ announcements: [], events: [] })),
  getSessions: vi.fn(async () => ({ sessions: [] })),
  getDataRequests: vi.fn(async () => ({ requests: [] })),
}));
vi.mock('../apps/attendance/src/portal/portalApi', () => {
  const rest = ['acceptItem', 'activate', 'askLeave', 'listRequests', 'askRequest', 'changeRequest', 'cancelRequest', 'requestRules', 'explainDay', 'explainLeave', 'editLeave', 'shortenLeave', 'getRestrictedHolidays', 'changePassword', 'endOtherSessions', 'endSession', 'decideApproval', 'askData', 'getApprovals', 'getMyData', 'getPrivacyNotice', 'readPrivacyNotice', 'withdrawConsent', 'getDocument', 'getAttendance', 'previewLeave', 'getSchedule', 'saveTax', 'punch', 'signIn', 'signOut', 'askDetailsChange', 'answerMyRequest', 'withdrawMyRequest', 'getPolicy', 'shrinkPhoto', 'locate', 'getForms', 'askFormRequest', 'replyFormRequest', 'withdrawFormRequest', 'getFormFile', 'getSwaps', 'swapColleagues', 'askSwap', 'answerSwap', 'withdrawSwap'];
  return { ...Object.fromEntries(rest.map((k) => [k, vi.fn(() => Promise.resolve({}))])), ...api };
});
/* The Me tab's money cards (MyMoney.jsx) call their own transport: nothing spent, no salary advance here. */
vi.mock('../apps/attendance/src/portal/moneyApi', () => {
  const calls = ['addBill', 'removeBill', 'sendClaim', 'reopenClaim', 'askAdvance', 'previewSalaryAdvance', 'askSalaryAdvance', 'withdrawMoney', 'answerMoney', 'billUrl', 'billData'];
  return { ...Object.fromEntries(calls.map((k) => [k, vi.fn(() => Promise.resolve({}))])), getMoney: vi.fn(() => Promise.resolve({ categories: [], merchants: [], draft: null, claims: [], advances: [], salaryAdvance: { available: false, asks: [], loans: [], cap: null } })) };
});
vi.mock('@platform/http', () => ({ apiFetch: vi.fn(), API_BASE: '/api' }));
vi.mock('@platform/context', () => ({ orgId: () => 'org1', currentUser: () => null }));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => dialogs);
vi.mock('../packages/ui/src/components/ui/notify', () => dialogs);

import EmployeePortal from '../apps/attendance/src/portal/EmployeePortal';
import AskHr from '../apps/attendance/src/portal/AskHr';
import { LeavingCompany, Payslips, PrivateComplaint } from '../apps/attendance/src/portal/MeExtras';
import { HolidaysYear, WhatsNew } from '../apps/attendance/src/portal/PortalFeeds';

const guard = (p) => p;
const ME = {
  today: '2026-10-27', company: { name: 'Mehta Furniture' }, employee: { name: 'Asha Rao', code: 'MF-007' }, approver: false,
  record: null, shift: { name: 'General', startTime: '09:00', endTime: '18:00' }, phone: { allowed: false, why: '' }, punches: [], privacy: null,
};
const DESK = {
  available: true,
  categories: [{ key: 'PAYROLL', label: 'Pay and payslips' }, { key: 'LEAVE', label: 'Leave and attendance' }, { key: 'OTHER', label: 'Something else' }],
  requests: [
    { id: 'd1', subject: 'October salary is short', category: 'PAYROLL', status: 'WAITING_EMPLOYEE', createdAt: '2026-10-20T05:00:00Z', hrWroteLast: true },
    { id: 'd2', subject: 'Experience letter', category: 'OTHER', status: 'RESOLVED', createdAt: '2026-10-10T05:00:00Z', hrWroteLast: false },
  ],
};

beforeEach(() => {
  try { localStorage.clear(); } catch { /* none */ }
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Payslips', () => {
  it('says nothing when the company does not run payroll here', async () => {
    api.getPayslips.mockResolvedValue({ available: false, slips: [] });
    const { container } = render(<Payslips guard={guard} />);
    await waitFor(() => expect(api.getPayslips).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('lists period, take-home and paid; opening one shows its lines and Save as PDF prints it', async () => {
    api.getPayslips.mockResolvedValue({ available: true, slips: [{ id: 's1', period: 'September 2026', net: 23450, paid: true }, { id: 's2', period: 'October 2026', net: 24000, paid: false }] });
    api.getPayslip.mockResolvedValue({ slip: {
      id: 's1', number: 'PS-0009', company: 'Mehta Furniture', period: 'September 2026', from: '2026-09-01', to: '2026-09-30',
      employee: { name: 'Asha Rao', code: 'MF-007', pan: '••••••234F', account: '••••6789', bank: 'SBI', uan: '', designation: '', department: '' },
      days: { working: 26, payable: 25, lossOfPay: 1 },
      earnings: [{ name: 'Basic', amount: 15000 }, { name: 'HRA', amount: 10000 }], deductions: [{ name: 'PF', amount: 1550 }],
      gross: 25000, totalDeductions: 1550, net: 23450, paid: true,
    } });
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<Payslips guard={guard} />);
    expect(await screen.findByText('September 2026')).toBeInTheDocument();
    expect(screen.getByText('₹23,450.00')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Not paid yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open payslip for September 2026' }));
    await waitFor(() => expect(api.getPayslip).toHaveBeenCalledWith('s1'));
    expect(await screen.findByText('Payslip · September 2026')).toBeInTheDocument();
    expect(screen.getAllByText('Basic').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹1,550.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/25 of 26 days paid · 1 without pay/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
    expect(print).toHaveBeenCalled();
    expect(document.title).toBe('Payslip September 2026 MF-007');
    print.mockRestore();
  });
});

describe('What’s new', () => {
  it('shows decisions with the note, and Got it puts one away on this browser', async () => {
    api.getUpdates.mockResolvedValue({ decided: [
      { key: 'leave:l1:REJECTED', kind: 'leave', status: 'REJECTED', text: 'Casual 3 Nov 2026 was rejected. “Stock count that day”', note: 'Stock count that day', at: '2026-10-26T05:00:00Z' },
      { key: 'lapse:2026', kind: 'lapse', status: 'LAPSE', text: '4 days of leave will lapse on 31 Dec 2026 unless you take them: Earned 4.', note: null, at: '2026-10-27T05:00:00Z' },
    ], waitingForMe: 0 });
    render(<WhatsNew guard={guard} />);
    expect(await screen.findByText(/was rejected\. “Stock count that day”/)).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText(/will lapse on 31 Dec 2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Got it: Casual/ }));
    expect(screen.queryByText(/was rejected/)).toBeNull();
    expect(JSON.parse(localStorage.getItem('clor.portal.seen'))).toEqual(['leave:l1:REJECTED']);
    cleanup();
    render(<WhatsNew guard={guard} />);
    expect(await screen.findByText(/will lapse/)).toBeInTheDocument();
    expect(screen.queryByText(/was rejected/)).toBeNull();
  });

  it('says so when it could not load', async () => {
    api.getUpdates.mockRejectedValue(new Error('Could not reach the server.'));
    render(<WhatsNew guard={guard} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Leaving the company', () => {
  it('fills the last day from the notice period, confirms, and sends', async () => {
    api.getLeaving.mockResolvedValueOnce({ status: 'ACTIVE', lastDay: null, waiting: null }).mockResolvedValue({ status: 'ACTIVE', lastDay: null, waiting: { id: 'l1', status: 'WAITING', createdAt: '2026-10-27T05:00:00Z' } });
    api.getMyDetails.mockResolvedValue({ terms: { noticeDays: 30 } });
    const onSent = vi.fn();
    render(<LeavingCompany guard={guard} onSent={onSent} />);
    fireEvent.click(await screen.findByRole('button', { name: 'I want to resign' }));
    expect(screen.getByLabelText(/Last working day/)).toHaveValue('2026-11-26');
    expect(screen.getByText(/Your notice is 30 days/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Moving to Pune' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resign' }));
    await waitFor(() => expect(api.resign).toHaveBeenCalledWith({ lastDay: '2026-11-26', reason: 'Moving to Pune' }));
    expect(dialogs.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Send your resignation?' }));
    expect(onSent).toHaveBeenCalled();
    expect(await screen.findByText(/Your resignation is with your manager and HR, sent 27 Oct 2026/)).toBeInTheDocument();
  });

  it('sends nothing when the confirm is declined', async () => {
    api.getLeaving.mockResolvedValue({ status: 'ACTIVE', lastDay: null, waiting: null });
    api.getMyDetails.mockResolvedValue({ terms: { noticeDays: null } });
    dialogs.confirmDialog.mockResolvedValueOnce(false);
    render(<LeavingCompany guard={guard} />);
    fireEvent.click(await screen.findByRole('button', { name: 'I want to resign' }));
    fireEvent.change(screen.getByLabelText(/Last working day/), { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resign' }));
    await waitFor(() => expect(dialogs.confirmDialog).toHaveBeenCalled());
    expect(api.resign).not.toHaveBeenCalled();
  });
});

describe('Ask HR as a conversation', () => {
  it('badges where HR wrote last, opens the thread, and sends a reply', async () => {
    api.getDesk.mockResolvedValue(DESK);
    api.getDeskCase.mockResolvedValue({ request: { id: 'd1', subject: 'October salary is short', category: 'PAYROLL', status: 'WAITING_EMPLOYEE', description: 'I got 2,000 less.', createdAt: '2026-10-20T05:00:00Z', messages: [{ id: 'm1', from: 'HR', authorName: 'Priya (HR)', body: 'Which days were you on leave?', createdAt: '2026-10-21T05:00:00Z' }] } });
    render(<AskHr guard={guard} />);
    const row = (await screen.findByText('October salary is short')).closest('button');
    expect(within(row).getByText('HR replied')).toBeInTheDocument();
    expect(within(row).getByText('HR is waiting for you')).toBeInTheDocument();
    fireEvent.click(row);
    expect(await screen.findByText('Which days were you on leave?')).toBeInTheDocument();
    expect(screen.getByText(/Priya \(HR\) · 21 Oct 2026/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Only 14 October.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(api.replyDesk).toHaveBeenCalledWith('d1', 'Only 14 October.'));
  });

  it('offers Reopen on an answer from the last seven days', async () => {
    api.getDesk.mockResolvedValue(DESK);
    api.getDeskCase.mockResolvedValue({ request: { id: 'd2', subject: 'Experience letter', category: 'OTHER', status: 'RESOLVED', description: 'Need one', resolution: 'Sent to your documents.', resolvedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), createdAt: '2026-10-10T05:00:00Z', messages: [] } });
    render(<AskHr guard={guard} />);
    fireEvent.click((await screen.findByText('Experience letter')).closest('button'));
    expect(await screen.findByText('Sent to your documents.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your reply')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(api.reopenDesk).toHaveBeenCalledWith('d2'));
  });

  it('shows nothing where the company does not take questions here', async () => {
    api.getDesk.mockResolvedValue({ available: false, requests: [], categories: [] });
    const { container } = render(<AskHr guard={guard} />);
    await waitFor(() => expect(api.getDesk).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});

describe('Private complaint', () => {
  it('a quiet link opens a short form; afterwards only the reference and the inquiry date', async () => {
    api.raisePrivateCase.mockResolvedValue({ reference: 'PC-2026-004', receivedOn: '2026-10-27', inquiryDue: '2027-01-25' });
    render(<PrivateComplaint guard={guard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Raise a private complaint' }));
    fireEvent.change(screen.getByLabelText(/When it happened/), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: 'Comments in the stores about me, more than once.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to the committee' }));
    await waitFor(() => expect(api.raisePrivateCase).toHaveBeenCalledWith({ kind: 'POSH', incidentOn: '2026-10-20', summary: 'Comments in the stores about me, more than once.' }));
    expect(await screen.findByText('PC-2026-004')).toBeInTheDocument();
    expect(screen.getByText(/finish its inquiry by 25 Jan 2027/)).toBeInTheDocument();
    expect(screen.queryByText(/Comments in the stores/)).toBeNull();
  });
});

describe('Holidays for the year', () => {
  it('lists every holiday, marks optional ones, and picks one inline', async () => {
    api.getHolidays.mockResolvedValue({ year: 2026, quota: 2, picked: 0, left: 2, holidays: [
      { id: null, date: '2026-08-15', name: 'Independence Day', restricted: false, picked: false, past: true },
      { id: 'h2', date: '2026-11-08', name: 'Diwali (2nd day)', restricted: true, picked: false, past: false },
      { id: null, date: '2026-12-25', name: 'Christmas', restricted: false, picked: false, past: false },
    ] });
    render(<HolidaysYear guard={guard} />);
    expect(await screen.findByText('Holidays 2026')).toBeInTheDocument();
    expect(screen.getByText('Independence Day')).toBeInTheDocument();
    expect(screen.getByText(/Optional holidays: 0 of 2 picked/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Pick' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }));
    await waitFor(() => expect(api.pickRestrictedHoliday).toHaveBeenCalledWith('h2', true));
    fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    await waitFor(() => expect(api.getHolidays).toHaveBeenCalledWith(2027));
  });
});

describe('The Me tab and Leave in the app', () => {
  it('the Pay card opens Ask HR filled in the pay category; a failed documents load says so', async () => {
    api.getMe.mockResolvedValue(ME);
    api.getPayslips.mockResolvedValue({ available: false, slips: [] });
    api.getMyDetails.mockResolvedValue({ fields: {}, labels: {}, savesAtOnce: [], hrDecidesWithinDays: 3, terms: null, requests: [] });
    api.getLeaving.mockResolvedValue({ status: 'ACTIVE', lastDay: null, waiting: null });
    api.getDesk.mockResolvedValue({ ...DESK, requests: [] });
    api.getDocuments.mockRejectedValue(new Error('boom'));
    api.getUpdates.mockResolvedValue({ decided: [] });
    render(<EmployeePortal />);
    fireEvent.click(await screen.findByRole('button', { name: 'Me' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask HR to change my account' }));
    expect(await screen.findByDisplayValue('Change my salary account')).toBeInTheDocument();
    expect(screen.getByLabelText('About')).toHaveValue('PAYROLL');
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raise a private complaint' })).toBeInTheDocument();
    expect(screen.getByText('Leaving the company')).toBeInTheDocument();
  });

  it('asks before cancelling approved leave', async () => {
    api.getMe.mockResolvedValue(ME);
    api.getUpdates.mockResolvedValue({ decided: [] });
    api.getHolidays.mockResolvedValue({ year: 2026, quota: 0, picked: 0, left: 0, holidays: [] });
    api.getLeave.mockResolvedValue({ year: 2026, today: '2026-10-27', types: [{ id: 't1', name: 'Casual', isPaid: true, available: 5, allocated: 12 }], requests: [{ id: 'l1', leaveTypeId: 't1', leaveTypeName: 'Casual', fromDate: '2026-11-03', toDate: '2026-11-04', days: 2, status: 'APPROVED' }] });
    dialogs.confirmDialog.mockResolvedValueOnce(false);
    render(<EmployeePortal />);
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dialogs.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cancel this leave?' })));
    expect(api.cancelLeave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(api.cancelLeave).toHaveBeenCalledWith('l1'));
  });
});
