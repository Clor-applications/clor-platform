/**
 * A field's help behind a small "i" (owner's style pick, 17 Nov 2026). Place it beside the field's
 * label, never inside the <label>. The words reach a screen reader two ways: the field points at a
 * hidden copy (`id`, for aria-describedby) and the "i" itself is named with them. A white tip shows
 * on hover or keyboard focus (TipLayer draws it from `title`).
 */
export default function HelpTip({ id, text }) {
  if (!text) return null;
  return (
    <>
      <button type="button" className="ui-helptip" title={text} aria-label={`Help: ${text}`} onClick={(e) => e.preventDefault()}>i</button>
      {id ? <span id={id} className="sr-only">{text}</span> : null}
    </>
  );
}
