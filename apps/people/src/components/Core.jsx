import React from 'react';
import { ArrowLeft } from '@ui/components/ui/lineIcons';
import '../people-core.css';

/**
 * The pieces People's employee-side screens share (R&D hand-off, PEOPLE-02..10): KPI tiles, the back link above a
 * page title, a soft panel for charts and a side summary card. Styles live in people-core.css.
 */

/*
 * KPI tiles (README §3 "KPI tiles"): a 36px tinted icon chip, a 12px uppercase label, a 28/36 tabular figure, a note,
 * and a 3px top accent in the tile's identity colour (`cat`, 1–8 of the categorical palette). A delta pill is coloured
 * by meaning (`good`), not by direction. A tile with `onClick` is a button that filters the list under it.
 */
export function KpiTiles({ items, label }) {
  const shown = items.filter(Boolean);
  return (
    <div className="pc-kpis" role="list" aria-label={label} data-count={shown.length}>
      {shown.map(({ key, label: l, value, note, delta, good = true, tone, cat = 1, Icon, onClick }) => {
        const body = (
          <>
            <span className="pc-kpi-icon" aria-hidden="true">{Icon ? <Icon /> : <i />}</span>
            <span className="pc-kpi-label">{l}</span>
            <span className="pc-kpi-value" data-tone={tone || undefined} data-zero={Number(value) === 0 || undefined}>{value ?? '—'}</span>
            {note || delta ? (
              <span className="pc-kpi-note">
                {delta ? <span className="pc-delta" data-good={good ? 'yes' : 'no'}>{delta}</span> : null}
                {note ? <span className="truncate">{note}</span> : null}
              </span>
            ) : null}
          </>
        );
        return (
          <div key={key || l} role="listitem" className="pc-kpi-cell" style={{ '--pc-id': `var(--cat-${cat})` }}>
            {onClick ? <button type="button" className="pc-kpi" onClick={onClick}>{body}</button> : <div className="pc-kpi">{body}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** "← Employees" above a record's title. */
export function BackLink({ label, onClick }) {
  return (
    <button type="button" className="pc-back" onClick={onClick}>
      <ArrowLeft size={16} aria-hidden="true" /> {label}
    </button>
  );
}

/** A named bar chart on the soft panel (PEOPLE-02 By department): categorical colours in order, never past 8. */
export function BarPanel({ rows, label, max }) {
  const top = max || Math.max(1, ...rows.map((r) => r.count));
  const eight = rows.length > 8 ? [...rows.slice(0, 7), { name: 'Other', count: rows.slice(7).reduce((a, r) => a + r.count, 0) }] : rows;
  return (
    <figure className="pc-bars" aria-label={`${label}: ${eight.map((r) => `${r.name} ${r.count}`).join(', ')}`}>
      <ul>
        {eight.map((r, i) => (
          <li key={r.name} style={{ '--pc-id': `var(--cat-${(i % 8) + 1})` }}>
            <span className="truncate">{r.name}</span>
            <span className="pc-bar" aria-hidden="true"><span style={{ width: `${Math.max(1, (r.count / top) * 100)}%` }} /></span>
            <b>{r.count}</b>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** A filled meter on the sunken track (Benefits, Onboarding): the fill is the identity colour, the value stays in ink. */
export function Meter({ value, max, cat = 1, label }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <span className="pc-meter" role="img" aria-label={label || `${pct}%`} style={{ '--pc-id': `var(--cat-${cat})` }}><span style={{ width: `${pct}%` }} /></span>;
}
