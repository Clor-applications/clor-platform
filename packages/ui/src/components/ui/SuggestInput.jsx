import { forwardRef, useId, useMemo, useRef, useState } from 'react';

import Popover from './Popover';

/**
 * A text field that offers what the company already has.
 *
 * Owner rule (26 Oct 2026): every free-text field suggests matching data that
 * already exists — the cities people live in, the relationships already
 * entered, the next employee ID, the work-email domain. Typing stays free: a
 * suggestion is offered, never forced, and the field submits whatever is in
 * it.
 *
 * The caret never leaves the input (the combobox pattern): ↓ and ↑ move the
 * highlight, Enter takes it only once the arrows were used (so Enter in a form
 * still submits; a row the pointer rests on is only highlighted), Escape and
 * leaving the field close it. On focus the list opens with everything that
 * fits; typing narrows it, matches that start with the typed text first.
 *
 * `suggestions`: strings, or { value, hint } where hint is a few words shown
 * on the right ("Next ID", "Branch"). Values identical to the current text are
 * not offered.
 */
const MAX = 8;
const norm = (s) => String(s ?? '').trim().toLowerCase();

function rank(list, typed) {
  const q = norm(typed);
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const item = typeof raw === 'string' ? { value: raw } : raw;
    const v = String(item?.value ?? '').trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    if (q && v.toLowerCase() === q) continue;
    const at = q ? v.toLowerCase().indexOf(q) : 0;
    if (q && at < 0 && !item.always) continue;
    out.push({ ...item, value: v, score: item.always ? -1 : at === 0 ? 0 : 1 });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, MAX);
}

const SuggestInput = forwardRef(function SuggestInput({ value, onChange, suggestions, className = 'ui-input w-full', onFocus, onBlur, onKeyDown, ...rest }, outerRef) {
  const anchorRef = useRef(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /* Whether the highlight came from the arrows: only then does Enter take it. */
  const [keyed, setKeyed] = useState(false);
  const shown = useMemo(() => rank(suggestions, value), [suggestions, value]);
  const visible = open && shown.length > 0;

  const close = () => { setOpen(false); setActive(-1); setKeyed(false); };
  const take = (v) => {
    onChange?.(v);
    close();
  };
  const keys = (e) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!shown.length) return;
      e.preventDefault();
      setOpen(true);
      setKeyed(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i < 0 ? (step > 0 ? 0 : shown.length - 1) : (i + step + shown.length) % shown.length));
      return;
    }
    if (e.key === 'Enter' && visible && keyed && active >= 0 && shown[active]) {
      e.preventDefault();
      take(shown[active].value);
      return;
    }
    if (e.key === 'Escape' && visible) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <span ref={anchorRef} className="block">
      <input
        ref={outerRef}
        {...rest}
        className={className || 'ui-input w-full'}
        value={value ?? ''}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        aria-activedescendant={visible && keyed && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { onChange?.(e.target.value); setOpen(true); setActive(-1); setKeyed(false); }}
        onFocus={(e) => { setOpen(true); onFocus?.(e); }}
        /* Tab or a click elsewhere closes the list; a row takes its pick on pointer down, before the caret could leave. */
        onBlur={(e) => { if (!e.relatedTarget?.closest?.(`[id="${listId}"]`)) close(); onBlur?.(e); }}
        onClick={() => setOpen(true)}
        onKeyDown={keys}
      />
      {visible ? (
        <Popover anchorRef={anchorRef} onClose={close} autoFocus={false} minWidth={200}>
          <ul id={listId} role="listbox" className="ui-suggest-list">
            {shown.map((s, i) => (
              <li
                key={s.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={keyed && i === active}
                data-active={i === active}
                className="ui-suggest-option"
                /* Pointer down, not click: the input keeps focus and the list does not close first. */
                onPointerDown={(e) => { e.preventDefault(); take(s.value); }}
                onMouseEnter={() => { setActive(i); setKeyed(false); }}
              >
                <span className="truncate">{s.value}</span>
                {s.hint ? <span className="ui-caption shrink-0">{s.hint}</span> : null}
              </li>
            ))}
          </ul>
        </Popover>
      ) : null}
    </span>
  );
});

export default SuggestInput;
export { rank as rankSuggestions };
