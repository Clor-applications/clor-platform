import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MONDAY_FIRST, daysLate, lateText, mondayFirst, sortMondayFirst } from './round33';
import HalfDayChoice from './HalfDayChoice';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

describe('round 33: week starts on Monday', () => {
  it('lists the days Monday first and keeps the stored numbers', () => {
    expect(MONDAY_FIRST).toEqual([1, 2, 3, 4, 5, 6, 0]);
    const days = mondayFirst(DAYS);
    expect(days.map((d) => d.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(days[6]).toEqual({ label: 'Sun', index: 0 });
  });

  it('sorts stored days Monday first', () => {
    expect(sortMondayFirst(['0', '6'])).toEqual(['6', '0']);
    expect(sortMondayFirst([0, 3, 1])).toEqual([1, 3, 0]);
  });
});

describe('round 33: leave asked for days already gone', () => {
  it('counts the days after the first day of leave', () => {
    expect(daysLate('2026-11-17', '2026-11-19')).toBe(2);
    expect(daysLate('2026-11-17', '2026-11-17')).toBe(0);
    expect(daysLate('2026-11-20', '2026-11-17')).toBe(0);
    expect(daysLate('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('says it plainly, or nothing when asked in time', () => {
    expect(lateText('2026-11-17', '2026-11-19')).toBe('Asked 2 days late');
    expect(lateText('2026-11-17', '2026-11-18')).toBe('Asked 1 day late');
    expect(lateText('2026-11-20', '2026-11-17')).toBeNull();
    expect(lateText('', '2026-11-17')).toBeNull();
  });
});

describe('round 33: first half or second half in one tap', () => {
  it('shows three buttons for one day and picks a half', () => {
    const onChange = vi.fn();
    render(<HalfDayChoice form={{ fromDate: '2026-11-21', toDate: '2026-11-21', halfDay: '' }} allowed label="How much of the day" onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'How much of the day' });
    expect(group).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Whole day' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Second half' }));
    expect(onChange).toHaveBeenCalledWith({ halfDay: 'SECOND' });
    fireEvent.click(screen.getByRole('radio', { name: 'Whole day' }));
    expect(onChange).toHaveBeenLastCalledWith({ halfDay: '' });
  });

  it('marks the chosen half', () => {
    render(<HalfDayChoice form={{ fromDate: '2026-11-21', toDate: '', halfDay: 'FIRST' }} allowed onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'First half' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Whole day' }).getAttribute('aria-checked')).toBe('false');
  });

  it('keeps the select in the employee app', () => {
    render(<HalfDayChoice native form={{ fromDate: '2026-11-21', toDate: '', halfDay: '' }} allowed label="How much of the day" onChange={() => {}} />);
    expect(screen.getByLabelText('How much of the day').tagName).toBe('SELECT');
  });
});
