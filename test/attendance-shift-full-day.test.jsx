import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * The full-day rule (audit 7 Nov 2026, P0) on the Shifts form: a new shift's
 * full day is the shift's own minutes (start to end less the break) and
 * follows the times, so a night shift made from the defaults can reach a
 * full day; a full day longer than the shift is said and cannot be saved
 * while the hours change. An older shift saved before the rule keeps its
 * value and can still be renamed or turned off.
 */
const api = vi.hoisted(() => ({
  listShifts: vi.fn(),
  createShift: vi.fn(),
  updateShift: vi.fn(),
  deleteShift: vi.fn(),
  hm: (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`,
}));
vi.mock('../apps/attendance/src/api/attendance', () => api);
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));

import Shifts from '../apps/attendance/src/screens/Shifts';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const setValue = (el, value) => fireEvent.change(el, { target: { value } });
const fullDay = () => screen.getByRole('spinbutton', { name: /^full day/i });

async function openNew() {
  api.listShifts.mockResolvedValue([]);
  render(<Shifts />);
  await userEvent.click((await screen.findAllByRole('button', { name: /new shift/i }))[0]);
}

describe('Shift form: full day', () => {
  it('starts at the day shift’s own minutes and says on time within grace is a full day', async () => {
    await openNew();
    expect(fullDay()).toHaveValue(480);
    expect(screen.getByText(/the shift less its break is 8 h\. In within the grace and out on time, or this many minutes worked, is a full day/i)).toBeInTheDocument();
    expect(fullDay()).toHaveAttribute('aria-describedby', 'full-day-hint');
  });

  it('follows the times for a night shift: 22:00–06:00 with a 30 min break is 450', async () => {
    await openNew();
    setValue(screen.getByLabelText(/^starts/i), '22:00');
    setValue(screen.getByLabelText(/^ends/i), '06:00');
    setValue(screen.getByRole('spinbutton', { name: /^break/i }), '30');
    expect(fullDay()).toHaveValue(450);
    await userEvent.type(screen.getByRole('textbox', { name: /name/i }), 'Night');
    api.createShift.mockResolvedValue({ shift: { id: 's1' } });
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(api.createShift).toHaveBeenCalled());
    expect(api.createShift.mock.calls[0][0]).toMatchObject({ startTime: '22:00', endTime: '06:00', breakMinutes: 30, fullDayMinutes: 450 });
  });

  it('refuses a full day longer than the shift, and keeps a typed shorter one when the times change', async () => {
    await openNew();
    await userEvent.type(screen.getByRole('textbox', { name: /name/i }), 'Day');
    setValue(fullDay(), '500');
    /* Said on the field while typing, announced only when Save is pressed. */
    expect(screen.getByText(/longer than the shift: 09:00–18:00 less the break is 8 h \(480 min\)/i)).toBeInTheDocument();
    expect(fullDay()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/longer than the shift/i);
    expect(api.createShift).not.toHaveBeenCalled();
    setValue(fullDay(), '420');
    expect(screen.queryByRole('alert')).toBeNull();
    setValue(screen.getByLabelText(/^ends/i), '19:00');
    expect(fullDay()).toHaveValue(420);
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
  });

  it('an existing shift saved before the rule keeps its value until changed', async () => {
    api.listShifts.mockResolvedValue([{ id: 'n1', name: 'Night', startTime: '22:00', endTime: '06:00', breakMinutes: 30, graceMinutes: 10, earlyOutGraceMinutes: 0, halfDayMinutes: 240, fullDayMinutes: 480, weeklyOffDays: '0', offSaturdays: '', isActive: true, assignments: 2 }]);
    render(<Shifts />);
    await userEvent.click(await screen.findByText('Night'));
    expect(fullDay()).toHaveValue(480);
    expect(fullDay()).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/longer than the shift less its break \(7 h 30 min\): kept as it is/i)).toBeInTheDocument();
  });

  it('an old shift saved unchanged, renamed or turned off, goes to the server as it is', async () => {
    api.listShifts.mockResolvedValue([{ id: 'n1', name: 'Night', startTime: '22:00', endTime: '06:00', breakMinutes: 30, graceMinutes: 10, earlyOutGraceMinutes: 0, halfDayMinutes: 240, fullDayMinutes: 480, weeklyOffDays: '0', offSaturdays: '', isActive: true, assignments: 2 }]);
    api.updateShift.mockResolvedValue({ shift: { id: 'n1' } });
    render(<Shifts />);
    await userEvent.click(await screen.findByText('Night'));
    const name = screen.getByRole('textbox', { name: /name/i });
    await userEvent.clear(name);
    await userEvent.type(name, 'Night (old)');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(api.updateShift).toHaveBeenCalled());
    expect(api.updateShift.mock.calls[0][1]).toMatchObject({ name: 'Night (old)', startTime: '22:00', endTime: '06:00', fullDayMinutes: 480 });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an old shift whose hours change must then fit them', async () => {
    api.listShifts.mockResolvedValue([{ id: 'n1', name: 'Night', startTime: '22:00', endTime: '06:00', breakMinutes: 30, graceMinutes: 10, earlyOutGraceMinutes: 0, halfDayMinutes: 240, fullDayMinutes: 480, weeklyOffDays: '0', offSaturdays: '', isActive: true, assignments: 2 }]);
    render(<Shifts />);
    await userEvent.click(await screen.findByText('Night'));
    setValue(screen.getByRole('spinbutton', { name: /^break/i }), '45');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/7 h 15 min \(435 min\)/);
    expect(api.updateShift).not.toHaveBeenCalled();
  });
});
