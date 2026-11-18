import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import JoinLeaveBars from './JoinLeaveBars';
import LongLeaveSpan, { backOn, lastDayOf, spanWords } from './LongLeaveSpan';
import CopyListLink, { addressHasFilters } from '../components/list/CopyListLink';

afterEach(() => {
  delete document.documentElement.dataset.palette;
  window.history.replaceState(null, '', '/');
});

it('draws joiners up and leavers down, and says both for a screen reader', () => {
  render(<JoinLeaveBars rows={[{ key: '2026-10', label: 'Oct', joiners: 7, leavers: 3 }, { key: '2026-11', label: 'Nov', joiners: 0, leavers: 2 }]} />);
  const chart = screen.getByRole('img');
  expect(chart.getAttribute('aria-label')).toBe('Joiners and leavers each month: Oct 7 joined, 3 left, Nov 0 joined, 2 left');
  expect(screen.getByText('+7 −3')).toBeTruthy();
  expect(screen.getByText('+0 −2')).toBeTruthy();
});

it('works out 26 weeks of maternity leave and the day back', () => {
  expect(lastDayOf('2026-12-02')).toBe('2027-06-01');
  expect(backOn('2027-06-01')).toBe('2027-06-02');
  expect(spanWords('2026-12-02', '2027-06-01')).toBe('26 weeks');
  expect(spanWords('2026-12-02', '2026-12-10')).toBe('1 week 2 days');
});

it('offers to fill 26 weeks on a maternity request and shows when she is back', () => {
  const onFill = vi.fn();
  const { rerender } = render(<LongLeaveSpan typeName="Maternity leave" fromDate="2026-12-02" toDate="" onFill={onFill} />);
  fireEvent.click(screen.getByRole('button', { name: /fill 26 weeks/i }));
  expect(onFill).toHaveBeenCalledWith('2027-06-01');
  rerender(<LongLeaveSpan typeName="Maternity leave" fromDate="2026-12-02" toDate="2027-06-01" onFill={onFill} />);
  expect(screen.getByText('26 weeks')).toBeTruthy();
  expect(screen.getByText(/back at work on/i).textContent).toMatch(/2 Jun 2027/);
  expect(screen.queryByRole('button', { name: /fill 26 weeks/i })).toBeNull();
});

it('says nothing for other leave types', () => {
  const { container } = render(<LongLeaveSpan typeName="Casual leave" fromDate="2026-12-02" toDate="2026-12-03" onFill={() => {}} />);
  expect(container.textContent).toBe('');
});

it('shows Copy link only once the list is filtered, and never in Books', () => {
  expect(addressHasFilters('?open=leave')).toBe(false);
  expect(addressHasFilters('?open=leave&s.status=PENDING')).toBe(true);
  const { rerender } = render(<CopyListLink />);
  expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
  window.history.replaceState(null, '', '/?open=leave&s.status=PENDING');
  rerender(<CopyListLink key="2" />);
  expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy();
  document.documentElement.dataset.palette = 'indigo';
  rerender(<CopyListLink key="3" />);
  expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
});
