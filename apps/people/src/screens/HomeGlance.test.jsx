import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { HomeGlance } from './PeopleOverview';

vi.mock('@platform/context', async (orig) => ({ ...(await orig()), requestOpenApp: vi.fn() }));

const glance = {
  probation: [
    { id: 'p1', name: 'Bina Rao', code: 'G2', endsOn: '2026-11-05', over: true },
    { id: 'p2', name: 'Asha Shah', code: 'G1', endsOn: '2026-11-18', over: false },
  ],
  week: {
    from: '2026-11-02',
    to: '2026-11-08',
    joining: [{ id: 'j1', name: 'Dev Patel', on: '2026-11-03' }],
    leaving: [{ id: 'l1', name: 'Esha Nair', on: '2026-11-07' }],
    holidays: [{ date: '2026-11-08', name: 'Diwali', optional: false }],
  },
  monthClose: { month: '2026-10', closedAt: null, ready: false, blocking: 2, noRecordDays: 0 },
};

/* People plan, 8 Nov 2026: Home's short lists, each line opening where it is acted on. */
it('lists probation ending, this week and last month’s close', async () => {
  const go = vi.fn((s, params) => () => ({ s, params }));
  render(<HomeGlance glance={glance} go={go} />);
  expect(screen.getByText('Ended 5 Nov 2026')).toBeTruthy();
  expect(screen.getByText('Ends 18 Nov 2026')).toBeTruthy();
  expect(go).toHaveBeenCalledWith('employee', { id: 'p2', tab: 'employment', focus: 'probation' });
  /* This week, in date order: a joiner, a last day, a holiday. */
  const rows = screen.getByRole('heading', { name: 'This week' }).closest('section').querySelectorAll('li');
  expect([...rows].map((r) => r.textContent)).toEqual([
    expect.stringMatching(/^Dev Patel joins/),
    expect.stringMatching(/^Esha Nair’s last day/),
    expect.stringMatching(/^Diwali \(holiday\)/),
  ]);
  expect(screen.getByText('2 things to fix before closing')).toBeTruthy();
  const { requestOpenApp } = await import('@platform/context');
  fireEvent.click(screen.getByText('October 2026').closest('button'));
  expect(requestOpenApp).toHaveBeenCalledWith('attendance', 'monthClose', { month: '2026-10' });
});

it('leaves out what is empty or not for this reader, and draws nothing when nothing is left', () => {
  const none = () => () => {};
  const { container, rerender } = render(
    <HomeGlance glance={{ probation: [], week: { from: '2026-11-02', to: '2026-11-08', joining: [], leaving: [], holidays: [] }, monthClose: { month: '2026-10', closedAt: '2026-11-02T06:00:00Z', ready: true, blocking: 0, noRecordDays: 0 } }} go={none} />,
  );
  expect(screen.queryByText('Probation ending')).toBeNull();
  expect(screen.queryByText('This week')).toBeNull();
  expect(screen.getByText('Closed on 2 Nov')).toBeTruthy();
  rerender(<HomeGlance glance={{ probation: null, week: null, monthClose: null }} go={none} />);
  expect(container.innerHTML).toBe('');
});
