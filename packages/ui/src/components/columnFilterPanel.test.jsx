import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ColumnHeader, useColumnFilters } from './ColumnFilters';
import { formatDateIn, parseDateIn } from '../utils/dates';

/**
 * The filter panel belongs under the heading it filters.
 *
 * It used to place itself at `min(anchorBottom + 6, viewportHeight - 460)` — a
 * fixed 460px reservation subtracted whether the panel needed it or not. On any
 * table more than half-way down the page that second term won, and the panel
 * was pulled UP over the column headings, covering the filters somebody was
 * reading.
 */

const Host = ({ values = ['Alpha Traders', 'Beta Supplies'] }) => {
  const state = useColumnFilters();
  return (
    <table>
      <thead>
        <tr>
          <ColumnHeader label="Party" col="name" state={{ ...state, valuesFor: () => values }} />
        </tr>
      </thead>
      <tbody><tr><td>x</td></tr></tbody>
    </table>
  );
};

const openPanel = async (user) => {
  await user.click(screen.getByRole('button', { name: /Sort and filter/ }));
  return screen.getByRole('dialog');
};

describe('where the panel sits', () => {
  it('opens below the heading when there is room', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const panel = await openPanel(user);

    /* jsdom reports a zero-sized anchor, so "below" is the top of the page —
       what matters is that it is not pushed off-screen or negative. */
    const top = Number.parseFloat(panel.style.top);
    expect(Number.isFinite(top)).toBe(true);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  /* The bug: a short viewport used to drag the panel up over the header. */
  it('never places itself above the top of the window', async () => {
    const user = userEvent.setup();
    window.innerHeight = 500;
    render(<Host />);
    const panel = await openPanel(user);

    expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(8);
  });

  it('is capped to the space it has, and scrolls inside', async () => {
    const user = userEvent.setup();
    window.innerHeight = 500;
    render(<Host values={Array.from({ length: 60 }, (_, i) => `Party ${i}`)} />);
    const panel = await openPanel(user);

    const maxHeight = Number.parseFloat(panel.style.maxHeight);
    expect(maxHeight).toBeLessThanOrEqual(500);
    expect(panel.querySelector('.overflow-y-auto')).toBeTruthy();
  });
});

describe('how a date reads', () => {
  it('is written the way this country writes it', () => {
    expect(formatDateIn('2026-09-12')).toBe('12/09/2026');
    expect(formatDateIn('')).toBe('');
    /* Anything that is not a date passes through rather than becoming NaN. */
    expect(formatDateIn('not a date')).toBe('not a date');
  });

  it('reads back the same way round', () => {
    expect(parseDateIn('12/09/2026')).toBe('2026-09-12');
    expect(parseDateIn('2/9/2026')).toBe('2026-09-02');
    expect(parseDateIn('2026-09-12')).toBe('2026-09-12');
    expect(parseDateIn('rubbish')).toBe('');
  });
});
