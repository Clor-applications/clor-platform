import React from 'react';
import {
  Beach20Color, Briefcase20Color, CalendarCheckmark20Color, CalendarClock20Color, CheckmarkCircle20Color, Clock20Color,
  CoinMultiple20Color, PeopleAdd20Color, PersonWarning20Color, ShieldCheckmark20Color, Trophy20Color, BookOpenLightbulb20Color,
  Gift20Color, ChatBubblesQuestion20Color, People20Color,
} from '@fluentui/react-icons';
import { colorSet } from '@ui/components/ui/colorIcon';
import { swatchOf } from './api';
/* People's R&D look for time, leave, hiring, growth and the HR checks (clor-rnd PEOPLE-11..27). The CSS is People's
   own file; these parts are shared with Attendance, so the import travels with them and both apps draw the same. */
import './time-off.css';

/**
 * The figures every R&D People screen opens with, and the small charts under them.
 *
 * - StatTiles: up to five tiles, each with a 3px top edge in its colour, a tinted icon square, an uppercase label,
 *   the figure and one line under it. `accent` is a categorical slot (1–8) or a status ('warn' | 'pos' | 'neg');
 *   `tone` colours the figure itself and is for state only (a count waiting, a share at risk).
 * - LeavePill: a leave type's name on a wash of its identity colour, with its dot. The name always goes with it.
 * - BarList / Columns: bars that start at zero, in the categorical palette's order (or all one colour when the
 *   bars are one series), with the figure written beside each bar so the colour is never the only signal.
 * - Meter: a progress bar with its percentage written out.
 */

/** The tiles' Fluent colour icons, by what they count. */
export const TILE_ICON = colorSet({
  waiting: CalendarCheckmark20Color, done: CheckmarkCircle20Color, time: Clock20Color, away: Beach20Color, low: PersonWarning20Color,
  money: CoinMultiple20Color, job: Briefcase20Color, people: PeopleAdd20Color, award: Trophy20Color, course: BookOpenLightbulb20Color,
  due: CalendarClock20Color, shield: ShieldCheckmark20Color, gift: Gift20Color, cases: ChatBubblesQuestion20Color, team: People20Color,
}, 20);

const ACCENT = { warn: 'var(--warn-ink)', pos: 'var(--pos)', neg: 'var(--neg)', neutral: 'var(--fg-subtle)' };
const accentVar = (a) => ACCENT[a] || `var(--cat-${Number(a) || 1})`;

export function Delta({ value, good = true, children }) {
  const up = String(value).trim().startsWith('+') || Number(value) > 0;
  return (
    <span className="pt-delta-line">
      <span className={`pt-delta ${good ? 'is-good' : 'is-bad'}`}><span aria-hidden="true">{up ? '▲' : '▼'}</span> {String(value).replace(/^-/, '−')}</span>
      {children}
    </span>
  );
}

export function StatTile({ label, value, sub = null, accent = 1, tone = null, Icon = null, onClick = null, busy = false }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`pt-tile ${onClick ? 'is-link' : ''}`} style={{ '--tile': accentVar(accent) }} onClick={onClick || undefined} role={onClick ? undefined : 'listitem'}>
      <span className="pt-tile-head">
        <span className="pt-tile-icon" aria-hidden="true">{Icon ? <Icon size={20} /> : <span className="pt-tile-dot" />}</span>
        <span className="pt-tile-label">{label}</span>
      </span>
      <span className={`pt-tile-value ${tone ? `is-${tone}` : ''}`}>{busy ? <span className="ui-skel ui-skel-text" style={{ width: '3rem' }} /> : value}</span>
      {sub ? <span className="pt-tile-sub">{sub}</span> : null}
    </Tag>
  );
}

export function StatTiles({ items, label = 'Figures' }) {
  const shown = (items || []).filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="pt-tiles" role="list" aria-label={label}>
      {shown.map(({ key, ...it }) => (it.onClick ? <div key={key || it.label} role="listitem" className="pt-tile-cell"><StatTile {...it} /></div> : <StatTile key={key || it.label} {...it} />))}
    </div>
  );
}

/** A leave type's name on its own colour: `type` is a leave type, or a row with `leaveTypeName` / `leaveTypeColor`. */
export function LeavePill({ type, children = null }) {
  const name = type?.name ?? type?.leaveTypeName ?? '';
  const swatch = swatchOf({ name, color: type?.color ?? type?.leaveTypeColor });
  return (
    <span className="pt-leave" style={{ '--leave': swatch }}>
      <span className="pt-leave-dot" aria-hidden="true" />
      {children || name}
    </span>
  );
}

/** Horizontal bars from zero. rows: [{ key?, label, value, text? }]; `one` draws every bar in the first colour. */
export function BarList({ rows, label, one = false, max = null, suffix = '' }) {
  const top = max ?? Math.max(0, ...rows.map((r) => Number(r.value) || 0));
  return (
    <ul className="pt-bars" aria-label={label}>
      {rows.map((r, i) => {
        const v = Math.max(0, Number(r.value) || 0);
        const w = top > 0 ? Math.min(100, (v / top) * 100) : 0;
        return (
          <li key={r.key || r.label} className="pt-bar-row">
            <span className="pt-bar-label">{r.label}</span>
            <span className="pt-bar-track" aria-hidden="true"><span className="pt-bar" style={{ width: `${w}%`, '--bar': r.color || (one ? 'rgb(var(--cat-1))' : `rgb(var(--cat-${(i % 8) + 1}))`) }} /></span>
            <span className="pt-bar-value">{r.text ?? `${v}${suffix}`}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Vertical bars from zero, one series in the first categorical colour, each with its figure on top. */
export function Columns({ rows, label }) {
  const top = Math.max(0, ...rows.map((r) => Number(r.value) || 0));
  return (
    <div className="pt-cols" role="img" aria-label={`${label}: ${rows.map((r) => `${r.label} ${r.text ?? r.value}`).join(', ')}`}>
      {rows.map((r) => {
        const v = Math.max(0, Number(r.value) || 0);
        return (
          <div key={r.key || r.label} className="pt-col">
            <span className="pt-col-value">{r.text ?? v}</span>
            <span className="pt-col-track"><span className="pt-col-bar" style={{ height: `${top > 0 ? (v / top) * 100 : 0}%` }} /></span>
            <span className="pt-col-label">{r.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Progress, 0–100, with the figure written beside the bar. */
export function Meter({ value, text = null, tone = null }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <span className="pt-meter">
      <span className="pt-meter-track" aria-hidden="true"><span className={`pt-meter-bar ${tone ? `is-${tone}` : ''}`} style={{ width: `${v}%` }} /></span>
      <span className="pt-meter-value">{text ?? `${Math.round(v)}%`}</span>
    </span>
  );
}

/** A heading over a chart panel (soft ground, no border), with an optional note at the right. */
export function ChartPanel({ title, note = null, children, className = '' }) {
  return (
    <section className={`pt-chart ${className}`} aria-label={title}>
      <header className="pt-chart-head"><h2 className="pt-h2">{title}</h2>{note ? <span className="pt-chart-note">{note}</span> : null}</header>
      <div className="pt-chart-body">{children}</div>
    </section>
  );
}

/** A one-line notice under a list: warn (amber) or info (neutral). */
export function Notice({ tone = 'warn', icon: Icon = null, children }) {
  return (
    <div className={`pt-notice is-${tone}`} role={tone === 'warn' ? 'status' : undefined}>
      {Icon ? <Icon size={18} aria-hidden="true" className="pt-notice-icon" /> : null}
      <span>{children}</span>
    </div>
  );
}
