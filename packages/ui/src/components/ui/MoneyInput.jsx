import { useLayoutEffect, useRef } from 'react';
import { caretAfterDigits, indianDigits, rawDigits } from '../../picks/round56';

/**
 * A money field with "INR" after the amount (owner's style pick, 17 Nov 2026). Every prop goes to the
 * input itself, so it drops in where a plain `<input inputMode="decimal">` was. The figure stays
 * right-aligned in tabular figures. "INR" is drawn by CSS (`.ui-money-field::after`) so it never joins
 * the text of a label wrapped round the field. Books has its own amount fields and does not use this.
 *
 * Round 56 (amounttyping A): the commas appear as the amount is typed, in the Indian grouping
 * (12,50,000), so a missed zero shows. The screen still gets plain digits ("1250000") in `onChange`,
 * exactly as before, and the caret stays after the digit just typed. A field the screen does not
 * control (`defaultValue`, read from the form) is left as typed.
 */
export default function MoneyInput({ className = '', wrapClassName = '', type, value, onChange, ...props }) {
  const ref = useRef(null);
  const caret = useRef(null);
  const controlled = value !== undefined && typeof onChange === 'function';
  const shown = controlled ? indianDigits(rawDigits(value)) : value;

  useLayoutEffect(() => {
    const el = ref.current;
    if (caret.current == null || !el || document.activeElement !== el) return;
    const at = caretAfterDigits(el.value, caret.current);
    caret.current = null;
    try { el.setSelectionRange(at, at); } catch { /* no caret */ }
  });

  const change = (e) => {
    if (!controlled) return onChange?.(e);
    const el = e.target;
    const typed = el.value;
    const raw = rawDigits(typed).trim();
    /* Only a number takes commas; anything else is refused as the old number field refused it. */
    if (raw && !/^-?\d*\.?\d*$/.test(raw)) return undefined;
    const before = typed.slice(0, el.selectionStart ?? typed.length).replace(/[^\d.-]/g, '').length;
    caret.current = before;
    /* The screen reads `e.target.value`: it gets the plain digits; every other read is the field's own. */
    const target = new Proxy(el, {
      get: (t, k) => {
        if (k === 'value') return raw;
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const ev = Object.create(e, { target: { value: target }, currentTarget: { value: target } });
    return onChange(ev);
  };

  return (
    <span className={`ui-money-field ${wrapClassName}`}>
      <input
        ref={ref}
        inputMode="decimal"
        {...props}
        type={controlled ? 'text' : type}
        value={shown}
        onChange={change}
        className={`ui-input ${className} ui-money-input`}
      />
    </span>
  );
}
