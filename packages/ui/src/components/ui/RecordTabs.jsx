import React, { useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * Record tabs (People design spec v1 §5 "Tabs"): distinct sections of one
 * record. A tablist with roving focus — Left/Right/Home/End move and select,
 * as the WAI-ARIA tabs pattern does — and one tabpanel. The caller keeps the
 * chosen tab in the address (shell `updateParams`) so Back and refresh keep it.
 * Tabs the viewer may not open are simply not passed in.
 */
/*
 * The underline slides from the tab you left to the one you chose, so the eye
 * follows the change of section. It measures the active tab after layout and
 * after any resize; without a measurement yet it is not drawn and the tab's
 * own underline shows instead.
 */
export function useTabIndicator(listRef, activeKey) {
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const place = () => {
      const tab = list.querySelector('[role="tab"][aria-selected="true"]');
      setBox(tab ? { left: tab.offsetLeft, width: tab.offsetWidth } : null);
    };
    place();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    ro?.observe(list);
    return () => ro?.disconnect();
  }, [listRef, activeKey]);
  return box ? <span className="ui-tab-indicator" aria-hidden="true" style={{ transform: `translateX(${box.left}px)`, width: box.width }} /> : null;
}

export default function RecordTabs({ tabs, value, onChange, label = 'Sections', children }) {
  const base = useId();
  const refs = useRef({});
  const keys = tabs.map((t) => t.key);
  const current = keys.includes(value) ? value : keys[0];
  const listRef = useRef(null);
  const indicator = useTabIndicator(listRef, current);
  const move = (to) => {
    const key = keys[(to + keys.length) % keys.length];
    onChange(key);
    refs.current[key]?.focus();
  };
  const onKey = (e) => {
    const i = keys.indexOf(current);
    if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(keys.length - 1); }
  };
  return (
    <div className="ui-record-tabs">
      <div ref={listRef} role="tablist" aria-label={label} className={`ui-record-tablist ${indicator ? 'has-indicator' : ''}`} onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.key}
            ref={(el) => { refs.current[t.key] = el; }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.key}`}
            aria-selected={t.key === current}
            aria-controls={`${base}-panel`}
            tabIndex={t.key === current ? 0 : -1}
            className={`ui-tab ${t.key === current ? 'is-active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            {t.label}
            {t.count != null ? <span className="ui-caption tabular-nums ml-1">{t.count}</span> : null}
          </button>
        ))}
        {indicator}
      </div>
      <div key={current} role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${current}`} tabIndex={0} className="ui-record-tabpanel ui-panel-in">
        {children}
      </div>
    </div>
  );
}
