import React, { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';

import Popover from './Popover';

/**
 * Which edge holds the panel.
 *
 * A panel that opens downward is held by its top: it hangs off the control and
 * grows down into empty page. A panel that flipped above must be held by its
 * BOTTOM, because its height is not fixed — the list filters as you type — and
 * one held by the top grows and shrinks downward, away from the field. Typing
 * a letter into an item field near the foot of the page used to cut the list
 * from four rows to one and strand it 187px above the box.
 *
 * jsdom has no layout, so the geometry is supplied: what is under test is the
 * decision, not the browser's arithmetic.
 */

const place = (anchor) => {
  Element.prototype.getBoundingClientRect = function rect() {
    if (this.dataset?.anchor === 'yes') return { ...anchor, x: anchor.left, y: anchor.top, toJSON() {} };
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
  };
};

const Host = ({ children }) => {
  const ref = useRef(null);
  return (
    <>
      <button type="button" ref={ref} data-anchor="yes">open</button>
      <Popover anchorRef={ref} onClose={() => {}} autoFocus={false}>{children}</Popover>
    </>
  );
};

const panel = () => screen.getByRole('dialog');

beforeEach(() => {
  window.innerHeight = 800;
  window.innerWidth = 1280;
  /* A list taller than either side has room for, so the flip is decided by the
     room available and not by the panel happening to be small. */
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 600 });
});

describe('a panel with room below it', () => {
  it('hangs from its top, under the control', () => {
    place({ top: 100, bottom: 136, left: 40, right: 300, width: 260, height: 36 });
    render(<Host>rows</Host>);
    const style = panel().style;
    expect(style.top).not.toBe('');
    expect(style.bottom).toBe('');
  });
});

describe('a panel with no room below it', () => {
  it('is held by its bottom, so it stays against the control as it resizes', () => {
    /* 60px under the control, 700 above it: it has to flip. */
    place({ top: 700, bottom: 740, left: 40, right: 300, width: 260, height: 40 });
    render(<Host>rows</Host>);
    const style = panel().style;
    expect(style.bottom).not.toBe('');
    expect(style.top).toBe('');
  });

  it('sits the gap above the control, measured from the window bottom', () => {
    place({ top: 700, bottom: 740, left: 40, right: 300, width: 260, height: 40 });
    render(<Host>rows</Host>);
    /* 800 - 700 + 6 = 106: the panel's bottom edge is 6px above the control. */
    expect(panel().style.bottom).toBe('106px');
  });
});
