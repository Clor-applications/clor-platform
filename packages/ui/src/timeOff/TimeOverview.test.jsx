import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import TimeOverview from './TimeOverview';
import { getTimeOverview } from './api';

vi.mock('./api', async (orig) => ({ ...(await orig()), getTimeOverview: vi.fn() }));
vi.mock('./LeaveRequests', () => ({ EnterLeave: () => null, TypeDot: () => null }));

afterEach(() => vi.useRealTimers());

const away = (id, name, date) => ({ id, employeeId: id, employeeName: name, department: 'Sales', status: 'APPROVED', leaveTypeName: 'Casual leave', fromDate: date, toDate: date, days: 1 });

/*
 * UI audit, 7 Nov 2026: with no `today` from the server, Who's away took UTC's date. At 00:30 IST on 7 November
 * that is still 6 November, so the seven-day clash window stopped at the 13th and missed a clash on the 14th.
 */
it('reads today in India at 00:30 IST, so the clash window runs to the seventh day after', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T19:00:00.000Z')); // 00:30 IST, 7 Nov
  getTimeOverview.mockResolvedValue({
    awayToday: [],
    upcoming: [away('a', 'Asha', '2026-11-14'), away('b', 'Bala', '2026-11-14')],
    waiting: { count: 0, olderThan3Days: 0, oldest: [] },
    lapsing: { periodEnd: null, rows: [] },
  });
  render(<TimeOverview openScreen={vi.fn()} />);
  expect(await screen.findByRole('region', { name: 'Away the same day' })).toBeTruthy();
  expect(screen.getByText('Sales: Asha, Bala')).toBeTruthy();
});
