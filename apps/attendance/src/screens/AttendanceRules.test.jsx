import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import AttendanceRules from './AttendanceRules';
import { PermissionContext } from '@ui/permissions/context';

/*
 * The Attendance app's late-arrival numbers (review of #89): they set the rule only while People's
 * Attendance rules hold "every N marks"; under a minute cut the real rule is shown, not two numbers.
 */
const api = vi.hoisted(() => ({
  getRules: vi.fn(), saveRules: vi.fn(), listShifts: vi.fn(async () => []), listRuleVersions: vi.fn(async () => []),
  recompute: vi.fn(), recomputeTrust: vi.fn(), simulateRules: vi.fn(),
  dayLabel: (d) => d, hm: (m) => String(m), todayIst: () => '2026-10-31',
}));
vi.mock('../api/attendance', () => api);
vi.mock('@ui/api/features', () => ({ getFeatures: vi.fn(async () => ({})), setFeatures: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

const BASE = { defaultShiftId: null, lateAllowancePerMonth: 1, latePenaltyEvery: 3, photoRetentionDays: 90, readerUsersBecomeEmployees: true, leaveApproval: 'HR', correctionApproval: 'HR', autoShiftByPunch: false, readerTrust: false, readerLateUploadHours: 24 };
const mount = () => render(<PermissionContext.Provider value={{ loading: false, error: '', isAdmin: true, permissions: new Set() }}><AttendanceRules /></PermissionContext.Provider>);
const lateSection = async () => within((await screen.findByRole('heading', { name: 'Late arrivals' })).closest('section'));

it('under People’s every-N rule the two numbers are set here, with the cost People chose and when a change counts', async () => {
  api.getRules.mockResolvedValue({ ...BASE, lateOn: true, lateFree: 1, lateCutMode: 'HALF_DAY_PER_N', lateCost: 1, lateRoundToMinutes: 15, lateRuleInPeople: true, lateNumbersHere: true });
  mount();
  const late = await lateSection();
  expect(late.getByLabelText('Free late arrivals a month')).toBeTruthy();
  expect(late.getByText(/Then a day’s pay lost every/)).toBeTruthy();
  expect(late.getByText(/every 3 late arrivals cost a full day\. A change counts from next month\./)).toBeTruthy();
});

it('under a minute cut the rule is shown in words, with no numbers to change', async () => {
  api.getRules.mockResolvedValue({ ...BASE, latePenaltyEvery: 0, lateOn: true, lateFree: 2, lateCutMode: 'TIME_MISSED_ROUNDED_DOWN', lateCost: 0.5, lateRoundToMinutes: 30, lateRuleInPeople: true, lateNumbersHere: false });
  mount();
  const late = await lateSection();
  await waitFor(() => expect(late.getByRole('status').textContent).toMatch(/After 2 free a month, each late arrival cuts the time missed, rounded down to 30 minutes\. Set in People, under Attendance rules\./));
  expect(late.queryByLabelText('Free late arrivals a month')).toBeNull();
  expect(late.queryByText(/half a day/)).toBeNull();
});

it('changes to the rules read in words: a People save shows each field that moved and when it counts, never [object Object]', async () => {
  api.getRules.mockResolvedValue({ ...BASE, lateOn: true, lateFree: 1, lateCutMode: 'HALF_DAY_PER_N', lateCost: 0.5, lateRoundToMinutes: 15, lateRuleInPeople: true, lateNumbersHere: true });
  const marks = { on: true, cutMode: 'HALF_DAY_PER_N', cost: 0.5, roundToMinutes: 15, takeFrom: [], late: { on: true, every: 3, free: 0, graceMinutes: null }, early: { on: false, every: 3, free: 0, graceMinutes: null } };
  api.listRuleVersions.mockResolvedValue([
    { version: 2, at: '2026-10-31T10:00:00Z', by: 'Hema HR', kind: 'RULES', name: 'Attendance rules', from: '2026-11-01', before: { marks, night: { on: true, mode: 'ENFORCE' } }, after: { marks: { ...marks, cutMode: 'TIME_MISSED_ROUNDED_DOWN', roundToMinutes: 30, late: { ...marks.late, free: 2 } }, night: { on: true, mode: 'WARN' } } },
    { version: 1, at: '2026-10-30T10:00:00Z', by: 'Owner', kind: 'RULES', before: { latePenaltyEvery: 0 }, after: { latePenaltyEvery: 3 } },
  ]);
  mount();
  const history = within((await screen.findByRole('heading', { name: 'Changes to the rules' })).closest('section'));
  const text = history.getAllByRole('listitem').map((li) => li.textContent).join(' | ');
  expect(text).not.toMatch(/object Object/);
  expect(text).toMatch(/Attendance rules \(People\)/);
  expect(text).toMatch(/Each mark cuts: every few marks → the time missed, rounded down/);
  expect(text).toMatch(/Rounded down to \(min\): 15 → 30/);
  expect(text).toMatch(/Free late marks: 0 → 2/);
  expect(text).toMatch(/Without consent: refuse the shift → save and warn/);
  expect(text).toMatch(/save and warn · Counts from 1 November 2026/);
  expect(text).toMatch(/Half day lost every: 0 → 3/);
});
