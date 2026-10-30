import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import AttendanceRules from './AttendanceRules';
import LateMarks from './LateMarks';
import Absences from './Absences';
import NightWork from './NightWork';

/*
 * The attendance-rules screens (WORKFLOW-GAP-RESEARCH 4.4, 4.6, B19): the settings sheet with its
 * preview, the month's late marks with waive and apply, an absence case's next step, and the
 * night-work report with consent recorded.
 */
const api = vi.hoisted(() => ({
  getAttendanceRules: vi.fn(),
  saveAttendanceRules: vi.fn(),
  previewLateMarks: vi.fn(),
  getLateMarks: vi.fn(),
  waivePenalty: vi.fn(),
  undoPenalty: vi.fn(),
  applyPenalties: vi.fn(),
  getAbsences: vi.fn(),
  checkAbsences: vi.fn(),
  sendAbsenceNotice: vi.fn(),
  getNoticeCopy: vi.fn(),
  closeAbsence: vi.fn(),
  recordAbsconded: vi.fn(),
  holdSettlement: vi.fn(),
  releaseSettlement: vi.fn(),
  getNightWork: vi.fn(),
  getConsentHistory: vi.fn(),
  recordNightConsent: vi.fn(),
}));
vi.mock('./api', () => api);
vi.mock('@ui/timeOff/api', () => ({ getRequestRules: vi.fn(async () => ({ rules: { MISSED_PUNCH: { quotaPerMonth: 3 } } })) }));
vi.mock('@ui/timeOff/suggestions', () => ({ useSuggestions: () => [] }));
vi.mock('@platform/context', () => ({ orgId: () => 'org1', currentUser: () => ({ fullName: 'Meera Shah' }) }));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => dialogs);

const RULES = {
  marks: { on: false, late: { on: true, graceMinutes: null, every: 3, free: 0 }, early: { on: false, graceMinutes: null, every: 3, free: 0 }, cost: 0.5, takeFrom: [] },
  nudge: { on: true, afterHours: 2, managerDigest: true },
  absence: { on: true, days: 5, noticeGapDays: 7, replyDays: 7 },
  night: { on: true, from: '19:00', to: '06:00' },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getAttendanceRules.mockResolvedValue({ rules: RULES, leaveTypes: [{ id: 'cl', name: 'Casual leave' }], version: 1, canEdit: true });
});

it('settings: late marks start off; switched on, the preview shows who it hits before anything is saved', async () => {
  api.previewLateMarks.mockResolvedValue({ month: '2026-09', rows: [{ employeeId: 'e1', name: 'Ravi Kumar', lateMarks: 4, earlyMarks: 0, now: 0, then: 0.5 }], totals: { people: 1, then: 0.5 } });
  api.saveAttendanceRules.mockResolvedValue({ rules: { ...RULES, marks: { ...RULES.marks, on: true, takeFrom: ['cl'] } }, version: 2 });
  render(<AttendanceRules />);
  const block = await screen.findByRole('group', { name: 'Late marks and early exits' });
  expect(within(block).queryByText('Take it from')).toBeNull();
  fireEvent.click(within(block).getByLabelText('On'));
  expect(screen.getByText(/Missed-punch requests a month/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Casual leave'));
  fireEvent.click(screen.getByRole('button', { name: /Who this hits in/ }));
  expect(await screen.findByText('Ravi Kumar')).toBeTruthy();
  expect(api.saveAttendanceRules).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.saveAttendanceRules).toHaveBeenCalled());
  expect(api.saveAttendanceRules.mock.calls[0][0].marks).toMatchObject({ on: true, takeFrom: ['cl'], cost: 0.5 });
});

it('settings: someone who may not change them sees no Save', async () => {
  api.getAttendanceRules.mockResolvedValue({ rules: RULES, leaveTypes: [], version: 1, canEdit: false });
  render(<AttendanceRules />);
  await screen.findByRole('group', { name: 'Missing punches' });
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
});

const MARKS = {
  month: '2026-09', ended: true, canApply: true, rules: { ...RULES.marks, on: true },
  totals: { people: 2, due: 1, days: 1, lossOfPayDays: 0.5, fromLeaveDays: 0.5, waived: 0, applied: 1 },
  rows: [
    { employeeId: 'e1', name: 'Asha Rao', code: 'E1', lateMarks: 3, earlyMarks: 0, lateDates: ['2026-09-01'], earlyDates: [], days: 0.5, status: 'DUE', fromLeave: [{ leaveTypeId: 'cl', name: 'Casual leave', days: 0.5 }], lossOfPayDays: 0, decision: null },
    { employeeId: 'e2', name: 'Ravi Kumar', code: 'E2', lateMarks: 4, earlyMarks: 0, lateDates: [], earlyDates: [], days: 0.5, status: 'APPLIED', fromLeave: [], lossOfPayDays: 0.5, decision: { reason: null } },
  ],
};

