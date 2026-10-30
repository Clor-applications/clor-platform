import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { HoursChoice, PreviewNotes } from '../packages/ui/src/timeOff/LeaveShape';
import { QUARTERS, hoursBody, hoursText, isHourly } from '../packages/ui/src/timeOff/partOfDay';

/*
 * Hourly leave and the preview's notes, the same in Enter leave, My leave and
 * the employee app (TIME-LEAVE-DECISIONS.md, "Leave policy rules"). Half days
 * are HalfDayChoice's, tested with it.
 */
afterEach(cleanup);

const days = { id: 't1', unit: 'DAY', allowHalfDay: true };
const hours = { id: 't2', unit: 'HOUR' };

describe('what a form sends', () => {
  it('hours on the one day for an hourly type, nothing extra for a type taken in days', () => {
    expect(isHourly(hours)).toBe(true);
    expect(isHourly(days)).toBe(false);
    expect(hoursBody({ fromDate: '2026-11-02', toDate: '2026-11-06', halfDay: 'FIRST', fromTime: '09:00', toTime: '11:00' }, hours))
      .toEqual({ toDate: '2026-11-02', halfDay: null, fromTime: '09:00', toTime: '11:00' });
    expect(hoursBody({ fromDate: '2026-11-02', toDate: '2026-11-04', fromTime: '09:00' }, days)).toEqual({});
  });

  it('reads saved hours back in words', () => {
    expect(hoursText({ fromTime: '14:00', toTime: '16:30' })).toBe('14:00 to 16:30');
    expect(hoursText({ halfDay: 'FIRST' })).toBeNull();
  });

  it('offers quarter hours only', () => {
    expect(QUARTERS[0]).toBe('06:00');
    expect(QUARTERS.every((t) => /:(00|15|30|45)$/.test(t))).toBe(true);
  });
});

function Harness({ start }) {
  const [form, setForm] = useState(start);
  return (
    <>
      <HoursChoice native form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
      <output data-testid="sent">{JSON.stringify(hoursBody(form, hours))}</output>
    </>
  );
}

describe('the hours on the form', () => {
  it('asks from and to, the end after the start, and sends what was chosen', () => {
    render(<Harness start={{ fromDate: '2026-11-02', fromTime: '', toTime: '' }} />);
    fireEvent.change(screen.getByLabelText('From *'), { target: { value: '14:00' } });
    const to = screen.getByLabelText('To *');
    const offered = [...to.querySelectorAll('option')].map((o) => o.value).filter(Boolean);
    expect(offered[0]).toBe('14:15');
    fireEvent.change(to, { target: { value: '16:30' } });
    expect(JSON.parse(screen.getByTestId('sent').textContent)).toMatchObject({ fromTime: '14:00', toTime: '16:30', toDate: '2026-11-02' });
    /* A later start drops an end that is no longer after it. */
    fireEvent.change(screen.getByLabelText('From *'), { target: { value: '17:00' } });
    expect(JSON.parse(screen.getByTestId('sent').textContent)).toMatchObject({ fromTime: '17:00', toTime: null });
  });

  it('shows nothing before a day is chosen', () => {
    render(<Harness start={{ fromDate: '', fromTime: '', toTime: '' }} />);
    expect(screen.queryByLabelText('From *')).toBeNull();
  });
});

describe('what does not stop a request', () => {
  it('shows the preview warnings in plain words, and nothing without them', () => {
    render(<PreviewNotes preview={{ warnings: [{ code: 'ON_NOTICE', message: 'Serving notice (last day 31 Dec 2026): the approver sees this.' }, { code: 'LOSS_OF_PAY', message: '2 days over the balance are loss of pay (Loss of Pay), from 4 Nov 2026.' }] }} />);
    expect(screen.getByText(/Serving notice/)).toBeTruthy();
    expect(screen.getByText(/loss of pay/)).toBeTruthy();
    cleanup();
    const { container } = render(<PreviewNotes preview={{ warnings: [] }} />);
    expect(container.textContent).toBe('');
  });
});
