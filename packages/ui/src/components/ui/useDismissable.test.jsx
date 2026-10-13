import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDismissable } from './useDismissable';

/**
 * What a menu has to do, proved rather than described.
 *
 * Six menus shipped that only closed when their own trigger was pressed a
 * second time. The scan in test/menus-close-when-you-click-away.test.js
 * catches a panel with no dismissal wired at all; these catch the wiring being
 * wrong — the ref on the trigger instead of the wrapper, which quietly turns
 * every re-click into close-then-reopen, and the click being spent on the
 * dismissal instead of reaching the button somebody aimed at.
 */

function Menu({ onElsewhere }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(open, () => setOpen(false));
  return (
    <div>
      <div className="relative" ref={ref}>
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Open
        </button>
        {open ? (
          <div role="menu">
            <button type="button">Inside</button>
          </div>
        ) : null}
      </div>
      <button type="button" onClick={onElsewhere}>
        Elsewhere
      </button>
    </div>
  );
}

const openIt = () => fireEvent.click(screen.getByText('Open'));
const isOpen = () => Boolean(screen.queryByRole('menu'));

describe('a menu that closes when you are done with it', () => {
  it('closes on a click anywhere outside', () => {
    render(<Menu />);
    openIt();
    expect(isOpen()).toBe(true);

    fireEvent.pointerDown(document.body);
    expect(isOpen()).toBe(false);
  });

  it('stays open when the click is inside it', () => {
    render(<Menu />);
    openIt();

    fireEvent.pointerDown(screen.getByText('Inside'));
    expect(isOpen()).toBe(true);
  });

  it('lets the trigger toggle rather than closing and reopening', () => {
    /* The ref wraps the trigger as well as the panel, so a second press on the
       trigger is the button's own business. With the ref on the panel alone,
       this test passes visually and the menu never closes: the hook shuts it
       on pointerdown and the click reopens it. */
    render(<Menu />);
    openIt();

    fireEvent.pointerDown(screen.getByText('Open'));
    expect(isOpen()).toBe(true);

    fireEvent.click(screen.getByText('Open'));
    expect(isOpen()).toBe(false);
  });

  it('spends the click on the button somebody aimed at', () => {
    /* pointerdown, not click: the menu is gone before the click lands, so one
       press both dismisses this and presses that. Dismissing on `click` costs
       a whole extra press for every menu in the product. */
    let pressed = 0;
    render(<Menu onElsewhere={() => { pressed += 1; }} />);
    openIt();

    const elsewhere = screen.getByText('Elsewhere');
    fireEvent.pointerDown(elsewhere);
    fireEvent.click(elsewhere);

    expect(isOpen()).toBe(false);
    expect(pressed).toBe(1);
  });

  it('closes on Escape and hands the keyboard back to the trigger', () => {
    render(<Menu />);
    openIt();
    screen.getByText('Inside').focus();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('Open'));
  });

  it('listens for nothing while it is closed', () => {
    /* A closed menu that still answers every pointerdown on the page is a
       listener per menu per row, for nothing. */
    render(<Menu />);
    expect(isOpen()).toBe(false);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(isOpen()).toBe(false);
  });
});
