import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import EmployeePortal from './EmployeePortal';

/*
 * Paused 19 Nov 2026 (owner): with LANGUAGE_CHOICE_ON false, the app shows in
 * English even for someone who chose Hindi before, and Me has no Language choice.
 */

const TODAY = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);
const ME = {
  employee: { name: 'Asha Rao', code: 'KT-007', department: 'Weaving', designation: 'Supervisor', photoUrl: null },
  company: { name: 'Kaveri Textiles', code: 'KAVERI' },
  today: TODAY,
  shift: { name: 'General', startTime: '09:30', endTime: '18:30', off: false, holiday: null },
  record: { status: 'PRESENT', checkInTime: '09:41', checkOutTime: null, lateMinutes: 11, earlyOutMinutes: 0 },
  punches: [{ time: '09:41', kind: 'IN', phone: false }],
  phone: { allowed: false, why: null },
  approver: false,
  privacy: { version: 1, read: true },
  people: true,
  language: 'hi',
};

const day = (n) => `${MONTH}-${String(n).padStart(2, '0')}`;
const ROUTES = {
  '/me': ME,
  '/attendance': {
    totals: { present: 2, halfDay: 0, absent: 1, leave: 0, late: 1 },
    days: [
      { date: day(1), status: 'PRESENT', checkIn: '09:35', checkOut: '18:40', lateMinutes: 5 },
      { date: day(2), status: 'ABSENT' },
    ],
  },
  '/schedule': { days: [{ date: TODAY, kind: 'WORK', shift: 'General', startTime: '09:30', endTime: '18:30' }, { date: day(28), kind: 'OFF' }] },
  '/requests': { requests: [], rules: null },
  '/leave': {
    types: [{ id: 't1', name: 'Casual leave', code: 'CL', allowHalfDay: true }],
    balances: [{ leaveTypeId: 't1', leaveTypeName: 'Casual leave', allotted: 12, used: 2, pending: 0, available: 10 }],
    requests: [],
  },
};

const answer = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  localStorage.setItem('clor.portal.token', 'test-token');
  localStorage.setItem('clor.portal.lang', 'hi');
  vi.stubGlobal('fetch', vi.fn((url) => {
    const path = String(url).replace(/^.*\/portal/, '').split('?')[0];
    if (ROUTES[path]) return answer(200, ROUTES[path]);
    return answer(404, { error: 'No such page.' });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('stays in English with no Language choice while it is paused', async () => {
  render(<EmployeePortal />);
  await screen.findByText(/Asha/);
  await act(() => new Promise((r) => setTimeout(r, 30)));
  expect(document.documentElement.getAttribute('lang')).not.toBe('hi');
  expect(screen.queryByText('आज की शिफ्ट')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Language' })).toBeNull();
  expect(screen.queryByText('हिन्दी')).toBeNull();
});
