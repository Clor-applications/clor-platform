import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import OvertimeRatesCaps from './OvertimeRatesCaps';
import OvertimeRuleFields from './OvertimeRuleFields';
import ShiftBreaks from './ShiftBreaks';
import { breakLength, breaksBody, breaksProblem, unpaidTotal } from './shiftBreaksMath';
import { expiringWords } from '@ui/timeOff/expiring';

/*
 * The three Time settings finished after the platform audit of 11 Nov 2026: overtime rates and caps,
 * a shift's breaks, and how long comp-off lasts. What each screen says and what it sends.
 */
const RULES = { overtimeRequests: true, overtimeApproval: 'HR', compOffEnabled: false, compOffLeaveTypeId: null, confirmCutoffDay: 3, rates: { working: 2, weeklyOff: 2, holiday: 2 }, caps: { dayMinutes: null, weekMinutes: null, quarterMinutes: null } };
const SUGGESTED = { dayMinutes: 120, weekMinutes: 720, quarterMinutes: 3000 };

it('overtime: shows twice the rate and no caps until set, names the law, and says the caps differ by state', () => {
  render(<OvertimeRatesCaps rules={RULES} suggestedCaps={SUGGESTED} save={vi.fn()} />);
  expect(screen.getByLabelText('Working day').value).toBe('2');
  expect(screen.getByLabelText('Weekly off').value).toBe('2');
  expect(screen.getByLabelText('Holiday').value).toBe('2');
  expect(screen.getByLabelText('In a day').value).toBe('');
  expect(screen.getByText(/Section 59 of the Factories Act, 1948 sets twice the ordinary rate/)).toBeTruthy();
  expect(screen.getByText(/section 64\(4\) of the Factories Act, 1948/)).toBeTruthy();
  expect(screen.getByText(/The limits differ by state/)).toBeTruthy();
  /* Nothing to save until something changes. */
  expect(screen.queryByRole('button', { name: 'Save rates and caps' })).toBeNull();
});

