import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Modal from './Modal';

/**
 * Closing is a state now, not an event.
 *
 * Surfaces used to unmount on the click, so they animated in over 200ms and
 * left in a single frame. The exit runs first and `onClose` fires on
 * animationend — which introduces the one failure worth a test: if that event
 * never arrives, or fires for a child's animation instead, the dialog either
 * never closes or closes before it has left.
 */

const open = (onClose) =>
  render(
    <Modal title="Test dialog" onClose={onClose}>
      <p>body</p>
    </Modal>
  );

const panel = () => screen.getByRole('dialog');

/* The exit is 140ms; the timer is the floor under `animationend`. */
const EXIT_MS = 140;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a dialog leaving', () => {
  it('does not close on the click itself', () => {
    const onClose = vi.fn();
    open(onClose);
    fireEvent.click(screen.getByLabelText('Close'));
    /* The exit is still playing; closing now would be the old hard cut. */
    expect(onClose).not.toHaveBeenCalled();
    expect(panel().className).toMatch(/ui-out/);
  });

  it('closes once the exit has had its time', () => {
    const onClose = vi.fn();
    open(onClose);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(EXIT_MS));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cannot be left open when no animation event ever arrives', () => {
    /* The reason the timer exists: jsdom has no animation engine, and neither
       does a browser that skipped the animation. Without this the dialog
       would be unclosable. */
    const onClose = vi.fn();
    open(onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on a child animation finishing', () => {
    /* Every form inside a dialog animates something. If those counted, the
       dialog would close while the user was still typing. */
    const onClose = vi.fn();
    open(onClose);
    fireEvent.animationEnd(screen.getByText('body'));
    act(() => vi.advanceTimersByTime(EXIT_MS));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves the same way when dismissed with Escape', () => {
    const onClose = vi.fn();
    open(onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    /* Escape used to close instantly while the button animated — three ways
       out of one dialog should not look like three different dialogs. */
    expect(onClose).not.toHaveBeenCalled();
    expect(panel().className).toMatch(/ui-out/);
    act(() => vi.advanceTimersByTime(EXIT_MS));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
