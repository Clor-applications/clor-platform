import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useScreenUrl } from './useScreenUrl';

/**
 * The screen, in the address bar.
 *
 * It has never been there: which screen you are on lived in one piece of state,
 * so a reload dropped you on Home, Back left the product, and there was no way
 * to send anybody a link to anything.
 */

const KNOWN = new Set(['dashboard', 'invoices', 'bills', 'settingsTax']);

const App = ({ start = 'dashboard' }) => {
  const [active, setActive] = useState(start);
  useScreenUrl({ active, setActive, isKnown: (k) => KNOWN.has(k) });
  return (
    <div>
      <span data-testid="screen">{active}</span>
      <button type="button" onClick={() => setActive('bills')}>
        go to bills
      </button>
    </div>
  );
};

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('opening a link', () => {
  it('lands on the screen the link names', () => {
    window.history.replaceState(null, '', '#/invoices');
    render(<App />);
    expect(screen.getByTestId('screen').textContent).toBe('invoices');
  });

  it('ignores a screen that does not exist', () => {
    /* The switch's default is the sales overview, so a typo in a link would
       otherwise show somebody a page they did not ask for and no error. */
    window.history.replaceState(null, '', '#/invoicez');
    render(<App />);
    expect(screen.getByTestId('screen').textContent).toBe('dashboard');
  });
});

describe('moving about', () => {
  it('writes the screen into the address bar', () => {
    render(<App />);
    act(() => {
      screen.getByText('go to bills').click();
    });
    expect(window.location.hash).toBe('#/bills');
  });

  it('follows Back', () => {
    render(<App />);
    act(() => {
      screen.getByText('go to bills').click();
    });
    expect(screen.getByTestId('screen').textContent).toBe('bills');

    act(() => {
      window.history.replaceState(null, '', '#/invoices');
      window.dispatchEvent(new Event('popstate'));
    });
    expect(screen.getByTestId('screen').textContent).toBe('invoices');
  });

  it('does not push the screen it was just told to show', () => {
    window.history.replaceState(null, '', '#/settingsTax');
    render(<App />);
    expect(screen.getByTestId('screen').textContent).toBe('settingsTax');
    /* Reading the hash then writing it back would put a second copy of the same
       screen in the history, and one Back press would look like none. */
    expect(window.location.hash).toBe('#/settingsTax');
  });
});
