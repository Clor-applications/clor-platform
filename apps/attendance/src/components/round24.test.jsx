import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { splitShiftLabel, TodayScreen } from './round24';
import { nextEmployeeCode } from '@ui/personnel/nextCode';
import { LeavePreview } from '@ui/timeOff/LeaveRequests';

describe('splitShiftLabel', () => {
  it('names both parts when a long unpaid break has its own times', () => {
    expect(splitShiftLabel({ startTime: '07:00', endTime: '21:00', breaks: [{ startTime: '11:00', endTime: '17:00', paid: false }] }))
      .toBe('Split · 07:00–11:00, 17:00–21:00');
  });
  it('leaves an ordinary shift alone', () => {
    expect(splitShiftLabel({ startTime: '09:00', endTime: '18:00', breaks: [{ startTime: '13:00', endTime: '14:00', paid: false }] })).toBeNull();
    expect(splitShiftLabel({ startTime: '09:00', endTime: '18:00', breaks: [{ startTime: '11:00', endTime: '15:00', paid: true }] })).toBeNull();
    expect(splitShiftLabel({ startTime: '22:00', endTime: '06:00', breaks: [] })).toBeNull();
    expect(splitShiftLabel({ startTime: '09:00', endTime: '18:00' })).toBeNull();
  });
});

describe('TodayScreen', () => {
  it('shows in, late and away in big figures and closes with Esc', () => {
    const onClose = vi.fn();
    render(<TodayScreen data={{ present: 400, halfDay: 12, late: [{}, {}], onLeave: 20, absent: 3, headcount: 450 }} dateLabel="Wednesday, 18 November" onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Today on a screen' });
    expect(dialog).toHaveTextContent('412In');
    expect(dialog).toHaveTextContent('2Late');
    expect(dialog).toHaveTextContent('23Away');
    expect(dialog).toHaveTextContent('412 of 450 in');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('nextEmployeeCode', () => {
  it('follows the series most codes share, keeping the width', () => {
    expect(nextEmployeeCode(['KT-0139', 'KT-0142', 'KT-0007', 'X1', null, ''])).toBe('KT-0143');
    expect(nextEmployeeCode(['E9', 'E10', 'E11'])).toBe('E12');
  });
  it('says nothing when no series shows', () => {
    expect(nextEmployeeCode([])).toBeNull();
    expect(nextEmployeeCode(['ABC'])).toBeNull();
    expect(nextEmployeeCode(['KT-0001'])).toBeNull();
  });
});

describe('LeavePreview balance below zero', () => {
  const preview = (after) => ({ total: 3, type: { isPaid: true }, parts: [{ from: '2026-11-20', to: '2026-11-22', days: 3, balance: { after }, dates: [] }] });
  it('shows a negative balance in red and says where the days come from', () => {
    render(<LeavePreview preview={preview(-2)} />);
    expect(screen.getByText('-2 days')).toHaveClass('ui-text-neg');
    expect(screen.getByText(/come out of the leave you earn next/)).toBeInTheDocument();
  });
  it('keeps the plain wording when days are left', () => {
    render(<LeavePreview preview={preview(4)} />);
    expect(screen.getByText(/left after/)).toBeInTheDocument();
    expect(screen.queryByText(/leave you earn next/)).toBeNull();
  });
});
