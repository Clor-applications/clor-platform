import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Night shifts (feature attendanceNightShifts) and O-09:
 * - Attendance policy has the company switch, off by default, saved on its
 *   own; someone without the right to change company features sees it but
 *   cannot change it.
 * - The leave preview names the night each date covers.
 * - A closed-month refusal links to Month close for someone who may reopen it.
 */
const features = vi.hoisted(() => ({
  getFeatures: vi.fn(),
  setFeatures: vi.fn(),
}));
const perms = vi.hoisted(() => ({ current: { isAdmin: true, permissions: new Set() } }));
vi.mock('@ui/api/features', () => features);
vi.mock('../packages/ui/src/api/features', () => features);
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('../packages/ui/src/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../apps/attendance/src/api/attendance', () => ({
  dayLabel: (d) => d, getRules: vi.fn(() => new Promise(() => {})), hm: (m) => String(m), listRuleVersions: vi.fn(() => Promise.resolve([])),
  listShifts: vi.fn(() => Promise.resolve([])), recompute: vi.fn(), saveRules: vi.fn(), simulateRules: vi.fn(), todayIst: () => '2026-10-27',
}));

import { NightShifts } from '../apps/attendance/src/screens/AttendanceRules';
import { LeavePreview } from '../packages/ui/src/timeOff/LeaveRequests';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  perms.current = { isAdmin: true, permissions: new Set() };
});

describe('Night shifts switch', () => {
  it('shows the company setting, off, and turns it on by itself', async () => {
    features.getFeatures.mockResolvedValue({ features: { attendance: true, attendanceNightShifts: false } });
    features.setFeatures.mockResolvedValue({ features: { attendance: true, attendanceNightShifts: true } });
    render(<NightShifts />);
    const box = await screen.findByRole('checkbox', { name: /ends the next morning/i });
    await waitFor(() => expect(box).not.toBeDisabled());
    expect(box).not.toBeChecked();
    expect(screen.getByText(/punches, corrections and leave after midnight go to that night/i)).toBeInTheDocument();
    await userEvent.click(box);
    expect(features.setFeatures).toHaveBeenCalledWith({ attendanceNightShifts: true });
    await waitFor(() => expect(box).toBeChecked());
  });

  it('turns it off again', async () => {
    features.getFeatures.mockResolvedValue({ features: { attendance: true, attendanceNightShifts: true } });
    features.setFeatures.mockResolvedValue({ features: { attendance: true, attendanceNightShifts: false } });
    render(<NightShifts />);
    const box = await screen.findByRole('checkbox', { name: /ends the next morning/i });
    await waitFor(() => expect(box).toBeChecked());
    await userEvent.click(box);
    expect(features.setFeatures).toHaveBeenCalledWith({ attendanceNightShifts: false });
    await waitFor(() => expect(box).not.toBeChecked());
  });

  it('cannot be changed without the right to change company features', async () => {
    perms.current = { isAdmin: false, permissions: new Set(['ATTENDANCE::Attendance Records::VIEW']) };
    features.getFeatures.mockResolvedValue({ features: { attendance: true, attendanceNightShifts: false } });
    render(<NightShifts />);
    const box = await screen.findByRole('checkbox', { name: /ends the next morning/i });
    await waitFor(() => expect(features.getFeatures).toHaveBeenCalled());
    expect(box).toBeDisabled();
    expect(screen.getByText(/only someone who can change company features/i)).toBeInTheDocument();
  });
});

describe('Leave preview', () => {
  const preview = (problems = [], night = null) => ({
    total: 1, parts: [{ from: '2026-08-19', to: '2026-08-19', days: 1, balance: { after: 5 }, dates: [{ date: '2026-08-19', counted: true, why: null, ...(night ? { night } : {}) }] }], problems,
  });

  it('says which night a date covers', () => {
    render(<LeavePreview preview={preview([], { label: 'Night shift 22:00–06:00 (ends next day)', covers: '22:00 on 19 Aug to 06:00 on 20 Aug' })} />);
    expect(screen.getByText(/Night shift 22:00–06:00 \(ends next day\)\. Covers 22:00 on 19 Aug to 06:00 on 20 Aug\./)).toBeInTheDocument();
  });

  it('a closed month links to Month close for someone who can reopen it, and not for others', () => {
    const closed = [{ code: 'ATTENDANCE_MONTH_CLOSED', message: 'September is closed. Ask HR to reopen it if this leave must count.', month: '2026-09' }];
    perms.current = { isAdmin: false, permissions: new Set(['ATTENDANCE::Attendance Records::APPROVE']) };
    render(<LeavePreview preview={preview(closed)} />);
    expect(screen.getByRole('alert')).toHaveTextContent('September is closed. Ask HR to reopen it if this leave must count.');
    expect(screen.getByRole('link', { name: 'Open Month close' })).toHaveAttribute('href', '?app=attendance&open=monthClose&month=2026-09');
    cleanup();
    perms.current = { isAdmin: false, permissions: new Set(['ATTENDANCE::Leave Requests::CREATE']) };
    render(<LeavePreview preview={preview(closed)} />);
    expect(screen.getByRole('alert')).toHaveTextContent('September is closed.');
    expect(screen.queryByRole('link', { name: 'Open Month close' })).toBeNull();
  });
});
