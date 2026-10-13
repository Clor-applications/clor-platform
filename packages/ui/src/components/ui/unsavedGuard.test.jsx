import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDocumentFormKeys } from './useDocumentFormKeys';

/**
 * Closing a tab half-way through a document.
 *
 * The guard was written and one form of twelve armed it: the invoice passed an
 * `isDirty` and every other document passed nothing, so a half-typed receipt, a
 * bill or a stock adjustment went without a word.
 */

const Doc = ({ isDirty }) => {
  const formRef = useRef(null);
  const onKeyDown = useDocumentFormKeys({ formRef, lineCount: 1, isDirty });
  return (
    <form ref={formRef} onKeyDown={onKeyDown} onSubmit={(e) => e.preventDefault()}>
      <input aria-label="narration" defaultValue="" />
      <button type="submit">Save</button>
    </form>
  );
};

/** What the browser would do: does anything cancel the unload? */
const closingTab = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

describe('a document that has been typed into', () => {
  it('says nothing when nothing has been typed', () => {
    render(<Doc />);
    expect(closingTab()).toBe(false);
  });

  it('warns once something has', () => {
    render(<Doc />);
    fireEvent.input(screen.getByLabelText('narration'), { target: { value: 'part payment' } });
    expect(closingTab()).toBe(true);
  });

  it('stops warning once it is saved', () => {
    render(<Doc />);
    fireEvent.input(screen.getByLabelText('narration'), { target: { value: 'part payment' } });
    fireEvent.click(screen.getByText('Save'));
    expect(closingTab()).toBe(false);
  });
});

describe('a form that knows better', () => {
  it('is believed over the typing', () => {
    /* The invoice opens with a generated number and today's date and does not
       count either as work; its own answer wins. */
    const isDirty = vi.fn(() => false);
    render(<Doc isDirty={isDirty} />);
    fireEvent.input(screen.getByLabelText('narration'), { target: { value: 'x' } });
    expect(closingTab()).toBe(false);
    expect(isDirty).toHaveBeenCalled();
  });

  it('and warns when it says there is work', () => {
    render(<Doc isDirty={() => true} />);
    expect(closingTab()).toBe(true);
  });
});
