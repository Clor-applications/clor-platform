import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import MyAttendance from './MyAttendance';
import { clock, getMe } from '../api/attendance';

/*
 * Review of #144: a day this browser opened can always be closed here, even
 * when the person has since been set to punch from their phone.
 */
vi.mock('../api/attendance', () => ({
  clock: vi.fn(), dayLabel: (d) => d, explainMyDay: vi.fn(), getMe: vi.fn(), hm: () => '0h', phonePunch: vi.fn(),
  REASON_CODES: [], requestCorrection: vi.fn(), STATUS: {}, todayIst: () => '2026-11-07',
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../components/PhonePunch', () => ({ default: () => <div>Phone punch card</div> }));
vi.mock('../components/DayExplain', () => ({ default: () => null }));

const me = (over) => ({
  employee: { name: 'Asha Rao', code: 'AT-1' },
  shift: { name: 'General', startTime: '09:00', endTime: '18:00' },
  today: '2026-11-07',
  todayRecord: { checkInTime: '09:02' },
  clockedIn: true,
  records: [],
  requests: [],
  punches: [],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

it('keeps Clock out for a day the browser opened, even for someone now on phone punching', async () => {
  getMe.mockResolvedValue(me({ phone: { allowed: true }, webClock: { allowed: true, outOnly: true, code: 'USE_PHONE_PUNCH', why: 'Punch from your phone from now on.' } }));
  clock.mockResolvedValue({ kind: 'OUT', record: { checkOutTime: '18:05' } });
  render(<MyAttendance />);
  expect(await screen.findByText('Phone punch card')).toBeTruthy();
  expect(screen.getByText('Punch from your phone from now on.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Clock out/ }));
  await waitFor(() => expect(clock).toHaveBeenCalledWith('OUT'));
});

it('shows no browser clock to someone on phone punching with no day to close', async () => {
  getMe.mockResolvedValue(me({ clockedIn: false, phone: { allowed: true }, webClock: { allowed: false, code: 'USE_PHONE_PUNCH', why: 'Punch from your phone.' } }));
  render(<MyAttendance />);
  expect(await screen.findByText('Phone punch card')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Clock (in|out)/ })).toBeNull();
});
