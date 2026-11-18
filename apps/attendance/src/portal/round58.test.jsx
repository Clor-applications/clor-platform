import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PhonePunch from '@ui/timeOff/PhonePunch';
import { AddToHome, LeaveCalendar, PayslipAsk, PayslipBundle } from './round58';

afterEach(cleanup);

function Cal({ loadMonth, single = false }) {
  const [v, setV] = useState({ from: '', to: '' });
  return (
    <>
      <LeaveCalendar from={v.from} to={v.to} single={single} today="2026-11-18" loadMonth={loadMonth} onChange={setV} />
      <output data-testid="span">{`${v.from}|${v.to}`}</output>
    </>
  );
}

describe('round 58: leave calendar (phonedate A, rangetap A)', () => {
  it('marks holidays and weekly offs, and two taps choose the span', async () => {
    const loadMonth = vi.fn(() => Promise.resolve({ days: [
      { date: '2026-11-08', kind: 'OFF' },
      { date: '2026-11-11', kind: 'HOLIDAY', holiday: 'Diwali' },
      { date: '2026-11-12', kind: 'WORK' },
    ] }));
    render(<Cal loadMonth={loadMonth} />);
    expect(loadMonth).toHaveBeenCalledWith('2026-11');
    const diwali = await screen.findByRole('button', { name: /11 November, holiday: Diwali/ });
    expect(diwali.dataset.mark).toBe('holiday');
    expect(screen.getByRole('button', { name: /8 November, weekly off/ }).dataset.mark).toBe('off');
    expect(screen.getByText('11 Diwali')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Monday, 9 November/ }));
    expect(screen.getByTestId('span').textContent).toBe('2026-11-09|');
    fireEvent.click(screen.getByRole('button', { name: /^Thursday, 12 November/ }));
    expect(screen.getByTestId('span').textContent).toBe('2026-11-09|2026-11-12');
    expect(screen.getByRole('button', { name: /^Tuesday, 10 November/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /^Friday, 13 November/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('moves between months and still picks dates when the schedule cannot load', async () => {
    render(<Cal loadMonth={() => { throw new Error('offline'); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('December 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Friday, 4 December/ }));
    expect(screen.getByTestId('span').textContent).toBe('2026-12-04|');
  });
});

describe('round 58: payslips (payslipquery A, payslipbundle A)', () => {
  const slip = { period: 'Oct 2026', number: 'PS-10', earnings: [{ name: 'Basic', amount: 20000 }, { name: 'Overtime', amount: 0 }], deductions: [{ name: 'PF', amount: 1800 }] };

  it('asks HR about one line, with the month in the question', () => {
    const onAsk = vi.fn();
    render(<PayslipAsk slip={slip} onAsk={onAsk} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this payslip' }));
    fireEvent.change(screen.getByLabelText('Which line?'), { target: { value: 'Overtime' } });
    fireEvent.change(screen.getByLabelText('What looks wrong?'), { target: { value: 'My 6 hours of overtime are missing.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask HR' }));
    expect(onAsk).toHaveBeenCalledWith({ category: 'PAYROLL', subject: 'Payslip Oct 2026: Overtime', description: 'About my payslip for Oct 2026 (PS-10), Overtime: My 6 hours of overtime are missing.' });
  });

  it('shows no ask where Ask HR is off', () => {
    render(<PayslipAsk slip={slip} onAsk={null} />);
    expect(screen.queryByRole('button', { name: 'Ask about this payslip' })).toBeNull();
  });

  it('puts the last six payslips together and opens the print dialog once', async () => {
    const slips = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, period: `P${i}` }));
    const load = vi.fn((id) => Promise.resolve({ slip: { ...slip, period: id, employee: { code: 'E1' }, gross: 1, totalDeductions: 0, net: 1 } }));
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PayslipBundle slips={slips} load={load} />);
    expect(screen.getByRole('radio', { name: 'Last 6' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save as one PDF' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(6));
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.clor-slip-bundle section')).toHaveLength(6);
    vi.useRealTimers();
    print.mockRestore();
  });
});

describe('round 58: add to home screen (installapp A)', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
  it('waits for the browser to offer an install, and Not now hides it for good', async () => {
    localStorage.setItem('clor.portal.visits', '3');
    vi.resetModules();
    const { AddToHome: Fresh } = await import('./round58');
    render(<Fresh />);
    expect(screen.queryByRole('region', { name: 'Add CLOR to your home screen' })).toBeNull();
    const e = new Event('beforeinstallprompt');
    e.prompt = vi.fn();
    e.userChoice = Promise.resolve({ outcome: 'dismissed' });
    act(() => { window.dispatchEvent(e); });
    expect(await screen.findByRole('region', { name: 'Add CLOR to your home screen' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region', { name: 'Add CLOR to your home screen' })).toBeNull();
    expect(localStorage.getItem('clor.portal.noInstall')).toBe('1');
  });

  it('says nothing on the first visit', () => {
    render(<AddToHome />);
    expect(screen.queryByText('Add CLOR to your home screen')).toBeNull();
  });
});

describe('round 58: punching (outsidearea A, punchdone A)', () => {
  const site = { name: 'Chennai office', latitude: 13.0, longitude: 80.0, radiusMeters: 200 };
  const geo = (lat, lon) => {
    const g = { getCurrentPosition: vi.fn((ok) => ok({ coords: { latitude: lat, longitude: lon, accuracy: 10 } })), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() };
    Object.defineProperty(navigator, 'geolocation', { value: g, configurable: true });
  };

  it('outside the site: says how far and the allowed distance, with Try again and Punch with a reason', async () => {
    geo(13.0029, 80.0); /* about 320 m north */
    const onAskInstead = vi.fn();
    render(<PhonePunch phone={{ allowed: true, mode: 'SITE', next: 'IN', sites: [site] }} onPunch={vi.fn()} onAskInstead={onAskInstead} />);
    fireEvent.click(screen.getByRole('button', { name: /Share my location to punch/ }));
    const box = await screen.findByRole('alert');
    expect(box.textContent).toMatch(/You are 32\d m from Chennai office \(allowed 200 m\)/);
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Punch with a reason' }));
    expect(onAskInstead).toHaveBeenCalledWith(expect.objectContaining({ kind: 'IN', site: 'Chennai office' }));
  });

  it('a field worker sees no outside box', async () => {
    geo(13.0029, 80.0);
    render(<PhonePunch phone={{ allowed: true, mode: 'FIELD', next: 'IN', sites: [site] }} onPunch={vi.fn()} onAskInstead={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Share my location to punch/ }));
    await screen.findByText(/Accurate to about/);
    expect(screen.queryByRole('button', { name: 'Punch with a reason' })).toBeNull();
  });

  it('after a punch, a full tick screen that goes by itself in 3 seconds', async () => {
    geo(13.0, 80.0);
    const onPunch = vi.fn(() => Promise.resolve({ kind: 'IN', time: '09:42', site: 'Chennai office' }));
    render(<PhonePunch phone={{ allowed: true, mode: 'SITE', next: 'IN', sites: [site] }} onPunch={onPunch} shiftStart="09:30" />);
    fireEvent.click(screen.getByRole('button', { name: /Share my location to punch/ }));
    await screen.findByText(/Accurate to about/);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole('button', { name: /Punch in now/ }));
    expect(await screen.findByText('In at 9:42 AM')).toBeTruthy();
    expect(screen.getByText('Chennai office · Shift 9:30 AM')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(3100); });
    expect(screen.queryByText('In at 9:42 AM')).toBeNull();
    vi.useRealTimers();
  });
});