it('overtime: the suggested caps fill the fields, and one save sends rates and caps in minutes', async () => {
  const save = vi.fn(async () => {});
  render(<OvertimeRatesCaps rules={RULES} suggestedCaps={SUGGESTED} save={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use 2 hours a day, 12 a week and 50 a quarter' }));
  expect(screen.getByLabelText('In a day').value).toBe('2');
  expect(screen.getByLabelText('In a quarter').value).toBe('50');
  fireEvent.change(screen.getByLabelText('Holiday'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save rates and caps' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).toMatchObject({ overtimeApproval: 'HR', rates: { working: 2, weeklyOff: 2, holiday: 3 }, caps: { dayMinutes: 120, weekMinutes: 720, quarterMinutes: 3000 } });
});

it('overtime: a cap for a day longer than the week’s is said and cannot be saved', () => {
  render(<OvertimeRatesCaps rules={RULES} suggestedCaps={SUGGESTED} save={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('In a day'), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText('In a week'), { target: { value: '6' } });
  expect(screen.getByRole('alert').textContent).toBe('The cap for a day cannot be more than the cap for a week.');
  expect(screen.getByRole('button', { name: 'Save rates and caps' }).disabled).toBe(true);
});

it('breaks: a break is as long as its times say, or its minutes; only unpaid ones come off the day', () => {
  expect(breakLength({ startTime: '13:00', endTime: '13:45' })).toBe(45);
  expect(breakLength({ startTime: '23:45', endTime: '00:15' })).toBe(30);
  expect(breakLength({ minutes: '15' })).toBe(15);
  const breaks = [{ name: 'Lunch', startTime: '13:00', endTime: '13:45', paid: false }, { name: 'Tea', minutes: 15, paid: true }, { name: 'Rest', minutes: 15, paid: false }];
  expect(unpaidTotal(breaks)).toBe(60);
  expect(breaksProblem(breaks)).toBe('');
  expect(breaksProblem([{ name: '', minutes: 15 }])).toBe('Break 1: give it a name.');
  expect(breaksProblem([{ name: 'Lunch', startTime: '13:00', endTime: '' }])).toBe('Lunch: give both a start and an end, or only the minutes.');
  expect(breaksProblem([{ name: 'Lunch' }])).toBe('Lunch: give a start and an end, or the minutes.');
  expect(breaksBody(breaks)[0]).toEqual({ name: 'Lunch', startTime: '13:00', endTime: '13:45', minutes: 45, paid: false });
  expect(breaksBody(breaks)[1]).toEqual({ name: 'Tea', startTime: null, endTime: null, minutes: 15, paid: true });
});

it('breaks: the editor adds and removes breaks, totals paid and unpaid, and explains punched breaks when chosen', () => {
  function Harness() {
    const [breaks, setBreaks] = useState([{ name: 'Lunch', startTime: '13:00', endTime: '13:45', minutes: '', paid: false }]);
    const [mode, setMode] = useState('FIXED');
    return <ShiftBreaks breaks={breaks} mode={mode} onChange={setBreaks} onMode={setMode} />;
  }
  render(<Harness />);
  expect(screen.getByText('Unpaid 45 min, taken off the day')).toBeTruthy();
  /* A break with times shows its length and does not take a typed one. */
  expect(screen.getByLabelText('Lunch: minutes').value).toBe('45');
  expect(screen.getByLabelText('Lunch: minutes').disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Add a break' }));
  fireEvent.change(screen.getByLabelText('Break 2: name'), { target: { value: 'Tea' } });
  fireEvent.change(screen.getByLabelText('Tea: minutes'), { target: { value: '15' } });
  fireEvent.click(screen.getByLabelText('Tea: paid'));
  expect(screen.getByText('Unpaid 45 min, taken off the day · paid 15 min, counted as work')).toBeTruthy();
  expect(screen.queryByText(/On a day with no break punches/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Break time taken off the day'), { target: { value: 'PUNCHED' } });
  expect(screen.getByText(/On a day with no break punches, the breaks above are taken off instead\./)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Tea' }));
  expect(screen.getByText('Unpaid 45 min, taken off the day')).toBeTruthy();
});

it('comp-off: the overtime rules say how long it lasts, from the leave type', () => {
  const types = [{ id: 'co', name: 'Comp-off', compOffValidDays: 90 }, { id: 'el', name: 'Earned', compOffValidDays: null }];
  const { rerender } = render(<OvertimeRuleFields rules={{ ...RULES, compOffLeaveTypeId: 'co' }} types={types} save={vi.fn()} />);
  expect(screen.getByText('Comp-off must be used within 90 days of the day worked, then it lapses. Change this on the leave type.')).toBeTruthy();
  rerender(<OvertimeRuleFields rules={{ ...RULES, compOffLeaveTypeId: 'el' }} types={types} save={vi.fn()} />);
  expect(screen.getByText('Comp-off does not expire. To set how long it lasts, open the leave type.')).toBeTruthy();
});

it('comp-off: a balance’s expiring days read soonest first', () => {
  const fmt = (d) => d;
  expect(expiringWords([], fmt)).toBe('');
  expect(expiringWords(undefined, fmt)).toBe('');
  expect(expiringWords([{ days: 1, expiresOn: '2026-12-12' }], fmt)).toBe('1 day expires on 2026-12-12');
  expect(expiringWords([{ days: 1.5, expiresOn: '2026-12-12' }, { days: 0.5, expiresOn: '2027-01-03' }], fmt)).toBe('1.5 days expire on 2026-12-12, then 0.5 on 2027-01-03');
  expect(expiringWords([{ days: 1, expiresOn: 'a' }, { days: 1, expiresOn: 'b' }, { days: 1, expiresOn: 'c' }, { days: 0.5, expiresOn: 'd' }], fmt)).toBe('1 day expires on a, then 1 on b, and 1.5 days later');
});
