import React, { useRef, useState } from 'react';
import { MoreVertical } from '@ui/components/ui/lineIcons';

import Popover from './Popover';

/** A ⋮ that opens a short menu of actions: a row's menu, a phone sheet's extra actions, a phone heading's Import and Export. */
export function RowMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const list = useRef(null);
  const onKey = (e) => {
    const all = [...(list.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])];
    const i = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  return (
    <>
      <button ref={btn} type="button" className="ui-icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <MoreVertical size={16} aria-hidden="true" />
      </button>
      {open ? (
        <Popover anchorRef={btn} onClose={() => setOpen(false)} minWidth={180} maxWidth={260}>
          <div ref={list} role="menu" aria-label={label} className="ui-menu" onKeyDown={onKey}>
            {items.map((it, i) => (
              /* The Popover hands the caret to [data-autofocus] once it is placed; focusing earlier is lost to the hidden panel. */
              <button key={it.key} type="button" role="menuitem" disabled={it.disabled} data-autofocus={i === items.findIndex((x) => !x.disabled) ? '' : undefined} className={`ui-menu-item ${it.danger ? 'is-danger' : ''}`}
                onClick={(e) => { e.stopPropagation(); setOpen(false); it.onSelect(); }}>
                {it.label}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}