it('late marks: HR applies an ended month; a waiver needs a reason', async () => {
  api.getLateMarks.mockResolvedValue(MARKS);
  api.applyPenalties.mockResolvedValue({ applied: 1, skipped: [] });
  api.waivePenalty.mockResolvedValue({});
  render(<LateMarks params={{ month: '2026-09' }} />);
  expect((await screen.findAllByText('Asha Rao')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('To apply').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Apply September' }));
  await waitFor(() => expect(api.applyPenalties).toHaveBeenCalledWith('2026-09'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Waive' })[0]);
  const dialog = await screen.findByRole('dialog');
  const save = within(dialog).getByRole('button', { name: 'Waive' });
  expect(save.disabled).toBe(true);
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'Bus strike all week' } });
  fireEvent.click(save);
  await waitFor(() => expect(api.waivePenalty).toHaveBeenCalledWith('e1', '2026-09', 'Bus strike all week'));
});

it('late marks: a manager (no apply) sees no Apply button', async () => {
  api.getLateMarks.mockResolvedValue({ ...MARKS, canApply: false });
  render(<LateMarks params={{ month: '2026-09' }} />);
  expect((await screen.findAllByText('Asha Rao')).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull();
});

it('absences: a found case offers notice 1, sent with who signs it', async () => {
  api.getAbsences.mockResolvedValue({
    rules: { days: 5, replyDays: 7 }, counts: { open: 1 }, canAct: true,
    rows: [{ id: 'c1', employeeId: 'e9', name: 'Gone Away', code: 'G1', fromDate: '2026-10-20', lastAbsentDate: '2026-10-29', days: 8, status: 'OPEN', next: { step: 'NOTICE_1', from: '2026-10-30' }, notices: [], email: 'g@example.com', phone: '9800000000', createdAt: '2026-10-28T03:00:00Z', hold: null }],
  });
  api.sendAbsenceNotice.mockResolvedValue({ notice: {} });
  render(<Absences />);
  fireEvent.click((await screen.findAllByText('Gone Away'))[0]);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send notice 1' }));
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Send' }));
  await waitFor(() => expect(api.sendAbsenceNotice).toHaveBeenCalledWith('c1', expect.objectContaining({ signatory: 'Meera Shah, HR', email: true })));
});

it('night work: who works nights without consent comes first; HR records consent', async () => {
  api.getNightWork.mockResolvedValue({
    night: { on: true, words: '7 pm to 6 am' }, canEdit: true,
    totals: { women: 2, given: 1, withdrawn: 0, problems: 1, noGender: 0 },
    rows: [
      { employeeId: 'w1', name: 'Priya Nair', consent: null, nightDays: 4, firstNightDay: '2026-11-03', problem: true },
      { employeeId: 'w2', name: 'Asha Menon', consent: { status: 'GIVEN', onDate: '2026-10-01', documentId: 'd1' }, nightDays: 0, firstNightDay: null, problem: false },
    ],
  });
  api.getConsentHistory.mockResolvedValue([]);
  api.recordNightConsent.mockResolvedValue({ consent: {} });
  render(<NightWork />);
  expect(await screen.findByText(/1 on night shifts without consent/)).toBeTruthy();
  expect(screen.getAllByLabelText('Night shift without consent').length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByText('Priya Nair')[0]);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Record consent' }));
  await waitFor(() => expect(api.recordNightConsent).toHaveBeenCalledWith('w1', expect.objectContaining({ status: 'GIVEN' })));
});

it('night work: people on nights with no gender are named, and a manager gets no history', async () => {
  api.getNightWork.mockResolvedValue({
    night: { on: true, words: '7 pm to 6 am', mode: 'WARN' }, canEdit: false,
    totals: { women: 1, given: 0, withdrawn: 0, problems: 1, noGender: 1, unknownOnNights: 1 },
    rows: [{ employeeId: 'w1', name: 'Priya Nair', consent: { status: 'GIVEN', onDate: '2026-10-01', note: null, documentId: null }, nightDays: 2, firstNightDay: '2026-11-03', problem: false }],
    unknownGender: [{ employeeId: 'u1', name: 'Kim Lee', nightDays: 3, firstNightDay: '2026-11-04' }],
  });
  render(<NightWork />);
  expect(await screen.findByText(/Kim Lee works 3 night shifts/)).toBeTruthy();
  expect(screen.getByText(/shifts are saved with a warning/)).toBeTruthy();
  fireEvent.click(screen.getAllByText('Priya Nair')[0]);
  await screen.findByRole('dialog');
  expect(api.getConsentHistory).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Record consent' })).toBeNull();
});

it('absences: someone back at work needs a reason to be recorded as absconded', async () => {
  api.getAbsences.mockResolvedValue({
    rules: { days: 5, replyDays: 7 }, counts: { open: 1 }, canAct: true,
    rows: [{ id: 'c2', employeeId: 'e8', name: 'Back Again', fromDate: '2026-10-01', lastAbsentDate: '2026-10-20', days: 12, status: 'NOTICE_2', next: { step: 'RECORD', from: '2026-10-25' }, backSince: '2026-10-28', notices: [], email: null, createdAt: '2026-10-08T03:00:00Z', hold: null }],
  });
  api.recordAbsconded.mockResolvedValue({ case: {} });
  render(<Absences />);
  expect((await screen.findAllByText(/Back since/)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByText('Back Again')[0]);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Record the leaving' }));
  const record = within(dialog).getByRole('button', { name: 'Record' });
  expect(record.disabled).toBe(true);
  fireEvent.click(within(dialog).getByLabelText('Record it all the same'));
  fireEvent.change(within(dialog).getAllByRole('combobox').at(-1), { target: { value: 'Came only to collect belongings' } });
  fireEvent.click(record);
  await waitFor(() => expect(api.recordAbsconded).toHaveBeenCalledWith('c2', expect.objectContaining({ confirmBack: true, reason: 'Came only to collect belongings' })));
});
