import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WeekPicker, { weekLabel, mondayOf } from './WeekPicker';

describe('WeekPicker', () => {
  it('names weeks Monday to Sunday', () => {
    expect(mondayOf('2026-11-19')).toBe('2026-11-16');
    expect(weekLabel('2026-11-19')).toBe('16 – 22 Nov 2026');
    expect(weekLabel('2026-12-30')).toBe('28 Dec 2026 – 3 Jan 2027');
    expect(weekLabel('2026-11-30')).toBe('30 Nov – 6 Dec 2026');
  });
  it('opens a month of weeks and takes the one clicked', () => {
    const onChange = vi.fn();
    render(<WeekPicker value="2026-11-19" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Week: 16 – 22 Nov 2026' }));
    expect(screen.getByRole('button', { name: '16 – 22 Nov 2026' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '23 – 29 Nov 2026' }));
    expect(onChange).toHaveBeenCalledWith('2026-11-23');
  });
});
