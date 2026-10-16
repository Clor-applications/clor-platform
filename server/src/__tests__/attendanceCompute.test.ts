import { describe, it, expect } from 'vitest';

import {
  DEFAULT_SHIFT,
  computeDay,
  istDate,
  istInstant,
  istTime,
  monthSummary,
  shiftWindow,
} from '../services/attendance/compute.js';

/** A Wednesday in October 2026. */
const day = '2026-10-14';
const at = (hhmm: string, d = day, plus = 0) => istInstant(d, hhmm, plus);

describe('the clock is Indian Standard Time', () => {
  it('turns a wall-clock time into the right instant and back', () => {
    expect(at('09:00').toISOString()).toBe('2026-10-14T03:30:00.000Z');
    expect(istTime(at('09:00'))).toBe('09:00');
    expect(istDate(at('00:10'))).toBe('2026-10-14');
  });

  it('ends a night shift the next day', () => {
    const w = shiftWindow({ ...DEFAULT_SHIFT, startTime: '22:00', endTime: '06:00' }, day);
    expect(w.end.getTime() - w.start.getTime()).toBe(8 * 3_600_000);
  });
});

describe('a working day', () => {
  it('counts a full day, less the break, as present and on time', () => {
    const r = computeDay({ date: day, shift: DEFAULT_SHIFT, checkIn: at('09:00'), checkOut: at('18:00') });
    expect(r).toEqual({ workedMinutes: 480, lateMinutes: 0, earlyOutMinutes: 0, overtimeMinutes: 0, status: 'PRESENT' });
  });

  it('forgives arriving within the grace, and counts from the start once past it', () => {
    expect(computeDay({ date: day, shift: DEFAULT_SHIFT, checkIn: at('09:10'), checkOut: at('18:00') }).lateMinutes).toBe(0);
    expect(computeDay({ date: day, shift: DEFAULT_SHIFT, checkIn: at('09:25'), checkOut: at('18:00') }).lateMinutes).toBe(25);
  });

  it('counts leaving early to the end of the shift', () => {
    const r = computeDay({ date: day, shift: DEFAULT_SHIFT, checkIn: at('09:00'), checkOut: at('17:30') });
    expect(r.earlyOutMinutes).toBe(30);
    expect(r.workedMinutes).toBe(450);
    expect(r.status).toBe('HALF_DAY');
  });

  it('does not take the break off a short day', () => {
    const r = computeDay({ date: day, shift: DEFAULT_SHIFT, checkIn: at('09:00'), checkOut: at('12:00') });
    expect(r.workedMinutes).toBe(180);
    expect(r.status).toBe('ABSENT');
  });

  it('counts overtime past the full day', () => {
    const r = computeDay({ date: day, shift: DEFAULT_SHIFT, checkIn: at('09:00'), checkOut: at('20:00') });
    expect(r.workedMinutes).toBe(600);
    expect(r.overtimeMinutes).toBe(120);
  });

  it('treats every minute on a holiday or weekly off as overtime, and never as late', () => {
    const sunday = '2026-10-18';
    const r = computeDay({ date: sunday, shift: DEFAULT_SHIFT, checkIn: at('11:00', sunday), checkOut: at('16:00', sunday) });
    expect(r.overtimeMinutes).toBe(r.workedMinutes);
    expect(r.lateMinutes).toBe(0);
    expect(computeDay({ date: day, shift: DEFAULT_SHIFT, checkIn: null, checkOut: null, isHoliday: true }).status).toBe('HOLIDAY');
    expect(computeDay({ date: sunday, shift: DEFAULT_SHIFT, checkIn: null, checkOut: null }).status).toBe('WEEKLY_OFF');
  });

  it('marks a day with no punches absent, or on leave', () => {
    expect(computeDay({ date: day, shift: DEFAULT_SHIFT, checkIn: null, checkOut: null }).status).toBe('ABSENT');
    expect(computeDay({ date: day, shift: DEFAULT_SHIFT, checkIn: null, checkOut: null, onLeave: true }).status).toBe('ON_LEAVE');
  });

  it('keeps an open day (in, not out) present with no minutes yet', () => {
    const r = computeDay({ date: day, shift: DEFAULT_SHIFT, checkIn: at('09:30'), checkOut: null });
    expect(r.status).toBe('PRESENT');
    expect(r.lateMinutes).toBe(30);
    expect(r.workedMinutes).toBe(0);
  });

  it('works a night shift across midnight', () => {
    const night = { ...DEFAULT_SHIFT, startTime: '22:00', endTime: '06:00' };
    const r = computeDay({ date: day, shift: night, checkIn: at('22:05'), checkOut: at('06:00', day, 1) });
    expect(r.workedMinutes).toBe(415);
    expect(r.lateMinutes).toBe(0);
    expect(r.earlyOutMinutes).toBe(0);
  });

  it('refuses an out before the in', () => {
    expect(() => computeDay({ date: day, shift: DEFAULT_SHIFT, checkIn: at('18:00'), checkOut: at('09:00') })).toThrow();
  });

  it('never scores staying longer worse than leaving earlier', () => {
    const status = (out: string) => computeDay({ date: day, shift: DEFAULT_SHIFT, checkIn: at('09:00'), checkOut: at(out) });
    expect(status('13:00').status).toBe('HALF_DAY');
    // Past half a day the break comes off — but not below half a day.
    expect(status('13:01').status).toBe('HALF_DAY');
    expect(status('13:30').status).toBe('HALF_DAY');
    let last = 0;
    for (let m = 12 * 60; m <= 19 * 60; m += 1) {
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const w = status(hhmm).workedMinutes;
      expect(w).toBeGreaterThanOrEqual(last);
      last = w;
    }
  });

  it('keeps a day off paid when someone works part of it', () => {
    const sunday = '2026-10-11';
    const r = computeDay({ date: sunday, shift: DEFAULT_SHIFT, checkIn: at('09:00', sunday), checkOut: at('15:00', sunday) });
    expect(r.status).toBe('WEEKLY_OFF');
    expect(r.overtimeMinutes).toBe(r.workedMinutes);
    const holiday = computeDay({ date: day, shift: DEFAULT_SHIFT, checkIn: at('09:00'), checkOut: at('14:00'), isHoliday: true });
    expect(holiday.status).toBe('HOLIDAY');
    const s = monthSummary({ days: [sunday], records: new Map([[sunday, { ...r, overtimeApproved: false }]]), shift: () => DEFAULT_SHIFT, holidays: new Set(), today: '2026-10-20' });
    expect(s.lossOfPayDays).toBe(0);
    expect(s.payableDays).toBe(1);
  });
});

