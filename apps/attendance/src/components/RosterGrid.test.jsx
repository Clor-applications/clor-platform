import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RosterGrid from './RosterGrid';
import { cellLabel } from './rosterCells';

vi.mock('../api/attendance', () => ({ SCHEDULE_SOURCE: { TEMPORARY: 'Temporary', ROSTER: 'Roster', DEFAULT: 'Company default' } }));

/*
 * The roster grid: a block of days is chosen with the mouse or the keys and
 * set in one call; a shift's code typed on a cell sets it; Enter opens the
 * choices; someone who may only view gets no way to change a day.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const DAYS = ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13'];
const SHIFTS = [
  { id: 's1', name: 'Day', code: 'D', startTime: '09:00', endTime: '18:00', minStaff: 2 },
  { id: 's2', name: 'Night', code: 'N', startTime: '22:00', endTime: '06:00', minStaff: null },
  { id: 's3', name: 'Night one', code: 'N1', startTime: '20:00', endTime: '04:00', minStaff: null },
];
const row = (i, over = {}) => ({
  employeeId: `e${i}`,
  name: `Person ${i}`,
  code: `P${i}`,
  cells: DAYS.map((date) => ({ date, kind: date === '2026-12-13' ? 'OFF' : 'WORK', shiftId: null, code: null, name: 'Standard', source: 'DEFAULT', ...(over[date] || {}) })),
});
const ROWS = [
  row(1, { '2026-12-08': { shiftId: 's1', code: 'D', name: 'Day', source: 'ROSTER', draft: 'SHIFT' }, '2026-12-09': { kind: 'LEAVE' }, '2026-12-10': { kind: 'HOLIDAY' } }),
  row(2),
  row(3),
];
const COVERAGE = DAYS.map((date) => ({ date, counts: date === '2026-12-08' ? { s1: 1, '': 2 } : { '': 3 }, company: date === '2026-12-08' ? { s1: 1 } : {}, short: date === '2026-12-08' ? { s1: 1 } : { s1: 2 } }));

const draw = (props = {}) => {
  const onAssign = vi.fn();
  render(<RosterGrid days={DAYS} rows={ROWS} shifts={SHIFTS} coverage={COVERAGE} canEdit onAssign={onAssign} {...props} />);
  return onAssign;
};
const cell = (r, c) => document.querySelector(`[data-cell="${r}:${c}"]`);
const key = (r, c, k, more = {}) => fireEvent.keyDown(cell(r, c), { key: k, ...more });
const chosen = () => [...document.querySelectorAll('[role="gridcell"][aria-selected="true"]')].map((el) => el.getAttribute('data-cell'));

describe('what a cell says', () => {
  it('is the shift’s code, or W, H, L, or a dash for a day not employed', () => {
    expect([{ kind: 'WORK', code: 'D' }, { kind: 'WORK', code: null, name: 'Standard' }, { kind: 'OFF' }, { kind: 'HOLIDAY' }, { kind: 'LEAVE' }, { kind: 'OUT' }].map(cellLabel)).toEqual(['D', 'St', 'W', 'H', 'L', '–']);
  });

  it('draws each day, marks a draft, and counts each shift with its shortfall', () => {
    draw();
    expect(cell(0, 1).textContent).toBe('D');
    expect(cell(0, 1).querySelector('[data-draft="true"]')).toBeTruthy();
    expect(cell(0, 1).getAttribute('aria-label')).toBe('Person 1, Tuesday 8 Dec: Day, draft, not published');
    expect([cell(0, 2).textContent, cell(0, 3).textContent, cell(0, 6).textContent]).toEqual(['L', 'H', 'W']);
    /* The shift's colour is a design token, never a literal. */
    expect(cell(0, 1).querySelector('span').getAttribute('style')).toContain('var(--dept-1)');
    const foot = document.querySelector('tfoot');
    const dayRow = within(foot).getByText('Day').closest('tr');
    expect(within(dayRow).getByText('· at least 2')).toBeTruthy();
    const tuesday = dayRow.querySelectorAll('td')[1];
    expect(tuesday.textContent).toBe('1−1');
    expect(tuesday.getAttribute('aria-label')).toBe('Tuesday 8 Dec: 1 on Day in the company, 1 short of 2');
    expect(dayRow.querySelectorAll('[data-short="true"]')).toHaveLength(7);
    /* A shift with no minimum is never short; people on no shift get their own row. */
    expect(within(foot).getByText('Night').closest('tr').querySelectorAll('[data-short="true"]')).toHaveLength(0);
    expect(within(foot).getByText('Standard day')).toBeTruthy();
  });
});

