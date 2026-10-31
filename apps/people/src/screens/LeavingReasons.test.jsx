import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

/* The People report's "Why people leave": a month with only people who stayed still shows (QA on #81). */
const api = vi.hoisted(() => ({ leavingReasons: vi.fn() }));
vi.mock('../api/engagement', () => api);
vi.mock('@platform/context', () => ({ orgId: () => 'org1' }));
vi.mock('@platform/http', () => ({ apiFetch: vi.fn(async () => ({})) }));

const { LeavingReasons } = await import('./PeopleReports');
const month = (m, over = {}) => ({ month: m, leavers: 0, answered: 0, reasons: {}, couldKeep: 0, retained: 0, ...over });

it('months with only someone who stayed are listed, with their Stayed count', async () => {
  api.leavingReasons.mockResolvedValue({ reasons: [], labels: {}, months: [month('2026-09'), month('2026-10', { retained: 1 }), month('2026-11'), month('2026-12', { retained: 1 })] });
  render(<LeavingReasons />);
  const table = await screen.findByRole('table');
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(2);
  expect(screen.queryByText(/No leavers in the last 12 months/)).toBeNull();
  for (const r of rows) expect(within(r).getAllByRole('cell').pop().textContent).toBe('1');
});
