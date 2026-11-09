import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import ReaderHealth from './ReaderHealth';

const reader = vi.hoisted(() => (id, name, status) => ({
  id, name, status, serialNumber: `SN-${id}`, areaName: 'Head office', model: 'K40', online: status === 'ok', isActive: true,
  lastSeenAt: '2026-11-07T04:00:00Z', lastPunchAt: '2026-11-07T03:50:00Z', clockOffsetSec: 0, issues: [], queue: { waiting: 0, failed24h: 0 },
  capacity: { users: { n: 3, max: 1000, pct: 0.3 }, fingers: { n: 3, max: 3000, pct: 0.1 }, faces: { n: null }, logs: { n: 120, max: 100000, pct: 0.1 } },
}));

vi.mock('../api/attendance', () => ({
  getReaderHealth: vi.fn().mockResolvedValue({
    readers: [reader('r1', 'Front gate', 'ok'), reader('r2', 'Store room', 'offline')],
    alerts: [], collection: [], settings: { alertEmails: 'owner@example.com' }, punchesToday: 12,
  }),
  getReaderTimeline: vi.fn(),
  saveReaderAlertSettings: vi.fn(),
}));

/* UI audit, 7 Nov 2026: a reader's row opened only to the mouse. A labelled button in the row now opens it from the keyboard. */
it('opens and closes a reader from the keyboard with a labelled button that says what it controls', async () => {
  const user = userEvent.setup();
  render(<ReaderHealth />);
  const toggle = await screen.findByRole('button', { name: 'Front gate: details' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.closest('tr').hasAttribute('aria-expanded')).toBe(false);

  toggle.focus();
  await user.keyboard('{Enter}');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const panel = document.getElementById(toggle.getAttribute('aria-controls'));
  expect(panel).toBeTruthy();
  expect(panel.textContent).toContain('Timeline');
  expect(document.activeElement).toBe(toggle);

  await user.keyboard(' ');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.hasAttribute('aria-controls')).toBe(false);
  expect(document.activeElement).toBe(toggle);
});

it('still opens on a row click, once (the button click does not toggle twice)', async () => {
  const user = userEvent.setup();
  render(<ReaderHealth />);
  const toggle = await screen.findByRole('button', { name: 'Store room: details' });
  await user.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  await user.click(screen.getByText('SN-r1 · Head office · K40'));
  expect(screen.getByRole('button', { name: 'Front gate: details' }).getAttribute('aria-expanded')).toBe('true');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});
