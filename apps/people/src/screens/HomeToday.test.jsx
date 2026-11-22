import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { approveLeave, rejectLeave } from '@ui/timeOff/api';
import { ArrivalsChart, ConnectionBar, DecideInPlace, TodayFeed, arrivalWords, useConnection } from './HomeToday';

/*
 * People → Home, read and act on (owner, 22 Nov 2026): a chart you can point
 * at, the day as a feed, leave decided in place with an undo, and the offline bar.
 */
vi.mock('@ui/timeOff/api', () => ({ approveLeave: vi.fn().mockResolvedValue({}), rejectLeave: vi.fn().mockResolvedValue({}) }));

const today = {
  date: '2026-11-22',
  expected: 10,
  inCount: 6,
  late: 2,
  shiftStart: '09:30',
  arrivals: [
    { at: '09:00', count: 3, late: 0, names: ['Asha', 'Meera', 'Joseph'] },
    { at: '09:15', count: 1, late: 0, names: ['Kiran'] },
    { at: '09:30', count: 2, late: 2, names: ['Ravi', 'Farah'] },
  ],
  feed: [
    { at: '10:20', kind: 'leaveApplied', employeeId: 'e1', name: 'Neha', text: 'applied for leave', from: '2026-11-25', to: '2026-11-26' },
    { at: '09:40', kind: 'late', employeeId: 'e2', name: 'Ravi', text: 'came in 10 min after the shift start', minutes: 10 },
    { at: '00:00', kind: 'joined', employeeId: 'e3', name: 'Nisha', text: 'joins today' },
  ],
};

describe('arrivals', () => {
  it('says each step in words, naming who came in', () => {
    expect(arrivalWords(today.arrivals[0])).toBe('09:00: 3 people came in (Asha, Meera, Joseph)');
    expect(arrivalWords({ at: '09:45', count: 5, late: 5, names: ['A', 'B', 'C'] })).toBe('09:45: 5 people came in (A, B, C and 2 more), 5 late');
    expect(arrivalWords({ at: '10:00', count: 0, late: 0, names: [] })).toBe('10:00: nobody came in');
  });

  it('shows who came in when a bar is focused, and marks the shift start', () => {
    render(<ArrivalsChart today={today} />);
    expect(screen.getByText('Shift starts 09:30')).toBeTruthy();
    const bar = screen.getByRole('button', { name: /^09:30: 2 people came in/ });
    expect(bar.getAttribute('data-late')).toBe('true');
    fireEvent.focus(bar);
    expect(screen.getByRole('status').textContent).toContain('Ravi, Farah');
    fireEvent.blur(bar);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('draws nothing before anyone comes in', () => {
    const { container } = render(<ArrivalsChart today={{ ...today, arrivals: [] }} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('today in the company', () => {
  it('filters by kind and tags only lateness', () => {
    const openPerson = vi.fn(() => () => {});
    render(<TodayFeed today={today} openPerson={openPerson} />);
    expect(screen.getAllByText('Late')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.getByText('Neha')).toBeTruthy();
    expect(screen.getByText('applied for leave, Wed, 25 Nov to Thu, 26 Nov')).toBeTruthy();
    expect(screen.queryByText('Ravi')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Joining and exits' }));
    expect(screen.getByText('Nisha')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
  });
});

describe('decide in place', () => {
  const reqs = [
    { id: 'l1', employeeName: 'Neha', leaveTypeName: 'Casual leave', fromDate: '2026-11-25', toDate: '2026-11-26', days: 2 },
    { id: 'l2', employeeName: 'Farah', leaveTypeName: 'Sick leave', fromDate: '2026-11-24', toDate: '2026-11-24', days: 1 },
  ];
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(approveLeave).mockClear(); vi.mocked(rejectLeave).mockClear(); });
  afterEach(() => vi.useRealTimers());

  it('holds an approval for five seconds, and Undo brings the request back unsent', async () => {
    render(<DecideInPlace requests={reqs} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve leave for Neha' }));
    expect(screen.queryByRole('button', { name: 'Approve leave for Neha' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Approved: Neha');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(approveLeave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Approve leave for Neha' })).toBeTruthy();
  });

  it('sends the approval when the five seconds end', async () => {
    const onDecided = vi.fn();
    render(<DecideInPlace requests={reqs} onDecided={onDecided} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve leave for Farah' }));
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(approveLeave).toHaveBeenCalledWith('l2', '');
    expect(onDecided).toHaveBeenCalled();
  });

  it('asks why before rejecting, and sends the reason', async () => {
    render(<DecideInPlace requests={reqs} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject leave for Neha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('alert').textContent).toBe('Say why. They see this with the decision.');
    fireEvent.change(screen.getByRole('textbox', { name: 'Why reject Neha’s leave' }), { target: { value: 'Stock count that week' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reject' })); });
    expect(rejectLeave).toHaveBeenCalledWith('l1', 'Stock count that week');
  });

  it('brings a request back with the reason when the server refuses', async () => {
    vi.mocked(approveLeave).mockRejectedValueOnce(Object.assign(new Error('Not your step'), { status: 403 }));
    render(<DecideInPlace requests={reqs} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve leave for Neha' }));
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole('button', { name: 'Approve leave for Neha' })).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('connection', () => {
  function Probe({ onBack }) {
    const c = useConnection(onBack);
    return <ConnectionBar online={c.online} back={c.back} onRetry={() => {}} />;
  }
  it('says what still works while offline, then that it is back', () => {
    const onBack = vi.fn();
    render(<Probe onBack={onBack} />);
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByRole('alert').textContent).toContain('Connection lost');
    expect(screen.getByRole('alert').textContent).toContain('Decisions wait until you are back');
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Back online');
  });
});
