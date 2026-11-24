import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BarChart, CalendarHeatmap, Funnel, LineChart, Meter, RingProgress, Sparkline, fmtMoney, fmtMoneyShort } from './index';
import { niceTicks, seriesStyle, INK } from './core';

describe('chart kit helpers', () => {
  it('formats Indian money with a true minus and short units', () => {
    expect(fmtMoney(1234567)).toBe('₹12,34,567');
    expect(fmtMoney(-500)).toBe('−₹500');
    expect(fmtMoneyShort(1840000)).toBe('₹18L');
    expect(fmtMoneyShort(640000)).toBe('₹6.4L');
    expect(fmtMoneyShort(31000000)).toBe('₹3.1Cr');
  });

  it('gives round ticks that cover the data', () => {
    const t = niceTicks(0, 61);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(61);
  });

  it('uses the app colour only for a focus series (DESIGN.md "Charts")', () => {
    expect(seriesStyle({ name: 'a' }, 0).color).toBe(INK.fg);
    expect(seriesStyle({ name: 'b' }, 1).dash).toBeTruthy();
    expect(seriesStyle({ name: 'c', focus: true }, 2).color).toBe(INK.act);
  });
});

describe('chart kit components', () => {
  it('line chart: a table for screen readers and a keyboard read-out', () => {
    render(<LineChart title="Headcount" categories={['Apr', 'May']} series={[{ name: 'This year', values: [40, 42] }]} />);
    expect(screen.getByRole('table', { hidden: true })).toBeTruthy();
    const plot = screen.getByRole('img', { name: /Headcount/ });
    fireEvent.keyDown(plot, { key: 'End' });
    expect(screen.getByRole('status').textContent).toContain('May');
    expect(screen.getByRole('status').textContent).toContain('42');
  });

  it('bar chart writes each total at the bar end when horizontal', () => {
    const { container } = render(<BarChart horizontal categories={['Sales', 'Ops']} series={[{ name: 'People', values: [14, 11] }]} />);
    expect([...container.querySelectorAll('.ck-val')].map((n) => n.textContent)).toEqual(['14', '11']);
  });

  it('meter exposes its value as a meter', () => {
    render(<Meter label="Seats in use" value={46} max={50} status="4 left" tone="warn" />);
    const m = screen.getByRole('meter', { name: 'Seats in use' });
    expect(m.getAttribute('aria-valuetext')).toBe('46 of 50, 4 left');
  });

  it('funnel writes the share that went on', () => {
    render(<Funnel steps={[{ name: 'Applied', value: 100 }, { name: 'Screened', value: 25 }]} />);
    expect(screen.getByText('25% went on')).toBeTruthy();
  });

  it('heatmap in status mode writes every status in the key', () => {
    render(
      <CalendarHeatmap
        from="2026-11-02"
        to="2026-11-08"
        days={[{ date: '2026-11-03', status: 'absent' }]}
        statuses={[{ key: 'present', label: 'Present', color: '#000' }, { key: 'absent', label: 'Absent', color: '#f00' }]}
      />,
    );
    expect(screen.getAllByText('Present').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Absent').length).toBeGreaterThan(0);
  });

  it('ring and sparkline render with a label', () => {
    render(<RingProgress rings={[{ name: 'Documents', value: 0, max: 6 }]} />);
    expect(screen.getByText('0 of 6')).toBeTruthy();
    render(<Sparkline values={[1, 2, 3]} label="Hires" />);
    expect(screen.getByRole('img', { name: 'Hires: 1, 2, 3' })).toBeTruthy();
  });
});
