import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useListKeys } from './useListKeys';

/**
 * Walking a list from the keyboard.
 *
 * Every other part of the product answers to the keys and the lists did not: to
 * open the third invoice you left the keyboard, found it with a mouse, and came
 * back.
 */

class StubResizeObserver {
  observe() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || StubResizeObserver;

const List = ({ onOpen, rows = 3 }) => {
  useListKeys(0);
  return (
    <main id="main-content">
      <div className="ui-table-scroll">
        <table>
          <tbody>
            {Array.from({ length: rows }, (_, i) => (
              <tr key={i} data-testid={`row-${i}`} onClick={() => onOpen(i)}>
                <td>Doc {i}</td>
                <td>
                  <input aria-label={`tick-${i}`} type="checkbox" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
};

/* jsdom reports every element as unrendered; the hook skips those. */
const makeVisible = () =>
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);

const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

afterEach(() => vi.restoreAllMocks());

describe('the arrows move a row at a time', () => {
  it('gives the table one tab stop, not one per row', async () => {
    makeVisible();
    const { getByTestId } = render(<List onOpen={() => {}} />);
    await settle();
    expect(getByTestId('row-0').tabIndex).toBe(0);
    expect(getByTestId('row-1').tabIndex).toBe(-1);
    expect(getByTestId('row-2').tabIndex).toBe(-1);
  });

  it('walks down and back up', async () => {
    makeVisible();
    const { getByTestId } = render(<List onOpen={() => {}} />);
    await settle();
    const first = getByTestId('row-0');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getByTestId('row-1'));
    fireEvent.keyDown(getByTestId('row-1'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
  });

  it('stops at the ends rather than wrapping', async () => {
    makeVisible();
    const { getByTestId } = render(<List onOpen={() => {}} />);
    await settle();
    const first = getByTestId('row-0');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement).toBe(getByTestId('row-2'));
    fireEvent.keyDown(getByTestId('row-2'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getByTestId('row-2'));
  });
});

describe('Enter opens the row', () => {
  it('does exactly what clicking it does', async () => {
    makeVisible();
    const onOpen = vi.fn();
    const { getByTestId } = render(<List onOpen={onOpen} />);
    await settle();
    const row = getByTestId('row-1');
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(1);
  });
});

describe('a control inside a row keeps its own keys', () => {
  it('leaves the tick box alone', async () => {
    makeVisible();
    const onOpen = vi.fn();
    const { getByLabelText, getByTestId } = render(<List onOpen={onOpen} />);
    await settle();
    const tick = getByLabelText('tick-0');
    tick.focus();
    /* Down here belongs to nothing in particular, but it must not steal focus
       out of the control the caret is in. */
    fireEvent.keyDown(tick, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(tick);
    fireEvent.keyDown(tick, { key: 'Enter' });
    expect(onOpen).not.toHaveBeenCalled();
    expect(getByTestId('row-0')).toBeTruthy();
  });
});
