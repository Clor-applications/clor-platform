import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import StatutoryDues, { nextDues } from './StatutoryDues';
import { useStrongText } from '@ui/components/ui/useStrongText';

/* Round 50 picks (18 Nov 2026): next statutory dues, stronger text. */

describe('next statutory dues', () => {
  it('lists the next five from today, soonest first', () => {
    const d = nextDues('2026-11-18');
    expect(d).toHaveLength(5);
    expect(d.map((x) => x.date)).toEqual(['2026-12-07', '2026-12-15', '2026-12-15', '2027-01-07', '2027-01-15']);
    expect(d[0].what).toBe('TDS deposit for Nov 2026');
    expect(d.map((x) => x.what)).toContain('PF return and payment for Nov 2026');
  });
  it('keeps a due that falls today, and March TDS by 30 April', () => {
    expect(nextDues('2026-12-07')[0]).toMatchObject({ date: '2026-12-07', what: 'TDS deposit for Nov 2026' });
    const april = nextDues('2027-04-08', 3);
    expect(april.map((x) => x.what)).toEqual(['PF return and payment for Mar 2027', 'ESI contribution for Mar 2027', 'TDS deposit for Mar 2027']);
    expect(april[2].date).toBe('2027-04-30');
  });
  it('brings in the quarterly TDS return and Form 16', () => {
    expect(nextDues('2027-05-20', 5).map((x) => x.what)).toContain('TDS return (24Q), January to March');
    expect(nextDues('2027-06-08', 5).map((x) => x.what)).toContain('Form 16 to every employee');
  });
  it('says how many days are left', () => {
    render(<StatutoryDues today="2026-12-06" />);
    expect(screen.getByRole('heading', { name: 'Next dues' })).toBeInTheDocument();
    expect(screen.getByText('Tomorrow')).toBeInTheDocument();
    expect(screen.getByText(/differ by state/)).toBeInTheDocument();
  });
});

describe('stronger text', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-contrast');
    localStorage.removeItem('uiStrongText');
  });
  it('turns on and off, and is remembered', () => {
    const { result } = renderHook(() => useStrongText());
    expect(result.current.on).toBe(false);
    act(() => result.current.toggle());
    expect(document.documentElement.dataset.contrast).toBe('strong');
    expect(localStorage.getItem('uiStrongText')).toBe('on');
    act(() => result.current.toggle());
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false);
    expect(localStorage.getItem('uiStrongText')).toBeNull();
  });
});
