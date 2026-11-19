import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import EmployeePortal from './EmployeePortal';
import { KEEP_ENGLISH } from '@ui/i18n/translate';

/* The Language choice is paused in the product (LANGUAGE_CHOICE_ON false); these tests keep Hindi working for when it comes back. */
vi.mock('@ui/i18n', async (importOriginal) => ({ ...(await importOriginal()), LANGUAGE_CHOICE_ON: true }));

/*
 * Round 67: the employee app in Hindi. With Hindi chosen, every main screen
 * (Today, My days, Schedule, Leave, Me) shows no English word except the terms
 * that stay in English (PF, UAN, HR …), the names and codes in the data, and
 * the language's own name on the language choice. The server answers from a
 * table below; anything it does not know answers "No such page." the way the
 * real one does, so those cards show their (Hindi) load-failed line.
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
/* Words from the data above: names and codes stay as they are. */
const DATA_WORDS = ['Asha', 'Rao', 'KT', 'Weaving', 'Supervisor', 'Kaveri', 'Textiles', 'KAVERI', 'General', 'Casual', 'Sick'];
/* Labels of other people's screens quoted in the Hindi (the phone's share sheet, the EPFO site, the print dialog). */
const QUOTED = ['Save', 'as', 'Add', 'to', 'Home', 'Screen', 'Track', 'claim', 'status', 'Online', 'Services', 'Claim', 'English'];
const ALLOWED = new Set([...KEEP_ENGLISH, ...DATA_WORDS, ...QUOTED]);

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

/** Every English word a person could read or hear on the page now. */
function englishLeft() {
  const seen = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest('script, style, svg, .sr-only[hidden]')) continue;
    if (n.nodeValue.trim()) seen.push(n.nodeValue);
  }
  document.body.querySelectorAll('[placeholder], [aria-label], [title], [alt]').forEach((el) => {
    ['placeholder', 'aria-label', 'title', 'alt'].forEach((a) => el.getAttribute(a) && seen.push(el.getAttribute(a)));
  });
  const words = seen.join(' ').match(/[A-Za-z][A-Za-z’']+/g) || [];
  return [...new Set(words.filter((w) => !ALLOWED.has(w)))];
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

it('shows every main screen in Hindi, with no English left but the terms that stay', async () => {
  const user = userEvent.setup();
  render(<EmployeePortal />);
  await waitFor(() => expect(document.documentElement.getAttribute('lang')).toBe('hi'));
  await screen.findByText('आज की शिफ्ट');
  await settle();
  const nav = screen.getByRole('navigation');
  const report = {};
  report.today = englishLeft();
  for (const [key, name] of [['days', 'मेरे दिन'], ['schedule', 'शेड्यूल'], ['leave', 'छुट्टी'], ['me', 'मैं']]) {
    await user.click(within(nav).getByRole('button', { name }));
    await settle();
    await settle();
    report[key] = englishLeft();
  }
  expect(report).toEqual({ today: [], days: [], schedule: [], leave: [], me: [] });
});

it('puts English back when English is chosen on Me, and keeps the choice on the person', async () => {
  const user = userEvent.setup();
  render(<EmployeePortal />);
  await screen.findByText('आज की शिफ्ट');
  const nav = screen.getByRole('navigation');
  await user.click(within(nav).getByRole('button', { name: 'मैं' }));
  const choice = await screen.findByRole('radiogroup', { name: 'भाषा' });
  await user.click(within(choice).getByRole('radio', { name: 'English' }));
  await waitFor(() => expect(within(nav).getByRole('button', { name: 'Today' })).toBeTruthy());
  expect(screen.getByRole('heading', { name: 'Language' })).toBeTruthy();
  expect(document.documentElement.getAttribute('lang')).not.toBe('hi');
  expect(localStorage.getItem('clor.portal.lang')).toBeNull();
  const saved = fetch.mock.calls.find(([url, init]) => String(url).endsWith('/portal/me/language') && init?.method === 'PUT');
  expect(JSON.parse(saved[1].body)).toEqual({ language: 'en' });
});

it('opens in English by default, so nothing changes for anyone who has not chosen', async () => {
  localStorage.removeItem('clor.portal.lang');
  ROUTES['/me'] = { ...ME, language: 'en' };
  try {
    render(<EmployeePortal />);
    expect(await screen.findByText('Today’s shift')).toBeTruthy();
    expect(document.documentElement.getAttribute('lang')).not.toBe('hi');
  } finally {
    ROUTES['/me'] = ME;
  }
});
