import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDocumentFormKeys } from './useDocumentFormKeys';
import useGlobalShortcuts from './useGlobalShortcuts';
import { GROUPS } from './ShortcutSheet';

/**
 * The keys an accounts clerk in this country already has in their fingers.
 *
 * They learned them in Tally, and they are held in the hands rather than in the
 * head — F6 is a receipt, and somebody reaches for it before deciding to.
 */

const Shell = ({ actions }) => {
  useGlobalShortcuts(actions);
  return <div>shell</div>;
};

describe("Tally's voucher keys", () => {
  const press = (key) => fireEvent.keyDown(window, { key });

  it('raises the voucher each one means', () => {
    const calls = [];
    render(
      <Shell
        actions={{
          newInvoice: () => calls.push('invoice'),
          newBill: () => calls.push('bill'),
          newReceipt: () => calls.push('receipt'),
          newJournal: () => calls.push('journal'),
          contra: () => calls.push('contra'),
        }}
      />
    );
    press('F8');
    press('F9');
    press('F6');
    press('F7');
    press('F4');
    expect(calls).toEqual(['invoice', 'bill', 'receipt', 'journal', 'contra']);
  });

  it('leaves the browser its own keys', () => {
    const calls = [];
    render(<Shell actions={{ newPayment: () => calls.push('payment') }} />);
    /* F5 reloads the page. Taking it from somebody who meant to reload is a
       worse trade than a payment voucher is worth. */
    press('F5');
    expect(calls).toEqual([]);
  });

  it('does not fire out from under a picker', () => {
    const calls = [];
    render(
      <>
        <Shell actions={{ newInvoice: () => calls.push('invoice') }} />
        <div role="listbox">
          <input aria-label="inside a picker" />
        </div>
      </>
    );
    screen.getByLabelText('inside a picker').focus();
    press('F8');
    expect(calls).toEqual([]);
  });
});

const Doc = ({ onSave, removeLine, onCancel }) => {
  const formRef = useRef(null);
  const [lines] = useState([0, 1]);
  const onKeyDown = useDocumentFormKeys({ formRef, lineCount: lines.length, addLine: () => {}, removeLine, onSave, onCancel });
  return (
    <form ref={formRef} onKeyDown={onKeyDown} onSubmit={(e) => e.preventDefault()}>
      <input aria-label="ref" defaultValue="abc" />
      <table>
        <tbody>
          {lines.map((n) => (
            <tr key={n} data-line-row={n}>
              <td><input aria-label={`qty-${n}`} defaultValue="1" /></td>
              <td><input type="checkbox" aria-label={`tick-${n}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </form>
  );
};

describe('the keys inside a voucher', () => {
  it('accepts on Ctrl+A where there is nothing to select', () => {
    const onSave = vi.fn();
    render(<Doc onSave={onSave} removeLine={() => {}} />);
    const tick = screen.getByLabelText('tick-0');
    tick.focus();
    fireEvent.keyDown(tick, { key: 'a', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('still selects the text when Ctrl+A is pressed in a field', () => {
    const onSave = vi.fn();
    render(<Doc onSave={onSave} removeLine={() => {}} />);
    const field = screen.getByLabelText('ref');
    field.focus();
    fireEvent.keyDown(field, { key: 'a', ctrlKey: true });
    /* A narration being selected is what somebody pressing it there meant. */
    expect(onSave).not.toHaveBeenCalled();
  });

  it('removes the line the cursor is on with Alt+D', () => {
    const removeLine = vi.fn();
    render(<Doc onSave={() => {}} removeLine={removeLine} />);
    const cell = screen.getByLabelText('qty-1');
    cell.focus();
    fireEvent.keyDown(cell, { key: 'd', altKey: true });
    expect(removeLine).toHaveBeenCalledWith(1);
  });

  it('leaves the voucher on Escape', () => {
    const onCancel = vi.fn();
    render(<Doc onSave={() => {}} removeLine={() => {}} onCancel={onCancel} />);
    const field = screen.getByLabelText('ref');
    field.focus();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('the sheet keeps up with them', () => {
  it('names the voucher keys it now answers to', () => {
    const vouchers = GROUPS.find((g) => g.name === 'Vouchers');
    expect(vouchers).toBeTruthy();
    const combos = vouchers.keys.map((k) => k.combo.join('+'));
    expect(combos).toEqual(expect.arrayContaining(['F8', 'F9', 'F6', 'F7', 'F4']));
    /* And says where the payment went, rather than leaving F5 unexplained. */
    expect(vouchers.keys.some((k) => /F5 belongs to the browser/.test(k.does))).toBe(true);
  });
});
