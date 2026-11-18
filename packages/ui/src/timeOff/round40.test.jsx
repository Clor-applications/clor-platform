import React from 'react';
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import EarlyGoTag, { earlyGoText } from './EarlyGoTag';
import ListHeader, { titleWithCount } from '../components/list/ListHeader';

describe('round 40: early-go tag', () => {
  it('words the minutes like a person would', () => {
    expect(earlyGoText(0)).toBe('');
    expect(earlyGoText(null)).toBe('');
    expect(earlyGoText(40)).toBe('Left 40 min early');
    expect(earlyGoText(120)).toBe('Left 2h early');
    expect(earlyGoText(80)).toBe('Left 1h 20m early');
  });
  it('draws nothing for a full day and a tag otherwise', () => {
    const { container, rerender } = render(<EarlyGoTag minutes={0} />);
    expect(container.textContent).toBe('');
    rerender(<EarlyGoTag minutes={120} />);
    expect(screen.getByText('Left 2h early')).toHaveClass('ui-late-tag', 'ui-early-tag');
  });
});

describe('round 40: count in the list title', () => {
  afterEach(() => { delete document.documentElement.dataset.palette; });
  it('adds the matching count to the title', () => {
    render(<ListHeader title="Employees" count={6} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Employees (6)');
  });
  it('leaves the title alone until the count is known', () => {
    render(<ListHeader title="Employees" count={null} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Employees$/);
  });
  it('groups big numbers the Indian way', () => {
    render(<>{titleWithCount('Employees', 120000)}</>);
    expect(screen.getByText('(1,20,000)')).toBeInTheDocument();
  });
  it('keeps Books plain', () => {
    document.documentElement.dataset.palette = 'indigo';
    expect(titleWithCount('Bills', 6)).toBe('Bills');
  });
});
