import React from "react";

/*
 * One figure: a label over a key amount (DESIGN.md "figure", 22/28 at 600).
 * No box, no tint, no coloured bar, and never shown at zero: a figure that
 * says nothing is left out, and a row of them with nothing left renders
 * nothing at all. Payroll had seven of these, each a little different.
 *
 * `value` is what is shown (already formatted); `raw` is the number behind it
 * when the shown text cannot tell zero apart (₹0.00, "0 days"). `hint` is a
 * line of secondary text under the figure.
 */

const isZero = (value, raw) => {
  if (raw !== undefined) return raw === null || !Number(raw);
  if (value === null || value === undefined || value === "" || value === "—") return true;
  if (typeof value === "number") return value === 0;
  return /^[−-]?₹?\s?0(\.0+)?%?$/.test(String(value).trim());
};

export function Figure({ label, value, raw, hint = null, showZero = false }) {
  if (!showZero && isZero(value, raw)) return null;
  return (
    <div className="min-w-0">
      <dt className="ui-t-label">{label}</dt>
      <dd className="ui-num m-0 text-[1.375rem] leading-7 font-semibold tabular-nums [overflow-wrap:anywhere]">{value}</dd>
      {hint ? <dd className="ui-caption m-0">{hint}</dd> : null}
    </div>
  );
}

/* Up to four figures in a row; `items` are Figure props. Nothing to show: nothing rendered. */
export function Figures({ items = [], label }) {
  const shown = items.filter((f) => f && (f.showZero || !isZero(f.value, f.raw)));
  if (!shown.length) return null;
  return (
    <dl className="grid gap-x-6 gap-y-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 10rem), 1fr))' }} aria-label={label}>
      {shown.map((f) => (
        <Figure key={f.label} {...f} />
      ))}
    </dl>
  );
}

export default Figure;
