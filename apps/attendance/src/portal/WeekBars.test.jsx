import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WeekBars, { weekDays } from './WeekBars';

describe('WeekBars', () => {
  it('lays out Monday to Sunday of the week holding today', () => {
    const week = weekDays([{ date: '2026-11-17', workedMinutes: 480 }], '2026-11-18');
    expect(week.map((d) => d.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    expect(week[1].minutes).toBe(480);
    expect(week[3].future).toBe(true);
    expect(week[2].future).toBe(false);
  });

  it('shows the week total and a bar per day', () => {
    render(<WeekBars today="2026-11-18" days={[{ date: '2026-11-16', workedMinutes: 540 }, { date: '2026-11-17', workedMinutes: 300 }]} />);
    expect(screen.getByText('14:00')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Hours worked each day this week' });
    expect(list.querySelectorAll('li')).toHaveLength(7);
    expect(screen.getByLabelText('Tue: 5:00')).toBeInTheDocument();
    expect(screen.getByLabelText('Wed: no hours')).toBeInTheDocument();
    expect(screen.getByLabelText('Thu: not yet')).toBeInTheDocument();
  });
});
