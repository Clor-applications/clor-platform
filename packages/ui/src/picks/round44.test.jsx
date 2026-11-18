import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { daysBetween, newRegimeTax, payCalendar, takeHome } from './round44';
import PayCalendarStrip from '../../../../apps/payroll/src/components/PayCalendarStrip';
import TakeHomeEstimate from '../../../../apps/people/src/workforce/TakeHomeEstimate';
import PfWithdrawSteps, { EPFO_MEMBER_PORTAL } from '../../../../apps/attendance/src/portal/PfWithdrawSteps';

/* Round 44 picks (18 Nov 2026): take-home from CTC, payroll dates strip, PF withdrawal steps. */

describe('take-home from a yearly CTC', () => {
  it('works ₹6,00,000 into pay, PF, professional tax and no income tax', () => {
    const t = takeHome('6,00,000');
    expect(t).toMatchObject({ monthly: 50000, pf: 1800, gross: 48200, pt: 200, tax: 0, net: 46200, rounded: 46200 });
  });
  it('caps PF on a big salary and charges new-regime tax', () => {
    const t = takeHome(2400000);
    expect(t.pf).toBe(1800);
    expect(t.tax).toBeGreaterThan(0);
    expect(t.net).toBe(t.gross - t.pf - t.pt - t.tax);
  });
  it('takes PF on half the pay when basic is under ₹15,000', () => {
    const t = takeHome(240000);
    expect(t.pf).toBe(Math.round(0.12 * ((0.5 * 20000) / 1.06)));
    expect(t.tax).toBe(0);
  });
  it('gives nothing for a blank or zero CTC', () => {
    expect(takeHome('')).toBeNull();
    expect(takeHome(0)).toBeNull();
  });
  it('new regime: nothing up to the rebate, marginal relief just above it', () => {
    expect(newRegimeTax(1275000)).toBe(0);
    expect(newRegimeTax(1285000)).toBe(Math.round(10000 * 1.04));
    expect(newRegimeTax(1675000)).toBe(Math.round((20000 + 40000 + 60000) * 1.04));
  });
  it('shows the estimate under the CTC on an offer', () => {
    render(<TakeHomeEstimate ctc="600000" />);
    expect(screen.getByRole('status')).toHaveTextContent('Net pay, about ₹46,200 a month');
    expect(screen.getByRole('status')).toHaveTextContent('An estimate on the new tax regime');
  });
});

describe('payroll dates strip', () => {
  const period = { name: 'November 2026', endDate: '2026-11-30', paymentDate: '2026-11-30' };
  it('counts the days left to pay and marks where the month stands', () => {
    expect(daysBetween('2026-11-18', '2026-11-30')).toBe(12);
    const cal = payCalendar(period, null, '2026-11-18');
    expect(cal.steps.map((s) => s.state)).toEqual(['now', 'next', 'next', 'next']);
    expect(cal.left).toBe('Pay in 12 days');
    expect(payCalendar(period, { status: 'REVIEW' }, '2026-11-28').steps[1].state).toBe('now');
    expect(payCalendar(period, { status: 'APPROVED' }, '2026-11-30').left).toBe('Pay today');
    expect(payCalendar(period, { status: 'PAID' }, '2026-12-01').left).toBe('Paid');
    const late = payCalendar(period, { status: 'APPROVED' }, '2026-12-02');
    expect(late).toMatchObject({ left: 'Pay was due 2 days ago', late: true });
  });
  it('draws the four steps with the known dates', () => {
    render(<PayCalendarStrip period={period} run={{ status: 'CALCULATED' }} today="2026-11-27" />);
    const strip = screen.getByRole('region', { name: 'Payroll dates for November 2026' });
    expect(strip).toHaveTextContent('Inputs close30 Nov');
    expect(strip).toHaveTextContent('Run and reviewNow');
    expect(strip).toHaveTextContent('Pay in 3 days');
  });
});

describe('PF withdrawal steps', () => {
  it('lists the steps and links to the EPFO member page', () => {
    render(<PfWithdrawSteps />);
    expect(screen.getByText('Taking money out of your PF')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('link', { name: /Open the EPFO member page/ })).toHaveAttribute('href', EPFO_MEMBER_PORTAL);
  });
});
