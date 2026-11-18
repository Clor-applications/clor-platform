import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./portalApi', () => {
  class SignedOut extends Error {}
  return {
    SignedOut,
    getHolidays: vi.fn((year) => Promise.resolve(year === 2026
      ? { year, holidays: [{ id: 'h1', name: 'Diwali', date: '2026-11-08' }, { id: 'h2', name: 'Optional day', date: '2026-12-01', restricted: true, picked: false }] }
      : { year, holidays: [{ id: 'h3', name: 'Pongal', date: '2027-01-14' }] })),
    getSchedule: vi.fn((month) => Promise.resolve({
      days: month === '2026-11'
        ? [{ date: '2026-11-17', kind: 'WORK' }, { date: '2026-11-25', kind: 'WORK' }, { date: '2026-11-30', kind: 'OFF' }]
        : [{ date: '2026-12-01', kind: 'WORK' }, { date: '2026-12-02', kind: 'WORK' }],
    })),
  };
});

import { NextHoliday, monthsFor, nextDays, nextHoliday } from './round48';

describe('round 48: next holiday', () => {
  it('takes the first day off from today, skipping optional days not chosen', () => {
    const list = [
      { name: 'Past', date: '2026-01-26' },
      { name: 'Optional', date: '2026-11-20', restricted: true },
      { name: 'Chosen optional', date: '2026-11-22', restricted: true, picked: true },
      { name: 'Christmas', date: '2026-12-25' },
    ];
    expect(nextHoliday(list, '2026-11-18').name).toBe('Chosen optional');
    expect(nextHoliday([], '2026-11-18')).toBeNull();
  });

  it('looks into next year when this year has none left', async () => {
    render(<NextHoliday guard={(p) => p} today="2026-11-18" />);
    expect(await screen.findByText(/Pongal, Thu,? 14 Jan/)).toBeInTheDocument();
    expect(screen.getByText('Next holiday')).toBeInTheDocument();
  });
});

describe('round 48: my next 14 days', () => {
  it('spans a month end and starts today', () => {
    expect(monthsFor('2026-11-18', 14)).toEqual(['2026-11', '2026-12']);
    expect(monthsFor('2026-11-01', 14)).toEqual(['2026-11']);
    const days = [{ date: '2026-12-02' }, { date: '2026-11-17' }, { date: '2026-11-18' }, { date: '2026-12-01' }, { date: '2026-12-05' }];
    expect(nextDays(days, '2026-11-18', 14).map((d) => d.date)).toEqual(['2026-11-18', '2026-12-01']);
  });
});
