import React from 'react';
import './count-line.css';

/**
 * The count line (DESIGN.md "Page header"): a list page's figures as one quiet line under its title, in place
 * of figure tiles. "12 waiting · 3 approved this month".
 *
 * items: [{ key?, label, value, tone?: 'warn' | 'neg', onClick?, active?, busy? }]. A figure at zero or still
 * loading is left out. An item with `onClick` is a link that filters the list; `active` marks the filter as on.
 */
const lowerFirst = (t) => (typeof t === 'string' && /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
const isZero = (v) => v === 0 || v === '0' || v === null || v === undefined || v === '' || v === '—';

export function CountLine({ items, label = 'Figures' }) {
  const shown = (items || []).filter((it) => it && !it.busy && !isZero(it.value));
  if (!shown.length) return null;
  return (
    <p className="ui-count-line" aria-label={label}>
      {shown.map(({ key, label: what, value, onClick, tone, active }, i) => {
        const text = <><span className={`ui-count-line-figure ${tone ? `is-${tone}` : ''}`}>{value}</span> {lowerFirst(what)}</>;
        return (
          <React.Fragment key={key || what}>
            {i ? <span className="ui-count-line-sep" aria-hidden="true"> · </span> : null}
            {onClick ? <button type="button" className="ui-count-line-link" aria-pressed={active ? 'true' : 'false'} onClick={onClick}>{text}</button> : <span>{text}</span>}
          </React.Fragment>
        );
      })}
    </p>
  );
}

export default CountLine;
