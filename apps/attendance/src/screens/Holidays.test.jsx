import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import Holidays from './Holidays';
import { createHoliday } from '../api/attendance';

vi.mock('../api/attendance', () => ({
  dayLabel: (d) => d,
  todayIst: () => '2026-11-21',
  getHolidayYear: vi.fn().mockResolvedValue({ holidays: [], stateMinimum: [] }),
  createHoliday: vi.fn(),
  updateHoliday: vi.fn(),
  deleteHoliday: vi.fn(),
  getHolidayCalendars: vi.fn().mockResolvedValue({ year: 2026, calendars: [], branches: [] }),
  importHolidayCalendar: vi.fn(),
  getRestrictedPicks: vi.fn(),
}));
vi.mock('@ui/personnel/api', () => ({
  listStructure: vi.fn().mockResolvedValue([]),
  listBranches: vi.fn().mockResolvedValue([]),
}));

beforeEach(() => vi.clearAllMocks());

/* Audit 21 Nov 2026: a double click or Enter pressed twice sent the same holiday twice. */
it('sends a holiday once however often Add is pressed, and says it is saving', async () => {
  let finish;
  createHoliday.mockImplementation(() => new Promise((r) => { finish = r; }));
  const { container } = render(<Holidays />);
  const date = await waitFor(() => {
    const el = container.querySelector('input[type="date"]');
    if (!el) throw new Error('no form yet');
    return el;
  });
  fireEvent.change(date, { target: { value: '2026-12-25' } });
  fireEvent.change(screen.getByPlaceholderText('e.g. Diwali'), { target: { value: 'Christmas' } });
  const form = screen.getByRole('form', { name: 'Add a holiday' });
  fireEvent.submit(form);
  fireEvent.submit(form);
  fireEvent.submit(form);
  const button = await screen.findByRole('button', { name: /Saving…/ });
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(createHoliday).toHaveBeenCalledTimes(1);
  finish({ id: 'h1' });
  expect(await screen.findByRole('button', { name: /Add holiday/ })).toBeTruthy();
  expect(createHoliday).toHaveBeenCalledTimes(1);
});