describe('choosing a block', () => {
  it('moves with the arrows and stretches with Shift', () => {
    draw();
    expect(cell(0, 0).tabIndex).toBe(0);
    key(0, 0, 'ArrowRight');
    key(0, 1, 'ArrowDown');
    expect(cell(1, 1).tabIndex).toBe(0);
    expect(cell(0, 0).tabIndex).toBe(-1);
    expect(chosen()).toEqual(['1:1']);
    key(1, 1, 'ArrowDown', { shiftKey: true });
    key(2, 1, 'ArrowRight', { shiftKey: true });
    key(2, 2, 'ArrowRight', { shiftKey: true });
    expect(chosen()).toEqual(['1:1', '1:2', '1:3', '2:1', '2:2', '2:3']);
    expect(screen.getByText('2 people × 3 days chosen')).toBeTruthy();
    /* The edges hold; Home and End run along the row; Escape lets go of the block. */
    key(2, 3, 'ArrowDown');
    expect(cell(2, 3).tabIndex).toBe(0);
    key(2, 3, 'End');
    expect(cell(2, 6).tabIndex).toBe(0);
    key(2, 6, 'Home', { shiftKey: true });
    expect(chosen()).toHaveLength(7);
    key(2, 0, 'Escape');
    expect(chosen()).toEqual(['2:0']);
  });

  it('drags, Shift+clicks, and takes a whole row or column from its heading', () => {
    draw();
    fireEvent.mouseDown(cell(0, 1), { button: 0 });
    fireEvent.mouseEnter(cell(1, 2));
    fireEvent.mouseEnter(cell(2, 3));
    fireEvent.mouseUp(window);
    expect(screen.getByText('3 people × 3 days chosen')).toBeTruthy();
    /* The drag is over: passing over a cell no longer moves the block. */
    fireEvent.mouseEnter(cell(0, 6));
    expect(chosen()).toHaveLength(9);
    fireEvent.mouseDown(cell(0, 0), { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(cell(1, 6), { button: 0, shiftKey: true });
    fireEvent.mouseUp(window);
    expect(screen.getByText('2 people × 7 days chosen')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Choose all of Person 2’s days'));
    expect(chosen()).toEqual(DAYS.map((_, c) => `1:${c}`));
    fireEvent.click(screen.getByTitle('Choose everyone shown on Wednesday 9 Dec'));
    expect(chosen()).toEqual(['0:2', '1:2', '2:2']);
  });
});

describe('setting the block, in one call', () => {
  it('a shift’s code typed on a cell sets the whole block', () => {
    const onAssign = draw();
    key(0, 0, 'ArrowDown', { shiftKey: true });
    key(1, 0, 'ArrowRight', { shiftKey: true });
    key(1, 1, 'd');
    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(onAssign).toHaveBeenCalledWith({ employeeIds: ['e1', 'e2'], dates: ['2026-12-07', '2026-12-08'], kind: 'SHIFT', shiftId: 's1' });
  });

  it('waits for the next letter when a longer code could follow, W is a weekly off, Delete goes back to the schedule', () => {
    vi.useFakeTimers();
    const onAssign = draw();
    key(0, 0, 'n');
    expect(onAssign).not.toHaveBeenCalled();
    expect(screen.getByText(/typing N/)).toBeTruthy();
    key(0, 0, '1');
    expect(onAssign).toHaveBeenLastCalledWith({ employeeIds: ['e1'], dates: ['2026-12-07'], kind: 'SHIFT', shiftId: 's3' });
    key(0, 0, 'N');
    act(() => { vi.advanceTimersByTime(800); });
    expect(onAssign).toHaveBeenLastCalledWith({ employeeIds: ['e1'], dates: ['2026-12-07'], kind: 'SHIFT', shiftId: 's2' });
    key(0, 0, 'w');
    expect(onAssign).toHaveBeenLastCalledWith({ employeeIds: ['e1'], dates: ['2026-12-07'], kind: 'OFF', shiftId: null });
    key(0, 0, 'Delete');
    expect(onAssign).toHaveBeenLastCalledWith({ employeeIds: ['e1'], dates: ['2026-12-07'], kind: 'CLEAR', shiftId: null });
    /* A letter that starts no code does nothing; nor does a shortcut. */
    key(0, 0, 'z');
    key(0, 0, 'd', { ctrlKey: true });
    act(() => { vi.advanceTimersByTime(800); });
    expect(onAssign).toHaveBeenCalledTimes(4);
  });

  it('Enter opens the choices; arrows and Enter pick one; Escape closes them', () => {
    const onAssign = draw();
    key(1, 2, 'Enter');
    /* The choices open on the cell that has the keys: the first one until it is moved. */
    const box = screen.getByRole('listbox', { name: 'Set the chosen days to' });
    expect(within(box).getAllByRole('option').map((o) => o.textContent)).toEqual(['DDay 09:00–18:00', 'NNight 22:00–06:00', 'N1Night one 20:00–04:00', 'WWeekly off', 'Back to their schedule']);
    key(0, 0, 'ArrowDown');
    expect(within(box).getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    /* The arrows now move through the choices, not the grid. */
    expect(cell(0, 0).tabIndex).toBe(0);
    key(0, 0, 'Enter');
    expect(onAssign).toHaveBeenCalledWith({ employeeIds: ['e1'], dates: ['2026-12-07'], kind: 'SHIFT', shiftId: 's2' });
    expect(screen.queryByRole('listbox')).toBeNull();
    key(0, 0, 'F2');
    expect(screen.getByRole('listbox')).toBeTruthy();
    key(0, 0, 'Escape');
    expect(screen.queryByRole('listbox')).toBeNull();
    /* A double click opens them too, and a click picks. */
    fireEvent.doubleClick(cell(2, 4));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Weekly off'));
    expect(onAssign).toHaveBeenCalledTimes(2);
    expect(onAssign).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'OFF' }));
  });

  it('the Set to list above the grid sets the block too', () => {
    const onAssign = draw();
    fireEvent.click(screen.getByTitle('Choose all of Person 3’s days'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Set the chosen days to' }), { target: { value: 'OFF' } });
    expect(onAssign).toHaveBeenCalledWith({ employeeIds: ['e3'], dates: DAYS, kind: 'OFF', shiftId: null });
  });
});

describe('someone who may only view', () => {
  it('can move about and choose, and has no way to change a day', () => {
    const onAssign = draw({ canEdit: false });
    expect(screen.getByRole('grid', { name: 'Roster' }).getAttribute('aria-readonly')).toBe('true');
    expect(screen.queryByRole('combobox', { name: 'Set the chosen days to' })).toBeNull();
    key(0, 0, 'ArrowRight');
    expect(cell(0, 1).tabIndex).toBe(0);
    key(0, 1, 'd');
    key(0, 1, 'Enter');
    key(0, 1, 'Delete');
    fireEvent.doubleClick(cell(0, 1));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('nothing is sent while a change is being saved', () => {
    const onAssign = draw({ busy: true });
    key(0, 0, 'd');
    expect(onAssign).not.toHaveBeenCalled();
  });
});
