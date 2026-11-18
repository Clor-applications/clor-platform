import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import UnderEighteen, { ageOn, isUnderEighteen } from './UnderEighteen.jsx';

afterEach(() => { cleanup(); delete document.documentElement.dataset.palette; });

describe('round 31: under-18 joiner', () => {
  it('counts whole years, birthday not yet reached', () => {
    expect(ageOn('2009-03-04', '2026-11-18')).toBe(17);
    expect(ageOn('2008-11-18', '2026-11-18')).toBe(18);
    expect(ageOn('2008-11-19', '2026-11-18')).toBe(17);
    expect(ageOn('', '2026-11-18')).toBeNull();
  });

  it('flags only under-18', () => {
    expect(isUnderEighteen('2009-03-04', '2026-11-18')).toBe(true);
    expect(isUnderEighteen('1990-01-01', '2026-11-18')).toBe(false);
    expect(isUnderEighteen('2030-01-01', '2026-11-18')).toBe(false);
  });

  it('warns without blocking, and says nothing for adults', () => {
    const { rerender } = render(<UnderEighteen dob="2009-03-04" on="2026-11-18" />);
    expect(screen.getByRole('status')).toHaveTextContent('Under 18');
    expect(screen.getByRole('status')).toHaveTextContent('You can still add them.');
    rerender(<UnderEighteen dob="1990-01-01" on="2026-11-18" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stays out of Books', () => {
    document.documentElement.dataset.palette = 'indigo';
    render(<UnderEighteen dob="2009-03-04" on="2026-11-18" />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
