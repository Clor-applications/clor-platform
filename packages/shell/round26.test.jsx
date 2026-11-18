import React, { useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { clockText, lockoutSeconds } from './lockoutWait';
import PrintFooter, { printedLine } from './PrintFooter';
import useJkList from '@ui/components/list/useJkList';
import { withWomenShare } from '../../apps/people/src/screens/womenShare';

/* Round 26 picks (18 Nov 2026): wait timer, printed footer, J/K/A keys, % women. */

describe('too many wrong codes', () => {
  it('reads the minutes from the server’s 429 and counts as m:ss', () => {
    expect(lockoutSeconds({ status: 429, message: 'Too many failed attempts. Try again in 5 minute(s).' })).toBe(300);
    expect(lockoutSeconds({ status: 429, code: 'SMS_HELD', message: 'Try again in 1 minute' })).toBe(0);
    expect(lockoutSeconds({ status: 401, message: 'Try again in 5 minute(s).' })).toBe(0);
    expect(clockText(298)).toBe('4:58');
    expect(clockText(0)).toBe('0:00');
  });
});

describe('printed footer', () => {
  afterEach(() => { delete document.documentElement.dataset.palette; });
  it('says who printed it, from CLOR, and when', () => {
    const line = printedLine('Anita Rao', new Date(2026, 10, 18, 16, 12));
    expect(line).toMatch(/^Printed by Anita Rao from CLOR · 18 Nov 2026, 4:12 PM$/i);
    render(<PrintFooter name="Anita Rao" />);
    expect(document.querySelector('.ui-print-footer')).toHaveTextContent('Printed by Anita Rao from CLOR');
  });
  it('is not drawn in Books', () => {
    document.documentElement.dataset.palette = 'indigo';
    render(<PrintFooter name="Anita Rao" />);
    expect(document.querySelector('.ui-print-footer')).toBeNull();
  });
});

function List({ onApprove }) {
  const ref = useRef(null);
  useJkList(ref);
  return (
    <div ref={ref}>
      <input aria-label="Search" />
      <table><tbody>
        {['Rahul', 'Divya', 'Meena'].map((n) => (
          <tr key={n}>
            <td><button type="button" className="ui-row-open">{n}</button></td>
            <td><button type="button" className="ui-decide-btn is-yes" onClick={() => onApprove(n)}>Approve {n}</button></td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

describe('J and K move down a list, A approves', () => {
  afterEach(() => { delete document.documentElement.dataset.palette; });
  it('moves with J and K and approves the focused row with A', () => {
    const approve = vi.fn();
    render(<List onApprove={approve} />);
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(screen.getByRole('button', { name: 'Rahul' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: 'j' });
    fireEvent.keyDown(document.activeElement, { key: 'j' });
    expect(screen.getByRole('button', { name: 'Meena' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: 'k' });
    expect(screen.getByRole('button', { name: 'Divya' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: 'a' });
    expect(approve).toHaveBeenCalledWith('Divya');
  });
  it('leaves the keys alone while typing, and in Books', () => {
    const approve = vi.fn();
    render(<List onApprove={approve} />);
    screen.getByLabelText('Search').focus();
    fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'j' });
    expect(screen.getByLabelText('Search')).toHaveFocus();
    document.documentElement.dataset.palette = 'indigo';
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(screen.getByRole('button', { name: 'Rahul' })).not.toHaveFocus();
  });
});

describe('men and women in each team', () => {
  it('adds a % women column from the counts, blank where counts are masked', () => {
    const d = withWomenShare({
      id: 'gender',
      columns: [{ key: 'group', label: 'Department' }, { key: 'FEMALE', label: 'Women' }, { key: 'MALE', label: 'Men' }, { key: 'total', label: 'Total' }],
      rows: [{ group: 'Sales', FEMALE: 6, MALE: 18, total: 24 }, { group: 'HR', FEMALE: 'Fewer than 5', MALE: '5 or more', total: 7 }],
      totals: { group: 'Everyone', FEMALE: 6, MALE: 18, total: 24 },
    });
    expect(d.columns.at(-1)).toMatchObject({ key: 'womenPct', label: '% women', kind: 'pct' });
    expect(d.rows[0].womenPct).toBe(25);
    expect(d.rows[1].womenPct).toBeNull();
    expect(d.totals.womenPct).toBe(25);
    expect(withWomenShare({ id: 'headcount', columns: [], rows: [] }).columns).toEqual([]);
  });
});
