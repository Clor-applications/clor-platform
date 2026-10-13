import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { useDocumentFormKeys } from './useDocumentFormKeys';

/** A document in miniature: a head, and a two-row line grid. */
const Doc = ({ inDialog = false }) => {
  const formRef = useRef(null);
  const [lines, setLines] = useState([0, 1]);
  // The hook returns the handler itself, not an object holding one. Getting
  // that wrong wires nothing, and the tests then pass on jsdom's own defaults.
  const onKeyDown = useDocumentFormKeys({
    formRef,
    lineCount: lines.length,
    addLine: () => setLines((p) => p.concat(p.length)),
  });
  const form = (
    <form ref={formRef} onKeyDown={onKeyDown} onSubmit={(e) => e.preventDefault()}>
      <input aria-label="ref" defaultValue="abc" />
      <input aria-label="date" type="date" defaultValue="2026-01-01" />
      <input aria-label="terms" defaultValue="net30" />
      <table>
        <tbody>
          {lines.map((n) => (
            <tr key={n} data-line-row={n}>
              <td><input aria-label={`desc-${n}`} defaultValue="" /></td>
              <td><input aria-label={`qty-${n}`} defaultValue="" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </form>
  );
  return inDialog ? <div role="dialog">{form}</div> : form;
};

const at = (name) => screen.getByLabelText(name);

describe('document form keyboard', () => {
  /*
   * jsdom has no date-segment behaviour to override — a plain Tab already
   * leaves the field there — so asserting only on where focus lands would pass
   * with this feature deleted. What is actually claimed is that the handler
   * takes the key over, so that is what is asserted: the default is prevented,
   * and focus is placed deliberately.
   */
  it('Tab leaves a date field in one press, by taking the key over', () => {
    render(<Doc />);
    const date = at('date');
    date.focus();
    const notPrevented = fireEvent.keyDown(date, { key: 'Tab' });
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(at('terms'));
  });

  it('Shift+Tab leaves a date field backwards in one press', () => {
    render(<Doc />);
    const date = at('date');
    date.focus();
    const notPrevented = fireEvent.keyDown(date, { key: 'Tab', shiftKey: true });
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(at('ref'));
  });

  it('form keys still work when the form IS the dialog', () => {
    render(<Doc inDialog />);
    const date = at('date');
    date.focus();
    // The regression this guards: a check meant to stand down under a popup
    // read the form's own modal frame as a popup and killed every key.
    const notPrevented = fireEvent.keyDown(date, { key: 'Tab' });
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(at('terms'));
  });

  it('ArrowDown moves to the next field in the head', async () => {
    const user = userEvent.setup();
    render(<Doc />);
    at('ref').focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(at('date'));
  });

  it('ArrowUp moves back', async () => {
    const user = userEvent.setup();
    render(<Doc />);
    at('terms').focus();
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(at('date'));
  });

  it('ArrowDown in the grid walks the same column, not the next cell', async () => {
    const user = userEvent.setup();
    render(<Doc />);
    at('qty-0').focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(at('qty-1'));
  });

  it('ArrowRight stays put while the caret is inside the text', async () => {
    const user = userEvent.setup();
    render(<Doc />);
    const ref = at('ref');
    ref.focus();
    ref.setSelectionRange(0, 0);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(ref);
  });

  it('ArrowRight leaves once the caret is at the end', async () => {
    const user = userEvent.setup();
    render(<Doc />);
    const ref = at('ref');
    ref.focus();
    ref.setSelectionRange(3, 3);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(at('date'));
  });
});
