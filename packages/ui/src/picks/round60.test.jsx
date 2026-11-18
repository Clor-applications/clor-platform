import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Abbr, SlowNote, decidedLine, lastSignedIn, lastSignedInLine, lineName, possessive, shortRange, shownLines } from './round60';

describe('round 60: clear words and getting unstuck', () => {
  it('toastwords A: the done message names the person, the thing and the days', () => {
    expect(possessive('Ravi Kumar')).toBe('Ravi Kumar’s');
    expect(possessive('Suresh Das')).toBe('Suresh Das’');
    expect(shortRange('2026-12-04', '2026-12-06')).toBe('4–6 Dec');
    expect(shortRange('2026-12-04', '2026-12-04')).toBe('4 Dec');
    expect(shortRange('2026-11-30', '2026-12-02')).toBe('30 Nov–2 Dec');
    expect(shortRange('2026-12-30', '2027-01-02')).toBe('30 Dec 2026–2 Jan 2027');
    expect(decidedLine({ name: 'Ravi', what: 'leave', from: '2026-12-04', to: '2026-12-06', verb: 'approved' })).toBe('Ravi’s leave, 4–6 Dec, approved');
    expect(decidedLine({ name: 'Ravi', what: 'missed punch', from: '2026-12-04', verb: 'not approved' })).toBe('Ravi’s missed punch, 4 Dec, not approved');
  });

  it('zerorows A: lines of ₹0 are left off a payslip', () => {
    expect(shownLines([{ name: 'Basic', amount: 20000 }, { name: 'Overtime', amount: 0 }, { name: 'Bonus', amount: '0.00' }, { name: 'Fine', amount: -50 }]).map((l) => l.name)).toEqual(['Basic', 'Fine']);
    expect(shownLines(null)).toEqual([]);
  });

  it('lastsignin A: Today, days ago, Never', () => {
    const now = new Date(2026, 10, 18, 15);
    expect(lastSignedIn(null, now)).toBe('Never');
    expect(lastSignedIn(new Date(2026, 10, 18, 9), now)).toBe('Today');
    expect(lastSignedIn(new Date(2026, 10, 17, 9), now)).toBe('Yesterday');
    expect(lastSignedIn(new Date(2026, 10, 15, 9), now)).toBe('3 days ago');
    expect(lastSignedInLine(new Date(2026, 10, 15, 9), now)).toBe('Signed in 3 days ago');
    expect(lastSignedInLine(undefined, now)).toBe('Never signed in');
    expect(lastSignedInLine(new Date(2026, 5, 1), now)).toMatch(/^Last signed in 1 Jun 2026$/);
  });

  it('abbrexplain A: a tap on PF gives the full name and one line', () => {
    render(<p>Take <Abbr k="PF" /> off</p>);
    const pf = screen.getByRole('button', { name: 'PF' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(pf);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Provident Fund, savings for retirement');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('abbrexplain A: payslip names that are a short form are explained, others stay text', () => {
    render(<dl><dt>{lineName('ESI')}</dt><dt>{lineName('Basic')}</dt></dl>);
    expect(screen.getByRole('button', { name: 'ESI' })).toBeInTheDocument();
    expect(screen.getByText('Basic').tagName).toBe('DT');
  });

  it('slowload A: the note shows only after 5 seconds, with Cancel', () => {
    vi.useFakeTimers();
    const onCancel = vi.fn();
    const { rerender } = render(<SlowNote busy onCancel={onCancel} />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole('status')).toHaveTextContent('Still working. Big reports take up to a minute.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    rerender(<SlowNote busy={false} onCancel={onCancel} />);
    expect(screen.queryByRole('status')).toBeNull();
    vi.useRealTimers();
  });
});
