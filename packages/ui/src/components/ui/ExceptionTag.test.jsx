import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExceptionTag, exceptionsFirst } from './ExceptionTag';

describe('ExceptionTag', () => {
  it('shows a tag for an exception', () => {
    render(<ExceptionTag label="No salary" normal="Active" />);
    expect(screen.getByText('No salary').className).toContain('ui-pill-warn');
    expect(screen.queryByText('Active')).toBeNull();
  });

  it('shows no tag for the expected state, and still says it to a screen reader', () => {
    const { container } = render(<ExceptionTag label="" normal="Active" />);
    expect(container.querySelector('.ui-pill')).toBeNull();
    expect(screen.getByText('Active').className).toBe('sr-only');
  });

  it('takes a quieter tone for a state that waits on nobody', () => {
    render(<ExceptionTag label="Left" tone="neutral" />);
    expect(screen.getByText('Left').className).toContain('ui-pill-neutral');
  });
});

describe('exceptionsFirst', () => {
  it('moves exceptions to the top and keeps the order otherwise', () => {
    const rows = [{ id: 1 }, { id: 2, bad: true }, { id: 3 }, { id: 4, bad: true }];
    expect(exceptionsFirst(rows, (r) => r.bad).map((r) => r.id)).toEqual([2, 4, 1, 3]);
  });

  it('returns the same list when nothing or everything is an exception', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(exceptionsFirst(rows, () => false)).toBe(rows);
    expect(exceptionsFirst(rows, () => true)).toBe(rows);
  });
});