describe('a month for payroll', () => {
  it('pays present days, holidays and offs; half days are half; absences are loss of pay', () => {
    const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
    const records = new Map<string, any>([
      ['2026-10-12', { status: 'PRESENT', lateMinutes: 25, overtimeMinutes: 60, overtimeApproved: true }],
      ['2026-10-13', { status: 'HALF_DAY', lateMinutes: 0, overtimeMinutes: 0, overtimeApproved: false }],
      ['2026-10-14', { status: 'ABSENT', lateMinutes: 0, overtimeMinutes: 0, overtimeApproved: false }],
      ['2026-10-15', { status: 'ON_LEAVE', lateMinutes: 0, overtimeMinutes: 0, overtimeApproved: false }],
    ]);
    const s = monthSummary({
      days,
      records,
      shift: () => DEFAULT_SHIFT,
      holidays: new Set(['2026-10-16']),
      today: '2026-10-17',
      unpaidLeaveDays: 1,
    });
    /* 17th: no record, past or today → absent. 18th: Sunday → weekly off. */
    expect(s).toMatchObject({ present: 1, halfDays: 1, absent: 2, leave: 1, holidays: 1, weeklyOffs: 1, lateCount: 1, approvedOvertimeMinutes: 60 });
    expect(s.lossOfPayDays).toBe(2 + 0.5 + 1);
    expect(s.payableDays).toBe(7 - 3.5);
  });

  it('does not count days still to come as lost', () => {
    const s = monthSummary({ days: ['2026-10-20', '2026-10-21'], records: new Map(), shift: () => DEFAULT_SHIFT, holidays: new Set(), today: '2026-10-14' });
    expect(s.notYet).toBe(2);
    expect(s.lossOfPayDays).toBe(0);
  });

  it('does not pay a past working day that has a check-in and no check-out', () => {
    const open = { status: 'PRESENT', lateMinutes: 0, overtimeMinutes: 0, overtimeApproved: false, checkIn: at('09:00', '2026-10-13'), checkOut: null };
    const sunday = { ...open, checkIn: at('09:00', '2026-10-18') };
    const today = { ...open, checkIn: at('09:00', '2026-10-20') };
    const s = monthSummary({
      days: ['2026-10-13', '2026-10-18', '2026-10-20'],
      records: new Map<string, any>([['2026-10-13', open], ['2026-10-18', sunday], ['2026-10-20', today]]),
      shift: () => DEFAULT_SHIFT,
      holidays: new Set(),
      today: '2026-10-20',
    });
    /* 13th: past, open, a working day → incomplete, not paid. 18th: Sunday → still a paid off. 20th: today → under way. */
    expect(s).toMatchObject({ incompleteDays: 1, weeklyOffs: 1, present: 1 });
    expect(s.lossOfPayDays).toBe(1);
    expect(s.payableDays).toBe(2);
  });
});
