import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ColumnName, RowsMore, allZero, noteRecentReport, periodWord, readRecentReports, reportHeaderLines, shapeRows, signedFigure, withHeaderLines } from './round63';
import { presetRanges } from '../components/ui/RangePresets';

afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* none */ } });

const cols = [{ key: 'name', label: 'Employee' }, { key: 'code', label: 'Employee ID' }, { key: 'ot', label: 'Overtime', align: 'right' }];

describe('round 63: reports', () => {
  it('columnhelp: a known column explains itself; an unknown one stays plain', () => {
    render(<table><thead><tr><th><ColumnName label="Attrition" /></th><th><ColumnName label="Sales" /></th></tr></thead></table>);
    const a = screen.getByText('Attrition');
    expect(a.className).toContain('ui-colhelp');
    expect(a.getAttribute('data-help')).toMatch(/share of the average headcount/);
    expect(a.getAttribute('tabindex')).toBe('0');
    expect(screen.getByText('Sales').className).not.toContain('ui-colhelp');
  });

  it('negformat: a minus figure has the sign before it and is marked red', () => {
    expect(signedFigure(-1200)).toEqual({ text: '−1,200', negative: true });
    expect(signedFigure(125000).text).toBe('1,25,000');
  });

  it('hidezero: all-zero rows wait behind "Show N people with none", unless every row is zero', () => {
    const rows = [{ name: 'A', code: '1', ot: 3 }, { name: 'B', code: '2', ot: 0 }, { name: 'C', code: '3', ot: 0 }];
    expect(allZero(rows[1], cols)).toBe(true);
    expect(allZero(rows[0], cols)).toBe(false);
    const s = shapeRows(rows, cols);
    expect(s.visible.map((r) => r.name)).toEqual(['A']);
    expect(s.hiddenZero).toBe(2);
    expect(shapeRows(rows, cols, { showZero: true }).visible).toHaveLength(3);
    expect(shapeRows([rows[1], rows[2]], cols).visible).toHaveLength(2);
  });

  it('reportpeek: the first 20 rows show with the count, then Show all', () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({ name: `P${i}`, code: String(i), ot: i + 1 }));
    const s = shapeRows(rows, cols);
    expect(s.visible).toHaveLength(20);
    expect(s.more).toBe(25);
    let all = false;
    let zero = false;
    render(<RowsMore hiddenZero={3} more={s.more} total={s.total} shownCount={20} person onShowAll={() => { all = true; }} onShowZero={() => { zero = true; }} />);
    expect(screen.getByText(/20 of 45 shown/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 45' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 people with none' }));
    expect(all && zero).toBe(true);
  });

  it('reportheader: the download starts with company, report, period, filters, and made on and by whom', () => {
    const lines = reportHeaderLines({ company: 'Kave Foods', report: 'Headcount over time', from: '2026-04-01', to: '2026-10-31', filters: ['Department: Sales'], by: 'Priya', today: new Date(2026, 10, 18) });
    expect(lines[0]).toBe('Kave Foods');
    expect(lines[1]).toBe('Headcount over time');
    expect(lines[2]).toMatch(/^Period: 1 Apr 2026 to 31 Oct 2026$/);
    expect(lines[3]).toBe('Filters: Department: Sales');
    expect(lines[4]).toMatch(/^Made on 18 Nov 2026 by Priya$/);
    const csv = withHeaderLines('\uFEFFMonth,Total\r\nJan,8', ['Kave Foods, Pune', 'Headcount']);
    expect(csv.startsWith('\uFEFF"Kave Foods, Pune"\r\nHeadcount\r\n\r\nMonth,Total')).toBe(true);
  });

  it('reportrecent: the last reports opened, newest first, four at most, with their period', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) noteRecentReport({ id, from: '2026-10-01', to: '2026-10-31' });
    noteRecentReport({ id: 'c', from: '2026-04-01', to: '2027-03-31' });
    const r = readRecentReports();
    expect(r.map((x) => x.id)).toEqual(['c', 'e', 'd', 'b']);
    expect(periodWord('2026-10-01', '2026-10-31')).toBe('Oct 2026');
    expect(periodWord('2026-04-01', '2027-03-31')).toBe('FY 2026–27');
  });

  it('datepresets: This quarter is the financial quarter the day falls in', () => {
    const q = presetRanges(new Date(2026, 10, 18)).find(([k]) => k === 'quarter');
    expect(q.slice(1)).toEqual(['This quarter', '2026-10-01', '2026-12-31']);
    const q1 = presetRanges(new Date(2027, 1, 5)).find(([k]) => k === 'quarter');
    expect(q1.slice(2)).toEqual(['2027-01-01', '2027-03-31']);
  });
});
