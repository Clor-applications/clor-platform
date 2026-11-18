import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { HomeGlance } from './PeopleOverview';

vi.mock('@platform/context', async (orig) => ({ ...(await orig()), requestOpenApp: vi.fn() }));

/* Round 55 (week ahead A): a manager's own team for the next seven days, first on Home. */
it("lists the manager's open requests, who is away and birthdays, in date order", () => {
  const go = vi.fn((s, params) => () => ({ s, params }));
  const glance = {
    waiting: 2,
    probation: null,
    week: null,
    monthClose: null,
    teamWeek: {
      from: '2026-11-18',
      to: '2026-11-24',
      team: 4,
      away: [{ id: 'a1', name: 'Away Anu', from: '2026-11-20', to: '2026-11-22', days: 3 }],
      birthdays: [{ id: 'b1', name: 'Birthday Bala', on: '2026-11-19' }],
    },
  };
  render(<HomeGlance glance={glance} go={go} />);
  const rows = screen.getByRole('heading', { name: 'Your team this week' }).closest('section').querySelectorAll('li');
  expect([...rows].map((r) => r.textContent)).toEqual([
    expect.stringMatching(/^2 requests wait for you/),
    expect.stringMatching(/^Birthday Bala’s birthday/),
    expect.stringMatching(/^Away Anu away till/),
  ]);
  fireEvent.click(screen.getByText(/requests wait for you/).closest('button'));
  expect(go).toHaveBeenCalledWith('approvals');
  expect(go).toHaveBeenCalledWith('employee', { id: 'a1' });
});

it('says nothing for someone with no team', () => {
  const { container } = render(<HomeGlance glance={{ waiting: 0, probation: null, week: null, monthClose: null, teamWeek: null }} go={() => () => {}} />);
  expect(container.textContent).toBe('');
});
