/**
 * A money field with "INR" after the amount (owner's style pick, 17 Nov 2026). Every prop goes to the
 * input itself, so it drops in where a plain `<input inputMode="decimal">` was. The figure stays
 * right-aligned in tabular figures. "INR" is drawn by CSS (`.ui-money-field::after`) so it never joins
 * the text of a label wrapped round the field. Books has its own amount fields and does not use this.
 */
export default function MoneyInput({ className = '', wrapClassName = '', ...props }) {
  return (
    <span className={`ui-money-field ${wrapClassName}`}>
      <input inputMode="decimal" {...props} className={`ui-input ${className} ui-money-input`} />
    </span>
  );
}
