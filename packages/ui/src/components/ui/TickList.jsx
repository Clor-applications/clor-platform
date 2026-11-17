/**
 * Choosing several from a short list as tick boxes, all in view (owner's style pick, 17 Nov 2026):
 * in place of a `<select multiple>`, which hides the choices and needs Ctrl to pick more than one.
 * `value` is an array of the chosen values.
 */
export default function TickList({ id, label, ariaLabel, options = [], value = [], onChange, disabled = false, columns = 1, scroll = false }) {
  const chosen = new Set(value.map(String));
  const flip = (v) => {
    const next = new Set(chosen);
    if (next.has(String(v))) next.delete(String(v)); else next.add(String(v));
    onChange?.(options.map((o) => o.value).filter((x) => next.has(String(x))));
  };
  return (
    <fieldset id={id} className={`ui-ticklist ${scroll ? 'is-scroll' : ''}`} disabled={disabled} aria-label={label ? undefined : ariaLabel} style={{ '--ticklist-cols': columns }}>
      {label ? <legend className="ui-label">{label}</legend> : null}
      {options.map((o) => (
        <label key={o.value} className="ui-ticklist-row">
          <input type="checkbox" checked={chosen.has(String(o.value))} onChange={() => flip(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
