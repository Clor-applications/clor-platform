import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PartsRing, ViewSwitch } from './FigureViews';

/* Two ways to show a few figures without four tiles (owner, 22 Nov 2026, styles E and H). */
describe('PartsRing', () => {
  it('names every part beside the ring, leaves out noughts, and lifts the part pointed at', () => {
    const { container } = render(
      <PartsRing
        label="The day"
        total={10}
        middle="60%"
        middleWords="6 of 10 in"
        parts={[
          { key: 'onTime', label: 'In on time', value: 4, tone: 'pos' },
          { key: 'late', label: 'In late', value: 2, tone: 'warn' },
          { key: 'absent', label: 'Absent', value: 0, tone: 'neg' },
          { key: 'rest', label: 'Not in yet', value: 4, tone: 'none' },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'The day: 4 in on time, 2 in late, 4 not in yet' })).toBeTruthy();
    expect(screen.queryByText('Absent')).toBeNull();
    expect(container.querySelectorAll('.ui-ring-arc')).toHaveLength(3);
    fireEvent.pointerEnter(screen.getByText('In late').closest('li'));
    expect(container.querySelector('.ui-ring-arc[data-tone="warn"]').getAttribute('data-lit')).toBe('true');
    expect(container.querySelector('.ui-ring-arc[data-tone="pos"]').getAttribute('data-dim')).toBe('true');
  });
});

describe('ViewSwitch', () => {
  const views = [
    { key: 'cost', label: 'Company pays', value: '₹3,00,000', note: 'Up 5% on October', points: [{ key: 'a', label: 'Oct', value: 100, words: '₹1' }, { key: 'b', label: 'Nov', value: 300, words: '₹3,00,000' }] },
    { key: 'people', label: 'People', value: '12 people', points: [{ key: 'a', label: 'Oct', value: 10, words: '10 people' }, { key: 'b', label: 'Nov', value: 12, words: '12 people' }] },
  ];
  it('switches the figure and the columns, and draws the newest strong', () => {
    render(<ViewSwitch label="Show" views={views} />);
    expect(screen.getByRole('button', { name: /Company pays/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Up 5% on October')).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Nov: ₹3,00,000' }).getAttribute('data-now')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /People/ }));
    expect(screen.getByRole('button', { name: /People/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('listitem', { name: 'Oct: 10 people' })).toBeTruthy();
    expect(screen.queryByText('Up 5% on October')).toBeNull();
  });
});
