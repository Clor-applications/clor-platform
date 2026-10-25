import React, { useId, useRef } from 'react';

/**
 * Record tabs (People design spec v1 §5 "Tabs"): distinct sections of one
 * record. A tablist with roving focus — Left/Right/Home/End move and select,
 * as the WAI-ARIA tabs pattern does — and one tabpanel. The caller keeps the
 * chosen tab in the address (shell `updateParams`) so Back and refresh keep it.
 * Tabs the viewer may not open are simply not passed in.
 */
export default function RecordTabs({ tabs, value, onChange, label = 'Sections', children }) {
  const base = useId();
  const refs = useRef({});
  const keys = tabs.map((t) => t.key);
  const current = keys.includes(value) ? value : keys[0];
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
      <div role="tablist" aria-label={label} className="ui-record-tablist" onKeyDown={onKey}>
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
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${current}`} tabIndex={0} className="ui-record-tabpanel">
        {children}
      </div>
    </div>
  );
}
