import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import ScheduleCalendar from './ScheduleCalendar';
import { copyRosterWeek, discardRosterDraft, getRoster, publishRoster, setRosterDraft } from '../api/attendance';
import { confirmDialog, notify } from '@ui/components/ui/notify';

/*
 * The roster screen: a block set in the grid is one request, then the grid is
 * read again; Publish is the one primary action and is there only with a
 * draft to publish; someone who may only view Shifts gets the grid read only.
 */

const perms = vi.hoisted(() => ({ value: { isAdmin: false, permissions: new Set(['ATTENDANCE::Shifts::EDIT']) } }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => perms.value }));
vi.mock('@ui/personnel/api', () => ({ listStructure: vi.fn(async () => []), listBranches: vi.fn(async () => []) }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@ui/components/list/exportMenu', () => ({ exportFormatFromKey: () => null, exportMenuItem: (label) => ({ key: 'export', label }), runListExport: vi.fn() }));
vi.mock('../api/attendance', () => ({
  getRoster: vi.fn(), setRosterDraft: vi.fn(), copyRosterWeek: vi.fn(), discardRosterDraft: vi.fn(), publishRoster: vi.fn(),
  SCHEDULE_SOURCE: {},
  dayLabel: (d) => d,
  todayIst: () => '2026-12-09',
}));

const DAYS = ['2026-12-07', '2026-12-08', '2026-12-09'];
const roster = (draft = { days: 0, people: 0, from: null, to: null }) => ({
  from: DAYS[0], to: DAYS[2], days: DAYS, total: 2, page: 1, pageSize: 50,
  rows: ['e1', 'e2'].map((id, i) => ({ employeeId: id, name: `Person ${i + 1}`, code: `P${i + 1}`, cells: DAYS.map((date) => ({ date, kind: 'WORK', shiftId: null, code: null, name: 'Standard', source: 'DEFAULT' })) })),
  employeeIds: ['e1', 'e2'],
  shifts: [{ id: 's1', name: 'Day', code: 'D', startTime: '09:00', endTime: '18:00', minStaff: null }],
  coverage: DAYS.map((date) => ({ date, counts: { '': 2 }, company: { '': 2 }, short: {} })),
  holidays: [], closedMonths: [], draft,
});
const cell = (r, c) => document.querySelector(`[data-cell="${r}:${c}"]`);

beforeEach(() => {
  perms.value = { isAdmin: false, permissions: new Set(['ATTENDANCE::Shifts::EDIT']) };
  for (const f of [getRoster, setRosterDraft, copyRosterWeek, discardRosterDraft, publishRoster, confirmDialog, notify.success, notify.error, notify.info]) f.mockClear();
  confirmDialog.mockResolvedValue(true);
  getRoster.mockResolvedValue(roster());
});
afterEach(cleanup);

it('asks for the month in view, and for a week when the view changes', async () => {
  render(<ScheduleCalendar />);
  await screen.findByRole('grid', { name: 'Roster' });
  expect(getRoster).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-12-01', to: '2026-12-31', page: 1, pageSize: 50 }));
  fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
  /* 9 Dec 2026 is a Wednesday: its week runs Monday 7 to Sunday 13. */
  await waitFor(() => expect(getRoster).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-12-07', to: '2026-12-13' })));
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
  await waitFor(() => expect(getRoster).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-12-14', to: '2026-12-20' })));
});

it('sets a block with one request, says what happened, and reads the grid again', async () => {
  setRosterDraft.mockResolvedValue({ changed: 3, unchanged: 0, skipped: [{ employeeId: 'e2', date: DAYS[1], reason: 'TEMPORARY' }], skippedCount: 1 });
  render(<ScheduleCalendar />);
  await screen.findByRole('grid', { name: 'Roster' });
  fireEvent.keyDown(cell(0, 0), { key: 'ArrowDown', shiftKey: true });
  fireEvent.keyDown(cell(1, 0), { key: 'ArrowRight', shiftKey: true });
  fireEvent.keyDown(cell(1, 1), { key: 'd' });
  await waitFor(() => expect(notify.success).toHaveBeenCalledWith('3 days set in the draft. 1 on a temporary schedule.'));
  expect(setRosterDraft).toHaveBeenCalledTimes(1);
  expect(setRosterDraft).toHaveBeenCalledWith({ employeeIds: ['e1', 'e2'], dates: [DAYS[0], DAYS[1]], kind: 'SHIFT', shiftId: 's1' });
  await waitFor(() => expect(getRoster).toHaveBeenCalledTimes(2));
});

it('says so when the server refuses, and changes nothing', async () => {
  setRosterDraft.mockRejectedValue(new Error('2026-09 is closed in Attendance.'));
  render(<ScheduleCalendar />);
  await screen.findByRole('grid', { name: 'Roster' });
  fireEvent.keyDown(cell(0, 0), { key: 'w' });
  await waitFor(() => expect(notify.error).toHaveBeenCalledWith('2026-09 is closed in Attendance.'));
  expect(getRoster).toHaveBeenCalledTimes(1);
});

it('publishes the draft from the one primary action, after asking', async () => {
  getRoster.mockResolvedValue(roster({ days: 4, people: 2, from: DAYS[0], to: DAYS[1] }));
  publishRoster.mockResolvedValue({ published: 4, people: 2, days: 4, notified: 1 });
  render(<ScheduleCalendar />);
  await screen.findByRole('grid', { name: 'Roster' });
  expect(screen.getByRole('status').textContent).toContain('4 changes for 2 people, 2026-12-07 to 2026-12-08, not published.');
  const button = screen.getByRole('button', { name: 'Publish' });
  expect(document.querySelectorAll('.ui-btn-primary')).toHaveLength(1);
  fireEvent.click(button);
  await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Roster published: 4 days changed for 2 people, 1 told.'));
  expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Publish 4 changes?', confirmLabel: 'Publish' }));
  expect(publishRoster).toHaveBeenCalledTimes(1);
});

it('does not publish when the question is answered no, and has nothing to publish without a draft', async () => {
  getRoster.mockResolvedValue(roster({ days: 1, people: 1, from: DAYS[0], to: DAYS[0] }));
  confirmDialog.mockResolvedValue(false);
  const first = render(<ScheduleCalendar />);
  await screen.findByRole('grid', { name: 'Roster' });
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
  expect(publishRoster).not.toHaveBeenCalled();
  first.unmount();
  getRoster.mockResolvedValue(roster());
  render(<ScheduleCalendar />);
  await screen.findByRole('grid', { name: 'Roster' });
  expect(screen.getByRole('button', { name: 'Publish' }).disabled).toBe(true);
  expect(screen.queryByRole('status')).toBeNull();
});

it('is read only for someone who may only view Shifts', async () => {
  perms.value = { isAdmin: false, permissions: new Set(['ATTENDANCE::Shifts::VIEW']) };
  getRoster.mockResolvedValue(roster({ days: 4, people: 2, from: DAYS[0], to: DAYS[1] }));
  render(<ScheduleCalendar />);
  const grid = await screen.findByRole('grid', { name: 'Roster' });
  expect(grid.getAttribute('aria-readonly')).toBe('true');
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  fireEvent.keyDown(cell(0, 0), { key: 'd' });
  expect(setRosterDraft).not.toHaveBeenCalled();
});
